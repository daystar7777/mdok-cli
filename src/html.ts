import { Marked } from "marked";

// Dedicated instance (render.ts registers a terminal renderer on the global
// marked — this one stays clean HTML).
const htmlMarked = new Marked({ gfm: true, breaks: false });

const CSS = [
  "body{font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:860px;margin:2rem auto;padding:0 1.5rem;line-height:1.6;color:#1f2328}",
  "@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}}",
  "pre{background:#f6f8fa;padding:1rem;overflow:auto;border-radius:6px}",
  "@media (prefers-color-scheme:dark){pre{background:#161b22}}",
  "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}",
  "table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:.4rem .8rem}",
  "blockquote{border-left:4px solid #d0d7de;margin:0;padding-left:1rem;color:#57606a}",
  "img{max-width:100%}",
].join("");

export function markdownToHtml(md: string, title: string): string {
  const body = htmlMarked.parse(md) as string;
  const safe = title.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${safe}</title>\n<style>${CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}
