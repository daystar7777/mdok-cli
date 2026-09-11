import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {realpath,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {openDesktop} from './desktop-open.js';
export async function serveDesktop(roots:string[],app?:string){
  if(!roots.length)throw Error('At least one explicit --root directory is required.');
  const allowed=await Promise.all(roots.map(async root=>{const p=await realpath(root);if(!(await stat(p)).isDirectory())throw Error('Root must be a directory.');return p;}));
  const server=new Server({name:'mdok-desktop',version:'0.1.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{
    name:'open_in_mdok',description:'Request opening an existing local Markdown file in the mdok desktop reader. Only explicitly configured folders are allowed. Does not return document content. Success means requested, not confirmation that the user accepted a dirty-document dialog.',
    inputSchema:{type:'object',properties:{path:{type:'string',description:'Absolute local .md or .markdown path'}},required:['path'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  }]}));
  server.setRequestHandler(CallToolRequestSchema,async request=>{
    try{
      if(request.params.name!=='open_in_mdok')throw Error('Unknown tool.');
      const args=request.params.arguments;
      if(!args||typeof args.path!=='string'||!isAbsolute(args.path)||Object.keys(args).some(k=>k!=='path'))throw Error('Expected only an absolute local path string.');
      const result=await openDesktop(args.path,{app,roots:allowed});
      return {content:[{type:'text',text:JSON.stringify(result)}]};
    }catch(e){return {isError:true,content:[{type:'text',text:String(e)}]};}
  });
  await server.connect(new StdioServerTransport());
}
