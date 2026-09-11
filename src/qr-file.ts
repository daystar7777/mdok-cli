import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {emitKeypressEvents} from 'node:readline';
import {qrFrames} from './qr-frames.js';
import {qrTerminalRows} from './qr.js';
export const QR_FILE_LIMIT=1024*1024;
export function createFileTransfer(name:string,bytes:Uint8Array,version:number){
 if(bytes.length>QR_FILE_LIMIT)throw Error('QR file limit: 1 MiB');
 const data=Buffer.from(bytes),sha256=createHash('sha256').update(data).digest('hex');
 const encoded=gzipSync(JSON.stringify({name:basename(name),size:data.length,sha256,data:data.toString('base64')})).toString('base64');
 const id=createHash('sha256').update(encoded).digest('hex').slice(0,16);
 return {name:basename(name),bytes:data.length,sha256,frames:qrFrames(encoded,id,version,'MDOK2'),version};
}
export async function runFileQr(path:string,options:{frame?:string;version?:string;interval:string}){
 const version=options.version?Number(options.version):Math.min(25,Math.floor((Math.min(process.stdout.columns||100,((process.stdout.rows||44)-6)*2)-25)/4));
 if(!Number.isInteger(version)||version<3||version>40)throw Error('QR version must be 3–40; enlarge the terminal if needed.');
 const interval=Number(options.interval);if(!Number.isFinite(interval)||interval<200||interval>60000)throw Error('Interval must be 200–60000 ms.');
 const file=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);let bytes:Buffer;
 try{const stat=await file.stat();if(!stat.isFile()||stat.size>QR_FILE_LIMIT)throw Error('Use a regular file up to 1 MiB.');const buffer=Buffer.alloc(QR_FILE_LIMIT+1);let size=0;while(size<buffer.length){const result=await file.read(buffer,size,buffer.length-size,null);if(!result.bytesRead)break;size+=result.bytesRead;}bytes=buffer.subarray(0,size);}finally{await file.close();}
 const transfer=createFileTransfer(path,bytes,version);
 let index=options.frame?Number(options.frame)-1:0;
 if(!Number.isInteger(index)||index<0||index>=transfer.frames.length)throw Error(`Frame must be 1–${transfer.frames.length}.`);
 const draw=()=>{
  const title=transfer.name.replace(/[\x00-\x1f\x7f-\x9f]/g,'?');
  process.stdout.write(`${title} · ${transfer.bytes} bytes · MDOK2 · ${index+1}/${transfer.frames.length}\n`);
  for(const row of qrTerminalRows(transfer.frames[index],version))process.stdout.write(`\x1b[30;47m${row}\x1b[0m\n`);
 };
 if(options.frame){draw();return;}
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Use --frame <number> outside an interactive terminal.');
 await new Promise<void>(resolve=>{
  let timer:ReturnType<typeof setInterval>|undefined,digits='';const raw=process.stdin.isRaw;
  const render=()=>{process.stdout.write('\x1b[H\x1b[2J');draw();process.stdout.write('←/→: page · Space: play/pause · number + Enter: jump · q/Esc: exit\n');};
  const pause=()=>{if(timer)clearInterval(timer);timer=undefined;};
  const finish=()=>{pause();process.stdin.off('keypress',key);process.off('SIGTERM',finish);process.off('SIGINT',finish);process.stdin.setRawMode(raw);process.stdin.pause();process.stdout.write('\x1b[?25h\x1b[?1049l');resolve();};
  const key=(value:string,k:{name?:string;ctrl?:boolean})=>{
   if(k.name==='escape'||value==='q'||(k.ctrl&&k.name==='c'))return finish();
   if(value===' '){if(timer)pause();else timer=setInterval(()=>{index=(index+1)%transfer.frames.length;render();},interval);}
   else if(k.name==='left'||k.name==='right'){pause();index=Math.max(0,Math.min(transfer.frames.length-1,index+(k.name==='right'?1:-1)));render();}
   else if(/^\d$/.test(value||''))digits=(digits+value).slice(-4);
   else if(k.name==='return'){pause();const n=Number(digits);digits='';if(n>=1&&n<=transfer.frames.length){index=n-1;render();}}
  };
  emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('keypress',key);process.on('SIGTERM',finish);process.on('SIGINT',finish);process.stdout.write('\x1b[?1049h\x1b[?25l');render();
 });
}
