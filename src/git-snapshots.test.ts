import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gitSnapshots,decodeText} from './git-snapshots.js';

test('Git snapshots distinguish staged, unstaged, commits without repository mutation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mdok-git-compare-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  try{
    git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','Test');
    for(const name of ['한 글.md','-dash.md','line\nbreak.md','back\\slash.md']){
      const file=join(dir,name);await writeFile(file,'base\r\n');git('add','--',name);git('commit','-qm','base');
      await writeFile(file,'staged\r\n');git('add','--',name);await writeFile(file,'buffer\r\n');
      const before=git('status','--porcelain=v1','-z');const head=git('rev-parse','HEAD');
      const staged=await gitSnapshots(file,'staged');assert.equal(staged.old,'base\r\n');assert.equal(staged.new,'staged\r\n');
      const unstaged=await gitSnapshots(file,'unstaged');assert.equal(unstaged.old,'staged\r\n');assert.equal(unstaged.new,'buffer\r\n');
      assert.equal((await gitSnapshots(file,'head')).old,'base\r\n');
      assert.equal(git('status','--porcelain=v1','-z'),before);assert.equal(git('rev-parse','HEAD'),head);
      assert.equal((await readFile(join(dir,'.git','HEAD'),'utf8')).startsWith('ref:'),true);
      git('commit','-qm','stage');const current=git('rev-parse','HEAD');
      const commits=await gitSnapshots(file,'head',head,current);assert.equal(commits.old,'base\r\n');assert.equal(commits.new,'staged\r\n');
      await assert.rejects(gitSnapshots(file,'head','--bad'),/Invalid/);
      await assert.rejects(gitSnapshots(file,'head','missing-ref'),/unavailable/);
    }
    const fresh=join(dir,'untracked.md');await writeFile(fresh,'new');assert.equal((await gitSnapshots(fresh)).old,'');
    const deleted=join(dir,'delete.md');await writeFile(deleted,'old');git('add','delete.md');await rm(deleted);assert.equal((await gitSnapshots(deleted)).new,'');
    const alias=join(dir,'alias.md');await symlink(fresh,alias);await assert.rejects(gitSnapshots(alias),/regular/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Git conflicts are rejected, not silently compared as normal files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mdok-git-conflict-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  try{
    git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','Test');
    const file=join(dir,'a.md');await writeFile(file,'base');git('add','a.md');git('commit','-qm','base');const branch=git('branch','--show-current');
    git('checkout','-qb','other');await writeFile(file,'other');git('commit','-qam','other');
    git('checkout',branch);await writeFile(file,'ours');git('commit','-qam','ours');assert.throws(()=>git('merge','other'));
    const before=git('ls-files','--unmerged');await assert.rejects(gitSnapshots(file),/Unmerged/);assert.equal(git('ls-files','--unmerged'),before);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('binary, invalid UTF-8, large content rejected; BOM preserved',()=>{
  assert.throws(()=>decodeText(Buffer.from([0])));assert.throws(()=>decodeText(Buffer.from([255])));assert.throws(()=>decodeText(Buffer.alloc(1024*1024+1,65)));
  assert.equal(decodeText(Buffer.from('\uFEFFhi')),'\uFEFFhi');
});
test('unborn HEAD compares first staged file against empty source',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mdok-git-unborn-'));
  try{
    execFileSync('git',['init','-q'],{cwd:dir});
    const file=join(dir,'first.md');await writeFile(file,'first $x$');
    execFileSync('git',['add','first.md'],{cwd:dir});
    const pair=await gitSnapshots(file,'staged');assert.equal(pair.old,'');assert.equal(pair.new,'first $x$');
    await assert.rejects(gitSnapshots(file,'staged','missing'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
