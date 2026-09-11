import {lstat,realpath,stat} from 'node:fs/promises';
import {resolve,extname,relative,isAbsolute,join} from 'node:path';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function desktopFile(input:string,roots?:string[]):Promise<string>{
  if(!input||input.includes('\0')||/^[a-z][a-z\d+.-]*:\/\//i.test(input))throw Error('Use a local Markdown file path, not a remote URI.');
  const path=resolve(input);
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())throw Error('A regular file is required (no symbolic links).');
  if(!['.md','.markdown'].includes(extname(path).toLowerCase()))throw Error('Only .md and .markdown files are supported.');
  if(info.size>1048576)throw Error('Document exceeds 1 MiB.');
  const canonical=await realpath(path);
  if(roots){
    const allowed=await Promise.all(roots.map(r=>realpath(r)));
    if(!allowed.some(root=>{const rel=relative(root,canonical);return rel!==''&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&rel!=='..'&&!isAbsolute(rel);}))throw Error('File is outside the explicitly allowed roots.');
  }
  return canonical;
}
export async function desktopApp(explicit?:string):Promise<string>{
  const candidates=explicit?[resolve(explicit)]:['/Applications/mdok.app',join(homedir(),'Applications/mdok.app')];
  for(const candidate of candidates){
    if(!candidate.endsWith('.app'))continue;
    try{if((await stat(join(candidate,'Contents/MacOS/mdok-desktop'))).isFile())return candidate;}catch{}
  }
  throw Error('mdok desktop is not installed. Install mdok.app or pass --app /absolute/path/mdok.app.');
}
export async function installedDesktop():Promise<string|null>{
  if(process.platform!=='darwin')return null;
  try{return await desktopApp(process.env.MDOK_DESKTOP_APP);}catch{return null;}
}
export async function openDesktop(file?:string,options:{app?:string;roots?:string[]}={}){
  if(process.platform!=='darwin')throw Error('Desktop opening currently supports macOS only.');
  const path=file?await desktopFile(file,options.roots):undefined;
  const app=await desktopApp(options.app);
  // Argument array, never a shell command. LaunchServices reuses the running app.
  await exec('/usr/bin/open',['-a',app,...(path?[path]:[])],{timeout:10000,maxBuffer:65536});
  return {status:'requested' as const,path,app};
}
