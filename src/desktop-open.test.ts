import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {desktopFile,desktopApp} from './desktop-open.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('desktop path policy: Unicode, boundaries, links, limits and app discovery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mdok-open-test-'));
 try{
  const root=join(dir,'allowed');await mkdir(root);
  const good=join(root,'한 글 ; $(no).MD');await writeFile(good,'# 수식 $x$');
  assert.equal(await desktopFile(good,[root]),await realpath(good));
  await assert.rejects(desktopFile(good,[]),/outside/);
  await assert.rejects(desktopFile('https://example.com/a.md'),/local/);
  await assert.rejects(desktopFile('vscode-remote://ssh/a.md'),/local/);
  await assert.rejects(desktopFile(root),/regular/);
  const other=join(dir,'other.md');await writeFile(other,'outside');
  await assert.rejects(desktopFile(other,[root]),/outside/);
  await symlink(other,join(root,'link.md'));await assert.rejects(desktopFile(join(root,'link.md'),[root]),/regular/);
  await mkdir(join(dir,'outside'));await writeFile(join(dir,'outside/a.md'),'outside');
  await symlink(join(dir,'outside'),join(root,'linked-folder'));
  await assert.rejects(desktopFile(join(root,'linked-folder/a.md'),[root]),/outside/);
  const big=join(root,'big.md');await writeFile(big,'x'.repeat(1048577));await assert.rejects(desktopFile(big),/1 MiB/);
  const txt=join(root,'a.txt');await writeFile(txt,'x');await assert.rejects(desktopFile(txt),/Only/);
  await assert.rejects(desktopApp(join(dir,'missing.app')),/not installed/);
  const app=join(dir,'mdok.app');await mkdir(join(app,'Contents/MacOS'),{recursive:true});await writeFile(join(app,'Contents/MacOS/mdok-desktop'),'fixture');assert.equal(await desktopApp(app),app);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('real MCP stdio handshake, discovery and rejected calls without launching apps',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mdok-mcp-test-'));
 const client=new Client({name:'mdok-test',version:'1'});
 try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js','mcp','--root',dir],stderr:'pipe'}));
  const list=await client.listTools();assert.deepEqual(list.tools.map(t=>t.name),['open_in_mdok']);
  for(const args of [{path:'https://example.com/a.md'},{path:'/missing.md'},{path:'x.md',app:'evil'}]){
   const result=await client.callTool({name:'open_in_mdok',arguments:args});assert.equal(result.isError,true);
  }
  assert.equal((await client.callTool({name:'unknown',arguments:{}})).isError,true);
 }finally{await client.close();await rm(dir,{recursive:true,force:true});}
});
