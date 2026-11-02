'use strict';
const assert=require('assert/strict'),{createSphere}=require('../src/world-domain.js');
const S=createSphere({radiusKm:1}),EPS=1e-12,H=1e-5;
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=v=>{const n=Math.hypot(...v);assert(n>1e-10&&v.every(Number.isFinite));return v.map(x=>x/n);};
function edges(source){
 const {W,H:height,labels}=source;assert(Number.isInteger(W)&&Number.isInteger(height)&&W>=2&&height>=2&&W*height<=1000000);assert.equal(labels.length,W*height);assert(Array.from(labels).every(x=>Number.isInteger(x)&&x>=-1&&x<4));
 const out=[];
 function add(i,j,type,u,v){
  if(!((labels[i]===0&&labels[j]===2)||(labels[i]===2&&labels[j]===0)))return;
  const point=S.fromLonLat(u*2*Math.PI-Math.PI,Math.asin(1-2*v)),ll=S.toLonLat(point),sign=labels[i]===0?1:-1;
  const n=type==='longitude'?[-Math.sin(ll.lon),Math.cos(ll.lon),0]:[Math.sin(ll.lat)*Math.cos(ll.lon),Math.sin(ll.lat)*Math.sin(ll.lon),-Math.cos(ll.lat)];
  const normal=n.map(x=>sign*x);assert(Math.abs(dot(point,normal))<1e-12&&Math.abs(Math.hypot(...normal)-1)<1e-12);
  out.push({edge:out.length,type,cell0:labels[i]===0?i:j,cell2:labels[i]===2?i:j,u,v,point,normal});
 }
 for(let y=0;y<height;y++)for(let x=0;x<W;x++){
  const i=y*W+x;add(i,y*W+(x+1)%W,'longitude',(x+1)/W,(y+0.5)/height);
  if(y+1<height)add(i,i+W,'latitude',(x+0.5)/W,(y+1)/height);
 }
 return out;
}
function omega(m){assert(m.spin===0&&Number.isFinite(m.rate)&&m.axis.length===3&&m.axis.every(Number.isFinite));assert(Math.abs(Math.hypot(...m.axis)-1)<1e-12);return m.axis.map(x=>x*m.rate);}
function normalRate(point,normal,w0,w2){return dot(cross(w2.map((x,i)=>x-w0[i]),point),normal);}
function analyse(boundary,motions){
 assert(boundary.length>0&&motions.length===4);motions.forEach(omega);const w0=omega(motions[0]),w2=omega(motions[2]),counts={opening:0,closing:0,neutral:0};let maxFiniteDifferenceError=0;
 const rows=boundary.map(e=>{
  const rate=normalRate(e.point,e.normal,w0,w2);assert(Number.isFinite(rate));const classification=rate>EPS?'opening':rate< -EPS?'closing':'neutral';counts[classification]++;
  const f=t=>{const a=S.apply(S.axisRotation(motions[0].axis,motions[0].rate*t),e.point),b=S.apply(S.axisRotation(motions[2].axis,motions[2].rate*t),e.point);return dot(b.map((x,i)=>x-a[i]),e.normal);};
  const finiteDifference=(f(H)-f(-H))/(2*H),error=Math.abs(rate-finiteDifference);assert(error<1e-8);maxFiniteDifferenceError=Math.max(maxFiniteDifferenceError,error);
  return {...e,normalRate:rate,classification,finiteDifference};
 });
 assert.equal(counts.opening+counts.closing+counts.neutral,boundary.length);
 return {counts,minNormalRate:Math.min(...rows.map(e=>e.normalRate)),maxNormalRate:Math.max(...rows.map(e=>e.normalRate)),maxFiniteDifferenceError,rows};
}
function unit(){
 const s={W:4,H:2,labels:[0,2,-1,-1,2,2,-1,-1]},before=JSON.stringify(s),e=edges(s);assert.equal(e.length,2);assert.deepEqual(e.map(x=>x.type),['longitude','latitude']);assert.equal(JSON.stringify(s),before);
 const seam=edges({W:4,H:2,labels:[0,-1,-1,2,-1,-1,-1,-1]});assert.equal(seam.length,1);assert.equal(seam[0].cell0,0);assert.equal(seam[0].cell2,3);
 assert.equal(edges({W:4,H:3,labels:[0,-1,-1,-1,-1,-1,-1,-1,2,-1,-1,-1]}).length,0);
 const reversed=edges({...s,labels:s.labels.map(x=>x===0?2:x===2?0:x)});e.forEach((edge,i)=>assert(Math.hypot(...edge.normal.map((x,j)=>x+reversed[i].normal[j]))<1e-12));
 assert.equal(normalRate([1,0,0],[0,1,0],[0,0,0],[0,0,1]),1);assert.equal(normalRate([1,0,0],[0,1,0],[0,0,1],[0,0,0]),-1);
 const motions=Array.from({length:4},()=>({axis:[0,0,1],rate:0.2,spin:0}));assert.equal(analyse(e,motions).counts.neutral,2);
 const original=JSON.stringify(e);motions[2]={axis:[0,0,1],rate:0.3,spin:0};const r=analyse(e,motions);assert(r.maxFiniteDifferenceError<1e-8);assert.equal(JSON.stringify(e),original);
 assert.throws(()=>analyse([] ,motions));assert.throws(()=>omega({axis:[0,0,1],rate:0.2,spin:0.1}));assert.throws(()=>edges({...s,labels:[0]}));return true;
}
module.exports={edges,normalRate,analyse,unit};
if(require.main===module){
 unit();
 if(process.argv.includes('--unit-only'))console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false}));
 else{
  const fs=require('fs'),path=require('path'),crypto=require('crypto'),F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js'),E=require('./world-k4-split-02.cjs');
  const load=(k,hash)=>F.load(path.join(__dirname,'fixtures/world-source/vondoran-227-k'+k+'.json'),hash);
  const parent=load(2,'f23e23e7c1bee7b68328dcc692bdded595e6c664862cb879109d9fbc6b0f6453'),child=load(4,'1bb053646f0b6746767ae2d1a93c90098cff17944126c76b6bcabb20952c31a6'),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'),before=hash([parent,child]);
  const mapping=[0,1,0,1];assert.equal(parent.W,child.W);assert.equal(parent.H,child.H);for(let i=0;i<child.labels.length;i++)assert.equal(parent.labels[i],child.labels[i]<0?-1:mapping[child.labels[i]]);
  const p=D.fromSource(parent),c=D.fromSource(child),[a,b]=p.fragments.map(f=>f.center),axis=norm(cross(a,b)),span=(Math.PI-S.angle(a,b))/4,splitAxis=norm(cross(c.fragments[0].center,c.fragments[2].center)),base=mapping.map(id=>({axis:axis.slice(),rate:(id===0?-1:1)*span/2,spin:0})),boundary=edges(child);
  const cases=[0,1].map(sign=>{const motions=E.motionsFor(base,splitAxis,sign),before=hash(motions),result=analyse(boundary,motions);assert.equal(hash(motions),before);if(sign===0)assert.equal(result.counts.neutral,boundary.length);return {name:sign?'split-02-plus':'grouped-control',motions,...result};});
  assert.equal(hash([parent,child]),before);assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
  const report={unitChecksPassed:true,integrationRun:true,sources:2,sourceInputsUnchanged:true,motionInputsUnchanged:true,generatorImported:false,pair:[0,2],time:0,sourceGrid:{width:child.W,height:child.H,projection:'cylindrical-equal-area'},edgeCount:boundary.length,rateEpsilon:EPS,finiteDifferenceStep:H,cases,scope:'Initial shared-source-edge midpoint velocities only, not a collision detector, complete boundary proof, new geography metric or motion change.'};
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});const jsonFile=path.join(dir,'k4-boundary-02-'+Date.now()+'.json');fs.writeFileSync(jsonFile,JSON.stringify(report,null,2),{encoding:'utf8',flag:'wx'});assert(fs.statSync(jsonFile).size>0);
  console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,sources:2,sourceInputsUnchanged:true,motionInputsUnchanged:true,generatorImported:false,edgeCount:boundary.length,jsonFile,summary:cases.map(({name,counts,minNormalRate,maxNormalRate,maxFiniteDifferenceError})=>({name,counts,minNormalRate,maxNormalRate,maxFiniteDifferenceError}))},null,2));
 }
}
