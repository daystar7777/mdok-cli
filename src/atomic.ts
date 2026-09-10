import { writeFile, rename, lstat, chmod } from "node:fs/promises";
import { writeFileSync, renameSync, unlinkSync, lstatSync, chmodSync } from "node:fs";
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
    let mode = 0o600;
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error("Refusing to replace a symbolic link; open the target file directly");
      mode = info.mode & 0o777;
    }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
    await writeFile(tmp, data, { encoding: "utf-8", mode: 0o600, flag: "wx" });
    await chmod(tmp, mode);
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
    let mode = 0o600;
    try {
      const info = lstatSync(target);
      if (info.isSymbolicLink()) throw new Error("Refusing to replace a symbolic link; open the target file directly");
      mode = info.mode & 0o777;
    }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
    writeFileSync(tmp, data, { encoding: "utf-8", mode: 0o600, flag: "wx" });
    chmodSync(tmp, mode);
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
