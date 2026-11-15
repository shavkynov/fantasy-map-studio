'use strict';
// Импорт растра высот в метрах: конвертер на синтетике и через настоящее рабочее пространство (сфера 144×72, ядро, вода).
// Не проверяются: выбор файла в интерфейсе, сохранение записи шкалы в файле карты, браузер, Electron, согласованность с локациями.
const assert=require('node:assert/strict'),Scale=require('../src/elevation-scale'),ImportF=require('../src/elevation-import'),G=require('../src/terrain-edit-spherical-base'),Shape=require('../src/terrain-edit-shaping'),Core=Shape.extend(require('../src/terrain-edit-smooth').extend(require('../src/terrain-edit-core'))),Session=require('../src/terrain-edit-session'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hierarchy=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill');
const Imp=ImportF.create(Scale),scale=Scale.create({radiusKm:6371,metersPerUnit:8000});
let count=0;async function test(name,fn){await fn();console.log('PASS '+(++count)+' '+name);}
const near=(a,b,t=1e-9)=>assert(Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),a+' != '+b);
const raster=(w,h,f)=>{const m=new Float64Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)m[y*w+x]=f(x,y);return {w,h,meters:m};};
(async()=>{
 await test('Однородный растр: суша = метры / metersPerUnit, океан без высоты',()=>{
  const r=Imp.convert(raster(8,4,(x)=>x<4?1600:-3000),scale),b=r.base;
  for(let y=0;y<4;y++)for(let x=0;x<8;x++){const i=y*8+x;if(x<4){assert.equal(b.land[i],1);near(b.height[i],.2);}else{assert.equal(b.land[i],0);assert(Number.isNaN(b.height[i]));}}
  assert.equal(r.report.landCells,16);near(r.report.meanLandMeters,1600);near(r.report.landFraction,.5,1e-12);near(r.report.maxLandMeters,1600);assert.equal(r.report.clampedToMinimum,0);
 });
 await test('Уровень воды: сдвиг datum и ровно ноль — океан',()=>{
  const r=Imp.convert(raster(8,4,()=>100),scale,{seaLevelMeters:100});assert.equal(r.report.landCells,0);assert.equal(r.report.meanLandMeters,null);
  const q=Imp.convert(raster(8,4,()=>1100),scale,{seaLevelMeters:1000});near(q.base.height[0],100/8000);near(q.report.meanLandMeters,100);
 });
 await test('Уменьшение блоками 2×2: среднее с весом по площади строк; океан в блоке отбрасывается',()=>{
  const wN=Math.sin(Math.PI/2)-Math.sin(Math.PI/4),wS=Math.sin(Math.PI/4);   // площади строк y=0 (90..45) и y=1 (45..0) при h=4→ полосы 90..45 и 45..0
  const same=Imp.convert(raster(8,4,(x,y)=>(y===0?100:y===1?300:-9)),scale,{targetW:4,targetH:2});near(same.base.height[0]*8000,(100*wN+300*wS)/(wN+wS),1e-9);
  // северная строка — суша 100, южная — океан: суша занимает 0.29 площади блока → океан
  const north=Imp.convert(raster(8,4,(x,y)=>(y===0?100:-50)),scale,{targetW:4,targetH:2});assert.equal(north.base.land[0],0);
  // северная — океан, южная — суша 300: 0.71 площади → суша, среднее только по суше = 300
  const south=Imp.convert(raster(8,4,(x,y)=>(y===1?300:-50)),scale,{targetW:4,targetH:2});assert.equal(south.base.land[0],1);near(south.base.height[0]*8000,300,1e-9);
 });
 await test('Порог 0.5 по площади по долготе',()=>{
  const half=Imp.convert(raster(16,2,(x)=>(x%4<2?1000:-100)),scale,{targetW:4,targetH:2});assert(half.base.land.every(v=>v===1),'ровно половина — суша');near(half.base.height[0],1000/8000);
  const quarter=Imp.convert(raster(16,2,(x)=>(x%4===0?1000:-100)),scale,{targetW:4,targetH:2});assert(quarter.base.land.every(v=>v===0));
 });
 await test('Неверные данные отклоняются',()=>{
  const ok=raster(8,4,()=>10);
  for(const [r,o] of [[null],[{w:8,h:4}],[{w:7,h:4,meters:new Float64Array(28)}],[{w:8,h:4,meters:new Float64Array(5)}],[raster(8,4,(x)=>x===3?NaN:1)],[raster(8,4,(x)=>x===3?Infinity:1)],[raster(8,4,(x)=>x===3?2e6:1)],[ok,{targetW:3}],[ok,{targetW:8,targetH:3}],[ok,{extra:1}],[ok,{seaLevelMeters:NaN}],[raster(8,4,()=>1e5),{}]])assert.throws(()=>Imp.convert(r,scale,o),undefined,JSON.stringify(o)+' '+(r&&r.w));
  assert.throws(()=>Imp.convert(ok,null));assert.throws(()=>ImportF.create(null));
 });
 await test('Малая высота суши поднимается до минимума ядра и считается',()=>{
  const r=Imp.convert(raster(8,4,()=>.001),scale);assert.equal(r.report.clampedToMinimum,32);assert(r.base.height.every(v=>v===1e-6));
 });
 // реальное рабочее пространство
 const deps={Core,Relief,Drainage,Hierarchy,Surface,Fill,yieldStep:()=>Promise.resolve()},mk=()=>Shape.createWorkspace(G.generate({seed:'imp-a',w:144,h:72,continents:4}),deps,Session);
 const world=(w,h)=>raster(w,h,(x,y)=>{const lon=2*Math.PI*((x+.5)/w-.5),lat=Math.PI*(.5-(y+.5)/h),d=Math.hypot(lon*Math.cos(lat),lat-.3);return d<1.2?Math.round(3500*(1-d/1.2)+50):-2000;});
 await test('Рабочее пространство: подготовка не меняет карту, коммит заменяет, вода сброшена, высоты в метрах',async()=>{
  const w=mk(),before=JSON.stringify(w.session.snapshot().height);await w.session.runWater();assert(w.session.snapshot().depth);
  const st=w.stageImported(world(288,144),scale,Imp);assert.equal(JSON.stringify(w.session.snapshot().height),before,'до коммита карта не изменена');
  assert(st.report.landCells>100&&st.report.targetW===144&&st.report.factorX===2);
  st.commit();const sn=w.session.snapshot();assert.equal(sn.depth,null);assert.equal(w.info().name,'Импорт рельефа');assert.equal(w.info().persisted,false);
  const f=Relief.build({w:144,h:72,land:sn.land},sn.height),d=scale.describe(f);near(d.landAreaKm2,st.report.landFraction*4*Math.PI*6371**2,1e-9);near(d.maxLandHeightM,st.report.maxLandMeters,1e-9);near(d.meanLandHeightM,st.report.meanLandMeters,1e-9);
  assert(d.maxLandHeightM<3600&&d.maxLandHeightM>2000);console.log('  импорт:',JSON.stringify({landCells:st.report.landCells,landFraction:+st.report.landFraction.toFixed(3),maxM:Math.round(d.maxLandHeightM),meanM:Math.round(d.meanLandHeightM)}));
 });
 await test('После импорта правка, отмена и расчёт воды работают; устаревшая подготовка отклоняется; неверный растр не меняет карту',async()=>{
  const w=mk();w.stageImported(world(144,72),scale,Imp).commit();const sn=w.session.snapshot(),i=sn.land.findIndex(v=>v);
  assert(w.session.stroke({cells:[i],mode:'raise',radius:.1,amount:.2}));assert(w.session.undo());
  assert.equal((await w.session.runWater()).status,'completed');const l=w.session.snapshot().ledger;assert(Math.abs(l.residual)<1e-10,'residual '+l.residual);
  const a=w.stageImported(world(144,72),scale,Imp),b=w.stageImported(world(144,72),scale,Imp);a.commit();assert.throws(()=>b.commit(),/устарела/);
  const keep=JSON.stringify(w.session.snapshot().height);assert.throws(()=>w.stageImported(raster(145,72,()=>5),scale,Imp));assert.throws(()=>w.stageImported(world(100,50),scale,Imp));assert.equal(JSON.stringify(w.session.snapshot().height),keep);
  assert.throws(()=>w.stageImported(world(144,72),scale,null));
 });
 console.log(JSON.stringify({passed:true,scope:'converter on synthetic rasters; stageImported on real workspace/core/water, 144x72 grid',notChecked:'file picker UI, saving the scale record with the map, browser, Electron, CI, resolutions other than 144x72'}));
})().catch(e=>{console.error(e);process.exit(1);});
