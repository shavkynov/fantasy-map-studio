'use strict';
const assert=require('node:assert/strict');
const D=require('../src/spherical-drainage.js'),H=require('../src/basin-spill-hierarchy.js'),F=require('../src/basin-fill-spill.js'),W=require('../src/coupled-basin-water.js');
const near=(a,b)=>assert(Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
function setup(z,areas=z.map(()=>1)){
 const n=z.length,f={w:n,h:1,land:Uint8Array.from(z,v=>v===null?0:1),height:Float64Array.from(z,v=>v===null?NaN:v),area:Float64Array.from(areas),neighbors:i=>[i-1,i+1].filter(j=>j>=0&&j<n),angularDistance:()=>1};
 const d=D.build(f),h=H.build(f,d),m=W.create(f,h,F,{trackRouting:true,trackEvaporation:true});return {f,d,h,m};
}
const zero={precipitation:0,evaporation:0,runoffCoefficient:0};
let checks=0,maxResidual=0;
function step(x,s,forcing,dt){
 const before=JSON.stringify(s),geometry=JSON.stringify([x.f.land,x.f.height,x.f.area,x.h.cellBasin,x.h.edges]);
 const r=x.m.advance(s,forcing,dt);assert.equal(JSON.stringify(s),before);assert.equal(JSON.stringify([x.f.land,x.f.height,x.f.area,x.h.cellBasin,x.h.edges]),geometry);
 near(r.ledger.residual,0);near(r.redistribution.stats.geometryResidual,0);
 let volume=0;for(let i=0;i<x.f.land.length;i++)if(x.f.land[i]){assert(r.redistribution.depth[i]>=0);volume+=r.redistribution.depth[i]*x.f.area[i];}
 near(volume,r.ledger.storedTotal);near(r.evaporationByCell.reduce((a,b)=>a+b,0),r.stepStats.evapTotal);assert(r.routingTrace);
 maxResidual=Math.max(maxResidual,Math.abs(r.ledger.residual));checks++;return r;
}
function inflow(x,cell,amount){const a=new Float64Array(x.h.basins.length);a[x.h.cellBasin[cell]]=amount;return {...zero,externalInflow:a};}
const lake=setup([null,5,1,2]);
let s=step(lake,lake.m.empty(),inflow(lake,2,3),1);near(s.ledger.storedTotal,3);near(s.ledger.boundaryTotal,0);near(s.redistribution.depth[2],2);near(s.redistribution.depth[3],1);
const held=step(lake,s,zero,10);near(held.ledger.storedTotal,3);assert.deepEqual(held.redistribution.depth,s.redistribution.depth);
s=step(lake,lake.m.empty(),inflow(lake,2,10),1);near(s.ledger.storedTotal,7);near(s.ledger.boundaryTotal,3);
s=step(lake,s,{...zero,evaporation:1},.5);near(s.ledger.storedTotal,6);near(s.stepStats.evapTotal,1);near(s.ledger.boundaryTotal,3);
const closed=setup([1,2]);s=step(closed,closed.m.empty(),inflow(closed,0,2),1);
const coarse=step(closed,s,{...zero,evaporation:1},.75);near(coarse.ledger.storedTotal,.75);near(coarse.evaporationByCell[0],.75);near(coarse.evaporationByCell[1],.5);
let fine=s;for(let k=0;k<16;k++)fine=step(closed,fine,{...zero,evaporation:1},.75/16);near(fine.ledger.storedTotal,coarse.ledger.storedTotal);
const joined=setup([null,6,1,3,1,6]);s=step(joined,joined.m.empty(),inflow(joined,2,7),1);near(s.ledger.storedTotal,7);assert(s.stepStats.inflowMerges>0);
s=step(joined,s,{...zero,evaporation:[0,0,3,0,0,0]},2);near(s.ledger.storedTotal,2);near(s.redistribution.depth[2],0);near(s.redistribution.depth[4],2);assert(s.stepStats.splitEvents>0);
let seed=71;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
for(let trial=0;trial<100;trial++){
 const z=Array.from({length:12},(_,i)=>i===0&&trial%2===0?null:1+Math.floor(random()*6)),x=setup(z,z.map(()=>.2+random()));let state=x.m.empty();
 for(let k=0;k<20;k++)state=step(x,state,{precipitation:k<10?2*random():0,evaporation:random(),seepage:.1*random(),runoffCoefficient:random()},.1+.2*random());
}
// Context lifetime: changing geometry is NOT a supported state migration.
const edits=[x=>{x.f.height[1]=2;},x=>{x.f.height=x.f.height.slice();},x=>{x.f.area[2]=2;},x=>{x.f.land[2]=0;},x=>{x.h.cellBasin[2]=x.h.cellBasin[1];},x=>{x.h.edges[0].level+=1;},x=>{x.h.edges=x.h.edges.slice();},x=>{x.f.w+=1;}];
for(const edit of edits){const x=setup([null,5,1,2]),state=x.m.empty(),before=JSON.stringify(state);edit(x);assert.throws(()=>x.m.advance(state,zero,1),/Water geometry changed/);assert.throws(()=>x.m.empty(),/Water geometry changed/);assert.equal(JSON.stringify(state),before);}
const rebuilt=setup([null,2,1,2]),rebuiltWater=step(rebuilt,rebuilt.m.empty(),inflow(rebuilt,2,10),1);near(rebuiltWater.ledger.storedTotal,1);near(rebuiltWater.ledger.boundaryTotal,9);
console.log(JSON.stringify({geometryMutationCases:edits.length,passed:true,checks,randomChains:100,randomStepsPerChain:20,maxResidual,analyticalCases:['lake retention','ocean spill','continuation','cell drying','merged-pool split'],scope:'four production modules; generated drainage/hierarchy, synthetic line geometry with unit distances; no sphere builder, atmosphere, main-world A/B, browser or CI'}));
