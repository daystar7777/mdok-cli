import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
import {tr,normalizeLang,type MsgKey} from "../src/i18n.js";
import {createQrTransfer} from "../src/qr.js";
import {gunzipSync} from "node:zlib";
import {strWidth} from "../src/width.js";

const source=await readFile(new URL('../src/i18n.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source+'\nexport {en,ko};',{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const tables=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const keys=Object.keys(tables.en) as MsgKey[];
const placeholders=(s:string)=>[...new Set([...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(x=>x[1]))].sort();

test('Korean and English contain identical message keys',()=>assert.deepEqual(Object.keys(tables.ko).sort(),[...keys].sort()));
for(const key of keys){
  test(`i18n placeholder parity ${key}`,()=>assert.deepEqual(placeholders(tables.en[key]).filter(name=>!(key==='msg.formatted'&&name==='es')),placeholders(tables.ko[key])));
  for(const lang of ['en','ko'] as const) test(`i18n nonempty and substitution ${lang} ${key}`,()=>{
    assert.equal(typeof tables[lang][key],'string');assert.ok(tables[lang][key].trim());
    const vars=Object.fromEntries(placeholders(tables[lang][key]).map(name=>[name,'한글_日本語_中文_العربية_😀']));
    const value=tr(lang,key,vars);assert.ok(value.isWellFormed());assert.deepEqual(placeholders(value),[]);
    for(const variable of Object.keys(vars)) assert.ok(value.includes(vars[variable]));
  });
}

test('all literal TUI and CLI translation lookups refer to existing keys',async()=>{
  for(const file of ['../src/tui.tsx','../src/index.ts']){
    const code=await readFile(new URL(file,import.meta.url),'utf8');
    const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const visit=(node:ts.Node)=>{
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['t','ct'].includes(node.expression.text)){
        const arg=node.arguments[0];if(arg&&ts.isStringLiteral(arg))assert.ok(arg.text in tables.en,`${file}: ${arg.text}`);
      }ts.forEachChild(node,visit);
    };visit(ast);
  }
});

for(const [value,wanted] of [[undefined,'en'],['ko','ko'],['en','en'],['ko-KR','ko'],['ko_KR.UTF-8','ko'],['KO','ko'],['ar','en']] as const){
  test(`characterize current locale normalization ${String(value)}`,()=>assert.equal(normalizeLang(value),wanted));
}
for(const [lang,readme] of [['ja','README.ja.md'],['zh-CN','README.zh-CN.md']] as const){
  test(`unsupported UI locale ${lang} falls back and ${readme} documents actual support`,async()=>{
    assert.equal(normalizeLang(lang),'en');
    const doc=await readFile(new URL(`../${readme}`,import.meta.url),'utf8');
    assert.match(doc,/UI (?:言語|语言):\s*English \/ 한국어/);
    assert.match(doc,lang==='ja'?/日本語はドキュメントのみ/:/简体中文仅提供文档/);
  });
}
test('decomposed Korean has the same display width as composed Korean',()=>assert.equal(strWidth('한'.normalize('NFD')),strWidth('한')));

const samples=['한글 문서','日本語の文書','简体中文文档','繁體中文文件','العربية مرحبا','עברית שלום','हिन्दी दस्तावेज़','e\u0301 résumé','👩‍💻 🇰🇷 👍🏽','한'.normalize('NFD')];
for(const [i,content] of samples.entries())for(const [columns,rows] of [[37,23],[80,30],[160,60]]){
  test(`multilingual QR byte roundtrip sample=${i} screen=${columns}x${rows}`,()=>{
    const name=`${content}.md`,transfer=createQrTransfer(name,content,columns,rows);
    const encoded=transfer.frames.map(frame=>frame.split(':')[4]).join('');
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(encoded,'base64')).toString('utf8')),{name,content});
  });
}
