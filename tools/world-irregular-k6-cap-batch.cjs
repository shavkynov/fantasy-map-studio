'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const C=require('./world-irregular-k6-area-policy.cjs');
const schema='k6-cap-batch-v1',self='tools/world-irregular-k6-cap-batch.cjs';
const dependencies=['src/world-domain.js','tools/world-irregular-k4-static.cjs','tools/world-irregular-k6-static.cjs','tools/world-irregular-k6-poses.cjs','tools/world-irregular-k6-area-policy.cjs','tools/world-irregular-k6-area.cjs','tools/world-irregular-k6-area-batch.cjs','tools/world-irregular-k6-cap.cjs','tools/world-irregular-k6-evidence.cjs',self];
const capFiles=['src/world-domain.js','tools/world-irregular-k4-static.cjs','tools/world-irregular-k6-static.cjs','tools/world-irregular-k6-poses.cjs','tools/world-irregular-k6-area.cjs'];
const methods=[['centre','centre'],['gauss4',4],['gauss8',8]],clone=v=>JSON.parse(JSON.stringify(v)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const loadedImplementation=sha(fs.readFileSync(__filename));
const flags=()=>({fullScheduleMeasured:false,collisionChecksPerformed:false,movingK6StageAccepted:false,integrationRun:false,frozenFixtureIntegrationRun:false,visualAccepted:false,appIntegrated:false});
function hashes(root){return Object.fromEntries(dependencies.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]));}
function context(root){
 const E=require('./world-irregular-k6-evidence.cjs'),r=E.readPointer(root);E.verifySources(root,r.data.sourceManifest);E.validate(r.data);
 assert.deepEqual(require('./world-irregular-k6-static.cjs').reference(),r.data.references,'current references differ');
 const sourceHashes=hashes(root);assert.equal(sourceHashes[self],loadedImplementation);
 return {references:clone(r.data.references),sourceHashes,capImplementationSHA256:r.data.capImplementationSHA256,capSourceBlobs:Object.fromEntries(capFiles.map(f=>[f,r.data.sourceManifest[f].gitBlob])),pairedMeasurements:clone(r.data.accelerated),controlEvidence:{path:r.entry.path,sha256:r.entry.sha256,evidenceCommit:r.entry.evidenceCommit,sourceCommit:r.entry.sourceCommit}};
}
function fresh(root,ctx){const next=context(root);assert.deepEqual(next,ctx,'sources or control evidence changed');}
function checkContext(ctx){
 assert.deepEqual(Object.keys(ctx.sourceHashes).sort(),[...dependencies].sort());for(const v of Object.values(ctx.sourceHashes))assert(/^[0-9a-f]{64}$/.test(v));
 assert.equal(ctx.sourceHashes['tools/world-irregular-k6-cap.cjs'],ctx.capImplementationSHA256);
 assert.deepEqual(Object.keys(ctx.capSourceBlobs).sort(),[...capFiles].sort());for(const v of Object.values(ctx.capSourceBlobs))assert(/^[0-9a-f]{40}$/.test(v));
 assert(Array.isArray(ctx.references)&&ctx.references.length===6&&Array.from(ctx.references).every(v=>Number.isFinite(v)&&v>0));
 assert(/^docs\/evidence\/[A-Za-z0-9._-]+\.json$/.test(ctx.controlEvidence.path));assert(/^[0-9a-f]{64}$/.test(ctx.controlEvidence.sha256));
 for(const k of ['evidenceCommit','sourceCommit'])assert(/^[0-9a-f]{40}$/.test(ctx.controlEvidence[k]));
}
function classify(r){return C.evaluateFrame({...r.frame,areaTolerance:C.policy.tolerance,quadratureOrders:[4,8],pieceIds:[0,1,2,3,4,5],centreErrors:r.measurements.centre.areas.map((v,id)=>Math.abs(v/r.references[id]-1)),gauss4Errors:r.measurements.gauss4.areas.map((v,id)=>Math.abs(v/r.references[id]-1)),gauss8Errors:r.measurements.gauss8.areas.map((v,id)=>Math.abs(v/r.references[id]-1))});}
function finish(r){r.classification=classify(r);r.interOrderAbsoluteAreaDifferences=r.measurements.gauss4.areas.map((v,id)=>Math.abs(v-r.measurements.gauss8.areas[id]));r.interOrderRelativeAreaDifferences=r.interOrderAbsoluteAreaDifferences.map((v,id)=>v/r.references[id]);return r;}
function make(index,measurements,ctx,origin,completed=true){
 assert(Number.isInteger(index)&&index>=0&&index<10);checkContext(ctx);
 const r={schema,index,frame:clone(C.schedule[index]),backend:'spherical-cap',experimental:true,policyId:C.policy.id,references:clone(ctx.references),sourceHashes:clone(ctx.sourceHashes),controlEvidence:clone(ctx.controlEvidence),pairedEquivalenceVerifiedForFrame:index===1,origin:clone(origin),measurements,completed,...flags()};return completed?finish(r):r;
}
function pairedPhases(ctx){return Object.fromEntries(methods.map(([key])=>[key,{...clone(ctx.pairedMeasurements[key]),schema:'analytic-k6-cap-experiment-v1',frame:clone(C.schedule[1]),culling:true,margin:1e-10,implementationSHA256:ctx.capImplementationSHA256,sourceBlobs:clone(ctx.capSourceBlobs),fullScheduleMeasured:false,collisionChecksPerformed:false,movingK6StageAccepted:false,integrationRun:false}]));}
function fromPaired(ctx){const r=make(1,pairedPhases(ctx),ctx,{kind:'paired-import'});validateFrame(r,ctx);return r;}
function validateFrame(r,ctx){
 checkContext(ctx);assert.equal(r.schema,schema);assert(Number.isInteger(r.index)&&r.index>=0&&r.index<10);assert.deepEqual(r.frame,C.schedule[r.index]);
 assert.equal(r.backend,'spherical-cap');assert.equal(r.experimental,true);assert.equal(r.policyId,C.policy.id);assert.equal(r.completed,true);assert.equal(r.error,undefined);
 for(const [k,v] of Object.entries(flags()))assert.equal(r[k],v);assert.deepEqual(r.references,ctx.references);assert.deepEqual(r.sourceHashes,ctx.sourceHashes);assert.deepEqual(r.controlEvidence,ctx.controlEvidence);
 assert.equal(r.pairedEquivalenceVerifiedForFrame,r.index===1);assert.equal(r.origin.kind,r.index===1?'paired-import':'cap-measurement');
 assert.deepEqual(Object.keys(r.measurements).sort(),['centre','gauss4','gauss8']);
 const vector=(v,p)=>assert(Array.isArray(v)&&v.length===6&&Array.from(v).every(p));
 for(const [key,order] of methods){
  const m=r.measurements[key],samples=r.frame.width*r.frame.height*(order==='centre'?1:order*order),naive=samples*6;
  assert.equal(m.membershipEvaluations,undefined,'no ambiguous membership counter');assert.equal(m.schema,'analytic-k6-cap-experiment-v1');assert.deepEqual(m.frame,r.frame);assert.equal(m.order,order);assert.equal(m.culling,true);assert.equal(m.margin,1e-10);
  assert.equal(m.implementationSHA256,ctx.capImplementationSHA256);assert.deepEqual(m.sourceBlobs,ctx.capSourceBlobs);
  for(const k of ['fullScheduleMeasured','collisionChecksPerformed','movingK6StageAccepted','integrationRun'])assert.equal(m[k],false);
  vector(m.areas,v=>Number.isFinite(v)&&v>=0&&v<=4*Math.PI);vector(m.hitSamples,v=>Number.isSafeInteger(v)&&v>=0&&v<=samples);
  assert(Number.isFinite(m.totalDomainWeight)&&Math.abs(m.totalDomainWeight-4*Math.PI)<1e-10);assert(Number.isFinite(m.elapsedMilliseconds)&&m.elapsedMilliseconds>=0);
  for(const k of ['boundingTests','exactMembershipEvaluations','culledMembershipEvaluations','naiveMembershipEvaluations'])assert(Number.isSafeInteger(m[k])&&m[k]>=0);
  assert.equal(m.boundingTests,naive);assert.equal(m.naiveMembershipEvaluations,naive);assert.equal(m.exactMembershipEvaluations+m.culledMembershipEvaluations,naive);
  assert(m.hitSamples.reduce((a,b)=>a+b,0)<=m.exactMembershipEvaluations);
 }
 if(r.index===1)assert.deepEqual(r.measurements,pairedPhases(ctx),'paired frame must retain exact stored measurements');
 const classification=classify(r);assert.deepEqual(r.classification,classification);
 const differences=r.measurements.gauss4.areas.map((v,id)=>Math.abs(v-r.measurements.gauss8.areas[id]));assert.deepEqual(r.interOrderAbsoluteAreaDifferences,differences);assert.deepEqual(r.interOrderRelativeAreaDifferences,differences.map((v,id)=>v/r.references[id]));
 return {...r.frame,areaTolerance:C.policy.tolerance,quadratureOrders:[4,8],pieceIds:[0,1,2,3,4,5],centreErrors:classification.pieces.map(p=>p.centreError),gauss4Errors:classification.pieces.map(p=>p.gauss4Error),gauss8Errors:classification.pieces.map(p=>p.gauss8Error)};
}
function assemble(records,ctx){
 assert(Array.isArray(records)&&records.length===10,'exactly ten cap-batch records required');const seen=new Set();
 const inputs=records.map(r=>{const input=validateFrame(r,ctx);assert(!seen.has(r.index),'duplicate frame');seen.add(r.index);return input;});
 return {schema,classification:C.evaluateSchedule(inputs),records,sourceHashes:clone(ctx.sourceHashes),controlEvidence:clone(ctx.controlEvidence),totals:Object.fromEntries(['boundingTests','exactMembershipEvaluations','culledMembershipEvaluations','naiveMembershipEvaluations'].map(k=>[k,records.reduce((n,r)=>n+methods.reduce((s,[name])=>s+r.measurements[name][k],0),0)])),experimental:true,pairedEquivalenceVerifiedIndices:[1],allFramesPairedEquivalenceVerified:false,...flags(),fullScheduleMeasured:true};
}
function write(dir,prefix,value){fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,prefix+'-'+Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.json');fs.writeFileSync(file,JSON.stringify(value,null,2),{flag:'wx'});assert(fs.statSync(file).size>0);return file;}
function main(args){
 const command=args[0]||'plan';assert(['plan','import-pair','frame','assemble'].includes(command),'plan | import-pair DIR | frame INDEX DIR --experimental | assemble DIR SUMMARY_DIR');
 if(command==='plan')assert(args.length<=1);else if(command==='import-pair')assert.equal(args.length,2);else if(command==='assemble')assert.equal(args.length,3);else{assert.equal(args.length,4);assert.equal(args[3],'--experimental');assert(/^[0-9]$/.test(args[1]));assert.notEqual(Number(args[1]),1,'use import-pair; do not rerun the stored control');}
 const root=path.resolve(__dirname,'..'),ctx=context(root);
 if(command==='plan'){console.log(JSON.stringify({frames:C.schedule.map((f,index)=>({index,...f,naiveMembershipEvaluations:f.width*f.height*6*81,action:index===1?'import-pair':'explicit-experimental-frame'})),experimental:true,measuredFrames:0,...flags()},null,2));return;}
 if(command==='import-pair'){const r=fromPaired(ctx);fresh(root,ctx);console.log(JSON.stringify({file:write(args[1],'frame-1-imported',r),importedFrames:1,newlyMeasuredFrames:0,...flags()}));return;}
 if(command==='assemble'){
  const names=fs.readdirSync(args[1]);assert(names.every(n=>/^frame-[0-9]-.*\.json$/.test(n)),'unexpected result entry');
  const result=assemble(names.map(n=>JSON.parse(fs.readFileSync(path.join(args[1],n),'utf8'))),ctx);fresh(root,ctx);
  const file=write(args[2],'cap-area-schedule',result);console.log(JSON.stringify({file,pieceFrameChecks:result.classification.pieceFrameChecks,revisedAreaChecksPassed:result.classification.revisedAreaChecksPassed,fullScheduleMeasured:true,experimental:true,movingK6StageAccepted:false}));assert(result.classification.revisedAreaChecksPassed,'area failed; complete report preserved');return;
 }
 const index=Number(args[1]),r=make(index,{},ctx,{kind:'cap-measurement',nodeVersion:process.version},false);let file;
 try{
  const F=require('./world-irregular-k6-cap.cjs');for(const [name,order] of methods)r.measurements[name]=F.measure(r.frame,order,true);
  fresh(root,ctx);r.completed=true;finish(r);validateFrame(r,ctx);file=write(args[2],'frame-'+index,r);
  console.log(JSON.stringify({file,index,revisedAreaGatePassed:r.classification.revisedAreaGatePassed,experimental:true,...flags()}));assert(r.classification.revisedAreaGatePassed,'area failed; raw report preserved');
 }catch(e){if(!file){r.completed=false;r.error=e.message;file=write(args[2],'frame-'+index+'-partial',r);console.error(JSON.stringify({file,completed:false}));}throw e;}
}
module.exports={dependencies,methods,make,fromPaired,validateFrame,assemble,write,finish};
if(require.main===module)try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
