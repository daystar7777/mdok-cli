import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { writeFileAtomic, writeFileAtomicSync } from "./atomic.js";

export interface SessionTab {
  path: string;
  cursor: { r: number; c: number };
  /** Unsaved buffer content (when dirty). Absent = matches disk. */
  content?: string;
}

export interface Session {
  files: SessionTab[];
  active: number;
}

const SESSION_PATH = join(homedir(), ".mdok-session.json");
const safeIndex = (value: unknown): number => typeof value === "number" && Number.isFinite(value)
  ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0;

export async function loadSession(): Promise<Session | null> {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    const raw = JSON.parse(await readFile(SESSION_PATH, "utf-8")) as Partial<Session>;
    if (!raw || !Array.isArray(raw.files) || !raw.files.length) return null;
    const entries = raw.files
      .map((file, originalIndex) => ({ file, originalIndex }))
      .filter(({ file }) => file && typeof file.path === "string" && file.path.length > 0)
      .slice(0, 10);
    const files = entries
      .map(({ file: f }) => ({
        path: f.path,
        cursor: {
          r: safeIndex(f.cursor?.r),
          c: safeIndex(f.cursor?.c),
        },
        ...(typeof f.content === "string" ? { content: f.content } : {}),
      }));
    if (!files.length) return null;
    const active = entries.findIndex(entry => entry.originalIndex === safeIndex(raw.active));
    return { files, active: active >= 0 ? active : Math.min(safeIndex(raw.active), files.length - 1) };
  } catch {
    return null;
  }
}

export async function saveSession(s: Session): Promise<void> {
  try {
    await writeFileAtomic(SESSION_PATH, JSON.stringify(s) + "\n");
  } catch {
    // best effort
  }
}

export function saveSessionSync(s: Session): void {
  try {
    writeFileAtomicSync(SESSION_PATH, JSON.stringify(s) + "\n");
  } catch {
    // best effort
  }
}
