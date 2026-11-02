'use strict';
const assert=require('assert/strict'),{createSphere}=require('../src/world-domain.js');
const S=createSphere(),DELTA=0.02,TIMES=[0,0.25,0.5,0.75,1];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalized=v=>{const n=Math.hypot(...v);assert(n>1e-10&&v.every(Number.isFinite));return v.map(x=>x/n);};
const omega=m=>m.axis.map(x=>x*m.rate),near=(a,b)=>assert(Math.hypot(...a.map((x,i)=>x-b[i]))<1e-12);
function motionsFor(base,splitAxis,sign){
 assert([-1,0,1].includes(sign));const n=normalized(splitAxis);
 const motions=base.map((m,id)=>{
  const w=omega(m).map((x,j)=>x+(id===0?-sign:id===2?sign:0)*DELTA*n[j]),rate=Math.hypot(...w);
  assert(rate>1e-10);return {axis:w.map(x=>x/rate),rate,spin:0};
 });
 near(omega(motions[1]),omega(base[1]));near(omega(motions[3]),omega(base[3]));
 near(omega(motions[0]).map((x,i)=>x+omega(motions[2])[i]),omega(base[0]).map((x,i)=>x+omega(base[2])[i]));
 return motions;
}
function unit(){
 const base=[0,1,0,1].map(id=>({axis:[0,0,1],rate:id?-0.2:0.2,spin:0})),before=JSON.stringify(base);
 const plus=motionsFor(base,[0,1,0],1),minus=motionsFor(base,[0,1,0],-1),control=motionsFor(base,[0,1,0],0);
 near(omega(plus[0]),[0,-DELTA,0.2]);near(omega(plus[2]),[0,DELTA,0.2]);near(omega(minus[0]),omega(plus[2]));
 control.forEach((m,i)=>near(omega(m),omega(base[i])));assert.equal(JSON.stringify(base),before);
 assert.throws(()=>motionsFor(base,[0,0,0],1));assert.throws(()=>motionsFor(base,[0,1,0],2));
 const a=[1,0,0],b=[0,1,0],axis=normalized(cross(a,b)),t=1e-4;
 assert(S.angle(S.apply(S.axisRotation(axis,-DELTA*t),a),S.apply(S.axisRotation(axis,DELTA*t),b))>S.angle(a,b));
 const html=overview([{name:'unit',frames:[{snapshot:{width:2,height:1,coverage:[0,2],owner:[-1,-2]},report:{time:0,overlapUnionCells:1,validSampledGeometry:false}}]}]);
 assert(html.includes('НЕ КАНДИДАТ')&&html.includes('#ff00b7'));assert.equal((html.match(/<svg /g)||[]).length,1);
 return true;
}
function overview(rows){
 const colors=['#d69455','#8ac18b','#d4c56e','#b695d4'];
 return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>K4: один эксперимент 0–2</title><style>body{font:14px system-ui;background:#101820;color:#eef2f5;margin:20px}.row{display:grid;grid-template-columns:repeat(5,minmax(180px,1fr));gap:8px;max-width:1400px;min-width:950px}svg{width:100%}article{border:1px solid #65717e;padding:4px}h3{font-size:13px}</style><h1>K4: контроль и два знака изменения пары 0–2</h1><p>360×180, meridian=0; три строки, времена 0,0.25,0.5,0.75,1. Цвета — фрагменты, розовый — overlap. Допустимость только растровая: все кадры НЕ ПРИНЯТЫ. Это не четыре независимых движения: пара 1–3 связана. Нет выбора победителя.</p>'+rows.map(row=>'<h2>'+row.name+'</h2><div class="row">'+row.frames.map(({snapshot:s,report:r})=>{
  let rects='';const color=i=>s.coverage[i]>1?'#ff00b7':s.coverage[i]?colors[s.owner[i]]:'#172b42';
  for(let y=0;y<s.height;y++)for(let x=0;x<s.width;){const fill=color(y*s.width+x);let end=x+1;while(end<s.width&&color(y*s.width+end)===fill)end++;rects+='<rect x="'+x+'" y="'+y+'" width="'+(end-x)+'" height="1" fill="'+fill+'"/>';x=end;}
  return '<article><h3>t='+r.time+'; overlap='+r.overlapUnionCells+'; '+(r.validSampledGeometry?'допустим, не принят':'НЕ КАНДИДАТ')+'</h3><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180" shape-rendering="crispEdges">'+rects+'</svg></article>';
 }).join('')+'</div>').join('')+'</html>';
}
module.exports={motionsFor,unit,overview};
if(require.main===module){
 unit();
 if(process.argv.includes('--unit-only'))console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false}));
 else{
  const fs=require('fs'),path=require('path'),crypto=require('crypto'),F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js'),P=require('./world-k4-pair-overlap.cjs');
  const load=(k,hash)=>F.load(path.join(__dirname,'fixtures/world-source/vondoran-227-k'+k+'.json'),hash);
  const parent=load(2,'f23e23e7c1bee7b68328dcc692bdded595e6c664862cb879109d9fbc6b0f6453'),child=load(4,'1bb053646f0b6746767ae2d1a93c90098cff17944126c76b6bcabb20952c31a6');
  const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'),before=hash([parent,child]),mapping=[0,1,0,1];
  assert.equal(parent.W,child.W);assert.equal(parent.H,child.H);
  for(let i=0;i<child.labels.length;i++)assert.equal(parent.labels[i],child.labels[i]<0?-1:mapping[child.labels[i]]);
  const p=D.fromSource(parent),c=D.fromSource(child),[a,b]=p.fragments.map(f=>f.center),parentAxis=normalized(cross(a,b)),span=(Math.PI-S.angle(a,b))/4;
  const base=mapping.map(id=>({axis:parentAxis.slice(),rate:(id===0?-1:1)*span/2,spin:0})),centers=[c.fragments[0].center,c.fragments[2].center],splitAxis=normalized(cross(...centers));
  const rows=[{name:'grouped-control',sign:0},{name:'split-02-plus',sign:1},{name:'split-02-minus',sign:-1}].map(({name,sign})=>{
   const motions=motionsFor(base,splitAxis,sign),motionBefore=hash(motions),world=D.fromSource(child,{motions}),probe=1e-4;
   const distance=t=>S.angle(...centers.map((v,i)=>S.apply(world.pose(i===0?0:2,t),v)));
   if(sign)assert(sign*(distance(probe)-distance(0))>1e-7,'Unexpected initial split direction');
   const frames=TIMES.map(time=>{
    const snapshot=world.snapshot(time,{width:360,height:180,centralMeridian:0}),report=P.summarize(P.reconstruct(world,snapshot),snapshot);
    if(!sign||time===0)assert(report.validSampledGeometry,'Control/initial frame overlaps');
    const relative=S.compose(S.inverse(world.pose(1,time)),world.pose(3,time));assert(Math.hypot(relative[1],relative[2],relative[3])<1e-12);
    return {snapshot,report};
   });
   assert.equal(hash(motions),motionBefore);return {name,sign,motions,probeCenterAngleChange:distance(probe)-distance(0),frames};
  });
  assert.equal(hash([parent,child]),before);assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
  const report={deltaRadiansPerTime:DELTA,splitAxis,probeTime:1e-4,initialCenterAngleRadians:S.angle(...centers),times:TIMES,pairOrder:['01','02','03','12','13','23'],rows:rows.map(row=>({name:row.name,sign:row.sign,motions:row.motions,probeCenterAngleChange:row.probeCenterAngleChange,frames:row.frames.map(({report:r})=>({time:r.time,overlapCells:r.overlapUnionCells,overlapAreaFraction:r.overlapUnionSphereFraction,pairCells:r.pairs.map(p=>p.cells),multiplicityCells:r.multiplicityCells,validSampledGeometry:r.validSampledGeometry,reasons:r.reasons}))}))};
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});const stem=path.join(dir,'k4-split-02-'+Date.now()),jsonFile=stem+'.json',htmlFile=stem+'.html';
  fs.writeFileSync(jsonFile,JSON.stringify(report,null,2),{encoding:'utf8',flag:'wx'});fs.writeFileSync(htmlFile,overview(rows),{encoding:'utf8',flag:'wx'});
  assert(fs.statSync(jsonFile).size>0&&fs.statSync(htmlFile).size>0);
  console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,sources:2,scenarios:3,snapshots:15,sourceInputsUnchanged:true,motionInputsUnchanged:true,generatorImported:false,jsonFile,htmlFile,summary:report.rows.map(row=>({name:row.name,positiveValidFrames:row.frames.filter(f=>f.time>0&&f.validSampledGeometry).length,overlapCells:row.frames.map(f=>f.overlapCells)})),scope:'Single 0–2 perturbation of grouped control; 1–3 locked, no four-fragment solution or automatic frame acceptance.'},null,2));
 }
}
