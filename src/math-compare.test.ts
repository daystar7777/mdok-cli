import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMath,mathTokens,planDelimiterConversion,applyConversion} from './math.js';
import {checkMath} from './math-engine.js';
import {compareDocuments,comparisonLines} from './compare.js';
import {parseDocument,nodeRange,linePosition,safeDisplay} from './document-analysis.js';

const bodies=(text:string)=>analyzeMath(text).regions.map(r=>text.slice(r.body.start,r.body.end));
for(const [source,expected] of [
  ['$x$',['x']],['$$x^2$$',['x^2']],['\\[x\\]',['x']],['\\(x\\)',['x']],
  ['$1+2$',['1+2']],['cost $5 and $10',[]],['`$x$`',[]],['```tex\n$$x$$\n```',[]],
  ['    $x$\n',[]],['[label](https://a/$x$)',[]],['![alt $x$](a)',[]],['<!-- $x$ -->',[]],
  ['---\nkey: "$x$"\n---\n$x$',['x']],['\\$5 then $y$',['y']],
  ['$$x % $$ ignored\n+y$$',['x % $$ ignored\n+y']],
  ['한글 👩‍💻 $\\frac{1}{2}$',['\\frac{1}{2}']],
] as [string,string[]][])test(`math scanner ${JSON.stringify(source)}`,()=>assert.deepEqual(bodies(source),expected));

test('math policies are independent from Markdown profiles',()=>{
  assert.equal(analyzeMath('$x$ \\[y\\]','dollar').regions.length,1);
  assert.equal(analyzeMath('$x$ \\[y\\]','bracket').regions.length,1);
  assert.equal(analyzeMath('$x$','off').regions.length,0);
  assert.throws(()=>parseDocument('', 'bad' as never));
});
for(const source of ['$$x','\\[x','\\(x'])test(`unclosed ${source}`,()=>assert.ok(analyzeMath(source).diagnostics.some(d=>d.code==='unclosed')));
test('braces distinguish escaped literal braces and comments',()=>{
  assert.equal(analyzeMath('$\\{x\\}$').diagnostics.length,0);
  assert.equal(analyzeMath('$x{y$').diagnostics.filter(d=>d.code==='brace').length,1);
  assert.equal(analyzeMath('$$x % { ignored\n+y$$').diagnostics.length,0);
});
test('large malformed math recovers with a resource diagnostic',()=>{
  const r=analyzeMath('\\['+'x'.repeat(40000));assert.ok(r.partial);assert.ok(r.diagnostics.some(d=>d.code==='resource'));
});
test('all math tokens retain original Unicode offsets and bytes',()=>{
  const text='\\frac{한}{👩‍💻} % comment\r\n x_2';
  const tokens=mathTokens(text,5);assert.equal(tokens.map(t=>t.text).join(''),text);
  for(const t of tokens)assert.equal(text.slice(t.start-5,t.end-5),t.text);
});
for(const source of ['한'.normalize('NFD')+'\r\n$$x^2$$\r\n','`$code$` and $x$','\\[1+2\\] and \\(x\\)','$$\\frac{1}{2}$$'])test(`conversion roundtrip ${JSON.stringify(source)}`,()=>{
  const target=source.includes('\\[')?'dollar':'bracket';
  const plan=planDelimiterConversion(source,target);
  assert.equal(applyConversion(source,plan),plan.result);
  assert.throws(()=>applyConversion(source+'!',plan),/changed/);
  assert.deepEqual(bodies(source),bodies(plan.result));
  for(const e of plan.edits)assert.equal(source.slice(e.start,e.end),e.expected);
});
test('conversion selection only changes complete included math and preserves code',()=>{
  const source='$x$ + $y$ + `$z$`',plan=planDelimiterConversion(source,'bracket',{start:6,end:9});
  assert.equal(plan.result,'$x$ + \\(y\\) + `$z$`');
  assert.equal(planDelimiterConversion(source,'bracket',{start:1,end:2}).result,source);
});
test('conversion never changes inline/display kind',()=>{
  assert.equal(planDelimiterConversion('$x$\n\n$$y$$','bracket').result,'\\(x\\)\n\n\\[y\\]');
});
for(const engine of ['katex','mathjax'] as const){
  test(`${engine}: real engine accepts fractions, Greek, ams matrix`,async()=>{
    const result=await checkMath(String.raw`$$\frac{1}{2}+\alpha+\begin{matrix}a&b\\c&d\end{matrix}$$`,engine);
    assert.equal(result.partial,false,JSON.stringify(result));assert.deepEqual(result.diagnostics,[]);assert.match(result.engine,/\d+\.\d+/);
  });
  test(`${engine}: real unsupported command is a scoped compatibility warning`,async()=>{
    const result=await checkMath('$\\mdokUnknown{x}$',engine);
    assert.equal(result.partial,false);assert.ok(result.diagnostics.some(d=>d.code==='engine'&&d.severity==='warning'));
  });
  test(`${engine}: document macro/resource is unknown, never executed`,async()=>{
    const result=await checkMath('$\\input{secret}$',engine);assert.ok(result.diagnostics.some(d=>d.code==='unknown'));
  });
  test(`${engine}: string macros supported and never leak`,async()=>{
    const good=await checkMath('$\\mdokMacro$',engine,{macros:{'\\mdokMacro':'x^2'}});
    assert.equal(good.diagnostics.length,0,JSON.stringify(good));
    const bad=await checkMath('$\\mdokMacro$',engine);assert.ok(bad.diagnostics.length);
  });
  test(`${engine}: worker timeout and abort do not report clean`,async()=>{
    const report=await checkMath('$x$',engine,{timeout:1});assert.ok(report.partial);
    const abort=new AbortController();abort.abort();await assert.rejects(checkMath('$x$',engine,{signal:abort.signal}),/Cancelled/);
  });
}
test('reject function-like and excessive macro config',async()=>{
  await assert.rejects(checkMath('$x$','katex',{macros:{'\\foo':()=>{}} as never}),/Invalid/);
});
test('source offsets preserve CRLF and Unicode',()=>{
  const source='# 한글\r\n\r\n$x$';const tree=parseDocument(source);
  assert.equal(source.slice(nodeRange(tree.children![1]).start),'$x$');assert.deepEqual(linePosition(source,source.indexOf('$')),{line:2,col:0});
});
for(let i=0;i<180;i++)test(`lossless structure comparison ${i}`,()=>{
  const a=`# Repeat\r\n\r\n| A | B |\r\n|---|---|\r\n| 한글${i} | $x$ |\r\n\r\n[link](a)\n\n$$x_${i}$$\n`;
  const b=i%3===0?a:a.replace('한글','日本語').replace('$x$','$y$').replace('(a)','(b)')+(i%2?'\n':'');
  const result=compareDocuments(a,b);
  assert.equal(result.chunks.map(c=>c.old).join(''),a);assert.equal(result.chunks.map(c=>c.new).join(''),b);
  assert.equal(result.chunks.some(c=>c.changed),a!==b);
  assert.ok(comparisonLines(result).length);assert.ok(comparisonLines(result,true).length);
});
test('table cell and row changes appear in detail',()=>{
  const a='| a | b |\n|---|---|\n|x|y|\n|z|w|',b=a.replace('|x|y|','|x|q|');
  assert.ok(compareDocuments(a,b).chunks.some(c=>c.details.some(d=>d.includes('C2'))));
  const insert=a.replace('|x|y|','|new|row|\n|x|y|');assert.ok(compareDocuments(a,insert).chunks.some(c=>c.details.some(d=>d.includes('rows +'))));
});
test('math body vs delimiter changes remain visible; equivalent expressions not hidden',()=>{
  assert.ok(compareDocuments('$$x+x$$','\\[2x\\]').chunks.some(c=>c.details.some(d=>d.includes('delimiter changed'))));
});
test('comparison past 60 lines and no ANSI execution',()=>{
  const a=Array.from({length:100},(_,i)=>`line ${i}\n`).join('');
  const report=compareDocuments(a,a+'\x1b[31mEND');
  const rows=comparisonLines(report,true);assert.ok(rows.length>60);assert.ok(!rows.join('').includes('\x1b'));
  assert.equal(safeDisplay('\x1b[31m'),'\\x1b[31m');
});
test('wide comparison has source columns, narrow falls back',()=>{
  const r=compareDocuments('old','new');assert.ok(comparisonLines(r,false,120).some(l=>l.includes('│')));assert.ok(!comparisonLines(r,false,40).some(l=>l.includes('│')));
});
