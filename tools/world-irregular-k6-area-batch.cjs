'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {performance}=require('perf_hooks');
const C=require('./world-irregular-k6-area-policy.cjs'),P=require('./world-irregular-k6-static.cjs');
const M=require('./world-irregular-k6-poses.cjs'),A=require('./world-irregular-k6-area.cjs');
const S=require('../src/world-domain.js').createSphere({radiusKm:1});
const schema='k6-fixed-area-batch-v3',root=path.resolve(__dirname,'..');
const methods=[['centre','centre','centreErrors'],['gauss4',4,'gauss4Errors'],['gauss8',8,'gauss8Errors']];
const sources=['src/world-domain.js','tools/world-irregular-k6-static.cjs','tools/world-irregular-k6-poses.cjs','tools/world-irregular-k6-area.cjs','tools/world-irregular-k6-area-policy.cjs','tools/world-irregular-k6-area-pilot.cjs','tools/world-irregular-k6-area-batch.cjs'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const flags=()=>({integrationRun:false,collisionChecksPerformed:false,movingK6StageAccepted:false,frozenFixtureIntegrationRun:false,visualAccepted:false,appIntegrated:false});
const pinned={"src/world-domain.js":"71ee09ed451bca803ab0150594c1cc2cc6dcb352","tools/world-irregular-k6-static.cjs":"c5c765c1351187dca359f5938fee67d4ae55a329","tools/world-irregular-k6-poses.cjs":"423e6816c6ffc4b4943ac064853a4f910090c9c8","tools/world-irregular-k6-area.cjs":"137d8f13fafde60b2f5ee60fb99b3c2d67845b94","tools/world-irregular-k6-area-policy.cjs":"61dcba212ef81dd1c1c14c28f8aefc88cea5f0cc","tools/world-irregular-k6-area-pilot.cjs":"6b5f5db1b44da329ee6ffcd2ecb1dccf647edf4f"};
function fingerprints(){return Object.fromEntries(sources.map(f=>{const b=fs.readFileSync(path.join(root,f));if(pinned[f])assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex'),pinned[f],'pinned source changed: '+f);return [f,sha(b)];}));}
function make(index,measurements,origin,hashes){return {schema,index,frame:clone(C.schedule[index]),policyId:C.policy.id,references:P.reference(),measurements,origin,hashes,...flags(),fullScheduleMeasured:false};}
function validate(r,hashes){
 assert.equal(r.schema,schema);assert(Number.isInteger(r.index)&&r.index>=0&&r.index<10,'unexpected frame index');
 assert.deepEqual(r.frame,C.schedule[r.index]);assert.equal(r.policyId,C.policy.id);assert.deepEqual(r.hashes,hashes,'mixed source versions');
 assert.deepEqual(r.references,P.reference());assert(r.references.every(v=>Number.isFinite(v)&&v>0));
 assert.deepEqual(Object.keys(r.measurements).sort(),['centre','gauss4','gauss8']);
 assert(r.origin&&['measured','legacy-pilot'].includes(r.origin.kind));
 if(r.origin.kind==='legacy-pilot'){assert.equal(r.index,4);assert.equal(r.origin.originalFileHashesAvailable,false);assert(/^[0-9a-f]{64}$/.test(r.origin.jsonSHA256));}
 const input={...r.frame,areaTolerance:C.policy.tolerance,quadratureOrders:[4,8],pieceIds:[0,1,2,3,4,5]};
 for(const [name,order,field] of methods){
  const m=r.measurements[name],samples=r.frame.width*r.frame.height*(order==='centre'?1:order*order);
  assert.equal(m.order,order);assert.equal(m.membershipEvaluations,samples*6);
  assert(Number.isFinite(m.totalDomainWeight)&&Math.abs(m.totalDomainWeight-S.totalAreaKm2)<1e-10);
  assert(Number.isFinite(m.elapsedMilliseconds)&&m.elapsedMilliseconds>=0);
  assert(Array.isArray(m.areas)&&m.areas.length===6&&Array.from(m.areas).every(v=>Number.isFinite(v)&&v>=0&&v<=S.totalAreaKm2));
  assert(Array.isArray(m.hitSamples)&&m.hitSamples.length===6&&Array.from(m.hitSamples).every(v=>Number.isSafeInteger(v)&&v>=0&&v<=samples));
  input[field]=m.areas.map((v,id)=>Math.abs(v/r.references[id]-1));
 }
 const absolute=r.measurements.gauss4.areas.map((a,id)=>Math.abs(a-r.measurements.gauss8.areas[id]));
 return {input,classification:C.evaluateFrame(input),interOrderAbsoluteAreaDifferences:absolute,interOrderRelativeAreaDifferences:absolute.map((v,id)=>v/r.references[id])};
}
function importPilot(bytes,hashes){
 const p=JSON.parse(bytes.toString('utf8'));
 for(const [key,value] of Object.entries({areaPilotRun:true,unitChecksPassed:true,inputsUnchanged:true,measuredFrames:1,criterionRevised:true,geometryMode:'analytic-k6-one-frame-area-pilot',fullScheduleMeasured:false,...flags()}))assert.equal(p[key],value);
 assert.equal(p.policyId,C.policy.id);assert.deepEqual(p.frame,C.schedule[4]);assert.deepEqual(p.references,P.reference());
 const r=make(4,clone(p.measurements),{kind:'legacy-pilot',jsonSHA256:sha(bytes),originalFileHashesAvailable:false},hashes);
 const v=validate(r,hashes);assert.deepEqual(p.classification,v.classification);
 assert.equal(p.measurementMembershipEvaluations,Object.values(r.measurements).reduce((n,m)=>n+m.membershipEvaluations,0));
 const audit=p.referenceAudit;assert.equal(audit.pieceId,2);assert(Array.isArray(audit.originalFocused)&&audit.originalFocused.length===3);
 const differences=methods.map(([name],i)=>Math.abs(r.measurements[name].areas[2]-audit.originalFocused[i].area));
 assert(differences.every(v=>Number.isFinite(v)&&v<1e-12));assert.deepEqual(audit.absoluteDifferences,differences);
 r.originalJsonBase64=bytes.toString('base64');return r;
}
function assemble(records,hashes){
 assert.equal(records.length,10,'exactly ten saved frames required');const seen=new Set();
 const derived=records.map(r=>{
  const v=validate(r,hashes);assert(!seen.has(r.index),'duplicate frame');seen.add(r.index);
  if(r.origin.kind==='legacy-pilot'){
   assert.equal(typeof r.originalJsonBase64,'string');const bytes=Buffer.from(r.originalJsonBase64,'base64');assert.equal(sha(bytes),r.origin.jsonSHA256);
   assert.deepEqual(r,importPilot(bytes,hashes));
  }
  return {index:r.index,...v};
 });
 return {derived,classification:C.evaluateSchedule(derived.map(v=>v.input))};
}
function measure(frame,order){
 assert(order==='centre'||C.policy.orders.includes(order));
 const start=performance.now(),{width,height,time,direction}=frame;
 const inverse=C.policy.pieceIds.map(id=>{const q=M.pose(id,time),actual=direction===1?q:S.inverse(q);return S.inverse(actual);});
 const areas=Array(6).fill(0),hitSamples=Array(6).fill(0);let totalDomainWeight=0;
 function sample(p,w){for(let id=0;id<6;id++)if(P.contains(id,S.apply(inverse[id],p))){areas[id]+=w;hitSamples[id]++;}}
 if(order==='centre'){
  const longitude=Array.from({length:width},(_,col)=>{const lon=(col+.5)/width*2*Math.PI-Math.PI;return [Math.cos(lon),Math.sin(lon)];});
  for(let row=0;row<height;row++){
   const lat=Math.PI/2-(row+.5)/height*Math.PI,c=Math.cos(lat),z=Math.sin(lat),w=S.cellAreaKm2(width,height,row);
   totalDomainWeight+=width*w;for(const [co,si] of longitude)sample([c*co,c*si,z],w);
  }
 }else{
  const r=A.rule(order),lonHalf=Math.PI/width,longitude=[],sum=r.weights.reduce((a,b)=>a+b,0);
  for(let col=0;col<width;col++){
   const centre=(col+.5)/width*2*Math.PI-Math.PI;
   for(let k=0;k<order;k++){const lon=centre+lonHalf*r.nodes[k];longitude.push([Math.cos(lon),Math.sin(lon),lonHalf*r.weights[k]]);}
  }
  for(let row=0;row<height;row++){
   const top=Math.sin(Math.PI/2-row/height*Math.PI),bottom=Math.sin(Math.PI/2-(row+1)/height*Math.PI),middle=(top+bottom)/2,half=(top-bottom)/2;
   totalDomainWeight+=width*lonHalf*half*sum*sum;
   for(let k=0;k<order;k++){
    const z=middle+half*r.nodes[k],c=Math.sqrt(Math.max(0,1-z*z)),w=half*r.weights[k];
    for(const [co,si,lw] of longitude)sample([c*co,c*si,z],w*lw);
   }
  }
 }
 return {order,areas,hitSamples,totalDomainWeight,membershipEvaluations:width*height*6*(order==='centre'?1:order*order),elapsedMilliseconds:performance.now()-start};
}
function write(dir,prefix,value){
 fs.mkdirSync(dir,{recursive:true});const f=path.join(dir,prefix+'-'+Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.json');
 fs.writeFileSync(f,JSON.stringify(value,null,2),{flag:'wx'});assert(fs.statSync(f).size>0);return f;
}
function main(args){
 const [command,...rest]=args;assert(['plan','frame','import-pilot','assemble'].includes(command),'No default computation; plan | frame INDEX DIR | import-pilot JSON DIR | assemble DIR SUMMARY_DIR');
 const hashes=fingerprints();
 if(command==='plan'){assert.equal(rest.length,0);console.log(JSON.stringify({frames:C.schedule.map((f,index)=>({index,...f,membershipEvaluations:f.width*f.height*6*81})),pilotIndex:4,measuredFrames:0,...flags()},null,2));return;}
 assert.equal(rest.length,2,'exactly two arguments required');
 if(command==='frame'){
  assert(/^[0-9]$/.test(rest[0]));const index=Number(rest[0]),measurements={};
  for(const [name,order] of methods)measurements[name]=measure(C.schedule[index],order);
  const r=make(index,measurements,{kind:'measured'},hashes),file=write(rest[1],'frame-'+index,r);
  assert.deepEqual(fingerprints(),hashes,'source changed during measurement');const result=validate(r,hashes);
  console.log(JSON.stringify({file,index,classification:result.classification,...flags(),fullScheduleMeasured:false}));
  assert(result.classification.revisedAreaGatePassed,'area failed; raw result preserved');return;
 }
 if(command==='import-pilot'){
  const r=importPilot(fs.readFileSync(rest[0]),hashes);assert.deepEqual(fingerprints(),hashes);
  console.log(JSON.stringify({file:write(rest[1],'frame-4',r),importedFrames:1,newlyMeasuredFrames:0,...flags()}));return;
 }
 const names=fs.readdirSync(rest[0]);assert(names.every(n=>/^frame-[0-9]-.*\.json$/.test(n)),'unexpected result entry');
 const records=names.map(n=>JSON.parse(fs.readFileSync(path.join(rest[0],n),'utf8'))),result=assemble(records,hashes);
 assert.deepEqual(fingerprints(),hashes);
 const file=write(rest[1],'area-schedule',{schema,records,...result,fullScheduleMeasured:true,...flags()});
 console.log(JSON.stringify({file,pieceFrameChecks:result.classification.pieceFrameChecks,revisedAreaChecksPassed:result.classification.revisedAreaChecksPassed,fullScheduleMeasured:true,...flags()}));
 assert(result.classification.revisedAreaChecksPassed,'area failed; complete result preserved');
}
module.exports={make,validate,importPilot,assemble,measure};
if(require.main===module)try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
