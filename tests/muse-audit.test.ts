import {test} from "node:test";
import assert from "node:assert/strict";
import {Marked} from "marked";
import {strWidth} from "../src/width.js";
import {formatTable, formatMd, diffLines} from "../src/lint.js";
import {chatCompletionStream} from "../src/llm.js";

// Independent golden expectations requested by Muse's review, not self-oracles.
for(const [value,width] of [["가",2],["e\u0301",1],["🚀",2],["👩‍💻",2],["🇰🇷",2]] as const) {
  test(`golden terminal width ${value}`,()=>assert.equal(strWidth(value),width));
}

test("golden escaped pipe table preserves rendered meaning",()=>{
  const lines=["| name | value |","| --- | --- |","| a\\|b | c |"];
  const md=new Marked();
  // Compare semantic text/cells, disregarding insignificant formatting whitespace.
  const normalize=(s:string)=>s.replace(/>\s+</g,"><").trim();
  assert.equal(normalize(md.parse(formatTable(lines,2).lines.join("\n")) as string),normalize(md.parse(lines.join("\n")) as string));
});

test("golden Markdown hard break render is preserved",()=>{
  const lines=["first  ","second","","```js","let a = 1;  ","```"];
  const md=new Marked();
  assert.equal(md.parse(formatMd(lines).lines.join("\n")),md.parse(lines.join("\n")));
});

test("golden diff uses shortest insert/delete edit for swapped lines",()=>{
  const result=diffLines(["a","b"],["b","a"]);
  assert.equal(result.filter(x=>x.t!==" ").length,2);
  assert.equal(result.filter(x=>x.t===" ").length,1);
});

const wire=new TextEncoder().encode('event: message\r\ndata: {"choices":[{"delta":{"content":"한글😀"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"끝"}}]}\n\ndata: [DONE]\n\n');
for(let i=0;i<100;i++) test(`SSE independent split boundary ${i}`,async t=>{
  const split=1+i%(wire.length-1), tokens:string[]=[];
  t.mock.method(globalThis,"fetch",async()=>new Response(new ReadableStream({start(c){c.enqueue(wire.slice(0,split));c.enqueue(wire.slice(split));c.close();}})));
  const result=await chatCompletionStream("test",{baseURL:"https://example.invalid/v1",apiKey:"fake",model:"fake"},token=>tokens.push(token));
  assert.equal(result,"한글😀끝");assert.deepEqual(tokens,["한글😀","끝"]);
});
