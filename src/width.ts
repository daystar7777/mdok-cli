/** Display width of a single character: East Asian wide/fullwidth = 2. */
export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0) return 0;
  // Combining marks / variation selectors / zero-width
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    cp === 0x200b ||
    cp === 0xfeff ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef)
  ) {
    return 0;
  }
  // Wide / fullwidth ranges
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1b000 && cp <= 0x1b001) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Display width of a string (counts UTF-16 surrogate pairs once). */
export function strWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

export interface WidthSlice {
  /** Renderable text fitting in maxWidth columns. */
  text: string;
  /** UTF-16 offset in s where the slice starts/ends. */
  startIdx: number;
  endIdx: number;
  /** Visual column where the slice starts/ends. */
  startCol: number;
  endCol: number;
}

/** Slice a string by visual columns (for fixed-width terminal panes). */
export function sliceByWidth(s: string, startCol: number, maxWidth: number): WidthSlice {
  let col = 0; // visual column where the current char starts
  let ti = 0; // UTF-16 offset
  let startIdx = -1;
  let endIdx = -1;
  for (const ch of s) {
    const w = charWidth(ch);
    if (startIdx < 0 && col + w > startCol) startIdx = ti;
    if (startIdx >= 0) {
      if (col >= startCol + maxWidth) break;
      endIdx = ti + ch.length;
    }
    col += w;
    ti += ch.length;
  }
  if (startIdx < 0) {
    return { text: "", startIdx: s.length, endIdx: s.length, startCol: col, endCol: col };
  }
  const text = s.slice(startIdx, endIdx);
  return { text, startIdx, endIdx, startCol, endCol: startCol + strWidth(text) };
}

/** Visual column of a UTF-16 offset within s. */
export function colOfIndex(s: string, idx: number): number {
  return strWidth(s.slice(0, Math.max(0, Math.min(idx, s.length))));
}

/** UTF-16 offset at (nearest to) a visual column within s. */
export function indexOfCol(s: string, col: number): number {
  let c = 0;
  let i = 0;
  for (const ch of s) {
    const w = charWidth(ch);
    if (c + w > col) break;
    c += w;
    i += ch.length;
  }
  return i;
}
