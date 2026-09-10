import {parentPort,workerData} from 'node:worker_threads';
import {analyzeMath,planDelimiterConversion} from './math.js';
import {compareDocuments} from './compare.js';
try {
  const d=workerData;
  const result=d.kind==='math'?analyzeMath(d.text,d.policy,d.profile):d.kind==='convert'?planDelimiterConversion(d.text,d.target,d.selection,d.profile):compareDocuments(d.old,d.new,d.profile);
  parentPort?.postMessage({result});
} catch(e){parentPort?.postMessage({error:(e as Error).message});}
