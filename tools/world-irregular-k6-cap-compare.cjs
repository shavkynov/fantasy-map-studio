'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const expectedBaselineSHA256='baefd8b6b012c537be748b39f9d9a38357816170509ba6ef502773107471f108';
const files=['src/world-domain.js','tools/world-irregular-k4-static.cjs','tools/world-irregular-k6-static.cjs','tools/world-irregular-k6-poses.cjs','tools/world-irregular-k6-area.cjs','tools/world-irregular-k6-area-policy.cjs','tools/world-irregular-k6-area-pilot.cjs','tools/world-irregular-k6-area-batch.cjs'];
const methods=[['centre','centre'],['gauss4',4],['gauss8',8]],frame={width:360,height:180,time:0,direction:1};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function checkDigest(bytes){assert.equal(sha(bytes),expectedBaselineSHA256,'saved frame0 JSON digest mismatch; no computation');}
function vector(values,test){assert(Array.isArray(values)&&values.length===6&&Array.from(values).every(test));}
function common(m,order){
 const count=360*180*(order==='centre'?1:order*order);
 assert.equal(m.order,order);vector(m.areas,v=>Number.isFinite(v)&&v>=0&&v<=4*Math.PI);vector(m.hitSamples,v=>Number.isSafeInteger(v)&&v>=0&&v<=count);
 assert(Number.isFinite(m.totalDomainWeight)&&Math.abs(m.totalDomainWeight-4*Math.PI)<1e-10);
 assert(Number.isFinite(m.elapsedMilliseconds)&&m.elapsedMilliseconds>=0);return count*6;
}
function validateBaseline(r){
 assert.equal(r.schema,'k6-fixed-area-batch-v3');assert.equal(r.index,0);assert.deepEqual(r.frame,frame);assert.equal(r.origin.kind,'measured');
 vector(r.references,v=>Number.isFinite(v)&&v>0);assert.equal(r.policyId,'analytic-k6-dual-gauss-area-v1');
 assert.deepEqual(Object.keys(r.measurements).sort(),['centre','gauss4','gauss8']);
 for(const [key,order] of methods)assert.equal(r.measurements[key].membershipEvaluations,common(r.measurements[key],order));
}
function manifest(root){return Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]));}
function compare(r,phases,sourceBlobs){
 validateBaseline(r);assert.deepEqual(Object.keys(phases).sort(),['centre','gauss4','gauss8']);
 const results=[];let implementation;
 for(const [key,order] of methods){
  const slow=r.measurements[key],fast=phases[key],naive=common(fast,order);
  assert.equal(fast.schema,'analytic-k6-cap-experiment-v1');assert.deepEqual(fast.frame,frame);assert.equal(fast.culling,true);assert.equal(fast.margin,1e-10);
  assert.deepEqual(fast.sourceBlobs,sourceBlobs);assert(/^[0-9a-f]{64}$/.test(fast.implementationSHA256));
  if(implementation===undefined)implementation=fast.implementationSHA256;else assert.equal(fast.implementationSHA256,implementation);
  for(const k of ['exactMembershipEvaluations','culledMembershipEvaluations','boundingTests','naiveMembershipEvaluations'])assert(Number.isSafeInteger(fast[k])&&fast[k]>=0);
  assert.equal(fast.naiveMembershipEvaluations,naive);assert.equal(fast.boundingTests,naive);assert.equal(fast.exactMembershipEvaluations+fast.culledMembershipEvaluations,naive);
  const areaDifferences=fast.areas.map((v,id)=>Math.abs(v-slow.areas[id]));
  results.push({method:key,areaDifferences,areasExactlyEqual:areaDifferences.every(v=>v===0),hitCountsExactlyEqual:fast.hitSamples.every((v,id)=>v===slow.hitSamples[id]),domainWeightExactlyEqual:fast.totalDomainWeight===slow.totalDomainWeight});
 }
 return {passed:results.every(r=>r.areasExactlyEqual&&r.hitCountsExactlyEqual&&r.domainWeightExactlyEqual),methods:results};
}
function save(dir,report){fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'k6-cap-frame0-compare-'+Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});assert(fs.statSync(file).size>0);return file;}
function main(args){
 const [mode,baselinePath,outDir]=args;assert(mode==='preflight'||mode==='compare','preflight BASELINE_JSON | compare BASELINE_JSON OUTPUT_DIR');
 assert.equal(args.length,mode==='preflight'?2:3);assert(baselinePath);
 const bytes=fs.readFileSync(baselinePath);checkDigest(bytes);const baseline=JSON.parse(bytes.toString('utf8'));validateBaseline(baseline);
 const root=path.resolve(__dirname,'..'),before=manifest(root);assert.deepEqual(baseline.hashes,before,'baseline source hashes differ; no computation');
 const B=require('./world-irregular-k6-area-batch.cjs'),F=require('./world-irregular-k6-cap.cjs'),C=require('./world-irregular-k6-area-policy.cjs');
 const sourceBlobs=F.sourceHashes(),baselineClassification=B.validate(baseline,before).classification;
 const implementationSHA256=sha(fs.readFileSync(path.join(__dirname,'world-irregular-k6-cap.cjs')));
 if(mode==='preflight'){console.log(JSON.stringify({preflightPassed:true,baselineSHA256:sha(bytes),implementationSHA256,measuredFrames:0}));return;}
 const phases={},report={schema:'k6-cap-frame0-comparison-v1',baselineSHA256:sha(bytes),baselineOriginalJsonBase64:bytes.toString('base64'),sourceHashes:before,implementationSHA256,comparisonToolSHA256:sha(fs.readFileSync(__filename)),acceleratedPhases:phases,baselineClassification,fullScheduleMeasured:false,collisionChecksPerformed:false,movingK6StageAccepted:false,integrationRun:false};
 let error;
 try{
  for(const [key,order] of methods){phases[key]=F.measure(frame,order,true);assert.equal(phases[key].implementationSHA256,implementationSHA256);}
  assert.deepEqual(manifest(root),before);assert.deepEqual(fs.readFileSync(baselinePath),bytes,'baseline changed during comparison');
  assert.equal(sha(fs.readFileSync(path.join(__dirname,'world-irregular-k6-cap.cjs'))),implementationSHA256);
  report.comparison=compare(baseline,phases,sourceBlobs);
  const errors=key=>phases[key].areas.map((v,id)=>Math.abs(v/baseline.references[id]-1));
  report.acceleratedClassification=C.evaluateFrame({...frame,areaTolerance:C.policy.tolerance,quadratureOrders:[4,8],pieceIds:[0,1,2,3,4,5],centreErrors:errors('centre'),gauss4Errors:errors('gauss4'),gauss8Errors:errors('gauss8')});
 }catch(e){error=e;report.comparisonError=e.message;}
 report.completedMethods=Object.keys(phases).length;report.comparisonPassed=!error&&report.comparison.passed;
 const file=save(outDir,report);console.log(JSON.stringify({file,completedMethods:report.completedMethods,comparisonPassed:report.comparisonPassed,fullScheduleMeasured:false,collisionChecksPerformed:false,movingK6StageAccepted:false}));
 if(error)throw error;assert(report.comparisonPassed,'raw equivalence failed; evidence saved');assert(report.acceleratedClassification.revisedAreaGatePassed,'area gate failed; evidence saved');
}
module.exports={compare,validateBaseline,checkDigest,expectedBaselineSHA256};
if(require.main===module)try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
