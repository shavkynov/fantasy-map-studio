'use strict';
const assert = require('node:assert/strict');
const C = require('../src/coupled-basin-water.js');
const F = require('../src/basin-fill-spill.js');
const close = (a,b) => assert.ok(Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b)), `${a} != ${b}`);
function fixture(z,areas=z.map(()=>1),ids=z.map(()=>0),edges=[]) {
 const B=Math.max(...ids)+1,field={w:z.length,h:1,land:z.map(()=>1),height:z,area:areas};
 const hierarchy={w:z.length,h:1,waterNode:B,basins:Array.from({length:B},()=>({})),cellBasin:ids,edges};
 return {field,hierarchy,model:C.create(field,hierarchy,F,{trackEvaporation:true,trackRouting:true})};
}
function loaded(f,volumes) {
 const r=F.redistribute(f.field,f.hierarchy,volumes);
 return {redistribution:r,ledger:{initialTotal:volumes.reduce((a,b)=>a+b,0),inputTotal:0,storedTotal:r.stats.storedTotal,pendingTotal:0,boundaryTotal:r.boundaryOutflow,evapTotal:0,seepTotal:0}};
}
function run(f,initial,E,S,dt,steps=1) {
 let state=initial,byCell=f.field.height.map(()=>0);
 const before=JSON.stringify(initial);
 for(let k=0;k<steps;k++) {
  state=f.model.advance(state,{precipitation:0,runoffCoefficient:0,evaporation:E,seepage:S},dt/steps);
  state.evaporationByCell.forEach((v,i)=>byCell[i]+=v);
  close(state.ledger.residual,0);
  close(state.redistribution.stats.geometryResidual,0);
  state.redistribution.depth.forEach(v=>assert.ok(v>=0));
  assert.ok(state.routingTrace);
 }
 assert.equal(JSON.stringify(initial),before);
 return {state,byCell};
}
const f=fixture([1,2]),initial=loaded(f,[2]),coarse=run(f,initial,1,0,.75);
close(coarse.state.ledger.storedTotal,.75);
close(coarse.state.ledger.evapTotal,1.25);
close(coarse.byCell[0],.75);close(coarse.byCell[1],.5);
for(const steps of [2,4,16,64]) {
 const r=run(f,initial,1,0,.75,steps);
 close(r.state.ledger.storedTotal,.75);r.byCell.forEach((v,i)=>close(v,coarse.byCell[i]));
}
const mixed=run(f,initial,.5,.5,.75);
close(mixed.state.ledger.evapTotal,.625);close(mixed.state.ledger.seepTotal,.625);
const dry=run(f,initial,10,0,10);close(dry.state.ledger.storedTotal,0);close(dry.state.ledger.evapTotal,2);
const zero=run(f,initial,0,0,10);close(zero.state.ledger.storedTotal,2);
const plateau=fixture([1,1,2,2],[1,2,3,1]);
close(run(plateau,loaded(plateau,[6.5]),1,0,.75).state.ledger.storedTotal,2.25);
let seed=91;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
for(let trial=0;trial<100;trial++) {
 const z=Array.from({length:8},()=>1+Math.floor(random()*5)),areas=z.map(()=>.2+random());
 const x=fixture(z,areas),start=loaded(x,[1+20*random()]),E=z.map(()=>random()*2),S=z.map(()=>random()),dt=3*random();
 const a=run(x,start,E,S,dt),b=run(x,start,E,S,dt,16);
 close(a.state.ledger.storedTotal,b.state.ledger.storedTotal);
 close(a.state.ledger.evapTotal,b.state.ledger.evapTotal);close(a.state.ledger.seepTotal,b.state.ledger.seepTotal);
 a.byCell.forEach((v,i)=>close(v,b.byCell[i]));
}
const split=fixture([1,1],[1,1],[0,1],[{a:0,b:1,level:2}]);
const r=run(split,loaded(split,[2.5,0]),[1,0],0,1);
close(r.state.redistribution.depth[0],.5);close(r.state.redistribution.depth[1],1);
assert.equal(r.state.stepStats.splitEvents,1);
console.log('PASS drying events: analytic storage and per-cell evaporation, subdivisions, mixed losses, dryness, zero rates, equal heights, 100 random recession semigroup cases and saddle split');
