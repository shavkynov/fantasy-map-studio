 'use strict';
const assert=require('node:assert/strict'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill'),Routing=require('../src/rainfall-runoff-routing'),History=require('../src/runoff-flow-history');
const near=(a,b)=>assert(Math.abs(a-b)<=1e-12*Math.max(1,Math.abs(b)),`${a} != ${b}`);
function fixture(){
 const field={w:4,h:2,land:new Uint8Array(8).fill(1),height:Float64Array.from([4,4,4,4,4,2,1,4]),area:new Float64Array(8).fill(1),neighbors(i){const x=i%4,y=Math.floor(i/4),p=(x+2)%4;return [...new Set([y*4+(x+3)%4,y*4+(x+1)%4,y===0?p:i-4,y===1?4+p:i+4])];}};
 const drainage={w:4,h:2,receiver:Int32Array.from([4,5,6,7,5,6,-1,6])},hierarchy={w:4,h:2,basins:[{terminal:6}],waterNode:1,cellBasin:new Int32Array(8),edges:[]};
 return {field,drainage,hierarchy};
}
function run(schedule){
 const f=fixture(),model=Surface.create(f.field,f.hierarchy,Fill),history=History.create(4,2),geometry=JSON.stringify(f),rows=[];let state=model.empty();
 for(const v of schedule){
  const {dt,...forcing}=v,before=state,old=JSON.stringify(before),routing=Routing.build(f.field,f.drainage,{precipitation:forcing.precipitation,runoffCoefficient:forcing.runoffCoefficient},before.redistribution.depth);
  history.observe(f.field,f.drainage,routing,dt);state=model.advance(before,forcing,dt);
  assert.equal(JSON.stringify(before),old);assert.equal(JSON.stringify(f),geometry);near(routing.summary.effectiveSurfaceInput*dt,state.stepStats.inputTotal);near(state.ledger.residual,0);
  for(const d of state.redistribution.depth)assert(Number.isFinite(d)&&d>=0);
  rows.push({state,routing});
 }
 return {state,history:history.snapshot(),rows};
}
const step=(precipitation,evaporation,dt=1,seepage=0)=>({precipitation,evaporation,runoffCoefficient:1,seepage,dt});
const lake=run([step(.25,0),step(0,.1)]);near(lake.rows[0].state.ledger.storedTotal,2);near(lake.state.ledger.storedTotal,1.8);near(lake.state.ledger.evapTotal,.2);assert(lake.state.redistribution.depth[6]>0);assert(lake.rows[1].routing.flow.every(q=>q===0));assert.equal(lake.history.observationClass[0],2);assert.equal(lake.history.zeroFlowTime[0],1);assert.equal(lake.history.observationClass[6],3);assert.equal(lake.history.zeroFlowTime[6],0);assert.equal(lake.history.wetTime[6],1);near(lake.history.coverage[6],.5);
const dry=run([step(.25,0),step(0,2),step(0,.1,3)]);near(dry.state.ledger.storedTotal,0);near(dry.state.ledger.evapTotal,2);assert.equal(dry.history.observationClass[6],2);near(dry.history.zeroFlowTime[6],3);near(dry.history.wetTime[6],1);
const again=run([step(.25,0),step(0,2),step(0,.1,3),step(.25,0,2)]);assert(again.state.ledger.storedTotal>0);assert(again.rows.at(-1).routing.flow[6]>0);near(again.history.totalTime,7);near(again.history.occurrence[0],3/7);near(again.history.meanFlow[0],.75/7);near(again.history.maxObservedDryDuration[0],4);
const seep=run([step(.25,0),step(0,.1,1,.1)]);near(seep.state.ledger.storedTotal,1.6);near(seep.state.ledger.evapTotal,.2);near(seep.state.ledger.seepTotal,.2);
const coarse=run([step(.25,0),step(0,.1)]),fine=run([step(.25,0),...Array.from({length:10},()=>step(0,.1,.1))]);near(coarse.state.ledger.storedTotal,fine.state.ledger.storedTotal);near(coarse.history.meanFlow[0],fine.history.meanFlow[0]);near(coarse.history.occurrence[0],fine.history.occurrence[0]);
const field={w:2,h:1,land:[1,1],height:[1,1],area:[1,1]},hierarchy={w:2,h:1,waterNode:2,basins:[{},{}],cellBasin:[0,1],edges:[{a:0,b:1,level:2},{a:1,b:2,level:5}]},model=Surface.create(field,hierarchy,Fill);let state=model.advance(model.empty(),{precipitation:1.25,evaporation:0,runoffCoefficient:1},1);near(state.ledger.storedTotal,2.5);state=model.advance(state,{precipitation:0,evaporation:[1,0],runoffCoefficient:1},1);assert.equal(state.stepStats.splitEvents,1);near(state.redistribution.depth[0],.5);near(state.redistribution.depth[1],1);near(state.ledger.residual,0);
console.log(JSON.stringify({passed:true,groups:6,checks:'lake retained with zero rainfall runoff; flooded time not drought; complete drying; renewed rain and duration weights; seepage and dry subdivision; merged lake saddle split',retainedLake:lake.state.ledger.storedTotal,finalDryStorage:dry.state.ledger.storedTotal,renewedStorage:again.state.ledger.storedTotal,scope:'production water/fill/routing/history on prescribed synthetic geometry; no session, generated-world, UI, climate or confirmed lake outlet flow'}));
