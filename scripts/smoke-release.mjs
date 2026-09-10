// Run a compiled executable outside its repository/node_modules directory.
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const executable=resolve(process.argv[2]);
const dir=await mkdtemp(join(tmpdir(),'mdok-release-smoke-'));
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const run=(...args)=>execFileSync(executable,args,{cwd:dir,encoding:'utf8',timeout:20000});
try{
  await writeFile(join(dir,'a.md'),'# 한글\n\n$\\frac{1}{2}$\n\n$$\\begin{matrix}a&b\\\\c&d\\end{matrix}$$\n');
  assert.equal(run('--version').trim(),version);
  for(const engine of ['basic','katex','mathjax']){
    const report=JSON.parse(run('math-check','a.md','--engine',engine,'--json'));
    assert.equal(report.partial,false);assert.equal(report.regions.length,2);assert.deepEqual(report.diagnostics,[]);
  }
  await writeFile(join(dir,'b.md'),await readFile(join(dir,'a.md')));
  run('math-convert','b.md','--to','bracket','--write');
  const comparison=JSON.parse(run('compare','a.md','b.md','--json'));
  assert.ok(comparison.chunks.some(c=>c.changed));
  assert.equal(comparison.chunks.map(c=>c.old).join(''),await readFile(join(dir,'a.md'),'utf8'));
  assert.equal(comparison.chunks.map(c=>c.new).join(''),await readFile(join(dir,'b.md'),'utf8'));
  console.log(`standalone ${version}: engines, conversion, comparison PASS`);
}finally{await rm(dir,{recursive:true,force:true});}
