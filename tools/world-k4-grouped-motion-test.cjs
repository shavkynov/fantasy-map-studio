'use strict';
const assert=require('assert/strict'),path=require('path'),crypto=require('crypto');
const F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js'),{assess}=require('./world-frame-validity.cjs');
const hashes={2:'f23e23e7c1bee7b68328dcc692bdded595e6c664862cb879109d9fbc6b0f6453',4:'1bb053646f0b6746767ae2d1a93c90098cff17944126c76b6bcabb20952c31a6'};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const load=k=>F.load(path.join(__dirname,'fixtures/world-source/vondoran-227-k'+k+'.json'),hashes[k]);
const parent=load(2),child=load(4),before=[hash(parent),hash(child)];
assert.equal(parent.regions.length,2);assert.equal(child.regions.length,4);
assert.equal(parent.W,child.W);assert.equal(parent.H,child.H);
const groups=Array.from({length:4},()=>new Set());
for(let i=0;i<child.labels.length;i++){
 assert.equal(child.labels[i]>=0,parent.labels[i]>=0,'Source land unions differ');
 if(child.labels[i]>=0)groups[child.labels[i]].add(parent.labels[i]);
}
const parentByChild=groups.map(ids=>{assert.equal(ids.size,1,'Child crosses parent boundary');return [...ids][0];});
assert.deepEqual(parentByChild,[0,1,0,1]);
const base=D.fromSource(parent),sphere=base.sphere,[a,b]=base.fragments.map(f=>f.center);
const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],n=Math.hypot(...cross);
assert(n>1e-10,'Degenerate parent centers');
const axis=cross.map(x=>x/n),angle=sphere.angle(a,b),display={width:360,height:180,centralMeridian:0};
const frames=[];let roundTrips=0;
for(const opening of [true,false]){
 const span=opening?(Math.PI-angle)/4:angle;
 const motions=[0,1].map(id=>({axis:axis.slice(),rate:(id===0?-1:1)*(opening?1:-1)*span/2,spin:0}));
 const childMotions=parentByChild.map(id=>({...motions[id],axis:axis.slice()}));
 const motionBefore=hash([motions,childMotions]);
 const p=D.fromSource(parent,{motions}),c=D.fromSource(child,{motions:childMotions});
 for(let id=0;id<2;id++){
  const area=c.fragments.filter((f,j)=>parentByChild[j]===id).reduce((s,f)=>s+f.areaKm2,0);
  assert(Math.abs(area/p.fragments[id].areaKm2-1)<1e-12);
 }
 const times=opening?Array.from({length:17},(_,i)=>i/16):[0,1/1048576,1/64];
 for(const time of times){
  const ps=p.snapshot(time,display),cs=c.snapshot(time,display),pv=assess(ps),cv=assess(cs);
  assert.deepEqual(cs.coverage,ps.coverage,'Grouped K4 coverage differs from K2');
  assert.deepEqual(cs.sourceIndex,ps.sourceIndex);
  assert.deepEqual(cv,pv);
  assert.equal(cs.diagnostics.overlapCells,ps.diagnostics.overlapCells);
  assert.equal(cs.diagnostics.overlapAreaFraction,ps.diagnostics.overlapAreaFraction);
  if(opening||time===0)assert(cv.validSampledGeometry);
  else assert.deepEqual(cv.reasons,['fragment-overlap']);
  for(let i=0;i<cs.owner.length;i++){
   const id=cs.owner[i];
   if(id>=0)assert.equal(parentByChild[id],ps.owner[i]);
   else assert.equal(id,ps.owner[i]);
  }
  for(let id=0;id<4;id++){
   assert.deepEqual(c.pose(id,time),p.pose(parentByChild[id],time));
   const cells=child.regions[id].cells;
   for(const j of [0,Math.floor(cells.length/2),cells.length-1]){
    const index=cells[j],u=(index%child.W+0.5)/child.W,v=(Math.floor(index/child.W)+0.5)/child.H;
    const restored=c.restore(id,c.point(id,u,v,time),time);
    assert(sphere.angle(restored,c.sourcePoint(u,v))<1e-12);
    assert.equal(c.sourceIndex(restored),index);roundTrips++;
   }
  }
  frames.push({scenario:opening?'grouped-opening':'grouped-closing',time,overlapCells:cs.diagnostics.overlapCells,overlapAreaFraction:cs.diagnostics.overlapAreaFraction,...cv});
 }
 assert.equal(hash([motions,childMotions]),motionBefore);
}
assert.deepEqual([hash(parent),hash(child)],before);
assert(!Object.keys(require.cache).some(file=>file.endsWith(path.sep+'world-v4.js')));
console.log(JSON.stringify({checksPassed:true,integrationRun:true,sources:2,K:4,motionGroups:2,parentByChild,display,comparisons:frames.length,snapshots:frames.length*2,provenanceRoundTrips:roundTrips,groupedCoverageEqual:true,sourceInputsUnchanged:true,motionInputsUnchanged:true,generatorImported:false,frames,scope:'K4 subdivision control under two inherited K2 motions. Not independent four-fragment motion, frame selection, continuous collision detection, visual acceptance or app integration.'},null,2));
