import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';

export type MarkdownProfile = 'gfm' | 'commonmark';
export interface Range { start: number; end: number }
export interface SourceNode { type: string; position?: {start: {offset?: number}; end: {offset?: number}}; children?: SourceNode[] }
export const MAX_DOCUMENT = 1024 * 1024;
export function parseDocument(text: string, profile: MarkdownProfile = 'gfm'): SourceNode {
  if (text.length > MAX_DOCUMENT) throw new Error('Document analysis limit: 1 Mi UTF-16 units');
  if (profile !== 'gfm' && profile !== 'commonmark') throw new Error('Unsupported analysis profile');
  return fromMarkdown(text, profile === 'gfm' ? {extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]} : {}) as SourceNode;
}
export function nodeRange(node: SourceNode): Range {
  return { start: node.position?.start.offset ?? 0, end: node.position?.end.offset ?? 0 };
}
export function walk(node: SourceNode, visit: (node: SourceNode) => void): void {
  visit(node); for (const child of node.children ?? []) walk(child, visit);
}
export function excludedRanges(text: string, root: SourceNode): Range[] {
  const ranges: Range[] = [];
  walk(root, n => {
    if (['code','inlineCode','html','definition','image','imageReference'].includes(n.type)) ranges.push(nodeRange(n));
    if (n.type === 'link' || n.type === 'linkReference') {
      const last = n.children?.at(-1);
      if(last) ranges.push({start:nodeRange(last).end,end:nodeRange(n).end});
    }
  });
  // Front matter is data, not math, even when the chosen Markdown reader lacks it.
  const front = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  if(front) ranges.push({start:0,end:front[0].length});
  return ranges;
}
export function linePosition(text: string, offset: number): {line: number; col: number} {
  const before = text.slice(0,offset), line = (before.match(/\n/g) ?? []).length;
  return {line, col:offset - before.lastIndexOf('\n') - 1};
}
export function safeDisplay(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2,'0')}`);
}
