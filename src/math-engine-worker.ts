import {parentPort,workerData as d} from 'node:worker_threads';
import katex from 'katex';
import {mathjax} from '@mathjax/src/js/mathjax.js';
import {TeX} from '@mathjax/src/js/input/tex.js';
import {SVG} from '@mathjax/src/js/output/svg.js';
import {liteAdaptor} from '@mathjax/src/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
// Literal imports let standalone builds embed the engines, with no runtime
// node_modules lookup and no evaluation of document-supplied JavaScript.
try {
  let check:(body:string,display:boolean)=>void;
  if(d.engine==='katex') {
    check=(body,display)=>{katex.renderToString(body,{displayMode:display,throwOnError:true,trust:false,maxExpand:500,maxSize:20,strict:'error',macros:{...d.macros}});};
  } else {
    RegisterHTMLHandler(liteAdaptor());
    check=(body,display)=>{
      const tex=new TeX({packages:['base','ams','configmacros'],macros:d.macros,maxBuffer:32768,maxMacros:500,formatError:(_jax:unknown,e:Error)=>{throw e;}});
      mathjax.document('',{InputJax:tex,OutputJax:new SVG({fontCache:'none'})}).convert(body,{display});
    };
  }
  const errors=[];
  for(let i=0;i<d.items.length;i++){
    try{check(d.items[i].body,d.items[i].display);}
    catch(e){errors.push({i,message:String((e as Error).message||e).slice(0,240)});}
  }
  parentPort?.postMessage({errors});
}catch(e){parentPort?.postMessage({fatal:String((e as Error).message||e).slice(0,240)});}
