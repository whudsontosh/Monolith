/* ============================== MONOLITH CORE: ZIP ==============================
   Reading (stored and deflate) and writing (stored) zip files, for packages and campaign files. */
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(u8){let c=0xffffffff;for(let i=0;i<u8.length;i++)c=CRC_TABLE[(c^u8[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0}
function zipBuild(files){ // files: [{name, data:Uint8Array}]
  const enc=new TextEncoder();const parts=[];const central=[];let off=0;
  const now=new Date();const time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);const date=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
  for(const f of files){const name=enc.encode(f.name);const data=f.data;const crc=crc32(data);
    const h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,0,true);h.setUint16(10,time,true);h.setUint16(12,date,true);
    h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);h.setUint16(28,0,true);
    parts.push(new Uint8Array(h.buffer),name,data);
    const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(10,0,true);c.setUint16(12,time,true);c.setUint16(14,date,true);
    c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,off,true);
    central.push(new Uint8Array(c.buffer),name);off+=30+name.length+data.length}
  const cdSize=central.reduce((a,b)=>a+b.length,0);
  const e=new DataView(new ArrayBuffer(22));e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,cdSize,true);e.setUint32(16,off,true);
  return new Blob([...parts,...central,new Uint8Array(e.buffer)],{type:"application/zip"})}
async function zipParse(buf){const u8=new Uint8Array(buf);const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  let eocd=-1;for(let i=u8.length-22;i>=Math.max(0,u8.length-65558);i--){if(dv.getUint32(i,true)===0x06054b50){eocd=i;break}}
  if(eocd<0)throw new Error("That file isn't a zip.");
  const count=dv.getUint16(eocd+10,true);let p=dv.getUint32(eocd+16,true);if(count>4000)throw new Error("That file holds too many files.");
  const out=new Map();let total=0;const dec=new TextDecoder();
  for(let i=0;i<count;i++){if(dv.getUint32(p,true)!==0x02014b50)throw new Error("The file is damaged.");
    const method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true),usize=dv.getUint32(p+24,true),nlen=dv.getUint16(p+28,true),xlen=dv.getUint16(p+30,true),clen=dv.getUint16(p+32,true),loc=dv.getUint32(p+42,true);
    const name=dec.decode(u8.subarray(p+46,p+46+nlen));p+=46+nlen+xlen+clen;
    if(name.endsWith("/"))continue;
    if(/(^|[\\/])\.\.([\\/]|$)/.test(name)||/^[\\/]/.test(name))throw new Error("The file contains an unsafe file name.");
    total+=usize;if(total>700*1024*1024)throw new Error("The file is too big.");
    const start=loc+30+dv.getUint16(loc+26,true)+dv.getUint16(loc+28,true);const raw=u8.subarray(start,start+csize);
    let data;if(method===0)data=raw.slice();
    else if(method===8){const ds=new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));data=new Uint8Array(await new Response(ds).arrayBuffer())}
    else throw new Error("The file uses a compression this app can't read.");
    out.set(name,data)}
  return out}

Monolith.zip={build:zipBuild,parse:zipParse,crc32};
