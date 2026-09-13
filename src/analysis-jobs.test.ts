import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analyzeAsync,compareAsync,previewAsync} from './analysis-jobs.js';
const exec=promisify(execFile);
test('preview runs in a cancellable worker and preserves terminal color',async()=>{
  const abort=new AbortController();
  const pending=previewAsync('# Cancel\n'.repeat(50000),0,{signal:abort.signal});abort.abort();
  await assert.rejects(pending,/Cancelled/);
  const plain=await previewAsync('# Hello\n\n**World**',0);
  assert.match(plain,/Hello/);assert.match(plain,/World/);assert.doesNotMatch(plain,/\u001b\[/);
  assert.match(await previewAsync('# Hello\n\n**World**',1),/\u001b\[/);
  let ticks=0;const timer=setInterval(()=>ticks++,5);
  try{await previewAsync('A paragraph.\n\n'.repeat(10000),0);assert.ok(ticks>1);}
  finally{clearInterval(timer);}
  await assert.rejects(previewAsync('a'.repeat(1024*1024+1),0),/limit|large|MiB|exceed/i);
});
test('analysis worker cancellation and timeout reject without hanging',async()=>{
  const abort=new AbortController();
  const pending=analyzeAsync('$x$'.repeat(100000),'both','gfm',{signal:abort.signal});abort.abort();
  await assert.rejects(pending,/Cancelled/);
  await assert.rejects(compareAsync('a'.repeat(500000),'b'.repeat(500000),'gfm',{timeout:1}),/budget/);
  assert.equal((await analyzeAsync('$x$')).regions.length,1);
});
test('large analysis preserves event-loop responsiveness and rejects oversize input',async()=>{
  let ticks=0;const timer=setInterval(()=>ticks++,5);
  try{
    const source=('A paragraph $x$.\n\n').repeat(6000);
    const report=await analyzeAsync(source,'both','gfm',{timeout:10000});
    assert.equal(report.regions.length,6000);assert.ok(ticks>1);
    await assert.rejects(analyzeAsync('a'.repeat(1024*1024+1)),/limit|large|MiB|exceed/i);
  }finally{clearInterval(timer);}
});
test('compiled CLI real engines, conversion dry-run/write and lossless comparison',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mdok-cli-math-'));
  const cli=join(process.cwd(),'dist/index.js');
  const run=(...args:string[])=>exec(process.execPath,[cli,...args],{timeout:15000,maxBuffer:2*1024*1024});
  try{
    const file=join(dir,'한 글.md'),other=join(dir,'other.md'),source='# 제목\r\n\r\n$\\frac{1}{2}$\r\n';
    await writeFile(file,source);
    for(const engine of ['basic','katex','mathjax']){
      const report=JSON.parse((await run('math-check',file,'--engine',engine,'--json')).stdout);
      assert.equal(report.partial,false);assert.equal(report.diagnostics.length,0);assert.ok(report.engine.startsWith(engine+'/'));
    }
    await run('math-convert',file,'--to','bracket');assert.equal(await readFile(file,'utf8'),source);
    await run('math-convert',file,'--to','bracket','--write');
    const changed=await readFile(file,'utf8');assert.equal(changed,source.replace('$\\frac{1}{2}$','\\(\\frac{1}{2}\\)'));
    await writeFile(other,source);
    const diff=JSON.parse((await run('compare',other,file,'--json')).stdout);
    assert.equal(diff.chunks.map((c:{old:string})=>c.old).join(''),source);
    assert.equal(diff.chunks.map((c:{new:string})=>c.new).join(''),changed);
    await assert.rejects(run('math-check',file,'--engine','bogus'));
    await assert.rejects(run('compare',file,other,'--profile','bogus'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
