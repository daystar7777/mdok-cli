/** Allocate only visible panes; hidden source must not consume preview width. */
export function paneWidths(width: number, mode: "split" | "source" | "preview") {
  const available = Math.max(0, Math.floor(width));
  const source = mode === "preview" ? 0 : mode === "source" ? available : Math.floor(available / 2);
  return { source, preview: available - source };
}
