'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const root=path.resolve(process.argv[2]||'.'),api=require(path.join(root,'src/regional-material-terrain.js')),base=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):await require(path.join(root,'src/three-block-prototype.js')).create(),before=JSON.stringify(base.labels),relief={sourceUV:(model,p)=>p};
const a=api.create(base,relief),b=api.create(base,relief);assert.deepEqual(a.sourceValues,b.sourceValues);assert.equal(JSON.stringify(base.labels),before);
let count=0,min=Infinity,max=-Infinity;const coastal=[],inland=[];
for(let i=0;i<base.labels.length;i++){const z=a.sourceValues[i];if(base.labels[i]>=0){count++;assert.ok(Number.isFinite(z)&&z>0);min=Math.min(min,z);max=Math.max(max,z);assert.ok(Math.abs(a.materialElevation((i%256+.5)/256,(Math.floor(i/256)+.5)/171)-z)<1e-12);if(a.coastDistanceRadians[i]<.03)coastal.push(z);if(a.coastDistanceRadians[i]>.15)inland.push(z);}else assert.ok(Number.isNaN(z));}
assert.equal(count,14884);
let periodicError=0;for(let i=0;i<base.labels.length;i++)if(base.labels[i]>=0){const u=(i%256+.5)/256,v=(Math.floor(i/256)+.5)/171;periodicError=Math.max(periodicError,Math.abs(a.materialElevation(u,v)-a.materialElevation(u+1,v)));}assert.ok(periodicError<1e-12);
let seamError=0,seamCount=0;for(let y=0;y<171;y++){if(base.labels[y*256]>=0&&base.labels[y*256+255]>=0){const v=(y+.5)/171;seamError=Math.max(seamError,Math.abs(a.materialElevation(1e-10,v)-a.materialElevation(1-1e-10,v)));seamCount++;}}
assert.ok(seamError<1e-6);
const ids=base.labels.map((v,i)=>v>=0?i:-1).filter(i=>i>=0).slice(0,100),frame={w:100,h:1,land:new Uint8Array(100).fill(1),owner:new Uint8Array(100),angle:8},model={pointAt:(w,h,i)=>[(ids[i]%256+.5)/256,(Math.floor(ids[i]/256)+.5)/171],transport:p=>p,sourceLand:()=>true},mask=frame.land.slice(),out=a.heights(model,frame);
for(let i=0;i<ids.length;i++)assert.equal(out[i],a.sourceValues[ids[i]]);assert.deepEqual(frame.land,mask);
const mean=v=>v.reduce((x,y)=>x+y,0)/v.length;assert.ok(mean(coastal)<mean(inland));
if(process.argv[4])fs.writeFileSync(process.argv[4],Buffer.from(a.sourceValues.buffer));
console.log(JSON.stringify({passed:true,sourceLandCells:count,min,max,seamCount,seamError,periodicError,coastalCells:coastal.length,coastalMean:mean(coastal),inlandCells:inland.length,inlandMean:mean(inland),scope:'real source mask; source field and adapter synthetic model; no real A/B frame or browser run'}));

})().catch(e=>{console.error(e);process.exitCode=1;});
