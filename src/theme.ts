import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface TuiTheme {
  name: string;
  focus: string;
  selBg: string;
  selFg: string;
  findBg: string;
  findFg: string;
  findCurBg: string;
  findCurFg: string;
  accent: string;
}

export const BUILTIN_THEMES: TuiTheme[] = [
  { name: "forest", focus: "green", selBg: "blue", selFg: "white", findBg: "yellow", findFg: "black", findCurBg: "red", findCurFg: "white", accent: "cyan" },
  { name: "ocean", focus: "#00afff", selBg: "#005f87", selFg: "white", findBg: "#ffd75f", findFg: "black", findCurBg: "#ff5f00", findCurFg: "white", accent: "#00afff" },
  { name: "sunset", focus: "#ffaf00", selBg: "#875f00", selFg: "white", findBg: "#ffff87", findFg: "black", findCurBg: "#d70000", findCurFg: "white", accent: "#ffaf00" },
  { name: "mono", focus: "white", selBg: "white", selFg: "black", findBg: "gray", findFg: "white", findCurBg: "white", findCurFg: "black", accent: "gray" },
  { name: "rose", focus: "magenta", selBg: "#870087", selFg: "white", findBg: "#ffd7ff", findFg: "black", findCurBg: "#d7005f", findCurFg: "white", accent: "magenta" },
];

const THEMES_PATH = join(homedir(), ".mdok-themes.json");
const KEYS = ["focus", "selBg", "selFg", "findBg", "findFg", "findCurBg", "findCurFg", "accent"] as const;

function validTheme(v: unknown): v is TuiTheme {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name) return false;
  return KEYS.every((k) => typeof o[k] === "string" && (o[k] as string).length > 0);
}

/**
 * Custom color schemes from ~/.mdok-themes.json:
 * { "themes": [ { "name": "mine", "focus": "cyan", ... } ] }
 * Same-name custom themes override builtins; invalid entries are skipped.
 */
export async function loadThemes(): Promise<TuiTheme[]> {
  const merged = [...BUILTIN_THEMES];
  if (!existsSync(THEMES_PATH)) return merged;
  try {
    const raw = JSON.parse(await readFile(THEMES_PATH, "utf-8")) as { themes?: unknown };
    const list = Array.isArray(raw?.themes) ? raw.themes : [];
    for (const t of list) {
      if (!validTheme(t)) continue;
      const at = merged.findIndex((m) => m.name === t.name);
      if (at >= 0) merged[at] = t;
      else merged.push(t);
    }
  } catch {
    // malformed file: builtins only
  }
  return merged;
}

export function themeByName(list: TuiTheme[], name: string): TuiTheme {
  return list.find((t) => t.name === name) ?? BUILTIN_THEMES[0];
}

export function themesPath(): string {
  return THEMES_PATH;
}
