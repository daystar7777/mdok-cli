import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic, writeFileAtomicSync } from "./atomic.js";
import { qrInputAction } from "./qr-input.js";
import { createQrTransfer, qrTerminalRows } from "./qr.js";
import { formatMd, formatTable } from "./lint.js";
import { sliceByWidth, strWidth } from "./width.js";

test("QR controls survive mouse reports in the same input chunk", () => {
  for (const mouse of ["\x1b[<0;5;5M", "[<0;5;5m", "\x1b[M !!"]) {
    assert.equal(qrInputAction(mouse + " ", {}), "toggle");
    assert.equal(qrInputAction(mouse + "n", {}), "next");
    assert.equal(qrInputAction(mouse, {}), null);
    assert.equal(qrInputAction(mouse, {escape:true}), null);
  }
  assert.equal(qrInputAction(" ", {eventType:"release"}),null);
  assert.equal(qrInputAction(" ", {eventType:"repeat"}),null);
  assert.equal(qrInputAction(" ", {eventType:"press"}),"toggle");
  assert.equal(qrInputAction("",{escape:true}),"close");
  assert.equal(qrInputAction("",{leftArrow:true}),"previous");
  assert.equal(qrInputAction("[<0;5;",{}),null);
});

test("QR uses larger screens and does not reserve four-digit indexes for small transfers", () => {
  const content=Array.from({length:30},(_,i)=>`${i}: 간단한 문서입니다 ${i*1937}`).join("\n");
  const small=createQrTransfer("probe.md",content,80,24);
  const large=createQrTransfer("probe.md",content,160,60);
  assert.ok(small.frames.length<18);
  assert.equal(large.frames.length,1);
  assert.ok(large.version>10);
});

test("QR capacity is safe across digit boundaries with deterministic incompressible data", () => {
  let state=12345;
  const text=Array.from({length:6000},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return String.fromCharCode(33+state%90);}).join("");
  for(const n of [1,100,1000,6000]) {
    const transfer=createQrTransfer("entropy.md",text.slice(0,n),37,23);
    for(const payload of transfer.frames) assert.doesNotThrow(()=>qrTerminalRows(payload,transfer.version));
  }
});

test("atomic sync/async updates preserve permissions; new files default to private", async () => {
  const dir=await mkdtemp(join(tmpdir(),"mdok-permission-test-"));
  try {
    for(const mode of [0o600,0o640,0o755]) {
      const path=join(dir,`mode-${mode}`);
      await writeFile(path,"old",{mode});
      const expected=(await stat(path)).mode&0o777;
      writeFileAtomicSync(path,"sync");assert.equal((await stat(path)).mode&0o777,expected);
      await writeFileAtomic(path,"async");assert.equal((await stat(path)).mode&0o777,expected);
      assert.equal(await readFile(path,"utf8"),"async");
    }
    const path=join(dir,"new-secret");await writeFileAtomic(path,"secret");
    assert.equal((await stat(path)).mode&0o777,0o600);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("formatting preserves fenced and indented code, is idempotent", () => {
  const lines=["first  ","````md","```","code  ","","","````","    code  ","end ","",""];
  const result=formatMd(lines);
  assert.deepEqual(result.lines,["first  ","````md","```","code  ","","","````","    code  ","end",""]);
  assert.deepEqual(formatMd(result.lines),{lines:result.lines,fixes:0});
});

test("table insertion preserves preceding and following content", () => {
  for(const table of [["| a | b |"],["| a | b |","| c | d |"],["| a | b |","|---|---|","| c | d |"]]) {
    const result=formatTable(["before",...table,"after","last"],1);
    assert.equal(result.lines[0],"before");
    assert.deepEqual(result.lines.slice(-2),["after","last"]);
    assert.deepEqual(formatTable(result.lines,1).lines,result.lines);
  }
});

test("width slices have valid offsets and fit zero/tiny panes", () => {
  for(const input of ["가나다","a😀가b","e\u0301한글",""]) for(let start=0;start<=strWidth(input)+2;start++) for(let width=0;width<5;width++) {
    const slice=sliceByWidth(input,start,width);
    assert.ok(slice.endIdx>=slice.startIdx);
    assert.equal(input.slice(slice.startIdx,slice.endIdx),slice.text);
    assert.ok(strWidth(slice.text)<=width);
  }
});
