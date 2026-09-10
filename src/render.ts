import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal() as never);

export function renderMarkdown(md: string): string {
  return marked(md) as string;
}
