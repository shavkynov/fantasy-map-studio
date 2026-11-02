'use strict';
const assert=require('assert/strict'),{measure}=require('./world-water-metric.cjs');
const grid=(W,H,water)=>({width:W,height:H,coverage:Array.from({length:W*H},(_,i)=>water(i%W,Math.floor(i/W))?0:1)});
const value=s=>measure(s).largestWaterComponentSphereFraction,near=(a,b)=>assert(Math.abs(a-b)<1e-12,`${a} != ${b}`);
near(value(grid(8,4,()=>true)),1);near(value(grid(8,4,()=>false)),0);
near(value(grid(8,4,(x,y)=>y<2)),0.5);
near(value(grid(8,4,(x)=>x===0||x===7)),0.25);
near(value(grid(8,4,(x)=>x===0||x===4)),0.125);
near(value(grid(8,4,(x,y)=>y===0)),(1-Math.cos(Math.PI/4))/2);
const polar=value(grid(8,4,(x,y)=>x===0&&y===0)),equator=value(grid(8,4,(x,y)=>x===0&&y===1));assert(equator>polar);
near(value(grid(8,4,(x,y)=>y===0||y===3)),(1-Math.cos(Math.PI/4))/2);
const s=grid(8,4,(x,y)=>x===0||x===7||y===2),before=JSON.stringify(s);value(s);assert.equal(JSON.stringify(s),before);
for(let shift=0;shift<8;shift++){const shifted=grid(8,4,(x,y)=>s.coverage[y*8+(x+shift)%8]===0);near(value(shifted),value(s));}
for(const bad of [null,{width:8,height:4,coverage:[]},{width:1,height:1,coverage:[2]},{width:1,height:1,coverage:[-1]},{width:1,height:1,coverage:[NaN]}])assert.throws(()=>measure(bad));
if(process.argv.includes('--unit-only'))console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false}));
else{
 const path=require('path'),F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js'),{assess}=require('./world-frame-validity.cjs'),manifest=require('./world-v4-baseline.json');
 const cases=[...new Map(manifest.cases.map(c=>[c.expected.source,c])).values()],frames=[];assert.equal(cases.length,5);
 for(const c of cases){const source=F.load(path.join(__dirname,'fixtures/world-source',c.params.seed+'-k'+c.params.continents+'.json'),c.expected.source),world=D.fromSource(source);
  for(const time of [0,0.5,1,2,4]){const snap=world.snapshot(time,{width:360,height:180}),validity=assess(snap);
   if(!validity.validSampledGeometry){assert.throws(()=>measure(snap));frames.push({seed:c.params.seed,K:c.params.continents,time,measured:false,reasons:validity.reasons});continue;}
   const result=measure(snap),v=result.largestWaterComponentSphereFraction;assert(v>=0&&v<=1-snap.diagnostics.rasterUnionLandFraction+1e-10);frames.push({seed:c.params.seed,K:c.params.continents,time,measured:true,...result});
  }
 }
 assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
 console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,sources:cases.length,snapshots:frames.length,measuredFrames:frames.filter(f=>f.measured).length,skippedFrames:frames.filter(f=>!f.measured).length,generatorImported:false,scope:'Largest four-neighbour water component area on sphere; not ocean width or frame selection.',frames},null,2));
}
