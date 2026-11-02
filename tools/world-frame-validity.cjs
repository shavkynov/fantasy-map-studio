'use strict';
function assess(snapshot){
 const d=snapshot&&snapshot.diagnostics;
 if(!d||!Number.isSafeInteger(d.overlapCells)||d.overlapCells<0||!Number.isFinite(d.overlapAreaFraction)||d.overlapAreaFraction<0||d.overlapAreaFraction>1||typeof d.validSampledGeometry!=='boolean')throw Error('Invalid overlap diagnostics');
 const valid=d.overlapCells===0;
 if(d.validSampledGeometry!==valid||(valid?d.overlapAreaFraction!==0:d.overlapAreaFraction<=0))throw Error('Inconsistent overlap diagnostics');
 return {validSampledGeometry:valid,reasons:valid?[]:['fragment-overlap'],scope:'Sampled overlap only; not continuous collision detection or ocean-quality acceptance.'};
}
module.exports={assess};
if(require.main===module){
 const assert=require('assert/strict'),path=require('path');
 const frame=(n,a,v)=>({diagnostics:{overlapCells:n,overlapAreaFraction:a,validSampledGeometry:v}});
 assert.deepEqual(assess(frame(0,0,true)).reasons,[]);
 assert.deepEqual(assess(frame(1,0.01,false)).reasons,['fragment-overlap']);
 for(const s of [null,frame(-1,0,false),frame(0,0,false),frame(1,0,false),frame(0,0.1,true),frame(1,NaN,false),frame(1,0.1,true)])assert.throws(()=>assess(s));
 if(process.argv.includes('--unit-only')){console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false}));}
 else{
  const F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js'),manifest=require('./world-v4-baseline.json');
  const cases=[...new Map(manifest.cases.map(c=>[c.expected.source,c])).values()],frames=[];
  assert.equal(cases.length,5);
  for(const c of cases){const file=path.join(__dirname,'fixtures/world-source',c.params.seed+'-k'+c.params.continents+'.json'),source=F.load(file,c.expected.source),world=D.fromSource(source);
   for(const time of [0,0.5,1,2,4]){const s=world.snapshot(time,{width:360,height:180}),result=assess(s);assert.equal(result.validSampledGeometry,s.diagnostics.validSampledGeometry);if(time===0)assert.equal(result.reasons.length,0);frames.push({seed:c.params.seed,K:c.params.continents,time,overlapCells:s.diagnostics.overlapCells,...result});}
  }
  assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
  console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,sources:cases.length,snapshots:frames.length,rejectedFrames:frames.filter(f=>!f.validSampledGeometry).length,generatorImported:false,frames},null,2));
 }
}
