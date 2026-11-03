'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'k6-batch-io-'));
const files=['src/world-domain.js','tools/world-irregular-k4-static.cjs','tools/world-irregular-k6-static.cjs','tools/world-irregular-k6-poses.cjs','tools/world-irregular-k6-area.cjs','tools/world-irregular-k6-area-policy.cjs','tools/world-irregular-k6-area-pilot.cjs','tools/world-irregular-k6-area-batch.cjs'];
const runner='tools/world-irregular-k6-area-batch.cjs';
function cli(args){const r=spawnSync(process.execPath,[runner,...args],{cwd:temp,encoding:'utf8',timeout:10000});assert(!r.error,String(r.error));assert.equal(r.signal,null);return r;}
function json(dir,name,value){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),JSON.stringify(value),{flag:'wx'});}
try{
 for(const f of files){const target=path.join(temp,f);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,f),target);}
 const B=require(path.join(temp,runner)),C=require(path.join(temp,'tools/world-irregular-k6-area-policy.cjs')),P=require(path.join(temp,'tools/world-irregular-k6-static.cjs'));
 const hashes=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(temp,f))).digest('hex')]));
 assert.equal(cli(['plan']).status,0);
 const parent=path.join(temp,'tools/world-irregular-k4-static.cjs'),bytes=fs.readFileSync(parent);
 try{fs.appendFileSync(parent,'\n// dependency fingerprint regression probe\n');const bad=cli(['plan']);assert.equal(bad.status,1);assert(bad.stderr.includes('pinned source changed: tools/world-irregular-k4-static.cjs'));}finally{fs.writeFileSync(parent,bytes);}
 assert.equal(cli(['plan']).status,0);
 const methods=[['centre','centre'],['gauss4',4],['gauss8',8]];
 const fresh=()=>C.schedule.map((f,index)=>B.make(index,Object.fromEntries(methods.map(([name,order])=>[name,{order,areas:P.reference(),hitSamples:Array(6).fill(0),totalDomainWeight:4*Math.PI,membershipEvaluations:f.width*f.height*6*(order==='centre'?1:order*order),elapsedMilliseconds:0}])),{kind:'measured'},hashes));
 const input=path.join(temp,'complete'),output=path.join(temp,'summary');
 for(const r of fresh())json(input,'frame-'+r.index+'-synthetic.json',r);
 const complete=cli(['assemble',input,output]);assert.equal(complete.status,0,complete.stderr);
 const first=JSON.parse(complete.stdout);assert.equal(first.pieceFrameChecks,60);assert.equal(first.fullScheduleMeasured,true);assert.equal(first.movingK6StageAccepted,false);
 const saved=fs.readFileSync(first.file);assert(saved.length>0);
 const again=cli(['assemble',input,output]);assert.equal(again.status,0);assert.equal(fs.readdirSync(output).length,2);assert.deepEqual(fs.readFileSync(first.file),saved);
 const partial=path.join(temp,'partial'),partialOut=path.join(temp,'partial-summary');
 for(const r of fresh().slice(0,9))json(partial,'frame-'+r.index+'-synthetic.json',r);
 assert.equal(cli(['assemble',partial,partialOut]).status,1);assert(!fs.existsSync(partialOut));
 const duplicates=path.join(temp,'duplicates'),dupOut=path.join(temp,'duplicate-summary'),records=fresh();records[9]=records[0];
 records.forEach((r,i)=>json(duplicates,'frame-'+r.index+'-synthetic-'+i+'.json',r));
 assert.equal(cli(['assemble',duplicates,dupOut]).status,1);assert(!fs.existsSync(dupOut));
 const failed=path.join(temp,'failed'),failedOut=path.join(temp,'failed-summary'),badRecords=fresh();badRecords[0].measurements.gauss8.areas[0]*=1.04;
 for(const r of badRecords)json(failed,'frame-'+r.index+'-synthetic.json',r);
 const failure=cli(['assemble',failed,failedOut]);assert.equal(failure.status,1);const failureSummary=JSON.parse(failure.stdout);assert.equal(failureSummary.revisedAreaChecksPassed,false);assert(fs.statSync(failureSummary.file).size>0);
 const r=fresh()[4],legacy={areaPilotRun:true,unitChecksPassed:true,inputsUnchanged:true,measuredFrames:1,criterionRevised:true,geometryMode:'analytic-k6-one-frame-area-pilot',fullScheduleMeasured:false,integrationRun:false,collisionChecksPerformed:false,movingK6StageAccepted:false,frozenFixtureIntegrationRun:false,visualAccepted:false,appIntegrated:false,policyId:C.policy.id,frame:r.frame,references:r.references,measurements:r.measurements,classification:B.validate(r,hashes).classification,measurementMembershipEvaluations:Object.values(r.measurements).reduce((n,m)=>n+m.membershipEvaluations,0),referenceAudit:{pieceId:2,originalFocused:methods.map(([name])=>({area:r.measurements[name].areas[2]})),absoluteDifferences:[0,0,0]}};
 const legacyFile=path.join(temp,'legacy-synthetic.json'),mixed=path.join(temp,'mixed'),mixedOut=path.join(temp,'mixed-summary');fs.writeFileSync(legacyFile,JSON.stringify(legacy),{flag:'wx'});
 const imported=cli(['import-pilot',legacyFile,mixed]);assert.equal(imported.status,0,imported.stderr);assert.equal(JSON.parse(imported.stdout).newlyMeasuredFrames,0);
 for(const item of fresh().filter(item=>item.index!==4))json(mixed,'frame-'+item.index+'-synthetic.json',item);
 assert.equal(cli(['assemble',mixed,mixedOut]).status,0);
 assert.equal(cli([]).status,1);assert.equal(cli(['frame','10','unused']).status,1);assert.equal(cli(['frame','all','unused']).status,1);assert(!fs.existsSync(path.join(temp,'unused')));
 console.log(JSON.stringify({unitChecksPassed:true,syntheticOnly:true,measuredFrames:0,parentDependencyEditRejected:true,exclusiveResultsPreserved:true,partialAndDuplicateCollectionsRejected:true,failedGateReportPreserved:true,legacyImportCliPassed:true,mixedAssemblyCliPassed:true,fullScheduleMeasured:false,collisionChecksPerformed:false,movingK6StageAccepted:false}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
