import {open,lstat,realpath,link,rename,unlink,chmod,mkdir,rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {decodeText} from './git-snapshots.js';

export type DiskToken=string|null; // null means legacy/unknown baseline: never authorize a write.
export const contentToken=(content:string)=>createHash('sha256').update(content,'utf8').digest('hex');
export interface DiskSnapshot {path:string;token:string;content:string|null;identity:string;links:number;mode:number}
export class FileConflict extends Error {constructor(){super('Disk changed or is unavailable. Reload explicitly or save a separate copy.');}}
export async function documentPath(input:string):Promise<string>{
  const absolute=resolve(input);
  try{return await realpath(absolute);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return join(await realpath(dirname(absolute)),basename(absolute));}
}
/** Bounded, no-follow read; reject special files and changes during the read. */
export async function inspectDisk(path:string):Promise<DiskSnapshot>{
  let before;
  try{before=await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {path,token:'missing',content:null,identity:path,links:0,mode:0o600};throw e;}
  if(!before.isFile()||before.isSymbolicLink())throw new FileConflict();
  const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const first=await fd.stat();
    if(!first.isFile()||first.size>1048576||first.dev!==before.dev||first.ino!==before.ino)throw new FileConflict();
    const data=Buffer.alloc(1048577);let count=0;
    while(count<data.length){const r=await fd.read(data,count,data.length-count,null);if(!r.bytesRead)break;count+=r.bytesRead;}
    const after=await fd.stat(),current=await lstat(path);
    if(after.size!==first.size||after.mtimeMs!==first.mtimeMs||after.ctimeMs!==first.ctimeMs||current.dev!==first.dev||current.ino!==first.ino||current.isSymbolicLink())throw new FileConflict();
    const content=decodeText(data.subarray(0,count));
    return {path,content,token:contentToken(content),identity:`${first.dev}:${first.ino}`,links:first.nlink,mode:first.mode&0o777};
  }finally{await fd.close();}
}

/** Compare before preparing and immediately before committing. No cross-app OS CAS is claimed. */
export async function guardedWrite(path:string,content:string,expected:DiskToken):Promise<string>{
  const lock=join(dirname(path),`.${basename(path)}.mdok-write-lock`);
  try{await mkdir(lock,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error(`Save locked: ${lock}. Another save may be running. If a process crashed, close all mdok editors before removing this lock directory.`);throw e;}
  try{return await commitWrite(path,content,expected);}finally{await rmdir(lock).catch(()=>{});}
}
async function commitWrite(path:string,content:string,expected:DiskToken):Promise<string>{
  if(expected===null)throw new FileConflict();
  if(Buffer.byteLength(content,'utf8')>1048576)throw Error('Document exceeds 1 MiB');
  const before=await inspectDisk(path);
  if(before.token!==expected||before.links>1)throw new FileConflict();
  if(expected!=='missing'&&(before.mode&0o222)===0)throw Error('File is read-only; save a separate copy.');
  const temporary=join(dirname(path),`.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const fd=await open(temporary,'wx',0o600);
  try{
    await fd.writeFile(content,'utf8');await fd.sync();await fd.close();await chmod(temporary,before.mode);
    const latest=await inspectDisk(path);
    if(latest.token!==expected||latest.identity!==before.identity||latest.links>1)throw new FileConflict();
    if(expected!=='missing'&&(latest.mode&0o222)===0)throw Error('File became read-only; save a separate copy.');
    // New files use exclusive publication: never replace a concurrently created file.
    if(expected==='missing')await link(temporary,path);
    else await rename(temporary,path);
    return contentToken(content);
  }finally{await fd.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
export async function saveConflictCopy(path:string,content:string):Promise<string>{
  const copy=join(dirname(path),`${basename(path).replace(/\.(?:md|markdown)$/i,'')}.copy-${Date.now()}-${randomUUID().slice(0,8)}.md`);
  await guardedWrite(copy,content,'missing');return copy;
}
