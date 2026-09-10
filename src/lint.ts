export interface LintProblem {
  line: number; // 0-based
  col: number;
  rule: string;
  msg: string;
}

/** Small markdown linter: whitespace, blank runs, heading jumps, fences. */
export function lintMarkdown(lines: string[]): LintProblem[] {
  const out: LintProblem[] = [];
  let inFence = false;
  let prevLevel = 0;
  let blanks = 0;
  lines.forEach((ln, i) => {
    if (/^(```+|~~~+)/.test(ln.trim())) inFence = !inFence;
    if (!inFence) {
      const trail = ln.match(/[ \t]+$/);
      if (trail && ln.trim() !== "") {
        out.push({ line: i, col: ln.length - trail[0].length, rule: "trail", msg: "trailing whitespace" });
      }
      const h = ln.match(/^(#{1,6})\s+\S/);
      if (h) {
        const lv = h[1].length;
        if (prevLevel > 0 && lv > prevLevel + 1) {
          out.push({ line: i, col: 0, rule: "heading", msg: `heading jumped H${prevLevel} → H${lv}` });
        }
        prevLevel = lv;
      }
    }
    if (ln.trim() === "") {
      blanks += 1;
      if (blanks === 2) out.push({ line: i, col: 0, rule: "blanks", msg: "more than one blank line" });
    } else {
      blanks = 0;
    }
  });
  if (inFence) {
    out.push({ line: Math.max(0, lines.length - 1), col: 0, rule: "fence", msg: "unclosed code fence" });
  }
  return out;
}

/** Normalize whitespace: trim line ends, collapse blank runs to one. */
export function formatMd(lines: string[]): { lines: string[]; fixes: number } {
  let fixes = 0;
  const out: string[] = [];
  let blanks = 0;
  for (const ln of lines) {
    const t = ln.replace(/[ \t]+$/, "");
    if (t !== ln) fixes += 1;
    if (t.trim() === "") {
      blanks += 1;
      if (blanks > 1) {
        fixes += 1;
        continue;
      }
    } else {
      blanks = 0;
    }
    out.push(t);
  }
  return { lines: out, fixes };
}

function splitPipeRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function isSepCell(c: string): boolean {
  return /^:?-+:?$/.test(c);
}

export interface DiffRow {
  t: " " | "-" | "+";
  text: string;
}

/** Tiny LCS line diff for review UIs. Falls back to dumb replace on big inputs. */
export function diffLines(a: string[], b: string[]): DiffRow[] {
  if (a.length * b.length > 40000) {
    return [...a.map((text) => ({ t: "-" as const, text })), ...b.map((text) => ({ t: "+" as const, text }))];
  }
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: " ", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ t: "-", text: a[i] });
      i += 1;
    } else {
      out.push({ t: "+", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ t: "-", text: a[i] });
    i += 1;
  }
  while (j < m) {
    out.push({ t: "+", text: b[j] });
    j += 1;
  }
  return out;
}
export function formatTable(lines: string[], row: number): { lines: string[]; changed: boolean } {
  if (!lines[row]?.includes("|")) return { lines, changed: false };
  let top = row;
  let bot = row;
  while (top > 0 && lines[top - 1].includes("|")) top -= 1;
  while (bot < lines.length - 1 && lines[bot + 1].includes("|")) bot += 1;
  const block = lines.slice(top, bot + 1).map(splitPipeRow);
  if (block.length < 1) return { lines, changed: false };
  const ncols = Math.max(...block.map((r) => r.length));
  const norm = block.map((r) => {
    const a = [...r];
    while (a.length < ncols) a.push("");
    return a.slice(0, ncols);
  });
  let align: Array<"left" | "center" | "right"> = Array(ncols).fill("left");
  let body = norm;
  if (norm.length > 1 && norm[1].every(isSepCell)) {
    align = norm[1].map((c) =>
      c.startsWith(":") && c.endsWith(":") && c.length > 2
        ? "center"
        : c.endsWith(":")
          ? "right"
          : "left",
    );
    body = [norm[0], ...norm.slice(2)];
  }
  const widths = Array.from({ length: ncols }, (_, c) =>
    Math.max(1, ...body.map((r) => r[c].length)),
  );
  const cell = (s: string, c: number) => {
    const w = widths[c];
    const a = align[c];
    if (a === "right") return s.padStart(w);
    if (a === "center") {
      const gap = Math.max(0, w - s.length);
      const left = Math.floor(gap / 2);
      return " ".repeat(left) + s + " ".repeat(gap - left);
    }
    return s.padEnd(w);
  };
  const fmtRow = (r: string[]) => `| ${r.map(cell).join(" | ")} |`;
  const sepRow =
    "|" +
    widths
      .map((w, c) =>
        align[c] === "center"
          ? `:${"-".repeat(w)}:`
          : align[c] === "right"
            ? `${"-".repeat(w + 1)}:`
            : `:${"-".repeat(w + 1)}`,
      )
      .join("|") +
    "|";
  const next = [...lines];
  const formatted = [fmtRow(body[0]), sepRow, ...body.slice(1).map(fmtRow)];
  formatted.forEach((ln, i) => {
    next[top + i] = ln;
  });
  const changed = formatted.some((ln, i) => ln !== lines[top + i]);
  return { lines: next, changed };
}
