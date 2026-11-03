'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process'),X=require('./world-irregular-k6-cap-compare.cjs');
const clone=x=>JSON.parse(JSON.stringify(x)),sources={synthetic:'a'.repeat(40)},methods=[['centre','centre'],['gauss4',4],['gauss8',8]],frame={width:360,height:180,time:0,direction:1};
function fresh(){
 const baseline={schema:'k6-fixed-area-batch-v3',index:0,frame:{...frame},origin:{kind:'measured'},references:Array(6).fill(0.1),policyId:'analytic-k6-dual-gauss-area-v1',measurements:{}},phases={};
 for(const [key,order] of methods){const n=360*180*6*(order==='centre'?1:order*order),m={order,areas:Array(6).fill(0.1),hitSamples:Array(6).fill(5),totalDomainWeight:4*Math.PI,elapsedMilliseconds:1};baseline.measurements[key]={...clone(m),membershipEvaluations:n};phases[key]={...clone(m),schema:'analytic-k6-cap-experiment-v1',frame:{...frame},culling:true,margin:1e-10,sourceBlobs:sources,implementationSHA256:'b'.repeat(64),exactMembershipEvaluations:100,culledMembershipEvaluations:n-100,boundingTests:n,naiveMembershipEvaluations:n};}
 return {baseline,phases};
}
let good=fresh();assert(X.compare(good.baseline,good.phases,sources).passed);
let mismatches=0;
for(const edit of [p=>{p.gauss4.areas[0]+=1e-12},p=>{p.gauss8.hitSamples[5]++},p=>{p.centre.totalDomainWeight+=1e-12}]){const f=fresh();edit(f.phases);assert(!X.compare(f.baseline,f.phases,sources).passed);mismatches++;}
let rejections=0;
for(const edit of [f=>{f.baseline.index=4},f=>{f.baseline.frame.time=0.25},f=>{f.baseline.measurements.centre.membershipEvaluations--},f=>{delete f.phases.gauss8},f=>{f.phases.gauss8.areas[0]=NaN},f=>{f.phases.centre.hitSamples.pop()},f=>{f.phases.gauss4.culling=false},f=>{f.phases.gauss4.sourceBlobs={}},f=>{f.phases.gauss8.implementationSHA256='c'.repeat(64)},f=>{f.phases.gauss4.exactMembershipEvaluations--},f=>{f.phases.gauss4.margin=1e-3},f=>{f.phases.gauss8.boundingTests--},f=>{f.phases.gauss4.elapsedMilliseconds=-1}]){const f=fresh();edit(f);assert.throws(()=>X.compare(f.baseline,f.phases,sources));rejections++;}
assert.throws(()=>X.checkDigest(Buffer.from('{}')),/digest mismatch/);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'k6-compare-preflight-'));
try{
 const script=path.join(__dirname,'world-irregular-k6-cap-compare.cjs'),output=path.join(temp,'output'),missing=path.join(temp,'missing.json');
 const absent=spawnSync(process.execPath,[script,'compare',missing,output],{encoding:'utf8',timeout:3000});assert.equal(absent.status,1);assert(absent.stderr.includes('ENOENT'));assert(!fs.existsSync(output));
 const bad=path.join(temp,'wrong.json');fs.writeFileSync(bad,'{}');const wrong=spawnSync(process.execPath,[script,'compare',bad,output],{encoding:'utf8',timeout:3000});assert.equal(wrong.status,1);assert(wrong.stderr.includes('digest mismatch'));assert(!fs.existsSync(output));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log(JSON.stringify({unitChecksPassed:true,syntheticOnly:true,canonicalFramesMeasured:0,rawMismatchControls:mismatches,structuralRejections:rejections,missingAndWrongDigestRejectedBeforeDependencyLoading:true,realBaselineAvailable:false,realComparisonRun:false,fullScheduleMeasured:false,movingK6StageAccepted:false}));
