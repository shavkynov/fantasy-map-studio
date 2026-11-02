'use strict';
const assert=require('assert/strict'),path=require('path'),crypto=require('crypto');
const F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js'),{assess}=require('./world-frame-validity.cjs');
const fingerprint='f23e23e7c1bee7b68328dcc692bdded595e6c664862cb879109d9fbc6b0f6453';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function pairAxis(a,b){
 const c=cross(a,b),length=Math.hypot(...c);
 if(!Number.isFinite(length)||length<1e-10)throw Error('Degenerate pair centers');
 return c.map(x=>x/length);
}
function refine(lo,hi,measure){
 assert(lo.time<hi.time&&lo.validSampledGeometry&&!hi.validSampledGeometry,'Expected valid/overlap bracket');
 for(let i=0;i<14;i++){
  const mid=measure((lo.time+hi.time)/2);
  if(mid.validSampledGeometry)lo=mid;else hi=mid;
 }
 assert(hi.time-lo.time<=1e-6,'Bracket tolerance not reached');
 return {lo,hi};
}
assert.deepEqual(pairAxis([1,0,0],[0,1,0]),[0,0,1]);
assert.throws(()=>pairAxis([1,0,0],[1,0,0]));
assert.throws(()=>pairAxis([1,0,0],[-1,0,0]));
const fake=time=>({time,validSampledGeometry:time<0.003});
const unitBracket=refine(fake(0),fake(1/64),fake);
assert(unitBracket.lo.time<0.003&&unitBracket.hi.time>=0.003);
assert.throws(()=>refine(fake(0.001),fake(0.002),fake));
const source=F.load(path.join(__dirname,'fixtures/world-source/vondoran-227-k2.json'),fingerprint);
assert.equal(source.regions.length,2);
assert.equal(hash(Array.from(source.labels)),fingerprint);
const sourceBefore=hash(source),base=D.fromSource(source),sphere=base.sphere;
const centers=base.fragments.map(f=>f.center),axis=pairAxis(...centers),initialAngle=sphere.angle(...centers);
const display={width:360,height:180,centralMeridian:0};
let snapshots=0,roundTrips=0;
function scenario(opening){
 const span=opening?(Math.PI-initialAngle)/4:initialAngle;
 const motions=[0,1].map(id=>({axis:axis.slice(),rate:(id===0?-1:1)*(opening?1:-1)*span/2,spin:0}));
 const motionsBefore=JSON.stringify(motions),world=D.fromSource(source,{motions});
 function measure(time){
  const snapshot=world.snapshot(time,display),result=assess(snapshot);
  snapshots++;
  const moved=centers.map((c,id)=>sphere.apply(world.pose(id,time),c));
  const angle=sphere.angle(...moved),expected=initialAngle+(opening?1:-1)*span*time;
  assert(Math.abs(angle-expected)<1e-12,'Unexpected center trajectory');
  let overlapCells=0;
  for(let i=0;i<snapshot.coverage.length;i++){
   const n=snapshot.coverage[i];
   if(n>1){overlapCells++;assert.equal(snapshot.owner[i],-2);assert.equal(snapshot.sourceIndex[i],-1);}
   else if(n===0)assert.equal(snapshot.owner[i],-1);
   else assert.equal(source.labels[snapshot.sourceIndex[i]],snapshot.owner[i]);
  }
  assert.equal(overlapCells,snapshot.diagnostics.overlapCells);
  assert.deepEqual(result.reasons,overlapCells?['fragment-overlap']:[]);
  for(let id=0;id<2;id++){
   const cells=source.regions[id].cells;
   for(const index of [0,Math.floor(cells.length/2),cells.length-1]){
    const i=cells[index],u=(i%source.W+0.5)/source.W,v=(Math.floor(i/source.W)+0.5)/source.H;
    const back=world.restore(id,world.point(id,u,v,time),time);
    assert(sphere.angle(back,world.sourcePoint(u,v))<1e-12);
    assert.equal(world.sourceIndex(back),i);roundTrips++;
   }
  }
  assert.equal(JSON.stringify(motions),motionsBefore);
  return {time,centerAngleRadians:angle,overlapCells,overlapAreaFraction:snapshot.diagnostics.overlapAreaFraction,...result};
 }
 return {measure,motions,span};
}
const opening=scenario(true),openingFrames=[];
for(let k=0;k<=16;k++){
 const frame=opening.measure(k/16);
 assert(frame.validSampledGeometry,'Opening sampled frame overlaps');
 if(k)assert(frame.centerAngleRadians>openingFrames[k-1].centerAngleRadians);
 openingFrames.push(frame);
}
const closing=scenario(false),closingScan=[closing.measure(0)];
assert(closingScan[0].validSampledGeometry);
let bracket=null;
for(let k=1;k<=64;k++){
 const frame=closing.measure(k/64),previous=closingScan[closingScan.length-1];
 assert(frame.centerAngleRadians<previous.centerAngleRadians);
 closingScan.push(frame);
 if(!frame.validSampledGeometry){bracket={lo:previous,hi:frame};break;}
}
assert(bracket,'No sampled valid/overlap transition found');
const coarseBracket=bracket;
bracket=refine(bracket.lo,bracket.hi,closing.measure);
const lo=closing.measure(bracket.lo.time),hi=closing.measure(bracket.hi.time);
assert.deepEqual(lo,bracket.lo);assert.deepEqual(hi,bracket.hi);
assert(lo.validSampledGeometry&&!hi.validSampledGeometry);
assert.equal(hash(source),sourceBefore);
assert.equal(hash(Array.from(source.labels)),fingerprint);
assert(!Object.keys(require.cache).some(file=>file.endsWith(path.sep+'world-v4.js')));
console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,source:'vondoran-227-k2',sources:1,display,initialCenterAngleRadians:initialAngle,axis,openingMotions:opening.motions,closingMotions:closing.motions,openingFrames,closingScan,coarseBracket,refinedBracket:{lo,hi,width:hi.time-lo.time},snapshots,provenanceRoundTrips:roundTrips,sourceInputsUnchanged:true,motionInputsUnchanged:true,generatorImported:false,scope:'One frozen K2 pair; controlled center trajectories and sampled raster transition only. Not continuous collision detection, collision resolution, ocean-width measurement, visual acceptance or app integration.'},null,2));
