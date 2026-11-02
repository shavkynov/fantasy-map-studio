'use strict';
const assert=require('assert/strict');
const TIMES=[0,0.25,0.5],WIDTHS=[360,720],NAMES=['grouped-control','split-02-plus'];
function compare(frames){
 assert.equal(frames.length,12);
 return NAMES.flatMap(name=>TIMES.map(time=>{
  const selected=frames.filter(f=>f.name===name&&f.time===time).sort((a,b)=>a.width-b.width);
  assert.deepEqual(selected.map(f=>f.width),WIDTHS);
  const [coarse,fine]=selected;
  for(const f of selected){assert.equal(f.height,f.width/2);assert.equal(f.centralMeridian,0);assert.equal(f.validSampledGeometry,f.overlapCells===0);}
  return {name,time,sameSampledValidity:coarse.validSampledGeometry===fine.validSampledGeometry,coarse:{width:coarse.width,overlapCells:coarse.overlapCells,overlapAreaFraction:coarse.overlapAreaFraction},fine:{width:fine.width,overlapCells:fine.overlapCells,overlapAreaFraction:fine.overlapAreaFraction}};
 }));
}
function unit(){
 const frames=NAMES.flatMap(name=>WIDTHS.flatMap(width=>TIMES.map(time=>({name,width,height:width/2,centralMeridian:0,time,overlapCells:0,overlapAreaFraction:0,validSampledGeometry:true}))));
 const before=JSON.stringify(frames);assert(compare(frames).every(c=>c.sameSampledValidity));assert.equal(JSON.stringify(frames),before);
 const changed=frames.map(f=>f.name==='split-02-plus'&&f.width===720&&f.time===0.25?{...f,overlapCells:4,overlapAreaFraction:0.001,validSampledGeometry:false}:f);
 assert.equal(compare(changed).filter(c=>!c.sameSampledValidity).length,1);
 assert.throws(()=>compare(frames.slice(1)));assert.throws(()=>compare(frames.map(f=>({...f,width:360}))));
 return true;
}
module.exports={compare,unit};
if(require.main===module){
 unit();
 if(process.argv.includes('--unit-only'))console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false}));
 else{
  const fs=require('fs'),path=require('path'),crypto=require('crypto'),F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js'),E=require('./world-k4-split-02.cjs'),P=require('./world-k4-pair-overlap.cjs');
  const load=(k,hash)=>F.load(path.join(__dirname,'fixtures/world-source/vondoran-227-k'+k+'.json'),hash);
  const parent=load(2,'f23e23e7c1bee7b68328dcc692bdded595e6c664862cb879109d9fbc6b0f6453'),child=load(4,'1bb053646f0b6746767ae2d1a93c90098cff17944126c76b6bcabb20952c31a6');
  const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'),before=hash([parent,child]),mapping=[0,1,0,1];
  assert.equal(parent.W,child.W);assert.equal(parent.H,child.H);
  for(let i=0;i<child.labels.length;i++)assert.equal(parent.labels[i],child.labels[i]<0?-1:mapping[child.labels[i]]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=v=>{const n=Math.hypot(...v);assert(n>1e-10);return v.map(x=>x/n);};
  const p=D.fromSource(parent),c=D.fromSource(child),[a,b]=p.fragments.map(f=>f.center),axis=norm(cross(a,b)),span=(Math.PI-p.sphere.angle(a,b))/4;
  const base=mapping.map(id=>({axis:axis.slice(),rate:(id===0?-1:1)*span/2,spin:0})),splitAxis=norm(cross(c.fragments[0].center,c.fragments[2].center)),frames=[],definitions=[];
  for(let sign=0;sign<=1;sign++){
   const name=NAMES[sign],motions=E.motionsFor(base,splitAxis,sign),motionBefore=hash(motions),world=D.fromSource(child,{motions});definitions.push({name,motions});
   for(const width of WIDTHS)for(const time of TIMES){
    const snapshot=world.snapshot(time,{width,height:width/2,centralMeridian:0}),r=P.summarize(P.reconstruct(world,snapshot),snapshot);
    if(sign===0||time===0)assert(r.validSampledGeometry,'Control/initial snapshot overlaps');
    frames.push({name,time,width,height:width/2,centralMeridian:0,overlapCells:r.overlapUnionCells,overlapAreaFraction:r.overlapUnionSphereFraction,multiplicityCells:r.multiplicityCells,pairCells:r.pairs.map(p=>p.cells),pairSphereFractions:r.pairs.map(p=>p.sphereFraction),validSampledGeometry:r.validSampledGeometry,reasons:r.reasons});
   }
   assert.equal(hash(motions),motionBefore);
  }
  const comparisons=compare(frames);assert.equal(hash([parent,child]),before);assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
  const report={unitChecksPassed:true,integrationRun:true,sources:2,snapshots:12,sourceInputsUnchanged:true,motionInputsUnchanged:true,generatorImported:false,times:TIMES,widths:WIDTHS,centralMeridian:0,definitions,pairOrder:['01','02','03','12','13','23'],frames,comparisons,scope:'Fixed two-grid diagnostic, same split-02 motions; no convergence proof, speed search, frame choice or app integration.'};
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});const jsonFile=path.join(dir,'k4-resolution-'+Date.now()+'.json');
  fs.writeFileSync(jsonFile,JSON.stringify(report,null,2),{encoding:'utf8',flag:'wx'});assert(fs.statSync(jsonFile).size>0);
  console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,sources:2,snapshots:12,sourceInputsUnchanged:true,motionInputsUnchanged:true,generatorImported:false,jsonFile,summary:comparisons},null,2));
 }
}
