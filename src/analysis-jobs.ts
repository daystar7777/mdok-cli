import {Worker} from 'node:worker_threads';
import type {MathAnalysis,DelimiterPolicy,ConversionPlan} from './math.js';
import type {Comparison} from './compare.js';
import type {MarkdownProfile,Range} from './document-analysis.js';
interface JobOptions {signal?:AbortSignal;timeout?:number}
export function analysisJob<T>(data:Record<string,unknown>,options:JobOptions={}):Promise<T>{
  if(options.signal?.aborted)return Promise.reject(Error('Cancelled'));
  return new Promise((resolve,reject)=>{
    const entry=new URL(import.meta.url.endsWith('.ts')?'../dist/analysis-worker.js':'./analysis-worker.js',import.meta.url);
    const worker=new Worker(entry,{workerData:data,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:192}});
    let done=false;
    const finish=(error?:Error,value?:T)=>{if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);void worker.terminate();if(error)reject(error);else resolve(value!);};
    const abort=()=>finish(Error('Cancelled'));
    const timer=setTimeout(()=>finish(Error('Analysis time budget exceeded')),Math.max(1,Math.min(options.timeout??3000,10000)));
    worker.once('message',m=>finish(m.error?Error(m.error):undefined,m.result));
    worker.once('error',e=>finish(e));worker.once('exit',()=>finish(Error('Analysis worker exited')));
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
  });
}
export const analyzeAsync=(text:string,policy:DelimiterPolicy='both',profile:MarkdownProfile='gfm',options:JobOptions={})=>analysisJob<MathAnalysis>({kind:'math',text,policy,profile},options);
export const compareAsync=(oldText:string,newText:string,profile:MarkdownProfile='gfm',options:JobOptions={})=>analysisJob<Comparison>({kind:'compare',old:oldText,new:newText,profile},options);
export const convertAsync=(text:string,target:'dollar'|'bracket',selection?:Range,profile:MarkdownProfile='gfm',options:JobOptions={})=>analysisJob<ConversionPlan>({kind:'convert',text,target,selection,profile},options);
