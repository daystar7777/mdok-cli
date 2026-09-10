import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import jsQR from "jsqr";
import { strWidth, sliceByWidth } from "../src/width.js";
import { diffLines, formatMd, formatTable } from "../src/lint.js";
import { createQrTransfer, qrTerminalRows } from "../src/qr.js";
import { qrInputAction } from "../src/qr-input.js";

// Each case has its own deterministic seed; test-name-pattern can replay it.
const BASE = 0x4d444f4b;
function rng(id: number) {
  let state = (BASE + id) >>> 0;
  return (max: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
}
const alphabet = ["a","Z"," ","가","日","😀","e\u0301","\u200b","🚀","👩‍💻"];
function word(random: (n: number) => number, length: number) {
  return Array.from({length},()=>alphabet[random(alphabet.length)]).join("");
}

for(let i=0;i<2000;i++) test(`width seed=${BASE+i}`,()=>{
  const r=rng(i), input=word(r,r(50)), start=r(strWidth(input)+5), width=r(20);
  const result=sliceByWidth(input,start,width);
  assert.ok(result.startIdx>=0 && result.endIdx>=result.startIdx && result.endIdx<=input.length);
  assert.equal(input.slice(result.startIdx,result.endIdx),result.text);
  assert.ok(strWidth(result.text)<=width);
  assert.ok(result.text.isWellFormed());
  if(start===0 && width>=strWidth(input)) assert.equal(result.text,input);
});

for(let i=0;i<1000;i++) test(`diff seed=${BASE+2000+i}`,()=>{
  const r=rng(2000+i), a=Array.from({length:r(30)},()=>word(r,r(8))), b=Array.from({length:r(30)},()=>word(r,r(8)));
  const result=diffLines(a,b);
  assert.deepEqual(result.filter(x=>x.t!=="+").map(x=>x.text),a);
  assert.deepEqual(result.filter(x=>x.t!=="-").map(x=>x.text),b);
  assert.deepEqual(diffLines(a,a),a.map(text=>({t:" ",text})));
});

for(let i=0;i<500;i++) test(`format seed=${BASE+3000+i}`,()=>{
  const r=rng(3000+i), code=Array.from({length:3+r(10)},()=>word(r,8)+"  ");
  const fence=(i%2?"`":"~").repeat(3+r(4));
  const lines=["before  ",fence,...code,"","",fence,"after ","",""];
  const result=formatMd(lines).lines;
  assert.deepEqual(result.slice(1,code.length+5),[fence,...code,"","",fence]);
  assert.equal(result[0],"before  ");
  assert.deepEqual(formatMd(result),{lines:result,fixes:0});
});

for(let i=0;i<500;i++) test(`table seed=${BASE+3500+i}`,()=>{
  const r=rng(3500+i), columns=1+r(5);
  const row=()=>`| ${Array.from({length:columns},()=>word(r,1+r(8)).trim()||"x").join(" | ")} |`;
  const table=[row(),...(i%2?[`|${Array(columns).fill("---").join("|")}|`]:[]),...Array.from({length:r(5)},row)];
  const result=formatTable(["before",...table,"after","last"],1).lines;
  assert.equal(result[0],"before");assert.deepEqual(result.slice(-2),["after","last"]);
  assert.deepEqual(formatTable(result,1).lines,result);
});

for(let i=0;i<500;i++) test(`qr seed=${BASE+4000+i}`,()=>{
  const r=rng(4000+i),content=word(r,r(300)),columns=37+r(124),rows=23+r(38);
  const transfer=createQrTransfer("문서.md",content,columns,rows);
  const chunks=new Map<number,string>();
  for(const payload of [...transfer.frames].reverse().concat(transfer.frames[0])) {
    const [prefix,id,index,count,chunk]=payload.split(":");
    assert.equal(prefix,"MDOK1");assert.equal(Number(count),transfer.frames.length);
    assert.equal(id,transfer.frames[0].split(":")[1]);
    const lines=qrTerminalRows(payload,transfer.version);
    assert.ok(lines.length+4<=rows && lines[0].length<=columns);
    chunks.set(Number(index),chunk);
  }
  const data=[...chunks].sort((a,b)=>a[0]-b[0]).map(([,chunk])=>chunk).join("");
  assert.equal(createHash("sha256").update(data).digest("hex").slice(0,16),transfer.frames[0].split(":")[1]);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(data,"base64")).toString()),{name:"문서.md",content});
  // Independently decode every frame for 100 cases, not just metadata checks.
  if(i<100) for(const payload of transfer.frames) {
    const lines=qrTerminalRows(payload,transfer.version),scale=4,w=lines[0].length*scale,h=lines.length*2*scale;
    const pixels=new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const my=Math.floor(y/scale),cell=lines[Math.floor(my/2)][Math.floor(x/scale)];
      const black=cell==="█"||(my%2===0?cell==="▀":cell==="▄"),k=(y*w+x)*4;
      pixels[k]=pixels[k+1]=pixels[k+2]=black?0:255;pixels[k+3]=255;
    }
    assert.equal(jsQR(pixels,w,h)?.data,payload);
  }
});

for(let i=0;i<500;i++) test(`input seed=${BASE+4500+i}`,()=>{
  const r=rng(4500+i),mouse=`\x1b[<${r(128)};${1+r(200)};${1+r(100)}${i%2?"M":"m"}`;
  assert.equal(qrInputAction(mouse+" ",{}),"toggle");
  assert.equal(qrInputAction(mouse+"n",{}),"next");
  assert.equal(qrInputAction(mouse+"p",{}),"previous");
  assert.equal(qrInputAction(mouse,{escape:true}),null);
  assert.equal(qrInputAction(" ",{eventType:i%2?"repeat":"release"}),null);
});
