import { diffArrays, diffLines as textDiff } from 'diff';
import { parseDocument, nodeRange, safeDisplay, type SourceNode, type MarkdownProfile } from './document-analysis.js';
import { analyzeMath, mathTokens } from './math.js';
import {sliceByWidth,strWidth} from './width.js';

export interface ComparisonChunk {kind:string; old:string; new:string; changed:boolean; details:string[]}
export interface Comparison {oldText:string;newText:string;chunks:ComparisonChunk[];partial:boolean;profile:MarkdownProfile}
interface Block {type:string;raw:string;node?:SourceNode}
function blocks(text:string,profile:MarkdownProfile):Block[] {
  const root=parseDocument(text,profile),out:Block[]=[];let offset=0;
  for(const node of root.children??[]) {
    const r=nodeRange(node);
    if(r.start>offset)out.push({type:'spacing',raw:text.slice(offset,r.start)});
    out.push({type:node.type,raw:text.slice(r.start,r.end),node});offset=r.end;
  }
  if(offset<text.length)out.push({type:'spacing',raw:text.slice(offset)});
  return out;
}
function tokenDetail(a:string,b:string,math=false):string[] {
  if(a.length+b.length>32768)return ['[raw fallback: token budget]'];
  const tokenize=(s:string)=>math?mathTokens(s).map(t=>t.text):Array.from(new Intl.Segmenter(undefined,{granularity:'word'}).segment(s),t=>t.segment);
  const changes=diffArrays(tokenize(a),tokenize(b),{timeout:50,maxEditLength:2048});
  if(!changes)return ['[raw fallback: token budget]'];
  return changes.filter(c=>c.added||c.removed).map(c=>`${c.added?'+':'-'} ${c.value.join('')}`);
}
function tableDetails(a:Block,b:Block,oldText:string,newText:string):string[] {
  const rows=(block:Block,source:string)=>(block.node?.children??[]).map(row=>(row.children??[]).map(c=>{const r=nodeRange(c);return source.slice(r.start,r.end);}));
  const left=rows(a,oldText),right=rows(b,newText),details:string[]=[];
  const changes=diffArrays(left.map(r=>JSON.stringify(r)),right.map(r=>JSON.stringify(r)),{timeout:50,maxEditLength:1024});
  if(!changes)return ['[raw fallback: table alignment budget]'];
  let oi=0,ni=0;
  for(let i=0;i<changes.length;i++) {
    const c=changes[i];
    if(!c.added&&!c.removed){oi+=c.value.length;ni+=c.value.length;continue;}
    if(c.removed && changes[i+1]?.added) {
      const added=changes[++i],n=Math.max(c.value.length,added.value.length);
      for(let r=0;r<n;r++) {
        const l=left[oi+r]??[],v=right[ni+r]??[];
        for(let col=0;col<Math.max(l.length,v.length);col++)if(l[col]!==v[col])details.push(`cell old R${oi+r+1}/new R${ni+r+1} C${col+1}: ${JSON.stringify(l[col]??null)} -> ${JSON.stringify(v[col]??null)}`);
      }
      oi+=c.value.length;ni+=added.value.length;
    } else if(c.removed){details.push(`rows - ${oi+1}..${oi+c.value.length}`);oi+=c.value.length;}
    else {details.push(`rows + ${ni+1}..${ni+c.value.length}`);ni+=c.value.length;}
  }
  // Alignment/padding changes are still visible in the authoritative raw hunk.
  if(!details.length && a.raw!==b.raw)details.push('[table syntax/alignment/spacing changed: inspect raw]');
  return details;
}
export function compareDocuments(oldText:string,newText:string,profile:MarkdownProfile='gfm'):Comparison {
  const result:Comparison={oldText,newText,chunks:[],partial:false,profile};
  const left=blocks(oldText,profile),right=blocks(newText,profile);
  const changes=diffArrays(left.map(b=>`${b.type}\0${b.raw}`),right.map(b=>`${b.type}\0${b.raw}`),{timeout:500,maxEditLength:4096});
  if(!changes) return {...result,partial:true,chunks:[{kind:'raw fallback (alignment budget)',old:oldText,new:newText,changed:oldText!==newText,details:[]}]};
  let oi=0,ni=0;const deadline=Date.now()+1500;
  for(let i=0;i<changes.length;i++) {
    const c=changes[i];
    if(!c.added&&!c.removed){for(let k=0;k<c.value.length;k++){const a=left[oi++];ni++;result.chunks.push({kind:a.type,old:a.raw,new:a.raw,changed:false,details:[]});}continue;}
    const removed=c.removed?left.slice(oi,oi+c.value.length):[];
    const addition=c.added?c:(changes[i+1]?.added?changes[++i]:undefined);
    const added=addition?right.slice(ni,ni+addition.value.length):[];
    oi+=removed.length;ni+=added.length;
    for(let j=0;j<Math.max(removed.length,added.length);j++) {
      const a=removed[j],b=added[j],same=a?.type===b?.type,kind=same?a?.type??'raw':`${a?.type??'∅'} → ${b?.type??'∅'}`;
      const chunk:ComparisonChunk={kind,old:a?.raw??'',new:b?.raw??'',changed:true,details:[]};
      if(Date.now()>deadline){result.partial=true;chunk.details.push('[raw fallback: detail budget]');}
      else if(a&&b&&same){
        if(a.type==='table')chunk.details=tableDetails(a,b,oldText,newText);
        else if(a.type!=='code' && a.type!=='html' && a.type!=='spacing'){
          chunk.details=tokenDetail(a.raw,b.raw);
          const am=analyzeMath(a.raw,'both',profile),bm=analyzeMath(b.raw,'both',profile);
          for(let m=0;m<Math.max(am.regions.length,bm.regions.length);m++) {
            const ar=am.regions[m],br=bm.regions[m];
            const av=ar?a.raw.slice(ar.body.start,ar.body.end):'',bv=br?b.raw.slice(br.body.start,br.body.end):'';
            if(av!==bv||ar?.open!==br?.open)chunk.details.push(`math #${m+1}${ar?.open!==br?.open?' [delimiter changed]':''}`, ...tokenDetail(av,bv,true));
          }
        }
      }
      result.chunks.push(chunk);
    }
  }
  // Losslessness is an invariant, not an assumption about the AST.
  if(result.chunks.map(c=>c.old).join('')!==oldText||result.chunks.map(c=>c.new).join('')!==newText)throw Error('Comparison coverage invariant failed');
  return result;
}
export function comparisonLines(result:Comparison,raw=false,columns=0):string[] {
  const output:string[]=[];
  if(columns>=100&&!raw){
    const width=Math.floor((columns-3)/2);
    for(const c of result.chunks){
      if(!c.changed)continue;
      output.push(`@@ ${c.kind} [old | new] @@`);
      const left=c.old.split('\n'),right=c.new.split('\n');
      for(let i=0;i<Math.max(left.length,right.length);i++){
        const a=sliceByWidth(safeDisplay(left[i]??''),0,width).text,b=sliceByWidth(safeDisplay(right[i]??''),0,width).text;
        output.push(a+' '.repeat(Math.max(0,width-strWidth(a)))+' │ '+b);
      }
    }
    return output.length?output:['='];
  }
  if(raw){
    const rows=textDiff(result.oldText,result.newText,{timeout:500,maxEditLength:4096});
    if(rows)for(const r of rows)for(const line of r.value.split('\n'))output.push(`${r.added?'+':r.removed?'-':' '} ${safeDisplay(line)}`);
    else output.push('[raw diff budget exceeded: full old/new]',...result.oldText.split('\n').map(l=>'- '+safeDisplay(l)),...result.newText.split('\n').map(l=>'+ '+safeDisplay(l)));
  } else {
    let oldLine=1,newLine=1;
    for(const c of result.chunks){
      if(c.changed){output.push(`@@ ${c.kind} old:${oldLine} new:${newLine} @@`,...c.details.map(s=>'  '+safeDisplay(s)));
        if(c.old)output.push(...c.old.split('\n').map(l=>'- '+safeDisplay(l)));
        if(c.new)output.push(...c.new.split('\n').map(l=>'+ '+safeDisplay(l)));
      }
      oldLine+=(c.old.match(/\n/g)??[]).length;newLine+=(c.new.match(/\n/g)??[]).length;
    }
  }
  return output.length?output:['='];
}
