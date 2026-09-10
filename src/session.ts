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

export async function loadSession(): Promise<Session | null> {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    const raw = JSON.parse(await readFile(SESSION_PATH, "utf-8")) as Partial<Session>;
    if (!raw || !Array.isArray(raw.files) || !raw.files.length) return null;
    const files = raw.files
      .filter((f) => f && typeof f.path === "string")
      .map((f) => ({
        path: f.path,
        cursor: {
          r: Math.max(0, f.cursor?.r ?? 0),
          c: Math.max(0, f.cursor?.c ?? 0),
        },
        ...(typeof f.content === "string" ? { content: f.content } : {}),
      }))
      .slice(0, 10);
    if (!files.length) return null;
    return { files, active: Math.min(Math.max(0, raw.active ?? 0), files.length - 1) };
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
