'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {performance}=require('perf_hooks');
const S=require('../src/world-domain.js').createSphere({radiusKm:1});
const P=require('./world-irregular-k6-static.cjs'),M=require('./world-irregular-k6-poses.cjs'),A=require('./world-irregular-k6-area.cjs');
const margin=1e-10;
const implementationSHA256=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const pinned={'src/world-domain.js':'71ee09ed451bca803ab0150594c1cc2cc6dcb352','tools/world-irregular-k4-static.cjs':'a5ff8740180b06df54c82df3aaf4f802d986d57c','tools/world-irregular-k6-static.cjs':'c5c765c1351187dca359f5938fee67d4ae55a329','tools/world-irregular-k6-poses.cjs':'423e6816c6ffc4b4943ac064853a4f910090c9c8','tools/world-irregular-k6-area.cjs':'137d8f13fafde60b2f5ee60fb99b3c2d67845b94'};
function sourceHashes(){return Object.fromEntries(Object.entries(pinned).map(([f,expected])=>{const b=fs.readFileSync(path.join(__dirname,'..',f));assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex'),expected,'source changed: '+f);return [f,expected];}));}
function cap(id,time,direction){
 assert(direction===1||direction===-1);assert.equal(M.parameters.alpha,0.65);
 const q=M.pose(id,time),actual=direction===1?q:S.inverse(q);
 return {centre:S.apply(actual,[1,0,0]),cutoff:Math.cos(M.parameters.alpha)-margin,inverse:S.inverse(actual)};
}
function mayContain(bound,p,norm=Math.hypot(...p)){
 if(!Number.isFinite(norm)||norm<=0)return true;
 const c=bound.centre,dot=(c[0]*p[0]+c[1]*p[1]+c[2]*p[2])/norm;
 return !(dot<bound.cutoff);
}
function measure(frame,order,culling=true){
 assert(frame&&typeof frame==='object');
 const {width,height,time,direction}=frame;
 assert(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&height>=1&&width===2*height&&width<=720);
 assert(Number.isFinite(time)&&time>=0&&time<=1);assert(direction===1||direction===-1);
 assert(order==='centre'||order===4||order===8);assert(typeof culling==='boolean');
 const hashes=sourceHashes();assert.equal(crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),implementationSHA256);
 const start=performance.now(),caps=Array.from({length:6},(_,id)=>cap(id,time,direction));
 const areas=Array(6).fill(0),hitSamples=Array(6).fill(0);
 let totalDomainWeight=0,boundingTests=0,exactMembershipEvaluations=0,culledMembershipEvaluations=0;
 function sample(p,weight){
  const norm=culling?Math.hypot(...p):1;
  for(let id=0;id<6;id++){
   if(culling){boundingTests++;if(!mayContain(caps[id],p,norm)){culledMembershipEvaluations++;continue;}}
   exactMembershipEvaluations++;
   if(P.contains(id,S.apply(caps[id].inverse,p))){areas[id]+=weight;hitSamples[id]++;}
  }
 }
 if(order==='centre'){
  const longitude=Array.from({length:width},(_,col)=>{const lon=(col+0.5)/width*2*Math.PI-Math.PI;return [Math.cos(lon),Math.sin(lon)];});
  for(let row=0;row<height;row++){
   const lat=Math.PI/2-(row+0.5)/height*Math.PI,c=Math.cos(lat),z=Math.sin(lat),weight=S.cellAreaKm2(width,height,row);
   totalDomainWeight+=width*weight;for(const [co,si] of longitude)sample([c*co,c*si,z],weight);
  }
 }else{
  const r=A.rule(order),lonHalf=Math.PI/width,longitude=[],weightSum=r.weights.reduce((a,b)=>a+b,0);
  for(let col=0;col<width;col++){
   const centre=(col+0.5)/width*2*Math.PI-Math.PI;
   for(let k=0;k<order;k++){const lon=centre+lonHalf*r.nodes[k];longitude.push([Math.cos(lon),Math.sin(lon),lonHalf*r.weights[k]]);}
  }
  for(let row=0;row<height;row++){
   const top=Math.sin(Math.PI/2-row/height*Math.PI),bottom=Math.sin(Math.PI/2-(row+1)/height*Math.PI),middle=(top+bottom)/2,half=(top-bottom)/2;
   totalDomainWeight+=width*lonHalf*half*weightSum*weightSum;
   for(let k=0;k<order;k++){
    const z=middle+half*r.nodes[k],c=Math.sqrt(Math.max(0,1-z*z)),weight=half*r.weights[k];
    for(const [co,si,lw] of longitude)sample([c*co,c*si,z],weight*lw);
   }
  }
 }
 const naiveMembershipEvaluations=width*height*6*(order==='centre'?1:order*order);
 assert.equal(exactMembershipEvaluations+culledMembershipEvaluations,naiveMembershipEvaluations);
 assert(Math.abs(totalDomainWeight-S.totalAreaKm2)<1e-10);assert(areas.every(v=>Number.isFinite(v)&&v>=0&&v<=S.totalAreaKm2));
 const elapsedMilliseconds=performance.now()-start;assert.deepEqual(sourceHashes(),hashes);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),implementationSHA256);
 return {schema:'analytic-k6-cap-experiment-v1',frame:{width,height,time,direction},order,culling,margin,areas,hitSamples,totalDomainWeight,boundingTests,exactMembershipEvaluations,culledMembershipEvaluations,naiveMembershipEvaluations,elapsedMilliseconds,implementationSHA256,sourceBlobs:hashes,fullScheduleMeasured:false,collisionChecksPerformed:false,movingK6StageAccepted:false,integrationRun:false};
}
module.exports={cap,mayContain,measure,sourceHashes,margin};
if(require.main===module){console.error('Import-only experiment; no default calculation or batch adoption.');process.exitCode=1;}
