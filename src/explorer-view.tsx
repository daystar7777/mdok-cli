import React,{useEffect,useRef,useState} from 'react';
import {Box,Text,useInput} from 'ink';
import {stat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {filterEntries,listDirectory,newMarkdownPath,type ExplorerEntry,type ExplorerLocation} from './explorer.js';
import {safeDisplay} from './document-analysis.js';
import {previousBoundary,nextBoundary,sliceByWidth,strWidth} from './width.js';
export type ExplorerMouse=(cb:number,x:number,y:number,pressed:boolean)=>void;
type Decision='save'|'discard';
interface Props {columns:number;rows:number;lang:string;location:React.MutableRefObject<ExplorerLocation>;mouse:React.MutableRefObject<ExplorerMouse|null>;inputBlocked:()=>boolean;dirty:boolean;onClose:()=>void;onChoose:(path:string,create:boolean,decision?:Decision)=>Promise<void>}
const words={
  en:{up:'Up',path:'Path',search:'Search',open:'Open',create:'New MD',back:'Back',hidden:'Hidden',all:'All files',md:'MD only',loading:'Loading…',empty:'No matching files',name:'Name',size:'Size',date:'Modified',filename:'New Markdown name',confirm:'Unsaved changes: [Save] [Discard] [Cancel]',keys:'↑↓ select · Enter open · Backspace up · / search · p path · n new · h hidden · m filter · Esc back',save:'Save',discard:'Discard',cancel:'Cancel',busy:'Working…'},
  ko:{up:'상위',path:'경로',search:'검색',open:'열기',create:'새 MD',back:'돌아가기',hidden:'숨김',all:'전체 파일',md:'MD만',loading:'읽는 중…',empty:'일치하는 파일 없음',name:'이름',size:'크기',date:'수정일',filename:'새 Markdown 이름',confirm:'미저장 변경: [저장] [버리기] [취소]',keys:'↑↓ 선택 · Enter 열기 · Backspace 상위 · / 검색 · p 경로 · n 생성 · h 숨김 · m 필터 · Esc 복귀',save:'저장',discard:'버리기',cancel:'취소',busy:'처리 중…'},
};
export function ExplorerView(p:Props){
  const w=words[p.lang==='ko'?'ko':'en'];
  const [location,setLocation]=useState({...p.location.current});
  const [entries,setEntries]=useState<ExplorerEntry[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [reload,setReload]=useState(0);
  const [field,setField]=useState<{kind:'path'|'search'|'new';value:string;cursor:number}|null>(null);
  const [pending,setPending]=useState<{path:string;create:boolean}|null>(null);
  const [busy,setBusy]=useState(false);const busyRef=useRef(false);
  const [metadata,setMetadata]=useState<Record<string,string>>({});
  const [promptIndex,setPromptIndex]=useState(2);
  const lastClick=useRef<{path:string;time:number}|null>(null);
  const width=Math.max(1,p.columns);
  const labels=[w.up,w.path,w.search,w.open,w.create,location.markdownOnly?w.md:w.all,w.hidden+(location.hidden?'+':'-'),w.back];
  let toolbarRow=0,toolbarCol=0;
  const buttonLayout=labels.map(label=>{
    const size=strWidth(label)+3;if(toolbarCol&&toolbarCol+size>width){toolbarRow++;toolbarCol=0;}
    const result={label,row:toolbarRow,start:toolbarCol,end:toolbarCol+size-1};toolbarCol+=size;return result;
  });
  const toolbarRows=toolbarRow+1,listStart=3+toolbarRows,height=Math.max(1,p.rows-6-toolbarRows);
  const filtered=filterEntries(entries,location.query,location.hidden,location.markdownOnly);
  const selected=Math.min(location.selected,Math.max(0,filtered.length-1));
  const top=Math.min(location.top,Math.max(0,filtered.length-height));
  p.location.current=location;
  const change=(patch:Partial<ExplorerLocation>)=>setLocation(v=>({...v,...patch}));
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError('');
    void listDirectory(location.path,abort.signal).then(result=>{
      if(abort.signal.aborted)return;setEntries(result.entries);setLoading(false);
      setLocation(v=>({...v,path:result.path}));
    }).catch(e=>{if(!abort.signal.aborted){setEntries([]);setLoading(false);setError(e.message);}});
    return()=>abort.abort();
  },[location.path,reload]);
  useEffect(()=>{
    let live=true;
    void Promise.all(filtered.slice(top,top+height).map(async e=>{
      const info=await stat(e.path).then(s=>`${e.directory?'<DIR>':s.size.toLocaleString()}  ${s.mtime.toISOString().slice(0,10)}`).catch(()=>'?');
      return [e.path,info] as const;
    })).then(items=>{if(live)setMetadata(Object.fromEntries(items));});
    return()=>{live=false;};
  },[entries,top,height,location.query,location.hidden,location.markdownOnly]);
  const move=(index:number)=>{
    const next=Math.max(0,Math.min(index,filtered.length-1));
    change({selected:next,top:next<top?next:next>=top+height?next-height+1:top});lastClick.current=null;
  };
  const navigate=(path:string)=>{setEntries([]);setLoading(true);setField(null);lastClick.current=null;change({path,selected:0,top:0,query:''});setReload(v=>v+1);};
  const execute=async(target:{path:string;create:boolean},decision?:Decision)=>{
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');
    try{await p.onChoose(target.path,target.create,decision);}
    catch(e){setError((e as Error).message);setPending(null);setField(null);}
    finally{busyRef.current=false;setBusy(false);}
  };
  const request=(target:{path:string;create:boolean})=>{
    if(p.dirty){setField(null);setPending(target);setPromptIndex(2);}else void execute(target);
  };
  const activate=(index=selected)=>{
    if(loading||busyRef.current)return;
    const e=filtered[index];if(!e)return;
    if(e.directory)navigate(e.path);else request({path:e.path,create:false});
  };
  const setInput=(kind:'path'|'search'|'new')=>{
    const value=kind==='path'?location.path:kind==='search'?location.query:'';
    setField({kind,value,cursor:value.length});setError('');
  };
  const confirm=(index:number)=>{if(index===2)setPending(null);else if(pending)void execute(pending,index===0?'save':'discard');};
  const actions:[string,()=>void][]=[[w.up,()=>navigate(dirname(location.path))],[w.path,()=>setInput('path')],[w.search,()=>setInput('search')],[w.open,()=>activate()],[w.create,()=>setInput('new')],[location.markdownOnly?w.md:w.all,()=>change({markdownOnly:!location.markdownOnly,selected:0,top:0})],[w.hidden+(location.hidden?'+':'-'),()=>change({hidden:!location.hidden,selected:0,top:0})],[w.back,p.onClose]];
  const buttons=actions.map(([,run],i)=>({...buttonLayout[i],run}));
  const promptLabels=[w.save,w.discard,w.cancel];
  p.mouse.current=(cb,x1,y1,pressed)=>{
    if(busyRef.current)return;
    const x=x1-1,y=y1-1,button=cb&3;
    if(pending){
      if(pressed&&button===0&&!(cb&32)&&y===p.rows-2){
        let at=0;for(let i=0;i<promptLabels.length;i++){const end=at+strWidth(promptLabels[i])+3;if(x>=at&&x<end){confirm(i);break;}at=end;}
      }return;
    }
    if(field)return;
    if(y>=2&&y<2+toolbarRows&&pressed&&button===0&&!(cb&32)){buttons.find(b=>b.row===y-2&&x>=b.start&&x<b.end)?.run();return;}
    if(y<listStart||y>=listStart+height||loading)return;
    if(cb&64){change({top:Math.max(0,Math.min(top+(button===0?-3:3),Math.max(0,filtered.length-height)))});lastClick.current=null;return;}
    if(pressed&&button===0&&!(cb&32)){
      const index=top+y-listStart,e=filtered[index];if(!e)return;
      change({selected:index});const now=Date.now();
      if(lastClick.current?.path===e.path&&now-lastClick.current.time<400){lastClick.current=null;activate(index);}
      else lastClick.current={path:e.path,time:now};
    }
  };
  useEffect(()=>()=>{p.mouse.current=null;},[]);
  useInput((input,key)=>{
    if(p.inputBlocked()||busyRef.current||input.includes('\x1b[')||/^\[<\d/.test(input))return;
    if(pending){
      if(key.escape||input==='c'){setPending(null);return;}
      if(key.leftArrow)setPromptIndex(v=>Math.max(0,v-1));
      else if(key.rightArrow||key.tab)setPromptIndex(v=>(v+1)%3);
      else if(key.return)confirm(promptIndex);
      else if(input==='s')confirm(0);else if(input==='d')confirm(1);
      return;
    }
    if(field){
      if(key.escape){setField(null);return;}
      if(key.return){
        try{
          if(field.kind==='path')navigate(resolve(location.path,field.value));
          else if(field.kind==='search'){change({query:field.value,selected:0,top:0});setField(null);}
          else request({path:newMarkdownPath(location.path,field.value),create:true});
        }catch(e){setError((e as Error).message);}return;
      }
      let {value,cursor}=field;
      if(key.ctrl&&input==='u'){value='';cursor=0;}
      else if(key.leftArrow)cursor=previousBoundary(value,cursor);
      else if(key.rightArrow)cursor=nextBoundary(value,cursor);
      else if(key.home||(key.ctrl&&input==='a'))cursor=0;
      else if(key.end||(key.ctrl&&input==='e'))cursor=value.length;
      else if(key.backspace){const previous=previousBoundary(value,cursor);value=value.slice(0,previous)+value.slice(cursor);cursor=previous;}
      else if(key.delete)value=value.slice(0,cursor)+value.slice(nextBoundary(value,cursor));
      else if(!key.ctrl&&!key.meta&&!key.tab){const clean=input.replace(/[\x00-\x1f\x7f]/g,'');value=value.slice(0,cursor)+clean+value.slice(cursor);cursor+=clean.length;}
      setField({...field,value,cursor});return;
    }
    if(key.escape){p.onClose();return;}
    if(key.upArrow)move(selected-1);else if(key.downArrow)move(selected+1);
    else if(key.pageUp)move(selected-height);else if(key.pageDown)move(selected+height);
    else if(key.home)move(0);else if(key.end)move(filtered.length-1);
    else if(key.return)activate();else if(key.backspace)navigate(dirname(location.path));
    else if(input==='/')setInput('search');else if(input==='p')setInput('path');else if(input==='n')setInput('new');
    else if(input==='h')change({hidden:!location.hidden,selected:0,top:0});
    else if(input==='m')change({markdownOnly:!location.markdownOnly,selected:0,top:0});
    else if(input==='r')setReload(v=>v+1);
  });
  const nameWidth=Math.max(1,width-(width>=65?28:0));
  const line=(value:string)=>sliceByWidth(safeDisplay(value),0,width).text;
  return <Box flexDirection="column" width={width} height={p.rows}>
    <Text bold wrap="truncate">[Explore] mdok</Text>
    <Text wrap="truncate">{line(location.path)}</Text>
    {Array.from({length:toolbarRows},(_,row)=><Text key={'toolbar'+row} wrap="truncate">{buttons.filter(b=>b.row===row).map(b=>`[${b.label}] `).join('')}</Text>)}
    <Text dimColor wrap="truncate">{w.name}{width>=65?' '.repeat(Math.max(1,nameWidth-strWidth(w.name)))+w.size+' / '+w.date:''}</Text>
    {Array.from({length:height},(_,i)=>{
      const e=loading?undefined:filtered[top+i];
      const label=e?`${e.directory?'[D]':e.link?'[L]':'   '} ${e.name}`:i===0?(loading?w.loading:w.empty):'';
      const name=sliceByWidth(safeDisplay(label),0,nameWidth).text;
      return <Box key={i} height={1} flexShrink={0}><Text inverse={!!e&&top+i===selected} wrap="truncate">{name||' '}{e&&width>=65?' '.repeat(Math.max(1,nameWidth-strWidth(name)))+(metadata[e.path]??''):''}</Text></Box>;
    })}
    <Text wrap="truncate">{line(busy?w.busy:error||`${selected+1}/${filtered.length} ${location.query?' / '+location.query:''}${pending?' '+w.confirm:''}`)}</Text>
    <Box height={1} flexShrink={0}>{pending?<Text wrap="truncate">{promptLabels.map((label,i)=><Text key={i} inverse={promptIndex===i}>[{label}] </Text>)}</Text>:<Text wrap="truncate">{field?line(`${field.kind==='new'?w.filename:field.kind==='path'?w.path:w.search}: ${field.value.slice(0,field.cursor)}│${field.value.slice(field.cursor)}`):' '}</Text>}</Box>
    <Text dimColor wrap="truncate">{w.keys}</Text>
  </Box>;
}
