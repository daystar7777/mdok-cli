import { writeFile, rename } from "node:fs/promises";
import { writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";

function tmpPath(target: string): string {
  return join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
}

/**
 * Crash-safe write for synced folders (iCloud/Dropbox/Syncthing/git):
 * same-dir temp file + atomic rename, so watchers never see half a file.
 */
export async function writeFileAtomic(target: string, data: string): Promise<void> {
  const tmp = tmpPath(target);
  try {
    await writeFile(tmp, data, "utf-8");
    await rename(tmp, target);
  } catch (err) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

export function writeFileAtomicSync(target: string, data: string): void {
  const tmp = tmpPath(target);
  try {
    writeFileSync(tmp, data, "utf-8");
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}
