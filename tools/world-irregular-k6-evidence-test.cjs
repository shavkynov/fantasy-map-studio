'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const X=require('./world-irregular-k6-evidence.cjs'),C=require('./world-irregular-k6-area-policy.cjs'),clone=v=>JSON.parse(JSON.stringify(v));
const root=path.resolve(__dirname,'..'),loaded=X.readPointer(root),original=JSON.stringify(loaded.data);
assert(X.validate(loaded.data).revisedAreaGatePassed);assert.equal(JSON.stringify(loaded.data),original);
let rejected=0;
for(const edit of [d=>{d.scheduleIndex=0},d=>{d.frame.time=0.5},d=>{d.completed=false},d=>{d.fullScheduleMeasured=true},d=>{d.capMargin=1e-3},d=>{delete d.original.gauss8},d=>{d.accelerated.centre.areas[0]+=1e-12},d=>{d.accelerated.gauss4.hitSamples[1]++},d=>{d.original.gauss8.membershipEvaluations--},d=>{d.accelerated.gauss8.exactMembershipEvaluations--},d=>{d.accelerated.gauss4.boundingTests--},d=>{d.classification.revisedAreaGatePassed=false},d=>{d.originalMilliseconds++},d=>{d.capImplementationSHA256='0'.repeat(64)},d=>{d.comparison[0].exactMatch=false},d=>{d.references[0]*=2},d=>{d.original.centre.areas[0]=NaN},d=>{d.accelerated.gauss8.elapsedMilliseconds=-1}]){
 const data=clone(loaded.data);edit(data);assert.throws(()=>X.validate(data));rejected++;
}
const hashes=Object.fromEntries(X.nativeFiles.map(f=>[f,'a'.repeat(64)])),record=X.makeOriginal(loaded.data,hashes,loaded.entry);
assert.deepEqual(record.measurements,loaded.data.original);assert.equal(record.measurements.gauss8.membershipEvaluations,24883200);assert.equal(record.origin.kind,'measured');assert.equal(record.index,1);assert.equal(record.fullScheduleMeasured,false);assert.deepEqual(record.references,loaded.data.references);
record.measurements.centre.areas[0]=0;assert.equal(JSON.stringify(loaded.data),original);
const fresh=X.makeOriginal(loaded.data,hashes,loaded.entry),input={...fresh.frame,areaTolerance:C.policy.tolerance,quadratureOrders:[4,8],pieceIds:[0,1,2,3,4,5],centreErrors:fresh.measurements.centre.areas.map((v,id)=>Math.abs(v/fresh.references[id]-1)),gauss4Errors:fresh.measurements.gauss4.areas.map((v,id)=>Math.abs(v/fresh.references[id]-1)),gauss8Errors:fresh.measurements.gauss8.areas.map((v,id)=>Math.abs(v/fresh.references[id]-1))};
assert.deepEqual(C.evaluateFrame(input),loaded.data.classification);assert.throws(()=>C.evaluateSchedule([input]),/all ten frames/);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'k6-evidence-registry-'));
let sourceChangesRejected=0,pathFailuresRejected=0;
try{
 fs.mkdirSync(path.join(temp,'docs/evidence'),{recursive:true});
 const entry=clone(loaded.entry),pointer={schema:'fantasy-map-studio-evidence-index-v1',reports:{k6CapPairedFrame1:entry}},pointerFile=path.join(temp,'docs/evidence/CURRENT.json'),evidenceFile=path.join(temp,entry.path),bytes=fs.readFileSync(path.join(root,entry.path));
 fs.writeFileSync(pointerFile,JSON.stringify(pointer));fs.writeFileSync(evidenceFile,bytes);assert.deepEqual(X.readPointer(temp).data,loaded.data);
 for(const target of ['../outside.json','/tmp/outside.json','docs/evidence/../../outside.json']){entry.path=target;fs.writeFileSync(pointerFile,JSON.stringify(pointer));assert.throws(()=>X.readPointer(temp));pathFailuresRejected++;}
 entry.path=loaded.entry.path;fs.writeFileSync(pointerFile,JSON.stringify(pointer));fs.writeFileSync(evidenceFile,Buffer.concat([bytes,Buffer.from(' ')]));assert.throws(()=>X.readPointer(temp),/digest mismatch/);fs.writeFileSync(evidenceFile,bytes);
 fs.unlinkSync(evidenceFile);const outside=path.join(temp,'outside.json');fs.writeFileSync(outside,bytes);fs.symlinkSync(outside,evidenceFile);assert.throws(()=>X.readPointer(temp),/escapes/);pathFailuresRejected++;fs.unlinkSync(evidenceFile);fs.writeFileSync(evidenceFile,bytes);
 const manifest={};for(const f of X.files){const target=path.join(temp,f),b=Buffer.from('synthetic file hash probe '+f+'\n');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b);manifest[f]={sha256:crypto.createHash('sha256').update(b).digest('hex'),gitBlob:crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex')};}
 X.verifySources(temp,manifest);
 for(const f of X.files){const target=path.join(temp,f),b=fs.readFileSync(target);fs.appendFileSync(target,'changed');assert.throws(()=>X.verifySources(temp,manifest));sourceChangesRejected++;fs.writeFileSync(target,b);}
 assert.throws(()=>X.exportOriginal(temp,path.join(temp,'no-export')));assert(!fs.existsSync(path.join(temp,'no-export')));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log(JSON.stringify({unitChecksPassed:true,actualStoredEvidenceRead:true,policyRecomputed:true,evidenceSHA256:loaded.entry.sha256,dataRejections:rejected,pathFailuresRejected,sourceChangesRejected,originalMeasurementCopyPreserved:true,partialScheduleRejected:true,measuredFrames:0,fullCheckoutCliExportRun:false,fullScheduleMeasured:false,movingK6StageAccepted:false}));
