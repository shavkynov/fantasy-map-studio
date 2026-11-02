'use strict';
const assert=require('assert/strict'),path=require('path'),crypto=require('crypto');
const F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js'),{assess}=require('./world-frame-validity.cjs');
const fingerprint='1bb053646f0b6746767ae2d1a93c90098cff17944126c76b6bcabb20952c31a6';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const source=F.load(path.join(__dirname,'fixtures/world-source/vondoran-227-k4.json'),fingerprint),before=hash(source);
assert.equal(source.regions.length,4);
const world=D.fromSource(source),sphere=world.sphere;
function relativeAngle(a,b){
 const q=sphere.compose(sphere.inverse(a),b);
 return 2*Math.atan2(Math.hypot(q[1],q[2],q[3]),Math.abs(q[0]));
}
const identity=[1,0,0,0],turn=sphere.axisRotation([0,0,1],0.25);
assert(relativeAngle(identity,identity)<1e-12);
assert(relativeAngle(turn,turn)<1e-12);
assert(relativeAngle(turn,turn.map(x=>-x))<1e-12);
assert(Math.abs(relativeAngle(identity,turn)-0.25)<1e-12);
assert.throws(()=>relativeAngle(identity,[NaN,0,0,0]));
const earlySchedule=[0,...Array.from({length:9},(_,i)=>2**(i-16)),...Array.from({length:64},(_,i)=>(i+1)/128)];
assert.equal(earlySchedule.length,74);
assert.equal(new Set(earlySchedule).size,74);
assert.equal(earlySchedule[0],0);assert.equal(earlySchedule[1],1/65536);assert.equal(earlySchedule[73],0.5);
assert(earlySchedule.every((t,i)=>Number.isFinite(t)&&t>=0&&t<=0.5&&(i===0||t>earlySchedule[i-1])));
const earlyFrames=process.argv.includes('--early-frames'),times=earlyFrames?earlySchedule:[0,0.5,1,2,4];
const display={width:360,height:180,centralMeridian:0},frames=[];
let roundTrips=0,maxAreaError=0;
for(const time of times){
 const snapshot=world.snapshot(time,display),result=assess(snapshot),pairs=[];
 for(let a=0;a<4;a++)for(let b=a+1;b<4;b++){
  const angle=relativeAngle(snapshot.poses[a],snapshot.poses[b]);
  assert(time===0?angle<1e-12:angle>1e-6,'Pair has no resolved relative rotation');
  pairs.push({a,b,relativeRotationRadians:angle});
 }
 let overlapCells=0;
 for(let i=0;i<snapshot.coverage.length;i++){
  const n=snapshot.coverage[i];
  if(n===0){assert.equal(snapshot.owner[i],-1);assert.equal(snapshot.sourceIndex[i],-1);}
  else if(n>1){overlapCells++;assert.equal(snapshot.owner[i],-2);assert.equal(snapshot.sourceIndex[i],-1);}
  else assert.equal(source.labels[snapshot.sourceIndex[i]],snapshot.owner[i]);
 }
 assert.equal(overlapCells,snapshot.diagnostics.overlapCells);
 assert.deepEqual(result.reasons,overlapCells?['fragment-overlap']:[]);
 if(time===0)assert(result.validSampledGeometry);
 for(let id=0;id<4;id++){
  const motion=relativeAngle(identity,snapshot.poses[id]);
  assert(time===0?motion<1e-12:motion>1e-6);
  const f=world.fragments[id],err=Math.abs(snapshot.rasterFragmentAreasKm2[id]/f.areaKm2-1);
  maxAreaError=Math.max(maxAreaError,err);assert(err<0.03);
  assert.equal(snapshot.fragmentAreasKm2[id],f.areaKm2);
  const cells=source.regions[id].cells;
  for(const j of [0,Math.floor(cells.length/2),cells.length-1]){
   const i=cells[j],u=(i%source.W+0.5)/source.W,v=(Math.floor(i/source.W)+0.5)/source.H;
   const back=world.restore(id,world.point(id,u,v,time),time);
   assert(sphere.angle(back,world.sourcePoint(u,v))<1e-12);
   assert.equal(world.sourceIndex(back),i);roundTrips++;
  }
 }
 frames.push({time,...(earlyFrames?{minRelativeRotationRadians:Math.min(...pairs.map(p=>p.relativeRotationRadians))}:{relativePairs:pairs}),overlapCells,overlapAreaFraction:snapshot.diagnostics.overlapAreaFraction,...result});
}
assert(frames.some(f=>!f.validSampledGeometry),'Expected explicit rejection cases');
assert.equal(hash(source),before);
assert(!Object.keys(require.cache).some(file=>file.endsWith(path.sep+'world-v4.js')));
console.log(JSON.stringify({unitChecksPassed:true,scheduleChecksPassed:true,integrationRun:true,source:'vondoran-227-k4',sources:1,K:4,motionMode:'original-source-per-fragment',diagnosticMode:earlyFrames?'early-fixed-schedule':'original-five-times',motions:world.fragments.map(({id,axis,rate,spin})=>({id,axis,rate,spin})),display,snapshots:frames.length,relativePairChecks:frames.length*6,provenanceRoundTrips:roundTrips,maxRasterRelativeAreaError:maxAreaError,validFrames:frames.filter(f=>f.validSampledGeometry).length,positiveValidFrames:frames.filter(f=>f.time>0&&f.validSampledGeometry).length,rejectedFrames:frames.filter(f=>!f.validSampledGeometry).length,sourceInputsUnchanged:true,generatorImported:false,frames,scope:'Original K4 motion, all six relative rotations and sampled overlap diagnostics. Fixed times only; no continuous safety, speed search, frame selection, new water metric, collision resolution, visual acceptance or app integration.'},null,2));
