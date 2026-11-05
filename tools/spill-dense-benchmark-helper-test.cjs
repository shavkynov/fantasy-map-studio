const assert=require('node:assert/strict'),{timed,compare}=require('./spill-dense-ab-benchmark.cjs');
let ticks=0,created=0,empty=0,advances=0,retrieved=0;
const make=tracked=>()=>{created++;return {empty(){empty++;ticks+=100;return {n:0,ledger:{residual:0}};},advance(s){advances++;ticks+=tracked?2:1;return {n:s.n+1,ledger:{residual:0},...(tracked?{routingTrace:{}}:{})};},capture(s){retrieved++;ticks+=1000;return {n:s.n};}};};
const out=compare(make(false),make(true),{},.05,20,3,()=>ticks);
assert.equal(created,8);assert.equal(empty,8);assert.equal(advances,160);assert.equal(retrieved,4);assert.equal(out.samples.length,3);assert.deepEqual(out.samples.map(s=>s.order),[['plain','tracked'],['tracked','plain'],['plain','tracked']]);assert.equal(out.plainMedianMs,20);assert.equal(out.trackedMedianMs,40);assert.equal(out.ratio,2);assert.equal(out.overheadPercent,100);
assert.throws(()=>compare(make(false),()=>({empty:()=>({n:0}),advance:()=>({bad:true}),capture(){}}),{},.05,1,3,()=>0));
console.log(JSON.stringify({passed:true,scope:'Benchmark timing/accounting helper tested on mocks and deterministic clock. Not real A/B execution or measured hydrology overhead.'}));