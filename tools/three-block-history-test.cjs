const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{const m=await require(path.resolve(process.argv[2])).create(),baseline=process.argv[3]?await require(path.resolve(process.argv[3])).create():null;
const expected=[[0,0,0,42762,22038],[.05,5,0,42759,22036],[1,128,1,42637,22035],[2,245,4,42425,22130]],results=[];
for(const [t,n,r,o,l] of expected){const f=m.frame(360,180,t);if(baseline){const b=baseline.frame(360,180,t);assert.deepEqual(f.image,b.image);assert.deepEqual(f.owners,b.owners);}
const h=await m.historyField(f);assert.deepEqual([h.newCount,h.renewedCount,h.oldCount,h.landCount],[n,r,o,l]);
for(let i=0;i<h.kind.length;i++){if(h.kind[i]===1){assert.ok(h.birth[i]>=0&&h.birth[i]<=t);assert.ok(Math.abs(h.birth[i]+h.age[i]-t)<1e-12);}else{assert.ok(Number.isNaN(h.age[i]));assert.ok(Number.isNaN(h.birth[i]));}}
results.push({angle:t,newCount:h.newCount,renewedCount:h.renewedCount,oldCount:h.oldCount,landCount:h.landCount});}
await assert.rejects(()=>m.historyField(m.frame(64,32,2),{cancelled:()=>true}),/cancelled/);
await assert.rejects(()=>m.historyField(m.frame(64,32,2),{segments:1}),/sampling/);
const source=[-.3906716182458561,.006819198462093223,.9205048534524404],h=m.history(m.transport(source,1,2),1,2,128);assert.equal(h.kind,'new');assert.equal(h.oldSourceConsumed,true);
console.log(JSON.stringify({passed:true,maskSha256:m.labelsSha256,baselineCompared:!!baseline,results,cancellation:true,invalidSegments:true,knownReplacement:h}));
})().catch(e=>{console.error(e);process.exitCode=1;});