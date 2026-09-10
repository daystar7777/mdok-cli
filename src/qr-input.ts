/** Strip complete mouse reports without dropping a real key in the same chunk. */
export function qrInputAction(input: string, key: { escape?: boolean; leftArrow?: boolean; rightArrow?: boolean; eventType?: string }): "close" | "toggle" | "next" | "previous" | null {
  if (key.eventType === "release" || key.eventType === "repeat") return null;
  const clean = input.replace(/\x1b?\[<\d+;\d+;\d+[Mm]/g, "")
    .replace(/\x1b?\[M[\x20-\xff]{3}/g, "");
  if (clean === "q" || (key.escape && (input === "" || input === "\x1b"))) return "close";
  if (clean === " ") return "toggle";
  if (key.leftArrow || clean === "p" || /^(?:\x1b)?\[D$/.test(clean)) return "previous";
  if (key.rightArrow || clean === "n" || /^(?:\x1b)?\[C$/.test(clean)) return "next";
  return null;
}
