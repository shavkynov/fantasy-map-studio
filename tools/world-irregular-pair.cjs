'use strict';
const assert=require('assert/strict'),{createSphere}=require('../src/world-domain.js'),B=require('./world-separable-pair.cjs'),{assess}=require('./world-frame-validity.cjs');
const S=createSphere({radiusKm:1});
function create(options={}){
 const base=B.create(options),radius=phi=>base.alpha*(0.8+0.12*Math.sin(3*phi)+0.08*Math.cos(5*phi));
 function reference(n){
  assert(Number.isInteger(n)&&n>0&&n%2===0);
  return [Math.PI/2,-Math.PI/2].map(start=>{const step=Math.PI/n;let sum=0;for(let k=0;k<=n;k++)sum+=(k===0||k===n?1:k%2?4:2)*(1-Math.cos(radius(start+k*step)));return sum*step/3;});
 }
 const coarse=reference(4096),pieceAreas=Object.freeze(reference(8192)),quadratureDifferences=pieceAreas.map((a,i)=>Math.abs(a-coarse[i]));assert(quadratureDifferences.every(e=>e<1e-10));
 const inside=(id,p)=>p[0]>=Math.cos(radius(Math.atan2(p[2],p[1])))&&(id===0?p[1]<0:p[1]>=0);
 const contains=(id,p,time,direction=1)=>inside(id,S.apply(S.inverse(base.pose(id,time,direction)),p));
 function snapshot(time,width=360,direction=1){
  assert(Number.isInteger(width)&&width>=16&&width<=2048&&width%2===0);const height=width/2,coverage=new Uint8Array(width*height),owner=new Int16Array(width*height).fill(-1),areas=[0,0],inverse=[0,1].map(id=>S.inverse(base.pose(id,time,direction)));
  let overlapCells=0,overlapArea=0;
  for(let y=0;y<height;y++){
   const lat=Math.PI/2-(y+0.5)/height*Math.PI,c=Math.cos(lat),z=Math.sin(lat),weight=S.cellAreaKm2(width,height,y);
   for(let x=0;x<width;x++){
    const lon=(x+0.5)/width*2*Math.PI-Math.PI,p=[c*Math.cos(lon),c*Math.sin(lon),z],i=y*width+x;
    for(let id=0;id<2;id++)if(inside(id,S.apply(inverse[id],p))){coverage[i]++;owner[i]=coverage[i]===1?id:-2;areas[id]+=weight;}
    if(coverage[i]>1){overlapCells++;overlapArea+=weight;}
   }
  }
  return {time,width,height,direction,centralMeridian:0,coverage,owner,rasterPieceAreas:areas,relativeReferenceAreaErrors:areas.map((a,i)=>Math.abs(a/pieceAreas[i]-1)),diagnostics:{overlapCells,overlapAreaFraction:overlapArea/S.totalAreaKm2,validSampledGeometry:overlapCells===0}};
 }
 return Object.freeze({alpha:base.alpha,rate:base.rate,maxTime:base.maxTime,pose:base.pose,bounds:base.bounds,radius,reference,pieceAreas,quadratureDifferences,contains,snapshot});
}
function unit(){
 B.unit();const options={alpha:0.65},before=JSON.stringify(options),m=create(options);
 assert(Math.abs(m.radius(0)-m.radius(Math.PI))>0.05);assert(Math.abs(m.pieceAreas[0]-m.pieceAreas[1])>1e-4);
 for(let k=0;k<1000;k++){const phi=k/1000*2*Math.PI;assert(m.radius(phi)>=0.6*m.alpha-1e-12&&m.radius(phi)<=m.alpha+1e-12);assert(Math.abs(m.radius(phi)-m.radius(phi+2*Math.PI))<1e-12);}
 for(const a of m.pieceAreas)assert(a>=Math.PI*(1-Math.cos(0.6*m.alpha))&&a<=Math.PI*(1-Math.cos(m.alpha)));
 for(const time of [0,0.5,1])for(let id=0;id<2;id++){
  const phi=id===0?Math.PI:0,point=[Math.cos(0.2),Math.sin(0.2)*Math.cos(phi),Math.sin(0.2)*Math.sin(phi)],moved=S.apply(m.pose(id,time),point),back=S.apply(S.inverse(m.pose(id,time)),moved);
  assert(S.angle(point,back)<1e-12);assert(m.contains(id,moved,time));if(time)assert(m.bounds(time)[0].max<m.bounds(time)[1].min);
 }
 assert(!m.contains(0,[1,0,0],0)&&m.contains(1,[1,0,0],0));assert(m.contains(0,[1,0,0],0.25,-1)&&m.contains(1,[1,0,0],0.25,-1));
 const html=overview([{width:360,height:1,coverage:Array(360).fill(2),owner:Array(360).fill(-2),time:0.25,direction:-1,diagnostics:{overlapCells:360}}]);assert(html.includes('НЕ КАНДИДАТ')&&html.includes('#ff00b7'));
 assert.equal(JSON.stringify(options),before);assert.throws(()=>m.reference(3));return true;
}
function overview(frames){
 return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Неровный контур: разъединяемая пара</title><style>body{font:14px system-ui;background:#101820;color:#eef2f5;margin:20px}.grid{display:grid;grid-template-columns:repeat(2,minmax(320px,1fr));gap:12px;max-width:1200px}h2{font-size:16px}svg{width:100%}</style><h1>Неровный аналитический контур — НЕ K4 и НЕ принятая география</h1><p>Внешний берег неровный, общая граница — меридиан. Половинки жёсткие, площадь каждой постоянна. Исходные маски/фикстуры не меняются. Розовый — пересечение отрицательного контроля. Это ещё не генератор естественных материков.</p><div class="grid">'+frames.filter(s=>s.width===360).map(s=>{
  let rects='';const color=i=>s.coverage[i]>1?'#ff00b7':s.owner[i]===0?'#8ac18b':s.owner[i]===1?'#d69455':'#172b42';
  for(let y=0;y<s.height;y++)for(let x=0;x<s.width;){const fill=color(y*s.width+x);let end=x+1;while(end<s.width&&color(y*s.width+end)===fill)end++;rects+='<rect x="'+x+'" y="'+y+'" width="'+(end-x)+'" height="1" fill="'+fill+'"/>';x=end;}
  return '<article><h2>'+(s.direction===1?'Расхождение':'Отрицательный контроль')+' t='+s.time+'</h2><p>overlap='+s.diagnostics.overlapCells+'; '+(s.diagnostics.overlapCells?'НЕ КАНДИДАТ':'допустим в растре, НЕ ПРИНЯТ')+'</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180" shape-rendering="crispEdges">'+rects+'</svg></article>';
 }).join('')+'</div></html>';
}
module.exports={create,unit,overview};
if(require.main===module){
 unit();
 if(process.argv.includes('--unit-only'))console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false}));
 else{
  const fs=require('fs'),path=require('path'),model=create(),frames=[];
  for(const width of [360,720])for(const time of [0,0.5,1]){const s=model.snapshot(time,width);assert(assess(s).validSampledGeometry);assert(s.relativeReferenceAreaErrors.every(e=>e<0.03));frames.push(s);}
  const negative=model.snapshot(0.25,360,-1);assert.deepEqual(assess(negative).reasons,['fragment-overlap']);frames.push(negative);
  assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
  const report={unitChecksPassed:true,integrationRun:true,frozenFixtureIntegrationRun:false,geometryMode:'analytic-irregular-half-patch',parameters:{alpha:model.alpha,rate:model.rate,maxTime:model.maxTime},radialProfile:'alpha*(0.8+0.12*sin(3*phi)+0.08*cos(5*phi))',pieceAreaReferences:model.pieceAreas,areaReferenceMethod:'composite Simpson,8192 panels per half;4096 comparison',quadratureDifferences:model.quadratureDifferences,snapshots:7,longitudeBounds:[0,0.5,1].map(time=>({time,intervals:model.bounds(time)})),generatorImported:false,frames:frames.map(s=>({time:s.time,width:s.width,height:s.height,direction:s.direction,rasterPieceAreas:s.rasterPieceAreas,relativeReferenceAreaErrors:s.relativeReferenceAreaErrors,...s.diagnostics,...assess(s)})),visualAccepted:false,appIntegrated:false,scope:'Analytic irregular outline with inherited separability bounds only; not real K4/K6, mask regeneration or core/application integration.'};
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});const stem=path.join(dir,'world-irregular-pair-'+Date.now()),jsonFile=stem+'.json',htmlFile=stem+'.html';fs.writeFileSync(jsonFile,JSON.stringify(report,null,2),{encoding:'utf8',flag:'wx'});fs.writeFileSync(htmlFile,overview(frames),{encoding:'utf8',flag:'wx'});assert(fs.statSync(jsonFile).size>0&&fs.statSync(htmlFile).size>0);
  console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,frozenFixtureIntegrationRun:false,geometryMode:report.geometryMode,snapshots:7,openingValidFrames:6,negativeControlOverlapCells:negative.diagnostics.overlapCells,maxRasterRelativeReferenceAreaError:Math.max(...frames.flatMap(s=>s.relativeReferenceAreaErrors)),maxQuadratureDifference:Math.max(...model.quadratureDifferences),generatorImported:false,jsonFile,htmlFile,visualAccepted:false,appIntegrated:false},null,2));
 }
}
