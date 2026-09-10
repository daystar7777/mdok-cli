import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gitCommitFile } from "./git.js";

test("automatic commit includes only saved file and preserves other staged changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mdok-git-test-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(join(dir, "note.md"), "old");
    await writeFile(join(dir, "other.md"), "old");
    git("add", "."); git("commit", "-qm", "initial");
    await writeFile(join(dir, "note.md"), "new");
    await writeFile(join(dir, "other.md"), "staged");
    git("add", "other.md");
    await writeFile(join(dir, "untracked.md"), "private");
    await gitCommitFile(dir, join(dir, "note.md"), "save note");
    assert.equal(git("show", "--pretty=format:", "--name-only", "HEAD").trim(), "note.md");
    assert.equal(git("diff", "--cached", "--name-only").trim(), "other.md");
    assert.match(git("status", "--porcelain"), /\?\? untracked.md/);
    await assert.rejects(gitCommitFile(dir, join(dir, "..", "outside.md"), "invalid"), /outside/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("session builder preserves long active and inactive unsaved buffers", async () => {
  // Exercise the actual closure without mounting a terminal or touching user sessions.
  const source = await readFile(new URL("./tui.tsx", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("  const buildSession = () => ("), source.indexOf("  const quitNow ="));
  const capture = new Function("tabs", "active", "curFile", "cursor", "lines", "baseline", body + "return buildSession();");
  const content = "가😀".repeat(100001);
  const result = capture([{ path: "a.md" }, { path: "b.md", lines: [content], baseline: "old", cursor: { r: 0, c: 0 } }], 0, "a.md", { r: 0, c: 0 }, [content], "old");
  assert.equal(result.files[0].content, content);
  assert.equal(result.files[1].content, content);
  assert.match(source, /baseline: t\.baseline \?\? t\.content/);
  assert.match(source, /useState\(firstTab\.baseline \?\? firstTab\.content\)/);
});
