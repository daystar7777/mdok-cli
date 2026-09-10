import { execFile } from "node:child_process";
import { relative, resolve, isAbsolute } from "node:path";

function sh(file: string, args: string[], cwd: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().slice(0, 300)));
      else resolve(stdout);
    });
  });
}

/** Parse `git status --porcelain=v1` output: path -> short status. Pure, tested. */
export function parseGitPorcelain(out: string): Map<string, string> {
  const m = new Map<string, string>();
  if (out.includes("\0")) {
    const records = out.split("\0");
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (record.length < 4) continue;
      const x = record[0], y = record[1];
      const st = y !== " " && y !== "?" ? y : x;
      m.set(record.slice(3), st === "?" ? "??" : st);
      // -z emits destination first, then source as a separate NUL record.
      if (/[RC]/.test(x + y)) i++;
    }
    return m;
  }
  for (const ln of out.split("\n")) {
    if (ln.length < 4) continue;
    const x = ln[0];
    const y = ln[1];
    let p = ln.slice(3).trim();
    if ((x === "R" || x === "C") && p.includes(" -> ")) {
      p = p.slice(p.indexOf(" -> ") + 4);
    }
    p = p.replace(/^"|"$/g, "");
    if (!p) continue;
    const st = y !== " " && y !== "?" ? y : x;
    m.set(p, st === "?" ? "??" : st);
  }
  return m;
}

/** Status of worktree files relative to cwd (empty map outside a repo). */
export function gitStatus(cwd: string): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    execFile("git", ["status", "--porcelain=v1", "-z", "-uall"], { cwd, timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve(new Map());
        return;
      }
      try {
        resolve(parseGitPorcelain(stdout));
      } catch {
        resolve(new Map());
      }
    });
  });
}

export interface GitSyncState {
  root: string;
  branch: string;
  ahead: number;
  behind: number;
  /** False when the branch has no tracking upstream. */
  upstream: boolean;
  /** Unmerged paths present (resolve in git). */
  conflict: boolean;
}

/** Repo root or null. */
export async function gitRoot(cwd: string): Promise<string | null> {
  try {
    return (await sh("git", ["rev-parse", "--show-toplevel"], cwd, 5000)).trim() || null;
  } catch {
    return null;
  }
}

export async function gitSyncState(root: string): Promise<GitSyncState | null> {
  try {
    const [branchRaw, counts, unmerged] = await Promise.all([
      sh("git", ["rev-parse", "--abbrev-ref", "HEAD"], root).catch(() => "HEAD"),
      sh("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], root).catch(() => ""),
      sh("git", ["ls-files", "-u"], root).catch(() => ""),
    ]);
    let ahead = 0;
    let behind = 0;
    let upstream = false;
    const m = counts.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) {
      upstream = true;
      ahead = parseInt(m[1], 10);
      behind = parseInt(m[2], 10);
    }
    return {
      root,
      branch: branchRaw.trim() || "(detached)",
      ahead,
      behind,
      upstream,
      conflict: unmerged.trim().length > 0,
    };
  } catch {
    return null;
  }
}

export async function gitCommitAll(root: string, msg: string): Promise<void> {
  await sh("git", ["add", "-A"], root);
  await sh("git", ["-c", "user.name=mdok", "-c", "user.email=mdok@local", "commit", "-qm", msg], root);
}

/** Commit only the saved file, preserving unrelated staged/unstaged changes. */
export async function gitCommitFile(root: string, path: string, msg: string): Promise<void> {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error("File is outside the repository");
  }
  await sh("git", ["--literal-pathspecs", "add", "--", rel], root);
  await sh("git", ["--literal-pathspecs", "-c", "user.name=mdok", "-c", "user.email=mdok@local", "commit", "--only", "-qm", msg, "--", rel], root);
}

export async function gitPullRebase(root: string): Promise<string> {
  return (await sh("git", ["pull", "--rebase", "--autostash"], root, 60000)).trim();
}

export async function gitPush(root: string): Promise<string> {
  try {
    return (await sh("git", ["push"], root, 60000)).trim();
  } catch {
    // No upstream configured yet — set it from the current branch.
    return (await sh("git", ["push", "-u", "origin", "HEAD"], root, 60000)).trim();
  }
}
