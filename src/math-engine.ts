import { Worker } from 'node:worker_threads';
import katexPackage from 'katex/package.json' with {type:'json'};
import mathjaxPackage from '@mathjax/src/package.json' with {type:'json'};
import type { MathEngine, MathAnalysis, DelimiterPolicy, MathDiagnostic } from './math.js';
import type { MarkdownProfile } from './document-analysis.js';
import {analyzeAsync} from './analysis-jobs.js';

export interface EngineReport extends MathAnalysis {engine:string; revision:number}
export interface EngineOptions {signal?:AbortSignal; timeout?:number; revision?:number; policy?:DelimiterPolicy; profile?:MarkdownProfile; macros?:Record<string,string>}
export async function checkMath(text:string,engine:MathEngine='basic',options:EngineOptions={}):Promise<EngineReport> {
  if(!['basic','katex','mathjax'].includes(engine)) throw Error('Unsupported math engine');
  if(options.signal?.aborted) throw Error('Cancelled');
  const macros=options.macros??{};
  if(Object.entries(macros).length>100 || JSON.stringify(macros).length>8192 || Object.entries(macros).some(([k,v])=>!/^\\[A-Za-z]+$/.test(k)||typeof v!=='string')) throw Error('Invalid macro configuration');
  const analysis=await analyzeAsync(text,options.policy,options.profile,{signal:options.signal});
  const version=engine==='basic'?'basic/1':`${engine}/${engine==='katex'?katexPackage.version:mathjaxPackage.version}`;
  const report:EngineReport={...analysis,engine:version,revision:options.revision??0};
  if(engine==='basic'||!analysis.regions.length) return report;
  // Never permit macro definitions or resource-related primitives to mutate state or fetch data.
  const forbidden=/\\(?:def|gdef|edef|xdef|let|global|newcommand|renewcommand|require|input|include|includegraphics|href|url|html\w*|write|openout|read|catcode|csname)\b/;
  const selected=analysis.regions.filter(r=>{
    const body=text.slice(r.body.start,r.body.end);
    if(forbidden.test(body)) {report.diagnostics.push({...r,code:'unknown',severity:'info',detail:'Document macros/resources are not enabled'});return false;}
    return true;
  }).slice(0,200);
  if(selected.length<analysis.regions.length && analysis.regions.length>200) {report.partial=true;report.diagnostics.push({start:0,end:0,code:'resource',severity:'warning',detail:'200 math regions per check'});}
  if(!selected.length) return report;
  const engineMacros=engine==='mathjax'?Object.fromEntries(Object.entries(macros).map(([k,v])=>[k.slice(1),v])):macros;
  const result=await new Promise<{errors?:{i:number;message:string}[];fatal?:string}>(resolve=>{
    const entry=new URL(import.meta.url.endsWith('.ts')?'../dist/math-engine-worker.js':'./math-engine-worker.js',import.meta.url);
    const worker=new Worker(entry,{execArgv:[],workerData:{engine,macros:engineMacros,items:selected.map(r=>({body:text.slice(r.body.start,r.body.end),display:r.display}))},resourceLimits:{maxOldGenerationSizeMb:128}});
    let settled=false;
    const finish=(value:{errors?:{i:number;message:string}[];fatal?:string})=>{
      if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);void worker.terminate();resolve(value);
    };
    const abort=()=>finish({fatal:'Cancelled'});
    const timer=setTimeout(()=>finish({fatal:'Engine time budget exceeded'}),Math.max(1,Math.min(options.timeout??2000,10000)));
    options.signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',finish);worker.once('error',e=>finish({fatal:e.message}));worker.once('exit',()=>finish({fatal:'Engine exited'}));
    if(options.signal?.aborted) abort();
  });
  if(options.signal?.aborted) throw Error('Cancelled');
  if(result.fatal){report.partial=true;report.diagnostics.push({start:0,end:0,code:'resource',severity:'warning',detail:result.fatal});}
  for(const e of result.errors??[]) report.diagnostics.push({...selected[e.i],code:'engine',severity:'warning',detail:e.message});
  return report;
}
export function diagnosticText(d:MathDiagnostic,lang:string='en'):string {
  const en={unclosed:'Unclosed math delimiter',brace:'Unmatched brace',ambiguous:'Ambiguous dollar delimiter',engine:'Selected engine could not parse this math',unknown:'Not checked: unsupported macro/resource configuration',resource:'Analysis incomplete (resource limit)'};
  const ko={unclosed:'수식 구분자가 닫히지 않았습니다',brace:'중괄호 짝이 맞지 않습니다',ambiguous:'달러 구분자가 모호합니다',engine:'선택한 엔진에서 수식을 해석하지 못했습니다',unknown:'검사 안 함: 매크로/외부 자원 설정 미지원',resource:'자원 제한으로 검사가 일부 생략되었습니다'};
  return (lang==='ko'?ko:en)[d.code]+(d.detail?` (${d.detail})`:'');
}
