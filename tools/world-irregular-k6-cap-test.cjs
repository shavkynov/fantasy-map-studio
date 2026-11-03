'use strict';
const assert=require('assert/strict');
const F=require('./world-irregular-k6-cap.cjs'),P=require('./world-irregular-k6-static.cjs'),M=require('./world-irregular-k6-poses.cjs'),A=require('./world-irregular-k6-area.cjs');
const S=require('../src/world-domain.js').createSphere({radiusKm:1});
function oracle(frame,order){
 const {width,height,time,direction}=frame,areas=[],hits=[];
 for(let id=0;id<6;id++){
  const q=M.pose(id,time),inverse=S.inverse(direction===1?q:S.inverse(q));let area=0,hit=0;
  for(let row=0;row<height;row++)for(let k=0;k<(order==='centre'?1:order);k++){
   let z,c,w;
   if(order==='centre'){const lat=Math.PI/2-(row+0.5)/height*Math.PI;z=Math.sin(lat);c=Math.cos(lat);w=S.cellAreaKm2(width,height,row);}
   else{const r=A.rule(order),top=Math.sin(Math.PI/2-row/height*Math.PI),bottom=Math.sin(Math.PI/2-(row+1)/height*Math.PI),half=(top-bottom)/2;z=(top+bottom)/2+half*r.nodes[k];c=Math.sqrt(Math.max(0,1-z*z));w=half*r.weights[k];}
   for(let col=0;col<width;col++)for(let j=0;j<(order==='centre'?1:order);j++){
    const r=order==='centre'?null:A.rule(order),lon=(col+0.5)/width*2*Math.PI-Math.PI+(r?Math.PI/width*r.nodes[j]:0),weight=r?w*(Math.PI/width*r.weights[j]):w;
    if(P.contains(id,S.apply(inverse,[c*Math.cos(lon),c*Math.sin(lon),z]))){area+=weight;hit++;}
   }
  }
  areas.push(area);hits.push(hit);
 }
 return {areas,hits};
}
F.sourceHashes();let comparisons=0,naive=0,exact=0,bounding=0,boundaryProbes=0,insideProbes=0,slowMs=0,fastMs=0;
for(const width of [16,32])for(const [time,direction] of [[0,1],[0.25,1],[0.5,1],[1,1],[0.25,-1]]){
 const frame={width,height:width/2,time,direction};
 for(const order of ['centre',4,8]){
  const slow=F.measure(frame,order,false),fast=F.measure(frame,order,true),direct=oracle(frame,order);
  assert.deepEqual(fast.areas,slow.areas);assert.deepEqual(fast.areas,direct.areas);assert.deepEqual(fast.hitSamples,slow.hitSamples);assert.deepEqual(fast.hitSamples,direct.hits);
  assert.equal(fast.totalDomainWeight,slow.totalDomainWeight);assert.equal(fast.boundingTests,fast.naiveMembershipEvaluations);assert(fast.exactMembershipEvaluations<slow.exactMembershipEvaluations);
  naive+=slow.exactMembershipEvaluations;exact+=fast.exactMembershipEvaluations;bounding+=fast.boundingTests;slowMs+=slow.elapsedMilliseconds;fastMs+=fast.elapsedMilliseconds;comparisons++;
 }
 for(let id=0;id<6;id++){
  const bound=F.cap(id,time,direction),q=M.pose(id,time),actual=direction===1?q:S.inverse(q),[start,end]=P.intervals[id];
  for(const fraction of [0,1e-12,0.5,1-1e-12,1])for(const radial of [0,0.5,1-1e-12,1,1+1e-12]){
   const phi=start+(end-start)*fraction,a=P.radius(phi)*radial,p=S.apply(actual,[Math.cos(a),Math.sin(a)*Math.cos(phi),Math.sin(a)*Math.sin(phi)]);
   const truth=P.contains(id,S.apply(bound.inverse,p));if(truth){assert(F.mayContain(bound,p));insideProbes++;}boundaryProbes++;
  }
  for(const a of [0.65-1e-12,0.65,0.65+1e-12])for(const scale of [0.5,1,2]){const p=S.apply(actual,[Math.cos(a),Math.sin(a),0]).map(v=>v*scale);assert(F.mayContain(bound,p));boundaryProbes++;}
  for(const y of [0,-0])for(const z of [0,-0]){assert(F.mayContain(bound,S.apply(actual,[1,y,z])));boundaryProbes++;}
  assert(!F.mayContain(bound,S.apply(actual,[Math.cos(0.7),Math.sin(0.7),0])));
 }
}
const bound=F.cap(0,0,1),phi=(P.intervals[0][0]+P.intervals[0][1])/2,a=P.radius(phi)*0.5,p=[Math.cos(a),Math.sin(a)*Math.cos(phi),Math.sin(a)*Math.sin(phi)];
assert(P.contains(0,p));assert.throws(()=>assert(F.mayContain({...bound,cutoff:1},p)));
assert(F.mayContain(bound,[0,0,0]));assert(F.mayContain(bound,[NaN,0,0]));
for(const order of [0,2,16,NaN])assert.throws(()=>F.measure({width:16,height:8,time:0,direction:1},order));
for(const frame of [{width:16,height:9,time:0,direction:1},{width:16,height:8,time:-1,direction:1},{width:16,height:8,time:0,direction:0}])assert.throws(()=>F.measure(frame,4));
console.log(JSON.stringify({unitChecksPassed:true,diagnosticOnly:true,canonicalFramesMeasured:0,methodFrameComparisons:comparisons,pieceMethodComparisons:comparisons*6,naiveMembershipEvaluations:naive,exactMembershipEvaluations:exact,boundingTests:bounding,culledMembershipEvaluations:naive-exact,membershipReductionFactor:naive/exact,boundaryProbes,insideProbes,falseNegativeHits:0,unsafeShrinkControlRejected:true,areaDifferencesExactlyZero:true,hitCountsIdentical:true,slowMilliseconds:slowMs,fastMilliseconds:fastMs,fullScheduleMeasured:false,collisionChecksPerformed:false,movingK6StageAccepted:false}));
