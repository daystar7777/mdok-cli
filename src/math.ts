import { parseDocument, excludedRanges, type MarkdownProfile, type Range } from './document-analysis.js';

export type DelimiterPolicy = 'both' | 'dollar' | 'bracket' | 'off';
export type MathEngine = 'basic' | 'katex' | 'mathjax';
export interface MathRegion extends Range {body: Range; display: boolean; open: string; close: string}
export interface MathDiagnostic extends Range {
  code: 'unclosed' | 'brace' | 'ambiguous' | 'engine' | 'unknown' | 'resource';
  severity: 'error' | 'warning' | 'info'; detail?: string;
}
export interface MathAnalysis { regions: MathRegion[]; diagnostics: MathDiagnostic[]; partial: boolean }
export interface MathToken extends Range {text:string; kind:'command'|'delimiter'|'group'|'operator'|'number'|'text'|'space'|'comment'}
export const escaped = (s: string, at: number): boolean => {
  let n=0; while(at>0 && s[--at]==='\\') n++; return n%2===1;
};
export function mathTokens(text:string, offset=0):MathToken[] {
  const out:MathToken[]=[];
  const re=/\\[a-zA-Z]+\*?|\\[^\r\n]|%[^\r\n]*|[{}]|[=+*/^_<>-]|\d+(?:\.\d+)?|\s+|[^\\%{}=+*/^_<>\d\s-]+|./gu;
  for(const m of text.matchAll(re)) {
    const v=m[0];
    const kind:MathToken['kind']=v.startsWith('\\')?'command':v.startsWith('%')?'comment':/^[{}]$/.test(v)?'group':/^[=+*/^_<>-]$/.test(v)?'operator':/^\d/.test(v)?'number':/^\s/.test(v)?'space':'text';
    out.push({start:offset+m.index!,end:offset+m.index!+v.length,text:v,kind});
  }
  return out;
}
export function analyzeMath(text:string, policy:DelimiterPolicy='both', profile:MarkdownProfile='gfm'):MathAnalysis {
  if(!['both','dollar','bracket','off'].includes(policy)) throw Error('Unsupported delimiter policy');
  if(!['gfm','commonmark'].includes(profile)) throw Error('Unsupported Markdown profile');
  const result:MathAnalysis={regions:[],diagnostics:[],partial:false};
  if(policy==='off') return result;
  const root=parseDocument(text,profile), mask=new Uint8Array(text.length);
  for(const r of excludedRanges(text,root)) mask.fill(1,r.start,r.end);
  const pairs = [...(policy!=='bracket'?[['$$','$$'],['$','$']]:[]),...(policy!=='dollar'?[['\\[','\\]'],['\\(','\\)']]:[])];
  for(let i=0;i<text.length;i++) {
    if(mask[i]) continue;
    const pair=pairs.find(([o])=>text.startsWith(o,i));
    if(!pair || escaped(text,i)) continue;
    const [open,close]=pair,display=open==='$$'||open==='\\[';
    if(open==='$' && (/\s/.test(text[i+1]??' ') || text[i-1]==='$')) continue;
    let end=-1, comment=false, j=i+open.length;
    for(;j<text.length && j-i<=32768;j++) {
      if(mask[j] || (!display && /[\r\n]/.test(text[j])) || (display && /^\r?\n[ \t]*\r?\n/.test(text.slice(j,j+8)))) break;
      if(text[j]==='\n') comment=false;
      if(comment) continue;
      if(text[j]==='%' && !escaped(text,j)) {comment=true;continue;}
      if(text.startsWith(close,j) && !escaped(text,j) && !(open==='$' && (text[j+1]==='$'||/\s/.test(text[j-1])))) {end=j;break;}
    }
    if(end<0) {
      if(open==='$'&&/\d/.test(text[i+1]??'')){i=Math.max(i,j-1);continue;} // plain currency
      const code=j-i>32768?'resource':open==='$'?'ambiguous':'unclosed';
      result.diagnostics.push({start:i,end:i+open.length,code,severity:code==='unclosed'?'error':code==='resource'?'warning':'info'});
      result.partial ||= code==='resource'; i=Math.max(i+open.length-1,j-1); continue;
    }
    const r:MathRegion={start:i,end:end+close.length,body:{start:i+open.length,end},open,close,display};
    result.regions.push(r);
    const stack:number[]=[];
    for(const t of mathTokens(text.slice(r.body.start,r.body.end),r.body.start)) {
      if(t.text==='{') stack.push(t.start);
      if(t.text==='}') {if(stack.length) stack.pop();else result.diagnostics.push({...t,code:'brace',severity:'error'});}
    }
    for(const start of stack) result.diagnostics.push({start,end:start+1,code:'brace',severity:'error'});
    i=r.end-1;
  }
  return result;
}
export interface MathEdit extends Range {expected:string; replacement:string}
export interface ConversionPlan {source:string; edits:MathEdit[]; result:string; skipped:number}
export function planDelimiterConversion(text:string,target:'dollar'|'bracket', selection?:Range, profile:MarkdownProfile='gfm'):ConversionPlan {
  if(target!=='dollar' && target!=='bracket') throw Error('Unsupported conversion target');
  const analysis=analyzeMath(text,'both',profile),edits:MathEdit[]=[];
  for(const r of analysis.regions) {
    if(selection && (r.start<selection.start || r.end>selection.end)) continue;
    const [open,close]=target==='dollar'?(r.display?['$$','$$']:['$','$']):(r.display?['\\[','\\]']:['\\(','\\)']);
    if(r.open===open) continue;
    edits.push({start:r.start,end:r.body.start,expected:r.open,replacement:open},{start:r.body.end,end:r.end,expected:r.close,replacement:close});
  }
  let result=text;
  for(const e of [...edits].reverse()) result=result.slice(0,e.start)+e.replacement+result.slice(e.end);
  const after=analyzeMath(result,'both',profile);
  const bodies=(s:string,a:MathAnalysis)=>a.regions.map(r=>[r.display,s.slice(r.body.start,r.body.end)]);
  if(JSON.stringify(bodies(text,analysis))!==JSON.stringify(bodies(result,after))) throw Error('Unsafe delimiter conversion: math boundaries would change');
  return {source:text,result,edits,skipped:analysis.diagnostics.filter(d=>['ambiguous','unclosed','resource'].includes(d.code)).length};
}
export function applyConversion(current:string,plan:ConversionPlan):string {
  if(current!==plan.source) throw Error('Document changed; regenerate conversion');
  for(const e of plan.edits) if(current.slice(e.start,e.end)!==e.expected) throw Error('Stale edit');
  return plan.result;
}
