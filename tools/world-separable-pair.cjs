'use strict';
const assert=require('assert/strict'),{createSphere}=require('../src/world-domain.js'),{assess}=require('./world-frame-validity.cjs');
const S=createSphere({radiusKm:1});
function create(options={}){
 const alpha=options.alpha===undefined?0.65:options.alpha,rate=options.rate===undefined?0.25:options.rate,maxTime=options.maxTime===undefined?1:options.maxTime;
 assert([alpha,rate,maxTime].every(Number.isFinite)&&alpha>0&&alpha<Math.PI/2&&rate>0&&maxTime>0&&alpha+rate*maxTime<Math.PI);
 const threshold=Math.cos(alpha),pieceArea=Math.PI*(1-threshold);
 function pose(id,time,direction=1){assert(id===0||id===1);assert(Number.isFinite(time)&&time>=0&&time<=maxTime&&(direction===1||direction===-1));return S.axisRotation([0,0,1],(id===0?-1:1)*direction*rate*time);}
 const inSource=(id,p)=>p[0]>=threshold&&(id===0?p[1]<0:p[1]>=0);
 const contains=(id,p,time,direction=1)=>inSource(id,S.apply(S.inverse(pose(id,time,direction)),p));
 function bounds(time){pose(0,time);const theta=rate*time;return [{min:-alpha-theta,max:-theta},{min:theta,max:alpha+theta}];}
 function snapshot(time,width=360,direction=1){
  assert(Number.isInteger(width)&&width>=16&&width<=2048&&width%2===0);const height=width/2,N=width*height,coverage=new Uint8Array(N),owner=new Int16Array(N).fill(-1),area=[0,0],inverse=[0,1].map(id=>S.inverse(pose(id,time,direction)));
  let overlapCells=0,overlapArea=0;
  for(let y=0;y<height;y++){
   const lat=Math.PI/2-(y+0.5)/height*Math.PI,c=Math.cos(lat),z=Math.sin(lat),weight=S.cellAreaKm2(width,height,y);
   for(let x=0;x<width;x++){
    const lon=(x+0.5)/width*2*Math.PI-Math.PI,p=[c*Math.cos(lon),c*Math.sin(lon),z],i=y*width+x;
    for(let id=0;id<2;id++)if(inSource(id,S.apply(inverse[id],p))){coverage[i]++;owner[i]=coverage[i]===1?id:-2;area[id]+=weight;}
    if(coverage[i]>1){overlapCells++;overlapArea+=weight;}
   }
  }
  return {time,width,height,direction,centralMeridian:0,coverage,owner,rasterPieceAreas:area,relativeAreaErrors:area.map(a=>Math.abs(a/pieceArea-1)),diagnostics:{overlapCells,overlapAreaFraction:overlapArea/S.totalAreaKm2,validSampledGeometry:overlapCells===0}};
 }
 return Object.freeze({alpha,rate,maxTime,pieceArea,pose,contains,bounds,snapshot});
}
function unit(){
 const options={alpha:0.65,rate:0.25,maxTime:1},before=JSON.stringify(options),m=create(options),p=[1,0,0];
 assert(!m.contains(0,p,0)&&m.contains(1,p,0));assert(!m.contains(0,p,0.5)&&!m.contains(1,p,0.5));assert(m.contains(0,p,0.25,-1)&&m.contains(1,p,0.25,-1));
 for(const t of [0,0.25,0.5,1])for(let id=0;id<2;id++){
  const source=S.fromLonLat(id===0?-0.2:0.2,0),moved=S.apply(m.pose(id,t),source),back=S.apply(S.inverse(m.pose(id,t)),moved);
  assert(S.angle(source,back)<1e-12);assert(m.contains(id,moved,t));if(t)assert(m.bounds(t)[0].max<m.bounds(t)[1].min);
 }
 assert.equal(JSON.stringify(options),before);assert(m.snapshot(0.5,40,-1).diagnostics.overlapCells>0);
 assert.throws(()=>create({alpha:Math.PI/2}));assert.throws(()=>create({rate:-1}));assert.throws(()=>create({rate:4}));assert.throws(()=>m.pose(0,2));assert.throws(()=>m.pose(2,0));assert.throws(()=>m.snapshot(0,17));return true;
}
function overview(frames){
 const panels=frames.filter(s=>s.width===360).map(s=>{
  let shapes='';const color=i=>s.coverage[i]>1?'#ff00b7':s.owner[i]===0?'#8ac18b':s.owner[i]===1?'#d69455':'#172b42';
  for(let y=0;y<s.height;y++)for(let x=0;x<s.width;){const fill=color(y*s.width+x);let end=x+1;while(end<s.width&&color(y*s.width+end)===fill)end++;shapes+='<rect x="'+x+'" y="'+y+'" width="'+(end-x)+'" height="1" fill="'+fill+'"/>';x=end;}
  return '<article><h2>'+ (s.direction===1?'Расхождение':'Отрицательный контроль')+' t='+s.time+'</h2><p>overlap='+s.diagnostics.overlapCells+'; '+(s.diagnostics.overlapCells?'НЕ КАНДИДАТ':'допустим в растре, НЕ ПРИНЯТ')+'</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180" shape-rendering="crispEdges">'+shapes+'</svg></article>';
 }).join('');
 return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Разъединяемая пара: аналитический пример</title><style>body{font:14px system-ui;background:#101820;color:#eef2f5;margin:20px}.grid{display:grid;grid-template-columns:repeat(2,minmax(320px,1fr));gap:12px;max-width:1200px}h2{font-size:16px}svg{width:100%}</style><h1>Аналитический пример — НЕ K4 и НЕ принятая география</h1><p>Сферическая шапка разделена меридианом; половинки жёстко вращаются в разные стороны. Новые исходные фикстуры не создаются, существующие маски не меняются. Розовый — пересечения отрицательного контроля. Это проверка конструкции разъединения, не интерфейс приложения и не универсальный генератор.</p><div class="grid">'+panels+'</div></html>';
}
module.exports={create,unit,overview};
if(require.main===module){
 unit();
 if(process.argv.includes('--unit-only'))console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false}));
 else{
  const fs=require('fs'),path=require('path'),model=create(),frames=[];
  for(const width of [360,720])for(const time of [0,0.5,1]){
   const s=model.snapshot(time,width);assert(assess(s).validSampledGeometry);assert(s.relativeAreaErrors.every(e=>e<0.03));frames.push(s);
  }
  const negative=model.snapshot(0.25,360,-1);assert.deepEqual(assess(negative).reasons,['fragment-overlap']);frames.push(negative);
  assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
  const report={unitChecksPassed:true,integrationRun:true,frozenFixtureIntegrationRun:false,geometryMode:'analytic-half-cap',parameters:{alpha:model.alpha,rate:model.rate,maxTime:model.maxTime},analyticPieceArea:model.pieceArea,longitudeBounds:[0,0.5,1].map(time=>({time,intervals:model.bounds(time)})),snapshots:frames.length,generatorImported:false,frames:frames.map(s=>({time:s.time,width:s.width,height:s.height,direction:s.direction,rasterPieceAreas:s.rasterPieceAreas,relativeAreaErrors:s.relativeAreaErrors,...s.diagnostics,...assess(s)})),visualAccepted:false,appIntegrated:false,scope:'Constructive analytic pair only. No frozen masks, core drift, collision policy, K4/K6 generation or app UI changed.'};
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});const stem=path.join(dir,'world-separable-pair-'+Date.now()),jsonFile=stem+'.json',htmlFile=stem+'.html';fs.writeFileSync(jsonFile,JSON.stringify(report,null,2),{encoding:'utf8',flag:'wx'});fs.writeFileSync(htmlFile,overview(frames),{encoding:'utf8',flag:'wx'});assert(fs.statSync(jsonFile).size>0&&fs.statSync(htmlFile).size>0);
  console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,frozenFixtureIntegrationRun:false,geometryMode:report.geometryMode,snapshots:7,openingValidFrames:6,negativeControlOverlapCells:negative.diagnostics.overlapCells,maxRasterRelativeAreaError:Math.max(...frames.flatMap(s=>s.relativeAreaErrors)),generatorImported:false,jsonFile,htmlFile,visualAccepted:false,appIntegrated:false},null,2));
 }
}
