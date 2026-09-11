import QRCode from 'qrcode';

/** Shared MDOK1 framing. The caller supplies gzip/base64 and its SHA-256 id. */
export function qrFrames(encoded:string,id:string,version:number,protocol:'MDOK1'|'MDOK2'='MDOK1'):string[]{
 if(!Number.isInteger(version)||version<3||version>40)throw Error('size');
 let count=1,capacity=0;
 for(;;){
  let low=0,high=3000;
  while(low<high){
   const mid=Math.ceil((low+high)/2);
   try{QRCode.create([{data:new TextEncoder().encode(`${protocol}:${id}:${count}:${count}:${'a'.repeat(mid)}`),mode:'byte'}],{version,errorCorrectionLevel:'L'});low=mid;}
   catch{high=mid-1;}
  }
  if(!low)throw Error('size');
  capacity=low;const next=Math.ceil(encoded.length/capacity);
  if(String(next).length<=String(count).length){count=next;break;}
  count=next;
 }
 if(count>4096)throw Error('limit');
 return Array.from({length:count},(_,i)=>`${protocol}:${id}:${i+1}:${count}:${encoded.slice(i*capacity,(i+1)*capacity)}`);
}
