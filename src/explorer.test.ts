import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listDirectory,filterEntries,readExplorerFile,newMarkdownPath,createMarkdown} from './explorer.js';
test('explorer lists beyond 30 entries, folders first, filters and symlinks',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mdok-explore-'));
  try{
    await mkdir(join(dir,'folder'));await writeFile(join(dir,'.hidden.md'),'');await writeFile(join(dir,'plain.txt'),'text');
    for(let i=0;i<55;i++)await writeFile(join(dir,`한 글 ${i}.MD`),'hello');
    await symlink(join(dir,'folder'),join(dir,'alias'));await symlink(join(dir,'absent'),join(dir,'broken'));
    const result=await listDirectory(dir);assert.equal(result.entries.length,61);assert.equal(result.entries[0].name,'..');
    assert.equal(result.entries.find(e=>e.name==='alias')?.directory,true);
    const visible=filterEntries(result.entries,'',false,true);assert.equal(visible.length,58);assert.equal(visible[1].directory,true);
    assert.equal(filterEntries(result.entries,'한 글 54',false,true).length,2);
    assert.ok(filterEntries(result.entries,'',true,false).some(e=>e.name==='.hidden.md'));
    const abort=new AbortController();abort.abort();await assert.rejects(listDirectory(dir,abort.signal),/Cancelled/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('explorer creates exclusive Markdown and rejects unsafe names and files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mdok-explore-create-'));
  try{
    const path=newMarkdownPath(dir,'새 문서');await createMarkdown(path);await assert.rejects(createMarkdown(path));
    await writeFile(path,'한글\r\n');assert.equal((await readExplorerFile(path)).content,'한글\r\n');
    assert.equal(await readFile(path,'utf8'),'한글\r\n');
    assert.equal(newMarkdownPath(dir,'A.MARKDOWN'),join(dir,'A.MARKDOWN'));
    for(const name of ['','../a','a/b','a\\b','.','..','foo\u0000','CON','NUL.md','x.',' x'])assert.throws(()=>newMarkdownPath(dir,name));
    await assert.rejects(readExplorerFile(dir),/regular/);
    await writeFile(path,Buffer.from([255]));await assert.rejects(readExplorerFile(path));
    await writeFile(path,Buffer.alloc(1024*1024+1));await assert.rejects(readExplorerFile(path),/MiB/);
    await assert.rejects(listDirectory(join(dir,'absent')));
  }finally{await rm(dir,{recursive:true,force:true});}
});
