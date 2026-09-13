import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inspectDisk,documentPath,guardedWrite,contentToken,saveConflictCopy} from './file-safety.js';

async function fixture(run:(dir:string,path:string)=>Promise<void>){
  const dir=await fs.mkdtemp(join(tmpdir(),'mdok-file-safety-'));
  try{const path=join(dir,'원고.md');await fs.writeFile(path,'# Original\r\n\r\n한글');await run(dir,path);}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
test('roundtrip preserves BOM, CRLF, Unicode and permissions',()=>fixture(async(dir,path)=>{
  await fs.chmod(path,0o640);const first=await inspectDisk(path);
  const content='\uFEFF# 새 문서\r\n👩‍💻\r\n';
  assert.equal(await guardedWrite(path,content,first.token),contentToken(content));
  assert.equal((await inspectDisk(path)).content,content);assert.equal((await fs.stat(path)).mode&0o777,0o640);
  assert.deepEqual(await fs.readdir(dir),['원고.md']);
}));
test('external update blocks stale manual/queued saves without losing either version',()=>fixture(async(dir,path)=>{
  const original=await inspectDisk(path);await fs.writeFile(path,'# Obsidian');
  await assert.rejects(guardedWrite(path,'# My draft',original.token));
  assert.equal(await fs.readFile(path,'utf8'),'# Obsidian');
  const copy=await saveConflictCopy(path,'# My draft');assert.equal(await fs.readFile(copy,'utf8'),'# My draft');
  assert.equal(await fs.readFile(path,'utf8'),'# Obsidian');
}));
test('atomic replacement is detected repeatedly, even at the same length',()=>fixture(async(dir,path)=>{
  for(const text of ['# First','# Other','# Third']){
    const old=await inspectDisk(path),temp=join(dir,'replace.md');await fs.writeFile(temp,text);await fs.rename(temp,path);
    assert.notEqual((await inspectDisk(path)).token,old.token);await assert.rejects(guardedWrite(path,'# Mine',old.token));
  }
}));
test('deletion is not silently recreated, but explicit new files can be created',()=>fixture(async(dir,path)=>{
  const old=await inspectDisk(path);await fs.unlink(path);await assert.rejects(guardedWrite(path,'mine',old.token));
  assert.equal((await inspectDisk(path)).token,'missing');await guardedWrite(path,'new','missing');
  assert.equal(await fs.readFile(path,'utf8'),'new');await assert.rejects(guardedWrite(path,'overwrite','missing'));
}));
test('unknown legacy recovery baseline never authorizes a write',()=>fixture(async(dir,path)=>{
  await assert.rejects(guardedWrite(path,'recovery',null));assert.match(await fs.readFile(path,'utf8'),/Original/);
}));
test('canonical aliases identify the same file; symlink replacement cannot overwrite its target',()=>fixture(async(dir,path)=>{
  const alias=join(dir,'alias.md');await fs.symlink(path,alias);
  assert.equal(await documentPath(alias),await fs.realpath(path));await assert.rejects(inspectDisk(alias));
  const old=await inspectDisk(path),other=join(dir,'other.md');await fs.writeFile(other,'private');await fs.unlink(path);await fs.symlink(other,path);
  await assert.rejects(guardedWrite(path,'mine',old.token));assert.equal(await fs.readFile(other,'utf8'),'private');
}));
test('hardlink aliases are recognized and replacement saves fail closed',()=>fixture(async(dir,path)=>{
  const other=join(dir,'hard.md');await fs.link(path,other);
  const a=await inspectDisk(path),b=await inspectDisk(other);assert.equal(a.identity,b.identity);
  await assert.rejects(guardedWrite(path,'mine',a.token));assert.equal(await fs.readFile(other,'utf8'),a.content);
}));
test('special files, binary, invalid UTF-8 and oversize input are rejected',()=>fixture(async(dir,path)=>{
  await assert.rejects(inspectDisk(dir));
  for(const data of [Buffer.from([0]),Buffer.from([255]),Buffer.alloc(1048577,65)]){await fs.writeFile(path,data);await assert.rejects(inspectDisk(path));}
  await assert.rejects(guardedWrite(join(dir,'new.md'),'x'.repeat(1048577),'missing'));
}));
test('a second check catches a change after writing the temporary file',()=>fixture(async(dir,path)=>{
  const old=await inspectDisk(path),original=fs.chmod;
  fs.chmod=async(...args)=>{await fs.writeFile(path,'# Changed during save');return original(...args);};syncBuiltinESMExports();
  try{await assert.rejects(guardedWrite(path,'# Mine',old.token));}finally{fs.chmod=original;syncBuiltinESMExports();}
  assert.equal(await fs.readFile(path,'utf8'),'# Changed during save');assert.deepEqual(await fs.readdir(dir),['원고.md']);
}));
test('concurrent mdok saves cannot both replace the same baseline',()=>fixture(async(dir,path)=>{
  const old=await inspectDisk(path),out=await Promise.allSettled([guardedWrite(path,'first',old.token),guardedWrite(path,'second',old.token)]);
  assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.equal(out.filter(x=>x.status==='rejected').length,1);
  assert.ok(['first','second'].includes(await fs.readFile(path,'utf8')));assert.deepEqual(await fs.readdir(dir),['원고.md']);
}));
test('an occupied or abandoned write lock fails closed without removing it',()=>fixture(async(dir,path)=>{
  const lock=join(dir,'.원고.md.mdok-write-lock');await fs.mkdir(lock);
  await assert.rejects(guardedWrite(path,'mine',(await inspectDisk(path)).token),/Save locked/);
  assert.ok((await fs.stat(lock)).isDirectory());
}));
test('separate CLI processes cannot both save a shared disk baseline',()=>fixture(async(dir,path)=>{
  const old=await inspectDisk(path),run=promisify(execFile);
  const entry=new URL('../dist/file-safety.js',import.meta.url).href;
  const script=`import {guardedWrite} from ${JSON.stringify(entry)};try{await guardedWrite(process.argv[1],process.argv[2],process.argv[3]);console.log('saved');}catch{console.log('blocked');}`;
  const results=await Promise.all(['first process','second process'].map(text=>run(process.execPath,['--input-type=module','-e',script,path,text,old.token],{timeout:10000})));
  assert.deepEqual(results.map(r=>r.stdout.trim()).sort(),['blocked','saved']);
  assert.ok(['first process','second process'].includes(await fs.readFile(path,'utf8')));
  assert.deepEqual(await fs.readdir(dir),['원고.md']);
}));
test('read-only permissions cannot be bypassed with atomic replacement',()=>fixture(async(dir,path)=>{
  const old=await inspectDisk(path);await fs.chmod(path,0o444);
  await assert.rejects(guardedWrite(path,'mine',old.token),/read-only/);
  assert.equal(await fs.readFile(path,'utf8'),old.content);
  await fs.chmod(path,0o600);
}));
