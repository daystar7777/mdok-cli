import {execFile} from 'node:child_process';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,dirname,basename,join} from 'node:path';
export type GitCompareMode='staged'|'unstaged'|'head';
async function git(cwd:string,args:string[]):Promise<Buffer>{
  return new Promise((done,reject)=>execFile('git',['--no-pager',...args],{cwd,encoding:'buffer',timeout:5000,maxBuffer:2*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_LITERAL_PATHSPECS:'1',GIT_EXTERNAL_DIFF:'',GIT_PAGER:'cat'}},(err,stdout)=>err?reject(Error('Git snapshot unavailable (missing ref, path, or conflict)')):done(stdout)));
}
export function decodeText(bytes:Buffer):string {
  if(bytes.includes(0))throw Error('Binary files are not supported');
  if(bytes.length>1024*1024)throw Error('Snapshot exceeds 1 MiB');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
}
export async function gitSnapshots(file:string,mode:GitCompareMode='unstaged',ref='HEAD',otherRef?:string):Promise<{old:string;new:string;label:string}>{
  if(!['staged','unstaged','head'].includes(mode))throw Error('Invalid Git comparison mode');
  const cwd=await realpath(dirname(resolve(file)));
  const absolute=join(cwd,basename(file));
  const root=await realpath(String(await git(cwd,['rev-parse','--show-toplevel'])).replace(/\r?\n$/,''));
  const path=relative(root,absolute).split(sep).join('/');
  if(path.startsWith('../')||isAbsolute(path))throw Error('Path outside repository');
  try{const stat=await lstat(absolute);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Only regular files are supported');
    const real=await realpath(absolute),rel=relative(root,real);if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Path outside repository');
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const stages=String(await git(root,['ls-files','--unmerged','-z','--',path]));
  if(stages)throw Error('Unmerged file: resolve or compare explicit ours/theirs files');
  const commit=async(value:string)=>{
    if(value.startsWith('-')||value.includes('\0'))throw Error('Invalid ref');
    return String(await git(root,['rev-parse','--verify','--end-of-options',`${value}^{commit}`])).trim();
  };
  const blob=async(tree:string|null)=>{
    const listing=await git(root,tree?['ls-tree','-z',tree,'--',path]:['ls-files','--stage','-z','--',path]);
    if(!listing.length)return '';
    const header=String(listing).split('\t')[0];
    const match=/^(100644|100755) (?:blob )?([a-f0-9]{40,64})(?: 0)?$/.exec(header);
    if(!match)throw Error('Unsupported Git entry (symlink/submodule)');
    return decodeText(await git(root,['cat-file','blob',match[2]]));
  };
  if(otherRef){const a=await commit(ref),b=await commit(otherRef);return {old:await blob(a),new:await blob(b),label:`${a.slice(0,8)} ↔ ${b.slice(0,8)}`};}
  const base=async()=>{
    try{return await blob(await commit(ref));}
    catch(error){
      // A symbolic HEAD pointing to a missing branch is an unborn repository,
      // not a misspelled user ref. Its base snapshot is empty.
      if(ref!=='HEAD')throw error;
      const branch=String(await git(root,['symbolic-ref','-q','HEAD'])).trim();
      if((await git(root,['for-each-ref','--format=%(objectname)',branch])).length)throw error;
      return '';
    }
  };
  if(mode==='staged')return {old:await base(),new:await blob(null),label:`${ref} ↔ index`};
  const old=mode==='head'?await base():await blob(null);
  const current=await readFile(absolute).then(decodeText).catch(e=>{if(e.code==='ENOENT')return '';throw e;});
  return {old,new:current,label:`${mode==='head'?ref:'index'} ↔ worktree`};
}
