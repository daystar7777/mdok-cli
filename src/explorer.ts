import {opendir,open,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {decodeText} from './git-snapshots.js';
export interface ExplorerEntry {name:string;path:string;directory:boolean;link:boolean;parent?:boolean}
export interface ExplorerLocation {path:string;selected:number;top:number;query:string;hidden:boolean;markdownOnly:boolean}
export const markdownName=(name:string)=>/\.(md|markdown)$/i.test(name);
export async function listDirectory(path:string,signal?:AbortSignal):Promise<{path:string;entries:ExplorerEntry[]}> {
  const canonical=await realpath(resolve(path)),entries:ExplorerEntry[]=[];
  const directory=await opendir(canonical);
  for await(const entry of directory){
    if(signal?.aborted)throw Error('Cancelled');
    if(entries.length>=100000)throw Error('Directory exceeds 100,000 entries');
    const target=join(canonical,entry.name);
    let isDirectory=entry.isDirectory();
    if(entry.isSymbolicLink())isDirectory=await stat(target).then(s=>s.isDirectory()).catch(()=>false);
    entries.push({name:entry.name,path:target,directory:isDirectory,link:entry.isSymbolicLink()});
  }
  entries.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));
  if(dirname(canonical)!==canonical)entries.unshift({name:'..',path:dirname(canonical),directory:true,link:false,parent:true});
  return {path:canonical,entries};
}
export function filterEntries(entries:ExplorerEntry[],query:string,hidden:boolean,markdownOnly:boolean):ExplorerEntry[]{
  const q=query.toLocaleLowerCase();
  return entries.filter(e=>e.parent||((hidden||!e.name.startsWith('.'))&&(!markdownOnly||e.directory||markdownName(e.name))&&e.name.toLocaleLowerCase().includes(q)));
}
export async function readExplorerFile(path:string):Promise<{path:string;content:string}>{
  const canonical=await realpath(path);
  const info=await stat(canonical);if(!info.isFile())throw Error('Only regular files can be opened');
  const file=await open(canonical,constants.O_RDONLY|(constants.O_NONBLOCK??0));
  try{
    const s=await file.stat();if(!s.isFile())throw Error('Only regular files can be opened');
    if(s.size>1024*1024)throw Error('File exceeds 1 MiB');
    // Bounded read also protects against a file growing after stat().
    const bytes=Buffer.alloc(1024*1024+1);let size=0;
    while(size<bytes.length){const r=await file.read(bytes,size,bytes.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead;}
    return {path:canonical,content:decodeText(bytes.subarray(0,size))};
  }finally{await file.close();}
}
export function newMarkdownPath(directory:string,name:string):string {
  if(!name.trim()||name!==name.trim()||name==='.'||name==='..'||/[\\/\x00-\x1f\x7f<>:"|?*]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('Invalid file name');
  if(basename(name)!==name)throw Error('Enter a file name, not a path');
  return join(directory,markdownName(name)?name:name+'.md');
}
export async function createMarkdown(path:string):Promise<void>{
  const file=await open(path,'wx',0o600);await file.close();
}
