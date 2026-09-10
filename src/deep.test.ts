import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { writeFileAtomic, writeFileAtomicSync } from "./atomic.js";
import { gitCommitFile } from "./git.js";
import { createQrTransfer } from "./qr.js";
import { chatCompletion, chatCompletionStream } from "./llm.js";
import { diffLines, formatMd, formatTable } from "./lint.js";
import { sliceByWidth, strWidth } from "./width.js";

async function isolated(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mdok-deep-test-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function isolatedSession(dir: string) {
  // Redirect only the module's session path; never change HOME or access user data.
  const source = (await readFile(new URL("./session.ts", import.meta.url), "utf8"))
    .replace('join(homedir(), ".mdok-session.json")', JSON.stringify(join(dir, "session.json")))
    .replace('"./atomic.js"', JSON.stringify(new URL("./atomic.ts", import.meta.url).href));
  const ts = await import("typescript");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("session async/sync persistence retains large unsaved buffers and cursors", () => isolated(async dir => {
  const session = await isolatedSession(dir);
  assert.equal(await session.loadSession(), null);
  const value = { files: [{path:"한글.md",cursor:{r:2,c:3},content:"가😀".repeat(100001)}, {path:"empty.md",cursor:{r:0,c:0},content:""}], active:1 };
  await session.saveSession(value);
  assert.deepEqual(await session.loadSession(), value);
  session.saveSessionSync({...value,active:0});
  assert.deepEqual(await session.loadSession(), {...value,active:0});
}));

test("session rejects broken JSON and filters invalid paths", () => isolated(async dir => {
  const session = await isolatedSession(dir), path=join(dir,"session.json");
  for(const raw of ['{broken', 'null', '{}', '{"files":[]}']) {
    await writeFile(path,raw); assert.equal(await session.loadSession(),null);
  }
  await writeFile(path,JSON.stringify({files:[null,{path:123},{path:"valid.md",cursor:{r:-2,c:-3}}],active:99}));
  assert.deepEqual(await session.loadSession(),{files:[{path:"valid.md",cursor:{r:0,c:0}}],active:0});
}));

test("session malformed cursor and active index become finite integers", () => isolated(async dir => {
  const session=await isolatedSession(dir);
  await writeFile(join(dir,"session.json"),JSON.stringify({files:[{path:"note.md",cursor:{r:"bad",c:1.5}}],active:"bad"}));
  const result=await session.loadSession();
  assert.ok(Number.isInteger(result.active));
  assert.ok(Number.isInteger(result.files[0].cursor.r));
  assert.ok(Number.isInteger(result.files[0].cursor.c));
}));

test("atomic writes round-trip Unicode, CRLF, empty and large documents", () => isolated(async dir => {
  const path = join(dir, "한글 공백.md");
  for (const content of ["", "한글😀\r\n\0끝", "가😀".repeat(400000)]) {
    await writeFileAtomic(path, content);
    assert.equal(await readFile(path, "utf8"), content);
    writeFileAtomicSync(path, content);
    assert.equal(await readFile(path, "utf8"), content);
  }
  assert.deepEqual(await readdir(dir), ["한글 공백.md"]);
}));

test("failed atomic rename cleans temporary files and preserves target", () => isolated(async dir => {
  const target = join(dir, "existing-directory"); await mkdir(target);
  await assert.rejects(writeFileAtomic(target, "data"));
  assert.throws(() => writeFileAtomicSync(target, "data"));
  assert.ok((await stat(target)).isDirectory());
  assert.deepEqual(await readdir(dir), ["existing-directory"]);
  await assert.rejects(writeFileAtomic(join(dir, "missing", "file.md"), "data"));
}));

test("concurrent atomic writes never leave partial contents or temporary files", () => isolated(async dir => {
  const path = join(dir, "race.md"), values = Array.from({ length: 20 }, (_, i) => `${i}:` + "가".repeat(10000));
  await Promise.all(values.map(value => writeFileAtomic(path, value)));
  assert.ok(values.includes(await readFile(path, "utf8")));
  assert.deepEqual(await readdir(dir), ["race.md"]);
}));

test("atomic replacement preserves private file permissions", () => isolated(async dir => {
  const path = join(dir, "private.json");
  await writeFile(path, "old", { mode: 0o600 });
  await writeFileAtomic(path, "new");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
}));

for (const name of ["한글 공백.md", "[special]*.md", "-option.md"]) {
  test(`git only-file commit handles literal path: ${name}`, () => isolated(async dir => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
    await writeFile(join(dir, "base.md"), "base"); git("add", "."); git("commit", "-qm", "initial");
    await writeFile(join(dir, name), "new file");
    await gitCommitFile(dir, join(dir, name), "one file");
    assert.equal(git("show", `HEAD:${name}`), "new file");
    assert.equal(git("status", "--porcelain"), "");
    await assert.rejects(gitCommitFile(dir, join(dir, name), "unchanged"));
    assert.equal(git("rev-list", "--count", "HEAD").trim(), "2");
  }));
}

for (const [columns, rows] of [[37, 23], [40, 24], [80, 24], [120, 40], [200, 60]]) {
  test(`QR transfer integrity, reverse ordering and duplicate frames at ${columns}x${rows}`, () => {
    const content = Array.from({ length: 180 }, (_, i) => `${i}: 한글😀\r\n${i * 917}`).join("\n");
    const transfer = createQrTransfer("/notes/한글.md", content, columns, rows);
    const received = new Map<number, string>();
    for (const frame of [...transfer.frames].reverse().concat(transfer.frames[0])) {
      const [prefix, , index, count, chunk] = frame.split(":");
      assert.equal(prefix, "MDOK1"); assert.equal(Number(count), transfer.frames.length);
      received.set(Number(index), chunk);
    }
    const data = [...received].sort((a,b) => a[0]-b[0]).map(([,chunk]) => chunk).join("");
    assert.equal(createHash("sha256").update(data).digest("hex").slice(0,16), transfer.frames[0].split(":")[1]);
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(data,"base64")).toString()), { name: "한글.md", content });
    assert.notEqual(createHash("sha256").update(data.slice(1)).digest("hex").slice(0,16), transfer.frames[0].split(":")[1]);
  });
}

test("QR exact byte limit accepts 1 MiB and rejects oversized Unicode", () => {
  assert.ok(createQrTransfer("limit.md", "a".repeat(1024*1024), 120, 40).frames.length);
  assert.throws(() => createQrTransfer("limit.md", "가".repeat(349526), 120, 40), /limit/);
  assert.throws(() => createQrTransfer("small.md", "", 36, 23), /size/);
});

test("LLM SSE handles one-byte chunks including multibyte UTF-8", async t => {
  const wire = 'data: {"choices":[{"delta":{"content":"한글😀"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(wire);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } })));
  const tokens: string[] = [];
  assert.equal(await chatCompletionStream("test", {baseURL:"https://example.invalid/v1",apiKey:"fake",model:"fake"}, s => tokens.push(s)), "한글😀");
  assert.deepEqual(tokens, ["한글😀"]);
});

test("LLM HTTP errors and empty responses are reported", async t => {
  const opts = {baseURL:"https://example.invalid/v1",apiKey:"fake",model:"fake"};
  const mock = t.mock.method(globalThis, "fetch", async () => new Response("rate limited", {status:429}));
  await assert.rejects(chatCompletion("test", opts), /429/);
  await assert.rejects(chatCompletionStream("test", opts, () => {}), /429/);
  mock.mock.mockImplementation(async () => new Response('{"choices":[]}'));
  await assert.rejects(chatCompletion("test", opts), /empty/);
});

test("line diff reconstructs both inputs across small and fallback cases", () => {
  for (const [a,b] of [[[],[]], [["a"],["b"]], [["a","b","a"],["b","a","c"]], [Array(201).fill("a"),Array(201).fill("b")]] as string[][][]) {
    const diff = diffLines(a,b);
    assert.deepEqual(diff.filter(d=>d.t!=="+").map(d=>d.text),a);
    assert.deepEqual(diff.filter(d=>d.t!=="-").map(d=>d.text),b);
  }
});

test("formatting preserves Markdown hard line breaks", () => {
  assert.deepEqual(formatMd(["first  ","second"]).lines, ["first  ","second"]);
});

test("table formatting does not overwrite the following paragraph", () => {
  const result = formatTable(["| a | b |", "following paragraph"],0);
  assert.ok(result.lines.includes("following paragraph"));
});

test("CJK width slicing never exceeds its pane width", () => {
  for (const input of ["가", "a가b", "😀a"]) for(let start=0;start<strWidth(input);start++) for(let width=1;width<=3;width++) {
    assert.ok(strWidth(sliceByWidth(input,start,width).text)<=width, `${JSON.stringify(input)} start=${start} width=${width}`);
  }
});
