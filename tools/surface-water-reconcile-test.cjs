'use strict';
// Сверка каталога водоёмов с гидрологией: смежность каталога = смежность дренажа (8 соседей, полюс), соответствие «объект ↔ пул»,
// учёт воды шага без двойного счёта (новая вода отдельно от пересылки по цепочкам). Синтетика + настоящие модули (144×72, 360×180).
// Не проверяются: речные объекты, расход в м³/с, испарение по пулам, браузер, Electron, CI.
const assert=require('node:assert/strict'),Relief=require('../src/regional-relief-integration'),G=require('../src/terrain-edit-spherical-base'),Drainage=require('../src/spherical-drainage'),Hier=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill'),Objects=require('../src/surface-water-objects'),Links=require('../src/surface-water-links'),Flux=require('../src/surface-water-flux');
let count=0;const test=(name,fn)=>{fn();console.log('PASS '+(++count)+' '+name);};
const near=(a,b,t=1e-12)=>assert(Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),a+' != '+b);
// --- смежность каталога ---
const tiny=()=>{const w=8,h=4,land=new Uint8Array(w*h).fill(1),height=Float64Array.from({length:w*h},(_,i)=>1+i*.01);return Relief.build({w,h,land},height);};
const wet=(field,cells)=>{const d=new Float64Array(field.w*field.h);for(const i of cells)d[i]=.1;return {w:field.w,h:field.h,depth:d};};
test('Диагональ: «edge» делит водоём на два, «hydrology» соединяет (как дренаж)',()=>{
 const f=tiny(),w=wet(f,[9,18]);   // клетки (1,1) и (2,2)
 assert.equal(Objects.build(f,w).objects.length,2);assert.equal(Objects.build(f,w,{adjacency:'edge'}).objects.length,2);
 const c=Objects.build(f,w,{adjacency:'hydrology'});assert.equal(c.objects.length,1);assert.equal(c.metadata.adjacency,'hydrology');assert.equal(c.summary.objectCount,1);near(c.summary.volumeResidual,0);
});
test('Полюс: клетки на противоположных долготах верхнего ряда соединены отражением только в «hydrology»',()=>{
 const f=tiny(),w=wet(f,[1,5]);   // (1,0) и (5,0): w=8, сдвиг на w/2
 assert.equal(Objects.build(f,w).objects.length,2);assert.equal(Objects.build(f,w,{adjacency:'hydrology'}).objects.length,1);
 const s=wet(f,[8*3+2,8*3+6]);assert.equal(Objects.build(f,s,{adjacency:'hydrology'}).objects.length,1,'южный полюс');
});
test('Неверные параметры смежности',()=>{
 const f=tiny(),w=wet(f,[9]);assert.throws(()=>Objects.build(f,w,{adjacency:'x'}));const {neighbors,...bare}=f;assert.throws(()=>Objects.build({...bare},w,{adjacency:'hydrology'}),/neighbors/);
 assert.throws(()=>Objects.build({...f,neighbors:()=>[9999]},w,{adjacency:'hydrology'}),/neighbor/);assert.equal(Objects.build(f,w,{adjacency:'edge'}).metadata.adjacency,'edge');
});
// --- потоки шага: синтетика ---
const H=(B)=>({basins:new Array(B).fill({}),waterNode:B});
test('Цепочка 0→1→2→вода: новая вода 3, экспорт 3, пересылка по хопам отдельно, невязка 0',()=>{
 const tr={waterNode:3,initialByBasin:[1,1,1],events:[{kind:'transfer',from:0,to:1,edge:0,volume:1},{kind:'transfer',from:1,to:2,edge:1,volume:2},{kind:'boundary',from:2,to:3,edge:2,volume:3}],finalPools:[{node:0,volume:0},{node:1,volume:0},{node:2,volume:0}]};
 const f=Flux.analyze(H(3),tr,{previousStorage:[0,0,0]}),t=f.totals;near(t.rainInput,3);near(t.exportedToWater,3);near(t.hopVolume,3);near(t.maxPoolResidual,0);near(t.storedAfterInflow,0);
 assert.equal(f.edges.length,3);assert.deepEqual(f.pools.map(p=>[p.rain,p.spillIn,p.spillOut,p.exported]),[[1,0,1,0],[1,1,2,0],[1,2,0,3]]);
 // двойной счёт: сумма spillOut по всем пулам (3) уже равна hopVolume, но это не вода
 near(f.pools.reduce((a,p)=>a+p.spillOut,0),t.crossPoolHopVolume);
});
test('Слияние: переход внутри объединённого пула внутренний, старое хранилище не считается новой водой',()=>{
 const tr={waterNode:3,initialByBasin:[2,1,0],events:[{kind:'transfer',from:0,to:1,edge:0,volume:.5},{kind:'merge',node:4,left:0,right:1,edge:0},{kind:'transfer',from:4,to:2,edge:1,volume:.25}],finalPools:[{node:4,volume:2.75},{node:2,volume:.25}]};
 const f=Flux.analyze(H(3),tr,{previousStorage:[1,0,0]}),t=f.totals;near(t.rainInput,2);near(t.supplied,3);near(t.internalHopVolume,.5);near(t.crossPoolHopVolume,.25);near(t.maxPoolResidual,0);
 assert.deepEqual(f.pools.find(p=>p.node===4).basins,[0,1]);const none=Flux.analyze(H(3),tr);assert.equal(none.totals.rainInput,null);
});
test('Неверные входы потоков отклоняются',()=>{
 const ok=()=>({waterNode:3,initialByBasin:[1,1,1],events:[],finalPools:[{node:0,volume:1},{node:1,volume:1},{node:2,volume:1}]});
 assert.throws(()=>Flux.analyze(null,ok()));assert.throws(()=>Flux.analyze(H(3),null));assert.throws(()=>Flux.analyze(H(3),{...ok(),waterNode:7}));assert.throws(()=>Flux.analyze({basins:[{},{}],waterNode:3},ok()),/match/);assert.throws(()=>Flux.analyze(H(3),ok(),{previousStorage:[0]}));assert.throws(()=>Flux.analyze(H(3),ok(),{x:1}));
 assert.throws(()=>Flux.analyze(H(3),{...ok(),events:[{kind:'transfer',from:0,to:1,volume:-1}]}));assert.throws(()=>Flux.analyze(H(3),{...ok(),events:[{kind:'boundary',from:0,to:2,volume:1}]}));assert.throws(()=>Flux.analyze(H(3),{...ok(),events:[{kind:'x',volume:1}]}));
 assert.throws(()=>Flux.analyze(H(3),{...ok(),finalPools:[{node:0,volume:1},{node:1,volume:1}]}),/no final pool/);
 const bad=ok();bad.events=[{kind:'transfer',from:0,to:1,volume:1}];bad.finalPools[0].volume=5;assert(Flux.analyze(H(3),bad).totals.maxPoolResidual>1,'невязка видна, а не скрыта');
});
// --- настоящие модули ---
function model(seed,w,h,track){const base=G.generate({seed:'rec-'+seed,w,h,continents:4}),field=Relief.build({w,h,land:base.land},base.height),dr=Drainage.build(field),hi=Hier.build(field,dr),m=Surface.create(field,hi,Fill,track?{trackRouting:true}:{});return {field,hi,m};}
const wetRun=(m,steps,P=.4)=>{let st=m.empty();for(let s=0;s<steps;s++)st=m.advance(st,{precipitation:P,evaporation:.001,runoffCoefficient:.5},.05);return st;};
test('Реальные данные: каждый объект каталога (hydrology) = ровно один пул; объём и площадь совпадают',()=>{
 let objects=0;for(const [w,h] of [[144,72],[360,180]])for(const seed of ['a','b','c','d','e','f']){
  const {field,hi,m}=model(seed,w,h),st=wetRun(m,20,.02),cat=Objects.build(field,{w,h,depth:st.redistribution.depth},{adjacency:'hydrology'}),L=Links.build(field,hi,st.redistribution,cat);
  assert.equal(L.summary.consistent,true,w+'x'+h+' '+seed+' '+JSON.stringify(L.mismatches.slice(0,2)));assert(L.summary.maxVolumeRelDiff<1e-9&&L.summary.maxAreaRelDiff<1e-9,'расхождение '+L.summary.maxVolumeRelDiff+' '+L.summary.maxAreaRelDiff);assert.equal(L.summary.objectCount,cat.objects.length);objects+=L.summary.objectCount;
  for(const x of L.links){assert(x.outlet===null||x.outlet.headroom>=0);assert.equal(cat.labels[x.anchorCell],x.object);assert(x.downstream.kind);}}
 assert(objects>=30,'проверено объектов '+objects);
});
test('Регрессия: 360×180 «rec-c»: смежность «edge» даёт на один объект больше, чем гидрология',()=>{
 const {field,m}=model('c',360,180),st=wetRun(m,20,.02),d={w:360,h:180,depth:st.redistribution.depth};
 const a=Objects.build(field,d).objects.length,b=Objects.build(field,d,{adjacency:'hydrology'}).objects.length;assert.equal(a,11);assert.equal(b,10);
});
test('Сверка видит расхождения: каталог «edge» отклоняется, искусственно разорванный объект и пул обнаруживаются',()=>{
 const {field,hi,m}=model('e',360,180),st=wetRun(m,20,.02),d={w:360,h:180,depth:st.redistribution.depth};
 assert.throws(()=>Links.build(field,hi,st.redistribution,Objects.build(field,d)),/hydrology/);
 const cat=Objects.build(field,d,{adjacency:'hydrology'}),labels=Int32Array.from(cat.labels),cell=labels.findIndex(v=>v===0);labels[cell]=cat.objects.length;
 const L=Links.build(field,hi,st.redistribution,{...cat,labels,objects:[...cat.objects,{...cat.objects[0]}]});assert.equal(L.summary.consistent,false);assert(L.mismatches.some(x=>x.kind==='pool-spans-objects'),JSON.stringify(L.mismatches.map(x=>x.kind)));
 assert.throws(()=>Links.build(field,hi,{...st.redistribution,depth:new Float64Array(3)},cat));assert.throws(()=>Links.build(field,hi,st.redistribution,cat,{x:1}));
});
test('Реальные данные: пул замыкается, новая вода = входной объём шага, экспорт = граничный отток, пересылка превышает новую воду',()=>{
 let maxHopRatio=0,steps=0;for(const [w,h,seed] of [[144,72,'c'],[360,180,'a'],[360,180,'c']]){
  const {hi,m}=model(seed,w,h,true);let st=m.empty();
  for(let s=0;s<8;s++){const prev=st.redistribution.basinStorage;st=m.advance(st,{precipitation:s<6?.4:0,evaporation:.001,runoffCoefficient:.5},.05);
   const f=Flux.analyze(hi,st.routingTrace.inflow,{previousStorage:prev}),t=f.totals;steps++;
   assert(t.maxPoolResidual<1e-12,'невязка пула '+t.maxPoolResidual);near(t.rainInput,st.stepStats.inputTotal,1e-12);near(t.exportedToWater,st.routingTrace.inflow.boundaryOutflow,1e-12);
   near(t.supplied,prev.reduce((a,b)=>a+b,0)+st.stepStats.inputTotal,1e-12);near(t.hopVolume,t.crossPoolHopVolume+t.internalHopVolume,1e-12);
   if(t.rainInput>0)maxHopRatio=Math.max(maxHopRatio,t.hopVolume/t.rainInput);}}
 assert(maxHopRatio>1.2,'пересылка не превысила новую воду: '+maxHopRatio);console.log('  макс. отношение «переходы / новая вода» за шаг: '+maxHopRatio.toFixed(2)+' (шагов '+steps+')');
});
test('Включение трассировки не меняет числа модели (глубина, запасы, баланс)',()=>{
 const a=model('c',144,72,false),b=model('c',144,72,true),x=wetRun(a.m,10),y=wetRun(b.m,10);
 assert.deepEqual(Array.from(x.redistribution.depth),Array.from(y.redistribution.depth));assert.deepEqual(Array.from(x.redistribution.basinStorage),Array.from(y.redistribution.basinStorage));assert.deepEqual(x.ledger,y.ledger);
});
console.log(JSON.stringify({passed:true,scope:'catalog adjacency, object-pool reconciliation, per-step flux bookkeeping; synthetic + real modules 144x72 and 360x180',notChecked:'rivers, discharge units, evaporation per pool, session/UI wiring, browser, Electron, CI'}));
