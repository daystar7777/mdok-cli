import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, readdir, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {exportPandoc, openVsCode, pandocArgs, PROFILES, FORMATS, type Runner} from './integrations.js';

for(const profile of PROFILES) for(const format of FORMATS) test(`Pandoc arguments ${profile}/${format}`,()=>{
  const args=pandocArgs(profile,format,'/tmp/a b;touch nope');
  assert.ok(args.includes('--sandbox'));
  assert.equal(args[args.indexOf('--output')+1],'/tmp/a b;touch nope');
  assert.ok(!args.includes('--shell-escape'));
  if(format==='pdf') assert.ok(args.includes('--pdf-engine-opt=-no-shell-escape'));
  if(format==='html') assert.ok(args.includes('--mathml'));
});
test('VS Code cursor and hostile filename are passed as a single argument',async()=>{
  await openVsCode('a b;$(echo bad).md',2,4,async(tool,args)=>{
    assert.equal(tool,'code');assert.deepEqual(args,['--goto',`${resolve('a b;$(echo bad).md')}:3:5`]);
  });
});
test('VS Code failures propagate',async()=>assert.rejects(openVsCode('a.md',0,0,async()=>{throw new Error('ENOENT');}),/ENOENT/));
test('Pandoc uses current buffer, preserves destination, cleans temporary files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mdok-integration-test-'));
  try {
    const source=join(dir,'한 글.md'),out=join(dir,'out.docx');
    await writeFile(source,'disk');
    const runner:Runner=async(tool,args,input,cwd)=>{
      assert.equal(tool,'pandoc');assert.equal(input,'buffer $x$');assert.equal(cwd,dir);
      await writeFile(args[args.indexOf('--output')+1],'converted');
    };
    await exportPandoc('buffer $x$',source,out,'pandoc','docx',runner);
    assert.equal(await readFile(source,'utf8'),'disk');assert.equal(await readFile(out,'utf8'),'converted');
    await assert.rejects(exportPandoc('buffer $x$',source,out,'pandoc','docx',runner),/EEXIST/);
    const alias=join(dir,'alias.docx');await symlink(source,alias);
    await assert.rejects(exportPandoc('buffer $x$',source,alias,'pandoc','docx',runner),/EEXIST/);
    await assert.rejects(exportPandoc('',source,source,'gfm','html',runner),/differ/);
    await assert.rejects(exportPandoc('',source,join(dir,'fail.docx'),'gfm','docx',async()=>{throw new Error('missing tool');}),/missing tool/);
    assert.ok(!(await readdir(dir)).some(n=>n.startsWith('.mdok-export-')));
  } finally {await rm(dir,{recursive:true,force:true});}
});
