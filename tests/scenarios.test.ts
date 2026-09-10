import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm, symlink, lstat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { writeFileAtomic, writeFileAtomicSync } from "../src/atomic.js";
import { gitCommitFile, gitStatus, gitRoot, gitSyncState } from "../src/git.js";
import { chatCompletionStream, chatCompletion } from "../src/llm.js";
import { formatMd, lintMarkdown } from "../src/lint.js";
import { markdownToHtml } from "../src/html.js";
import { qrInputAction } from "../src/qr-input.js";

async function isolated(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mdok-scenarios-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function repository(dir: string) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
  git("config", "core.quotePath", "true");
  await writeFile(join(dir, "base.md"), "base"); git("add", "."); git("commit", "-qm", "base");
  return git;
}
async function sessionModule(dir: string) {
  const ts = await import("typescript");
  const source = (await readFile(new URL("../src/session.ts", import.meta.url), "utf8"))
    .replace('join(homedir(), ".mdok-session.json")', JSON.stringify(join(dir, "session.json")))
    .replace('"./atomic.js"', JSON.stringify(new URL("../src/atomic.ts", import.meta.url).href));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
const opts = { baseURL: "https://example.invalid/v1/", apiKey: "fake", model: "fake" };
const delta = (s: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;

test("SSE ignores tokens after DONE", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(delta("answer") + "data: [DONE]\n\n" + delta("unexpected")));
  assert.equal(await chatCompletionStream("test", opts, () => {}), "answer");
});

test("SSE callback exceptions propagate to caller", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(delta("answer") + "data: [DONE]\n\n"));
  await assert.rejects(chatCompletionStream("test", opts, () => { throw new Error("callback failed"); }), /callback failed/);
});

test("SSE transport failure after partial text rejects instead of claiming success", async t => {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ pull(c) {
    if (reads++ === 0) c.enqueue(new TextEncoder().encode(delta("partial")));
    else c.error(new Error("connection reset"));
  } })));
  await assert.rejects(chatCompletionStream("test", opts, () => {}), /connection reset/);
});

test("SSE passes abort signal and propagates pre-request cancellation", async t => {
  const controller = new AbortController(); controller.abort();
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    controller.signal.throwIfAborted(); return new Response();
  });
  await assert.rejects(chatCompletionStream("test", { ...opts, signal: controller.signal }, () => {}), { name: "AbortError" });
});

test("SSE skips keepalive comments and non-content usage events", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(': keepalive\n\ndata: {"choices":[],"usage":{"total_tokens":1}}\n\n' + delta("ok") + "data: [DONE]\n\n"));
  assert.equal(await chatCompletionStream("test", opts, () => {}), "ok");
});

test("LLM request preserves document and uses one endpoint slash", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://example.invalid/v1/chat/completions");
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(request.messages, [{ role: "system", content: "system" }, { role: "user", content: "한글\r\n\"quoted\"" }]);
    return new Response('{"choices":[{"message":{"content":" ok "}}]}');
  });
  assert.equal(await chatCompletion('한글\r\n"quoted"', { ...opts, system: "system" }), "ok");
});

for (const sync of [false, true]) test(`atomic save must preserve symlink or explicitly reject it sync=${sync}`, () => isolated(async dir => {
  const target = join(dir, "target.md"), link = join(dir, "link.md");
  await writeFile(target, "old"); await symlink(target, link);
  let rejected = false;
  try { if (sync) writeFileAtomicSync(link, "new"); else await writeFileAtomic(link, "new"); }
  catch { rejected = true; }
  assert.ok((await lstat(link)).isSymbolicLink(), "saving silently replaced symbolic link with a separate file");
  assert.equal(await readFile(target, "utf8"), rejected ? "old" : "new");
}));

test("failed write to directory preserves nested original data", () => isolated(async dir => {
  const target = join(dir, "folder"); await mkdir(target); await writeFile(join(target, "keep.md"), "important");
  await assert.rejects(writeFileAtomic(target, "replacement"));
  assert.equal(await readFile(join(target, "keep.md"), "utf8"), "important");
  assert.deepEqual(await readdir(dir), ["folder"]);
}));

test("Git status maps quoted Korean filenames back to actual names", () => isolated(async dir => {
  await repository(dir); await writeFile(join(dir, "한글.md"), "new");
  const result = await gitStatus(dir);
  assert.equal(result.get("한글.md"), "??");
}));

test("Git deletion commit does not include another staged file", () => isolated(async dir => {
  const git = await repository(dir);
  await writeFile(join(dir, "other.md"), "other"); git("add", "other.md");
  await unlink(join(dir, "base.md")); await gitCommitFile(dir, join(dir, "base.md"), "delete base");
  assert.equal(git("show", "--pretty=format:", "--name-status", "HEAD").trim(), "D\tbase.md");
  assert.equal(git("diff", "--cached", "--name-only").trim(), "other.md");
}));

test("Git staged rename remains intact when saving another file", () => isolated(async dir => {
  const git = await repository(dir); git("mv", "base.md", "renamed.md");
  await writeFile(join(dir, "note.md"), "note"); await gitCommitFile(dir, join(dir, "note.md"), "note");
  assert.equal(git("diff", "--cached", "--name-status").trim(), "R100\tbase.md\trenamed.md");
}));

test("Git commit failure preserves unrelated staged state", () => isolated(async dir => {
  const git = await repository(dir);
  await writeFile(join(dir, "other.md"), "other"); git("add", "other.md");
  const before = git("diff", "--cached");
  await assert.rejects(gitCommitFile(dir, join(dir, "missing.md"), "missing"));
  assert.equal(git("diff", "--cached"), before);
}));

test("Git operations outside repository return safe empty status", () => isolated(async dir => {
  assert.equal(await gitRoot(dir), null);
  assert.equal((await gitStatus(dir)).size, 0);
}));

test("Git no-upstream state is not confused with synchronized remote", () => isolated(async dir => {
  await repository(dir); const state = await gitSyncState(dir);
  assert.equal(state?.upstream, false); assert.equal(state?.conflict, false);
}));

test("session filtering preserves identity of the originally active valid tab", () => isolated(async dir => {
  const session = await sessionModule(dir);
  await writeFile(join(dir, "session.json"), JSON.stringify({ files: [null, { path: "a.md" }, { path: "b.md" }], active: 1 }));
  const loaded = await session.loadSession();
  assert.equal(loaded.files[loaded.active].path, "a.md");
}));

test("concurrent session writes produce one complete snapshot", () => isolated(async dir => {
  const session = await sessionModule(dir);
  const snapshots = Array.from({ length: 12 }, (_, i) => ({ files: [{ path: `${i}.md`, cursor: { r: 0, c: 0 }, content: "가".repeat(10000) }], active: 0 }));
  await Promise.all(snapshots.map(value => session.saveSession(value)));
  const loaded = await session.loadSession();
  assert.ok(snapshots.some(value => JSON.stringify(value) === JSON.stringify(loaded)));
}));

test("truncated multibyte session file fails safely", () => isolated(async dir => {
  const session = await sessionModule(dir);
  await writeFile(join(dir, "session.json"), Buffer.from('{"files":[{"path":"한글').subarray(0, 24));
  assert.equal(await session.loadSession(), null);
}));

test("Markdown blockquote fenced code keeps internal blank lines", () => {
  const lines = ["> ```", "> code  ", ">", ">", "> ```"];
  assert.deepEqual(formatMd(lines).lines, lines);
});

test("Markdown linter does not close backtick fence with tildes", () => {
  assert.ok(lintMarkdown(["```", "~~~", "code"]).some(problem => problem.rule === "fence"));
});

test("HTML title cannot inject a script tag", () => {
  const result = markdownToHtml("# safe", '</title><script>alert(1)</script>');
  assert.ok(!result.includes("<script>")); assert.ok(result.includes("&#60;script&#62;"));
});

test("QR bracketed paste does not activate navigation commands", () => {
  assert.equal(qrInputAction("\x1b[200~n\x1b[201~", {}), null);
  assert.equal(qrInputAction("\x1b[I", {}), null);
  assert.equal(qrInputAction("\x1b[O", {}), null);
});
