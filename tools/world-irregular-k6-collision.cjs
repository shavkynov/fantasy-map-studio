'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const pairs=Object.freeze(Array.from({length:6},(_,a)=>Array.from({length:5-a},(_,k)=>Object.freeze([a,a+k+1]))).flat());
const pins=Object.freeze({
 'src/world-domain.js':'71ee09ed451bca803ab0150594c1cc2cc6dcb352',
 'tools/world-irregular-k4-static.cjs':'a5ff8740180b06df54c82df3aaf4f802d986d57c',
 'tools/world-irregular-k6-static.cjs':'c5c765c1351187dca359f5938fee67d4ae55a329',
 'tools/world-irregular-k6-poses.cjs':'423e6816c6ffc4b4943ac064853a4f910090c9c8',
 'tools/world-frame-validity.cjs':'b271fc3a2e9c07bda5f5c75370cf53c045d08769',
 'tools/world-irregular-k6-area-policy.cjs':'61dcba212ef81dd1c1c14c28f8aefc88cea5f0cc'
});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function manifest(){return Object.fromEntries([...Object.keys(pins),'tools/world-irregular-k6-collision.cjs'].map(f=>{
 const b=fs.readFileSync(path.join(root,f)),gitBlob=crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
 if(pins[f])assert.equal(gitBlob,pins[f],'dependency changed: '+f);
 return [f,{gitBlob,sha256:sha(b)}];
}));}
function membership(bits){
 assert(Number.isInteger(bits)&&bits>=0&&bits<64,'six-bit membership required');
 const ids=Array.from({length:6},(_,id)=>id).filter(id=>bits&(1<<id));
 return {count:ids.length,owner:ids.length===0?-1:ids.length===1?ids[0]:-2,
  pairHits:pairs.map(([a,b])=>Boolean((bits&(1<<a))&&(bits&(1<<b))))};
}
const lookup=Array.from({length:64},(_,bits)=>membership(bits));
function unit(){
 assert.equal(pairs.length,15);assert.equal(new Set(pairs.map(p=>p.join(','))).size,15);
 for(let bits=0;bits<64;bits++){
  const s=membership(bits),ids=Array.from({length:6},(_,id)=>id).filter(id=>Math.floor(bits/2**id)%2===1),n=ids.length;
  assert.equal(s.count,n);assert.equal(s.owner,n===0?-1:n===1?ids[0]:-2);
  assert.equal(s.pairHits.filter(Boolean).length,n<2?0:n*(n-1)/2);
  for(let k=0;k<15;k++)assert.equal(s.pairHits[k],ids.includes(pairs[k][0])&&ids.includes(pairs[k][1]));
 }
 for(let k=0;k<15;k++){
  const [a,b]=pairs[k];assert.deepEqual(membership((1<<a)|(1<<b)).pairHits,pairs.map((_,j)=>j===k));
 }
 for(const b of [-1,64,0.5,NaN,Infinity,'1'])assert.throws(()=>membership(b));
 return {unitChecksPassed:true,membershipMasks:64,singlePairCases:15,invalidMasksRejected:6,measuredFrames:0,
  collisionChecksPerformed:false,movingK6StageAccepted:false,integrationRun:false};
}
function frameAt(index){
 assert(Number.isInteger(index)&&index>=0&&index<10,'frame index 0..9 required');
 const frame=require('./world-irregular-k6-area-policy.cjs').schedule[index];return {...frame};
}
function snapshot(index){
 const frame=frameAt(index),{width,height,time,direction}=frame;
 const S=require('../src/world-domain.js').createSphere({radiusKm:1}),P=require('./world-irregular-k6-static.cjs'),M=require('./world-irregular-k6-poses.cjs');
 const {assess}=require('./world-frame-validity.cjs');
 const before=JSON.stringify({intervals:P.intervals,parameters:M.parameters});
 const q=Array.from({length:6},(_,id)=>{const v=M.pose(id,time);return direction===1?v:S.inverse(v);}),inverse=q.map(S.inverse);
 const histogram=Array(7).fill(0),areaByCoverage=Array(7).fill(0),pieceCells=Array(6).fill(0),pieceAreas=Array(6).fill(0),pairCells=Array(15).fill(0),pairAreas=Array(15).fill(0);
 let zeroTimeOwnerMismatchCells=0;
 const start=process.hrtime.bigint();
 for(let row=0;row<height;row++){
  const lat=Math.PI/2-(row+0.5)/height*Math.PI,c=Math.cos(lat),z=Math.sin(lat),weight=S.cellAreaKm2(width,height,row);
  for(let col=0;col<width;col++){
   const lon=(col+0.5)/width*2*Math.PI-Math.PI,p=[c*Math.cos(lon),c*Math.sin(lon),z];let bits=0;
   for(let id=0;id<6;id++)if(P.contains(id,S.apply(inverse[id],p))){bits|=1<<id;pieceCells[id]++;pieceAreas[id]+=weight;}
   const state=lookup[bits];histogram[state.count]++;areaByCoverage[state.count]+=weight;
   for(let k=0;k<15;k++)if(state.pairHits[k]){pairCells[k]++;pairAreas[k]+=weight;}
   if(time===0&&state.owner!==P.owner(p))zeroTimeOwnerMismatchCells++;
  }
 }
 const sum=a=>a.reduce((x,y)=>x+y,0),weighted=(a,f)=>a.reduce((x,y,n)=>x+f(n)*y,0),choose2=n=>n*(n-1)/2;
 assert.equal(sum(histogram),width*height);assert.equal(sum(pairCells),weighted(histogram,choose2));
 assert.equal(sum(pieceCells),weighted(histogram,n=>n));assert.equal(zeroTimeOwnerMismatchCells,0);
 assert(Math.abs(sum(areaByCoverage)-S.totalAreaKm2)<1e-10);
 assert(Math.abs(sum(pairAreas)-weighted(areaByCoverage,choose2))<1e-10);
 assert(Math.abs(sum(pieceAreas)-weighted(areaByCoverage,n=>n))<1e-10);
 let roundTrips=0,maxRoundTripAngle=0;
 for(let id=0;id<6;id++)for(const fraction of [0.25,0.5,0.75]){
  const [a,b]=P.intervals[id],phi=(a+b)/2,r=P.radius(phi)*fraction;
  const source=Object.freeze([Math.cos(r),Math.sin(r)*Math.cos(phi),Math.sin(r)*Math.sin(phi)]),saved=JSON.stringify(source);
  assert(P.contains(id,source));const back=S.apply(inverse[id],S.apply(q[id],source));
  assert(P.contains(id,back));assert.equal(JSON.stringify(source),saved);
  maxRoundTripAngle=Math.max(maxRoundTripAngle,S.angle(source,back));roundTrips++;
 }
 assert.equal(roundTrips,18);assert(maxRoundTripAngle<1e-12);
 assert.equal(JSON.stringify({intervals:P.intervals,parameters:M.parameters}),before);
 const overlapCells=sum(histogram.slice(2)),overlapArea=sum(areaByCoverage.slice(2));
 const diagnostics={overlapCells,overlapAreaFraction:overlapArea/S.totalAreaKm2,validSampledGeometry:overlapCells===0},classification=assess({diagnostics});
 const expectationMatched=direction===1?
  classification.validSampledGeometry&&classification.reasons.length===0&&pairCells.every(n=>n===0):
  !classification.validSampledGeometry&&JSON.stringify(classification.reasons)===JSON.stringify(['fragment-overlap'])&&pairCells.every(n=>n>0)&&histogram[6]>0;
 return {index,frame,centralMeridian:0,pairOrder:pairs,coverageHistogram:histogram,areaByCoverage,pieceCells,rasterPieceAreas:pieceAreas,
  pairOverlapCells:pairCells,pairOverlapAreas:pairAreas,pairIncidences:sum(pairCells),zeroTimeOwnerMismatchCells,
  roundTrips,maxRoundTripAngle,diagnostics,classification,expectedRole:direction===1?'opening':'overlapping-negative-control',expectationMatched,
  membershipEvaluations:width*height*6,culling:false,elapsedMilliseconds:Number(process.hrtime.bigint()-start)/1e6};
}
function save(dir,report){
 fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'k6-collision-frame-'+report.index+'-'+Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.json');
 fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});assert(fs.statSync(file).size>0);return file;
}
function main(args){
 if(args.length===1&&args[0]==='--unit-only'){console.log(JSON.stringify(unit()));return;}
 if(args.length===0||(args.length===1&&args[0]==='plan')){
  console.log(JSON.stringify({schema:'analytic-k6-collision-plan-v1',schedule:Array.from({length:10},(_,i)=>({index:i,...frameAt(i)})),
   pairOrder:pairs,measuredFrames:0,defaultHeavyRunAbsent:true,collisionChecksPerformed:false,movingK6StageAccepted:false}));return;
 }
 assert(args.length===4&&args[0]==='frame'&&/^[0-9]$/.test(args[1])&&args[2]&&args[3]==='--experimental',
  'plan | --unit-only | frame INDEX OUTPUT_DIR --experimental; no all mode');
 const index=Number(args[1]),sourceManifest=manifest();unit();
 const report={schema:'analytic-k6-collision-frame-v1',reviewedBaseCommit:'70280b27a81a72ddac54729f25471bb0c1162ea3',index,
  sourceManifest,nodeVersion:process.version,completed:false,collisionChecksPerformed:false,areaMeasurementsPerformed:false,
  areaGatePerformed:false,fullScheduleMeasured:false,fullCollisionScheduleMeasured:false,movingK6StageAccepted:false,
  integrationRun:false,frozenFixtureIntegrationRun:false,visualAccepted:false,appIntegrated:false,
  scope:'One unculled cell-centre collision snapshot only. Incidental weighted areas are collision accounting,not AREA acceptance or Gauss measurements. No continuous collision detection or full-stage acceptance.'};
 let error;
 try{
  report.snapshot=snapshot(index);report.collisionChecksPerformed=true;
  assert.deepEqual(manifest(),sourceManifest,'sources changed during run');
  assert(!Object.keys(require.cache).some(f=>path.basename(f)==='world-v4.js'),'generator imported');
  report.inputsUnchanged=true;report.completed=true;
 }catch(e){error=e;report.error=e.stack||e.message;}
 const file=save(args[2],report);
 console.log(JSON.stringify({file,index,completed:report.completed,expectationMatched:report.snapshot?.expectationMatched??false,
  diagnostics:report.snapshot?.diagnostics,reasons:report.snapshot?.classification.reasons,collisionChecksPerformed:report.collisionChecksPerformed,
  fullCollisionScheduleMeasured:false,movingK6StageAccepted:false}));
 if(error)throw error;assert(report.snapshot.expectationMatched,'collision expectation failed; raw report saved');
}
module.exports={pairs,membership,unit,snapshot,frameAt,manifest,save};
if(require.main===module)try{main(process.argv.slice(2));}catch(e){console.error(e.stack||e.message);process.exitCode=1;}
