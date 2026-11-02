'use strict';
const assert=require('assert/strict');
const B=require('./world-irregular-k6-area-batch.cjs'),C=require('./world-irregular-k6-area-policy.cjs'),P=require('./world-irregular-k6-static.cjs');
const total=4*Math.PI,hashes={synthetic:'tests-only'},clone=x=>JSON.parse(JSON.stringify(x));
const methods=[['centre','centre'],['gauss4',4],['gauss8',8]];
function fresh(){return C.schedule.map((f,index)=>B.make(index,Object.fromEntries(methods.map(([name,order])=>[name,{order,areas:P.reference(),hitSamples:Array(6).fill(0),totalDomainWeight:total,membershipEvaluations:f.width*f.height*6*(order==='centre'?1:order*order),elapsedMilliseconds:0}])),{kind:'measured'},hashes));}
function pilot(){const r=fresh()[4];return {areaPilotRun:true,unitChecksPassed:true,inputsUnchanged:true,measuredFrames:1,criterionRevised:true,geometryMode:'analytic-k6-one-frame-area-pilot',fullScheduleMeasured:false,integrationRun:false,collisionChecksPerformed:false,movingK6StageAccepted:false,frozenFixtureIntegrationRun:false,visualAccepted:false,appIntegrated:false,policyId:C.policy.id,frame:r.frame,references:r.references,measurements:r.measurements,classification:B.validate(r,hashes).classification,measurementMembershipEvaluations:Object.values(r.measurements).reduce((n,m)=>n+m.membershipEvaluations,0),referenceAudit:{pieceId:2,originalFocused:methods.map(([name])=>({area:r.measurements[name].areas[2]})),absoluteDifferences:[0,0,0]}};}
const good=fresh(),before=JSON.stringify(good),summary=B.assemble(good,hashes);
assert(summary.classification.revisedAreaChecksPassed);assert.equal(summary.classification.pieceFrameChecks,60);assert.equal(JSON.stringify(good),before);
let invalidCollectionsRejected=0;
for(const edit of [r=>r.pop(),r=>r.push(r[0]),r=>{r[9]=r[0]},r=>{r[0].index=10},r=>{r[0].frame.time=.75},r=>{r[0].hashes={wrong:true}},r=>{r[0].policyId='wrong'},r=>{delete r[0].measurements.gauss8},r=>r[0].measurements.centre.areas.pop(),r=>{r[0].measurements.gauss4.areas[0]=null},r=>{r[0].measurements.gauss4.areas[0]=NaN},r=>{r[0].measurements.gauss4.areas[0]=Infinity},r=>{r[0].measurements.gauss4.areas[0]=-1},r=>{r[0].measurements.gauss8.membershipEvaluations--},r=>{r[0].measurements.centre.totalDomainWeight=0},r=>{r[0].references[0]*=2},r=>{r[0].measurements.centre.elapsedMilliseconds=-1},r=>{r[0].measurements.gauss8.hitSamples[0]=1.5},r=>{r[0].origin.kind='unknown'}]){
 const r=clone(fresh());edit(r);assert.throws(()=>B.assemble(r,hashes));invalidCollectionsRejected++;
}
const centreFail=fresh();centreFail[4].measurements.centre.areas[2]*=1.04;
const old=B.assemble(centreFail,hashes).classification;assert(!old.originalRasterAreaGatePassed&&old.revisedAreaChecksPassed);
for(const method of ['gauss4','gauss8']){const r=fresh();r[9].measurements[method].areas[5]*=1.04;assert(!B.assemble(r,hashes).classification.revisedAreaChecksPassed);}
const bytes=Buffer.from(JSON.stringify(pilot())),imported=B.importPilot(bytes,hashes);
assert.equal(imported.index,4);assert.equal(imported.origin.originalFileHashesAvailable,false);
const mixed=fresh();mixed[4]=imported;assert(B.assemble(mixed,hashes).classification.revisedAreaChecksPassed);
let invalidImportsRejected=0;
for(const edit of [p=>{p.frame.direction=1},p=>{p.measurements.gauss8.areas[0]=null},p=>{p.referenceAudit.absoluteDifferences[0]=1},p=>{p.measurementMembershipEvaluations--},p=>{p.classification.revisedAreaGatePassed=false},p=>{p.inputsUnchanged=false},p=>{p.measuredFrames=10}]){
 const p=pilot();edit(p);assert.throws(()=>B.importPilot(Buffer.from(JSON.stringify(p)),hashes));invalidImportsRejected++;
}
const corrupt=fresh();corrupt[4]=clone(imported);corrupt[4].originalJsonBase64=Buffer.from('{}').toString('base64');assert.throws(()=>B.assemble(corrupt,hashes));
const altered=fresh();altered[4]=clone(imported);altered[4].measurements.gauss4.areas[0]*=1.01;assert.throws(()=>B.assemble(altered,hashes));
for(const order of [0,2,16,NaN,undefined])assert.throws(()=>B.measure(C.schedule[0],order));
console.log(JSON.stringify({unitChecksPassed:true,syntheticOnly:true,measuredFrames:0,invalidCollectionsRejected,invalidImportsRejected,legacyBytesCorruptionRejected:true,legacyMeasurementsTamperingRejected:true,partialScheduleRejected:true,fullScheduleMeasured:false,collisionChecksPerformed:false,movingK6StageAccepted:false}));
