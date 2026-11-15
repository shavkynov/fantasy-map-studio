'use strict';
// Чтение файла растра высот: 16-битный серый PNG (все 5 фильтров, контрольные суммы, отказы) и JSON. PNG строится здесь же через zlib.
// Не проверяются: выбор файла в странице, большие реальные файлы, цветные/индексные PNG кроме отказа.
const assert=require('node:assert/strict'),zlib=require('node:zlib'),F=require('../src/elevation-raster-file');
let count=0;async function test(name,fn){await fn();console.log('PASS '+(++count)+' '+name);}
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})(),crc=b=>{let c=0xFFFFFFFF;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
const chunk=(type,data)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length,0);b.write(type,4,'latin1');Buffer.from(data).copy(b,8);b.writeUInt32BE(crc(b.subarray(4,8+data.length)),8+data.length);return b;};
function png(w,h,vals,{depth=16,colour=0,interlace=0,filters=[0],extra=[],trim=0}={}){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=depth;ihdr[9]=colour;ihdr[10]=0;ihdr[11]=0;ihdr[12]=interlace;
 const stride=w*2,rows=[],prev=Buffer.alloc(stride);
 for(let y=0;y<h;y++){const line=Buffer.alloc(stride);for(let x=0;x<w;x++)line.writeUInt16BE(vals[y*w+x],x*2);const f=filters[y%filters.length],out=Buffer.alloc(stride+1);out[0]=f;
  for(let i=0;i<stride;i++){const a=i>=2?line[i-2]:0,b=prev[i],c=i>=2?prev[i-2]:0;let p=0;if(f===1)p=a;else if(f===2)p=b;else if(f===3)p=(a+b)>>1;else if(f===4){const q=a+b-c,pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c);p=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}out[1+i]=(line[i]-p)&255;}
  rows.push(out);line.copy(prev);}
 const z=zlib.deflateSync(Buffer.concat(rows));return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...extra,chunk('IDAT',z.subarray(0,z.length-trim)),chunk('IEND',[])]));
}
const rnd=(n,s=7)=>{const a=new Uint16Array(n);let x=s;for(let i=0;i<n;i++){x=(x*1103515245+12345)&0x7fffffff;a[i]=x&65535;}a[0]=0;a[1]=65535;return a;};
(async()=>{
 await test('16-битный PNG: значения и линейное отображение в метры, все пять фильтров',async()=>{
  const w=13,h=10,v=rnd(w*h);
  for(const filters of [[0],[1],[2],[3],[4],[0,1,2,3,4]]){const r=await F.decode(png(w,h,v,{filters}),{minMeters:-500,maxMeters:8500});assert.equal(r.w,w);assert.equal(r.h,h);assert.equal(r.format,'png16');
   for(let i=0;i<v.length;i++)assert(Math.abs(r.meters[i]-(-500+v[i]/65535*9000))<1e-9,'фильтры '+filters+' клетка '+i);}
  const r=await F.decode(png(2,1,Uint16Array.of(0,65535)),{minMeters:-11000,maxMeters:9000});assert.equal(r.meters[0],-11000);assert.equal(r.meters[1],9000);
 });
 await test('Контрольная сумма, обрезка, мусор и неверный формат отклоняются',async()=>{
  const ok=png(8,4,rnd(32)),o={minMeters:0,maxMeters:1000};
  const bad=Uint8Array.from(ok);bad[40]^=1;await assert.rejects(F.decode(bad,o),/checksum|data/i);
  await assert.rejects(F.decode(ok.subarray(0,ok.length-20),o));await assert.rejects(F.decode(png(8,4,rnd(32),{trim:4}),o));
  await assert.rejects(F.decode(png(8,4,rnd(32),{depth:8}),o),/16-bit/);await assert.rejects(F.decode(png(8,4,rnd(32),{colour:2}),o),/16-bit|greyscale/);await assert.rejects(F.decode(png(8,4,rnd(32),{interlace:1}),o),/Interlaced/);
  await assert.rejects(F.decode(png(8,4,rnd(32),{extra:[chunk('PLTE',[0,0,0])]}),o),/required/);
  const withAncillary=await F.decode(png(8,4,rnd(32),{extra:[chunk('gAMA',[0,0,0,1])]}),o);assert.equal(withAncillary.w,8);
  await assert.rejects(F.decode(Uint8Array.of(1,2,3),o));await assert.rejects(F.decode(new Uint8Array(0),o));
 });
 await test('Диапазон метров для PNG обязателен и проверяется',async()=>{
  const ok=png(4,2,rnd(8));for(const o of [{},{minMeters:0},{minMeters:5,maxMeters:5},{minMeters:9,maxMeters:1},{minMeters:NaN,maxMeters:1},{minMeters:0,maxMeters:2e6},{minMeters:0,maxMeters:1,extra:1}])await assert.rejects(F.decode(ok,o),undefined,JSON.stringify(o));
  await assert.rejects(F.decode([1,2],{}));
 });
 await test('JSON-растр: принимается только {w,h,meters} с конечными числами',async()=>{
  const enc=o=>new TextEncoder().encode(JSON.stringify(o)),r=await F.decode(enc({w:2,h:2,meters:[1,-2,3.5,0]}),{});assert.deepEqual([...r.meters],[1,-2,3.5,0]);assert.equal(r.format,'json');
  for(const bad of [{w:2,h:2,meters:[1,2,3]},{w:2,h:2,meters:[1,2,3,'4']},{w:2,h:2,meters:[1,2,3,null]},{w:2,h:2,meters:[1,2,3,2e6]},{w:0,h:2,meters:[]},{w:2,h:2,meters:[1,2,3,4],x:1},[],null,'text'])await assert.rejects(F.decode(enc(bad),{}),undefined,JSON.stringify(bad));
  await assert.rejects(F.decode(new TextEncoder().encode('not json'),{}),/neither/);await assert.rejects(F.decode(Uint8Array.of(0xff,0xfe,0xfd),{}));
 });
 await test('Предел размера',async()=>{await assert.rejects(F.decode(new TextEncoder().encode(JSON.stringify({w:5000,h:5000,meters:[]})),{}));});
 console.log(JSON.stringify({passed:true,scope:'PNG16 grey decoder with 5 filters/CRC/refusals, JSON raster, range checks',notChecked:'page file picker, large real files, performance, CI'}));
})().catch(e=>{console.error(e);process.exit(1);});
