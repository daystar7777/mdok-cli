import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash,randomBytes} from 'node:crypto';
import {createFileTransfer,QR_FILE_LIMIT} from './qr-file.js';
test('MDOK2 preserves arbitrary bytes, empty files, names and hashes',()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from([0,255,128,13,10]),randomBytes(4096),Buffer.from('한글\n')]){
  const r=createFileTransfer('/tmp/파일.zip',bytes,8);
  assert.ok(r.frames.every(f=>f.startsWith('MDOK2:')));
  const encoded=r.frames.map(f=>f.split(':')[4]).join('');
  assert.equal(r.frames[0].split(':')[1],createHash('sha256').update(encoded).digest('hex').slice(0,16));
  const doc=JSON.parse(gunzipSync(Buffer.from(encoded,'base64')).toString('utf8'));
  assert.equal(doc.name,'파일.zip');assert.equal(doc.size,bytes.length);
  assert.deepEqual(Buffer.from(doc.data,'base64'),bytes);assert.equal(doc.sha256,createHash('sha256').update(bytes).digest('hex'));
 }
});
test('file and QR limits',()=>{
 assert.throws(()=>createFileTransfer('large',Buffer.alloc(QR_FILE_LIMIT+1),8));
 assert.throws(()=>createFileTransfer('file',Buffer.alloc(1),2));
});
