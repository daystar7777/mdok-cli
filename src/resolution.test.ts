import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink, lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Marked } from "marked";
import { formatTable, lintMarkdown } from "./lint.js";
import { parseGitPorcelain } from "./git.js";
import { strWidth, sliceByWidth, colOfIndex, indexOfCol } from "./width.js";
import { writeFileAtomic, writeFileAtomicSync } from "./atomic.js";
import { chatCompletionStream } from "./llm.js";

test("grapheme slices and column conversions never bisect emoji clusters", () => {
  for (const cluster of ["🚀", "👩‍💻", "🇰🇷", "👍🏽", "1️⃣"]) {
    assert.equal(strWidth(cluster), 2);
    assert.equal(sliceByWidth(cluster, 0, 1).text, "");
    assert.equal(sliceByWidth(cluster, 0, 2).text, cluster);
    assert.equal(indexOfCol(cluster + "a", 1), 0);
    assert.equal(indexOfCol(cluster + "a", 2), cluster.length);
    for (let i = 0; i < cluster.length; i++) assert.equal(colOfIndex(cluster, i), 0);
  }
});

test("escaped pipe cells and alignment retain identical HTML", () => {
  const md = new Marked();
  for (const separator of ["---", ":---", "---:", ":---:"]) for (const cell of ["a\\|b", "a\\\\|b", "`a\\|b`", "한글😀"]) {
    const lines = ["| name | value |", `| ${separator} | --- |`, `| ${cell} | end |`];
    assert.equal(md.parse(formatTable(lines, 2).lines.join("\n")), md.parse(lines.join("\n")));
  }
});

test("NUL Git status preserves literal newlines, spaces and rename destinations", () => {
  const result = parseGitPorcelain("?? 한글.md\0?? space \0?? line\nbreak.md\0R  새이름.md\0이전.md\0 M final.md\0");
  assert.equal(result.get("한글.md"), "??");
  assert.equal(result.get("space "), "??");
  assert.equal(result.get("line\nbreak.md"), "??");
  assert.equal(result.get("새이름.md"), "R");
  assert.equal(result.has("이전.md"), false);
  assert.equal(result.get("final.md"), "M");
});

test("dangling symbolic links are explicitly rejected and preserved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mdok-dangling-test-"));
  try {
    const link = join(dir, "link.md"); await symlink(join(dir, "missing.md"), link);
    await assert.rejects(writeFileAtomic(link, "new"), /symbolic link/);
    assert.throws(() => writeFileAtomicSync(link, "new"), /symbolic link/);
    assert.ok((await lstat(link)).isSymbolicLink());
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("fences require matching type, sufficient length and empty closing suffix", () => {
  for (const closing of ["```", "~~~~", "```` invalid"]) {
    assert.ok(lintMarkdown(["````js", "code", closing]).some(x => x.rule === "fence"));
  }
  assert.deepEqual(lintMarkdown(["````js", "code  ", "", "", "`````"]), []);
  assert.deepEqual(lintMarkdown(["first  ", "second"]), []);
});

test("DONE cancels the reader without waiting for transport close", async t => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')); },
    cancel() { cancelled = true; },
  })));
  const result = await chatCompletionStream("test", { baseURL: "https://example.invalid", apiKey: "fake", model: "fake" }, () => {});
  assert.equal(result, "ok"); assert.equal(cancelled, true);
});

test("malformed complete stream JSON propagates an error", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response('data: not-json\n\n'));
  await assert.rejects(chatCompletionStream("test", { baseURL: "https://example.invalid", apiKey: "fake", model: "fake" }, () => {}), /malformed/);
});
