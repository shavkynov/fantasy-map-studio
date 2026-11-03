'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const C=require('./world-irregular-k6-area-policy.cjs');
const files=['src/world-domain.js','tools/world-irregular-k4-static.cjs','tools/world-irregular-k6-static.cjs','tools/world-irregular-k6-poses.cjs','tools/world-irregular-k6-area-policy.cjs','tools/world-irregular-k6-area.cjs','tools/world-irregular-k6-area-batch.cjs','tools/world-irregular-k6-cap.cjs'];
const nativeFiles=['src/world-domain.js','tools/world-irregular-k4-static.cjs','tools/world-irregular-k6-static.cjs','tools/world-irregular-k6-poses.cjs','tools/world-irregular-k6-area.cjs','tools/world-irregular-k6-area-policy.cjs','tools/world-irregular-k6-area-pilot.cjs','tools/world-irregular-k6-area-batch.cjs'];
const methods=[['centre','centre'],['gauss4',4],['gauss8',8]],sha=b=>crypto.createHash('sha256').update(b).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v));
const blob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
function readPointer(root){
 const pointerBytes=fs.readFileSync(path.join(root,'docs/evidence/CURRENT.json')),pointer=JSON.parse(pointerBytes);
 assert.equal(pointer.schema,'fantasy-map-studio-evidence-index-v1');const entry=pointer.reports.k6CapPairedFrame1;
 assert.equal(entry.frameIndex,1);assert.equal(entry.purpose,'paired-culling-equivalence');assert.equal(entry.scope,'single-frame');assert.equal(entry.validatesWholeSchedule,false);
 assert(/^[0-9a-f]{64}$/.test(entry.sha256));assert(/^[0-9a-f]{40}$/.test(entry.evidenceCommit));
 assert(/^docs\/evidence\/[A-Za-z0-9._-]+\.json$/.test(entry.path),'unsafe evidence path');
 const base=fs.realpathSync(path.join(root,'docs/evidence')),file=fs.realpathSync(path.join(root,entry.path)),relative=path.relative(base,file);
 assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'evidence escapes directory');
 const bytes=fs.readFileSync(file);assert.equal(sha(bytes),entry.sha256,'evidence digest mismatch');
 const data=JSON.parse(bytes);assert.equal(data.sourceCommit,entry.sourceCommit);return {entry,data,pointerSHA256:sha(pointerBytes)};
}
function verifySources(root,manifest){
 assert.deepEqual(Object.keys(manifest).sort(),[...files].sort());
 for(const f of files){const b=fs.readFileSync(path.join(root,f));assert.equal(sha(b),manifest[f].sha256,'source digest mismatch: '+f);assert.equal(blob(b),manifest[f].gitBlob,'source blob mismatch: '+f);}
}
function validate(data){
 assert.equal(data.schema,'k6-paired-frame-evidence-v1');assert.equal(data.scheduleIndex,1);assert.deepEqual(data.frame,C.schedule[1]);
 for(const key of ['completed','inputsUnchanged','exactComparisonPassed','classificationsIdentical'])assert.equal(data[key],true);
 for(const key of ['fullScheduleMeasured','collisionChecksPerformed','movingK6StageAccepted','integrationRun','appIntegrated','visualAccepted','generatorImported','frozenFixtureIntegrationRun'])assert.equal(data[key],false);
 assert(/^[0-9a-f]{40}$/.test(data.sourceCommit));assert.equal(data.capMargin,1e-10);
 assert.deepEqual(Object.keys(data.sourceManifest).sort(),[...files].sort());
 for(const item of Object.values(data.sourceManifest)){assert(/^[0-9a-f]{40}$/.test(item.gitBlob));assert(/^[0-9a-f]{64}$/.test(item.sha256));}
 assert.equal(data.capImplementationSHA256,data.sourceManifest['tools/world-irregular-k6-cap.cjs'].sha256);
 const vector=(v,p)=>assert(Array.isArray(v)&&v.length===6&&Array.from(v).every(p));
 vector(data.references,v=>Number.isFinite(v)&&v>0);
 for(const collection of [data.original,data.accelerated])assert.deepEqual(Object.keys(collection).sort(),['centre','gauss4','gauss8']);
 const differences=[];
 for(const [key,order] of methods){
  const samples=data.frame.width*data.frame.height*(order==='centre'?1:order*order),naive=samples*6,a=data.original[key],b=data.accelerated[key];
  for(const m of [a,b]){assert.equal(m.order,order);vector(m.areas,v=>Number.isFinite(v)&&v>=0&&v<=4*Math.PI);vector(m.hitSamples,v=>Number.isSafeInteger(v)&&v>=0&&v<=samples);assert(Number.isFinite(m.totalDomainWeight)&&Math.abs(m.totalDomainWeight-4*Math.PI)<1e-10);assert(Number.isFinite(m.elapsedMilliseconds)&&m.elapsedMilliseconds>=0);}
  assert.equal(a.membershipEvaluations,naive);
  for(const field of ['boundingTests','exactMembershipEvaluations','culledMembershipEvaluations','naiveMembershipEvaluations'])assert(Number.isSafeInteger(b[field])&&b[field]>=0);
  assert.equal(b.boundingTests,naive);assert.equal(b.naiveMembershipEvaluations,naive);assert.equal(b.exactMembershipEvaluations+b.culledMembershipEvaluations,naive);
  assert.deepEqual(a.areas,b.areas);assert.deepEqual(a.hitSamples,b.hitSamples);assert.equal(a.totalDomainWeight,b.totalDomainWeight);
  differences.push({method:key,areaDifferences:Array(6).fill(0),hitDifferences:Array(6).fill(0),domainWeightDifference:0,exactMatch:true});
 }
 assert.deepEqual(data.comparison,differences);
 const classify=m=>C.evaluateFrame({...data.frame,areaTolerance:C.policy.tolerance,quadratureOrders:[4,8],pieceIds:[0,1,2,3,4,5],centreErrors:m.centre.areas.map((v,id)=>Math.abs(v/data.references[id]-1)),gauss4Errors:m.gauss4.areas.map((v,id)=>Math.abs(v/data.references[id]-1)),gauss8Errors:m.gauss8.areas.map((v,id)=>Math.abs(v/data.references[id]-1))});
 const original=classify(data.original),accelerated=classify(data.accelerated);assert.deepEqual(original,accelerated);assert.deepEqual(original,data.classification);assert(original.revisedAreaGatePassed);
 assert.equal(data.originalMembershipEvaluations,methods.reduce((n,[k])=>n+data.original[k].membershipEvaluations,0));
 assert.equal(data.acceleratedMembershipEvaluations,methods.reduce((n,[k])=>n+data.accelerated[k].exactMembershipEvaluations,0));
 assert.equal(data.boundingTests,methods.reduce((n,[k])=>n+data.accelerated[k].boundingTests,0));
 assert.equal(data.originalMilliseconds,methods.reduce((n,[k])=>n+data.original[k].elapsedMilliseconds,0));assert.equal(data.acceleratedMilliseconds,methods.reduce((n,[k])=>n+data.accelerated[k].elapsedMilliseconds,0));return original;
}
function checked(root){const result=readPointer(root);verifySources(root,result.data.sourceManifest);result.classification=validate(result.data);return result;}
function makeOriginal(data,hashes,entry){
 validate(data);assert.deepEqual(Object.keys(hashes).sort(),[...nativeFiles].sort());for(const value of Object.values(hashes))assert(/^[0-9a-f]{64}$/.test(value));
 return {schema:'k6-fixed-area-batch-v3',index:1,frame:clone(data.frame),policyId:C.policy.id,references:clone(data.references),measurements:clone(data.original),origin:{kind:'measured',source:'imported-paired-original'},hashes,importedEvidence:{path:entry.path,sha256:entry.sha256,evidenceCommit:entry.evidenceCommit,measuredSourceCommit:data.sourceCommit},fullScheduleMeasured:false,integrationRun:false,collisionChecksPerformed:false,movingK6StageAccepted:false,frozenFixtureIntegrationRun:false,visualAccepted:false,appIntegrated:false};
}
function exportOriginal(root,dir){
 const {entry,data,pointerSHA256}=checked(root),hashes=Object.fromEntries(nativeFiles.map(f=>{const b=fs.readFileSync(path.join(root,f));if(f.endsWith('area-pilot.cjs'))assert.equal(blob(b),'6b5f5db1b44da329ee6ffcd2ecb1dccf647edf4f','pilot source changed');else assert.equal(sha(b),data.sourceManifest[f].sha256);return [f,sha(b)];}));
 const record=makeOriginal(data,hashes,entry);verifySources(root,data.sourceManifest);assert.equal(sha(fs.readFileSync(path.join(root,'docs/evidence/CURRENT.json'))),pointerSHA256);assert.equal(sha(fs.readFileSync(path.join(root,entry.path))),entry.sha256);
 fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'frame-1-imported-'+Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.json');fs.writeFileSync(file,JSON.stringify(record,null,2),{flag:'wx'});assert(fs.statSync(file).size>0);return file;
}
module.exports={readPointer,verifySources,validate,makeOriginal,exportOriginal,files,nativeFiles};
if(require.main===module)try{
 const args=process.argv.slice(2),command=args[0]||'verify',root=path.resolve(__dirname,'..');
 if(command==='verify'){assert(args.length<=1);const r=checked(root);console.log(JSON.stringify({verified:true,evidence:r.entry.path,sha256:r.entry.sha256,frameIndex:1,revisedAreaGatePassed:r.classification.revisedAreaGatePassed,measuredFrames:0,fullScheduleMeasured:false,acceleratedBatchAdopted:false}));}
 else{assert.equal(command,'export-original-frame1');assert.equal(args.length,2);console.log(JSON.stringify({file:exportOriginal(root,args[1]),importedFrames:1,newlyMeasuredFrames:0,fullScheduleMeasured:false,movingK6StageAccepted:false}));}
}catch(e){console.error(e.message);process.exitCode=1;}
