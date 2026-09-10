import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { paneWidths } from "./layout.js";

test("View mode gives preview the entire document width", () => {
  assert.deepEqual(paneWidths(120, "preview"), {source:0,preview:120});
  assert.deepEqual(paneWidths(120, "source"), {source:120,preview:0});
  assert.deepEqual(paneWidths(120, "split"), {source:60,preview:60});
});

test("mode transitions never lose width across tabs, sidebar and narrow screens", () => {
  for (const cols of [30,40,60,80,81,120,160,240]) for (const sidebar of [0,22,34]) for (let tabs=1;tabs<=10;tabs++) {
    const width=Math.max(1,cols-sidebar);
    for (const mode of ["split","source","preview","split"] as const) {
      const result=paneWidths(width,mode);
      assert.equal(result.source+result.preview,width);
      assert.ok(result.source>=0 && result.preview>=0);
      if(mode==="preview") assert.equal(result.preview,width);
      if(mode==="source") assert.equal(result.source,width);
    }
  }
});

test("only the selected document uses the full allocated width", async () => {
  const source=await readFile(new URL("./tui.tsx",import.meta.url),"utf8");
  assert.ok(source.includes("renderPreviewPane(pairPreviewW)"));
  assert.ok(source.includes("const pairW = Math.max(1, mainW)"));
  assert.ok(!source.includes("<StaticPreview"));
  assert.ok(source.includes("const boxX = g.ox;"));
  assert.ok(!source.includes("pairW - srcW"));
});
