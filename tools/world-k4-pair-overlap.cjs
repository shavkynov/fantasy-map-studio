'use strict';
const assert=require('assert/strict'),{createSphere}=require('../src/world-domain.js'),{assess}=require('./world-frame-validity.cjs');
const sphere=createSphere({radiusKm:1}),pop=m=>{let n=0;for(let k=0;k<4;k++)n+=(m>>k)&1;return n;};
function summarize(bits,s){
 const {width:w,height:h}=s;assert(Number.isInteger(w)&&Number.isInteger(h)&&w>0&&h>0&&w*h<=2100000);
 assert(Number.isFinite(s.time)&&s.centralMeridian===0);assert.equal(bits.length,w*h);assert.equal(s.coverage.length,w*h);assert.equal(s.owner.length,w*h);
 const status=assess(s),pairs=[];for(let a=0;a<4;a++)for(let b=a+1;b<4;b++)pairs.push({a,b,cells:0,sphereFraction:0,cellIndices:[]});
 const multiplicityCells=[0,0,0,0,0];let union=0,area=0,incidences=0,weightedIncidences=0;
 for(let i=0;i<bits.length;i++){
  const m=bits[i];assert(Number.isInteger(m)&&m>=0&&m<16);const n=pop(m),weight=sphere.cellAreaKm2(w,h,Math.floor(i/w))/sphere.totalAreaKm2;
  assert.equal(n,s.coverage[i],'Membership/coverage mismatch at '+i);multiplicityCells[n]++;
  assert.equal(s.owner[i],n===0?-1:n===1?Math.log2(m):-2);
  if(n>1){union++;area+=weight;incidences+=n*(n-1)/2;weightedIncidences+=weight*n*(n-1)/2;}
  for(const p of pairs)if((m&(1<<p.a))&&(m&(1<<p.b))){p.cells++;p.sphereFraction+=weight;p.cellIndices.push(i);}
 }
 assert.equal(union,s.diagnostics.overlapCells);assert(Math.abs(area-s.diagnostics.overlapAreaFraction)<1e-12);
 assert.equal(pairs.reduce((n,p)=>n+p.cells,0),incidences);
 assert(Math.abs(pairs.reduce((n,p)=>n+p.sphereFraction,0)-weightedIncidences)<1e-12);
 return {time:s.time,width:w,height:h,centralMeridian:0,multiplicityCells,overlapUnionCells:union,overlapUnionSphereFraction:area,pairCellIncidences:incidences,pairSphereIncidences:weightedIncidences,pairs,...status};
}
function reconstruct(world,s){
 assert.equal(world.fragments.length,4);assert.equal(s.centralMeridian,0);
 const w=s.width,h=s.height,labels=world.sourceLabels(),bits=new Uint8Array(w*h),dirs=new Float64Array(w*h*3);
 for(let y=0;y<h;y++){
  const lat=Math.PI/2-(y+0.5)/h*Math.PI,c=Math.cos(lat),z=Math.sin(lat);
  for(let x=0;x<w;x++){const lon=(x+0.5)/w*2*Math.PI-Math.PI,j=(y*w+x)*3;dirs[j]=c*Math.cos(lon);dirs[j+1]=c*Math.sin(lon);dirs[j+2]=z;}
 }
 for(let id=0;id<4;id++){
  const q=world.sphere.inverse(world.pose(id,s.time)),a=world.sphere.apply(q,[1,0,0]),b=world.sphere.apply(q,[0,1,0]),c=world.sphere.apply(q,[0,0,1]);
  for(let i=0;i<bits.length;i++){
   const j=i*3,x=dirs[j],y=dirs[j+1],z=dirs[j+2];
   const index=world.sourceIndex([a[0]*x+b[0]*y+c[0]*z,a[1]*x+b[1]*y+c[1]*z,a[2]*x+b[2]*y+c[2]*z]);
   if(labels[index]===id){bits[i]|=1<<id;if(s.coverage[i]===1)assert.equal(s.sourceIndex[i],index);}
  }
 }
 summarize(bits,s);return bits;
}
function render(entries){
 const sections=entries.map(({snapshot:s,report:r})=>{
  let land='';for(let y=0;y<s.height;y++)for(let x=0;x<s.width;){if(!s.coverage[y*s.width+x]){x++;continue;}let end=x+1;while(end<s.width&&s.coverage[y*s.width+end])end++;land+='<rect x="'+x+'" y="'+y+'" width="'+(end-x)+'" height="1" fill="#65717e"/>';x=end;}
  const maps=r.pairs.map(p=>'<article><h3>Пара '+p.a+'–'+p.b+': '+p.cells+' клеток; sphereFraction='+p.sphereFraction+'</h3>'+(p.cells?'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+s.width+' '+s.height+'" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#172b42"/>'+land+p.cellIndices.map(i=>'<rect x="'+i%s.width+'" y="'+Math.floor(i/s.width)+'" width="1" height="1" fill="#ff00b7"/>').join('')+'</svg>':'<p>В этом отсчёте пересечений пары нет.</p>')+'</article>').join('');
  return '<section><h2>time='+r.time+'; '+(r.validSampledGeometry?'допустим в растре — НЕ ПРИНЯТ':'fragment-overlap — НЕ КАНДИДАТ')+'</h2><p>Уникальные пересечённые клетки: '+r.overlapUnionCells+'; парные вхождения: '+r.pairCellIncidences+'; triple='+r.multiplicityCells[3]+'; quadruple='+r.multiplicityCells[4]+'</p>'+maps+'</section>';
 }).join('');
 return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>K4: пары пересечений</title><style>body{font:16px system-ui;background:#101820;color:#eef2f5;margin:24px}section{border-top:1px solid #65717e}svg{display:block;width:100%;max-width:720px}h3{font-size:16px}</style><h1>K4: пары пересечений</h1><p>Исходные скорости, сетка 360×180, centralMeridian=0. Серая суша — объединение текущих фрагментов; розовые клетки — пересечение указанной пары. Клетки тройного покрытия появляются в трёх картах, четверного — в шести. Это атрибуция существующих растровых пересечений, не новая метрика качества, не непрерывное столкновение, не разрешение конфликтов и не выбор кадра.</p>'+sections+'</html>';
}
function unit(){
 const bits=[0,1,3,7,15,2,4,8],coverage=bits.map(pop),w=4,h=2;
 const overlap=coverage.filter(n=>n>1).length,area=bits.reduce((sum,m,i)=>sum+(pop(m)>1?sphere.cellAreaKm2(w,h,Math.floor(i/w))/sphere.totalAreaKm2:0),0);
 const s={width:w,height:h,time:0,centralMeridian:0,coverage,owner:bits.map(m=>pop(m)===0?-1:pop(m)===1?Math.log2(m):-2),diagnostics:{overlapCells:overlap,overlapAreaFraction:area,validSampledGeometry:false}};
 const before=JSON.stringify([bits,s]),r=summarize(bits,s);assert.deepEqual(r.multiplicityCells,[1,4,1,1,1]);assert.equal(r.overlapUnionCells,3);assert.equal(r.pairCellIncidences,10);assert.deepEqual(r.pairs.map(p=>p.cells),[3,2,1,2,1,1]);
 assert.equal(r.pairs[0].cellIndices.join(','),'2,3,4');const html=render([{snapshot:s,report:r}]);assert(html.includes('НЕ КАНДИДАТ'));assert(html.includes('#ff00b7'));assert.equal((html.match(/<svg /g)||[]).length,6);
 assert.equal(JSON.stringify([bits,s]),before);assert.throws(()=>summarize([16,...bits.slice(1)],s));assert.throws(()=>summarize(bits.slice(1),s));assert.throws(()=>summarize(bits,{...s,owner:s.owner.map(()=>-1)}));assert.throws(()=>summarize(bits,{...s,diagnostics:{...s.diagnostics,overlapCells:2}}));
 return true;
}
module.exports={summarize,reconstruct,render,unit};
if(require.main===module){
 unit();
 if(process.argv.includes('--unit-only'))console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false,artifactsWritten:false}));
 else{
  const fs=require('fs'),path=require('path'),crypto=require('crypto'),F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js');
  const source=F.load(path.join(__dirname,'fixtures/world-source/vondoran-227-k4.json'),'1bb053646f0b6746767ae2d1a93c90098cff17944126c76b6bcabb20952c31a6'),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'),before=hash(source),world=D.fromSource(source);
  const entries=[0,1/512,1/256,1/128,0.5,1,2,4].map(time=>{const snapshot=world.snapshot(time,{width:360,height:180,centralMeridian:0});return {snapshot,report:summarize(reconstruct(world,snapshot),snapshot)};});
  assert.equal(hash(source),before);assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});const stem=path.join(dir,'k4-pair-overlap-'+Date.now()),htmlFile=stem+'.html',jsonFile=stem+'.json';
  fs.writeFileSync(htmlFile,render(entries),{encoding:'utf8',flag:'wx'});fs.writeFileSync(jsonFile,JSON.stringify(entries.map(e=>e.report),null,2),{encoding:'utf8',flag:'wx'});
  assert(fs.statSync(htmlFile).size>0&&fs.statSync(jsonFile).size>0);
  console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,artifactsWritten:true,htmlFile,jsonFile,sources:1,snapshots:entries.length,sourceInputsUnchanged:true,generatorImported:false,frames:entries.map(({report:r})=>({...r,pairs:r.pairs.map(({cellIndices,...p})=>({...p,sampleCellIndices:cellIndices.slice(0,8)}))})),scope:'All six K4 pair overlaps; multiple coverage counted explicitly; no motion changes or geographic acceptance.'},null,2));
 }
}
