'use strict';
// Речные объекты по истории стока на фиксированном графе дренажа: русла, участки, реки (главное русло/притоки), устья, озёра, порядок Стралера,
// наблюдаемый режим, выбор по масштабу, физические длины. Синтетика (вручную) + настоящие модули 144×72 и 360×180.
// Не проверяются: расход в м³/с, грунтовое питание, сезоны, браузер, Electron, CI.
const assert=require('node:assert/strict'),Rivers=require('../src/river-objects'),Select=require('../src/river-selection'),Scale=require('../src/elevation-scale');
const G=require('../src/terrain-edit-spherical-base'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hier=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill'),Routing=require('../src/rainfall-runoff-routing'),FH=require('../src/runoff-flow-history'),Objects=require('../src/surface-water-objects'),Links=require('../src/surface-water-links');
let count=0;const test=(name,fn)=>{fn();console.log('PASS '+(++count)+' '+name);};
const near=(a,b,t=1e-9)=>assert(Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),a+' != '+b);
// --- синтетика: линия клеток, w=n,h=1 ---
function world(land,receiver,acc){const n=land.length;return {field:{w:n,h:1,land:Uint8Array.from(land),height:Float64Array.from({length:n},(_,i)=>land[i]?1-i*.05:NaN),angularDistance:(i,j)=>.01*Math.abs(i-j)},drainage:{w:n,h:1,receiver:Int32Array.from(receiver),accumulation:Float64Array.from(acc)}};}
function hist(n,o={}){const f=(k,d)=>Float64Array.from({length:n},(_,i)=>(o[k]&&o[k][i]!==undefined)?o[k][i]:d);return {w:n,h:1,totalTime:1,steps:10,peakFlow:f('peak',1),meanFlow:f('mean',1),occurrence:f('occ',1),wetTime:f('wet',0),eligibleTime:f('elig',1),zeroFlowTime:f('zero',0),maxObservedDryDuration:f('dry',0)};}
const Y=()=>world([1,1,1,1,1,0],[2,2,3,4,5,-2],[1,1,3,4,5,0]);
test('Y-слияние: участки, реки, главное русло по среднему стоку, притоки, порядок Стралера',()=>{
 const {field,drainage}=Y(),R=Rivers.build(field,drainage,hist(6,{mean:[1,2,3,3,3,0]}));
 assert.deepEqual(R.reaches.map(r=>r.id),[0,1,2]);assert.deepEqual(R.reaches.find(r=>r.id===2).cells,[2,3,4,5]);assert.equal(R.reaches.find(r=>r.id===2).end.type,'ocean');
 assert.deepEqual(R.rivers.map(r=>[r.id,r.reaches.join('>'),r.mouth.type,r.order]),[[0,'0','tributary',1],[1,'1>2','ocean',2]]);assert.equal(R.rivers[0].mouth.joinsRiver,1);assert.equal(R.reaches.find(r=>r.id===0).downstream,2);
 assert.equal(R.summary.riverCount,2);assert.equal(R.summary.tributaries,1);assert.equal(R.summary.toOcean,1);assert.equal(R.summary.activeCells,5);assert.equal(R.summary.maxOrder,2);
 assert.equal(R.rivers[1].catchmentSteradians,5);assert.equal(R.rivers[1].meanFlowAtMouth,3);
 const tie=Rivers.build(field,drainage,hist(6,{mean:[2,2,3,3,3,0],peak:[1,1,1,1,1,0]}));assert.equal(tie.rivers.find(r=>r.mouth.type==='ocean').id,0,'при равенстве — меньшая начальная клетка');
 const peak=Rivers.build(field,drainage,hist(6,{mean:[2,2,3,3,3,0],peak:[1,5,1,1,1,0]}));assert.equal(peak.rivers.find(r=>r.mouth.type==='ocean').id,1,'при равном среднем — больший пик');
});
test('Порог: клетки ниже порога не образуют русла; вход во влажную клетку = озеро, иначе ниже порога',()=>{
 const {field,drainage}=Y();
 const lake=Rivers.build(field,drainage,hist(6,{peak:[1,1,1,0,0,0],wet:[0,0,0,1,0,0]}));assert.equal(lake.rivers.find(r=>r.mouth.type!=='tributary').mouth.type,'lake');
 const dry=Rivers.build(field,drainage,hist(6,{peak:[1,1,1,0,0,0]}));assert.equal(dry.rivers.find(r=>r.mouth.type!=='tributary').mouth.type,'below-threshold');assert.equal(dry.summary.belowThreshold,1);
 const none=Rivers.build(field,drainage,hist(6,{peak:[0,0,0,0,0,0]}),{threshold:1});assert.equal(none.rivers.length,0);assert.equal(none.summary.activeCells,0);
 const high=Rivers.build(field,drainage,hist(6,{peak:[1,1,3,3,3,0]}),{threshold:2});assert.equal(high.summary.activeCells,3);assert.equal(high.rivers.length,1);
});
const Lk=()=>{const w=world([1,1,1,1,1,1,0,0],[1,2,-1,4,5,6,-2,-2],[1,2,3,1,2,3,0,0]);const labels=new Int32Array(8).fill(-1);labels[2]=0;return {...w,catalog:{w:8,h:1,labels},links:{links:[{object:0,anchorCell:2,outlet:{toCell:3,target:'pool',toObject:null,headroom:.1,atSpillLevel:false}}]}};};
test('Замкнутый бассейн с озером: устье «closed» с озером; озеро собирает притоки и ведёт в русло ниже',()=>{
 const {field,drainage,catalog,links}=Lk(),R=Rivers.build(field,drainage,hist(8,{peak:[1,1,1,1,1,1,0,0]}),{catalog,links});
 const up=R.rivers.find(r=>r.id===0);assert.equal(up.mouth.type,'closed');assert.equal(up.mouth.lakeLabel,0);assert.equal(up.mouth.lakeAnchor,2);assert.equal(R.summary.closedWithLake,1);
 assert.equal(R.lakes.length,1);const L=R.lakes[0];assert.deepEqual(L.inflowRivers,[0]);assert.equal(L.outlet.continuesInReach,3);assert.equal(L.outlet.continuesInRiver,3);
 const noLake=Rivers.build(field,drainage,hist(8,{peak:[1,1,1,1,1,1,0,0]}));assert.equal(noLake.rivers.find(r=>r.id===0).mouth.lakeLabel,null);assert.equal(noLake.lakes.length,0);
 assert.throws(()=>Rivers.build(field,drainage,hist(8),{catalog}));assert.throws(()=>Rivers.build(field,drainage,hist(8),{catalog:{...catalog,labels:new Int32Array(3)},links}));
});
test('Наблюдаемый режим: без сухой фазы «текут весь прогон» и пометка «не проверено»; с нулевым стоком у истока — «прерывистая»',()=>{
 const {field,drainage}=Y(),a=Rivers.build(field,drainage,hist(6));assert.equal(a.regime.dryPhaseObserved,false);assert(/NOT tested/.test(a.regime.note));assert.equal(a.regime.throughout,a.rivers.length);
 const b=Rivers.build(field,drainage,hist(6,{zero:[.5,0,0,0,0,0],dry:[.5,0,0,0,0,0],occ:[.5,1,1,1,1,1]}));assert.equal(b.regime.dryPhaseObserved,true);
 assert.equal(b.rivers.find(r=>r.id===0).observation,'intermittent');assert.equal(b.rivers.find(r=>r.id===1).observation,'throughout');assert.equal(b.rivers.find(r=>r.id===0).maxObservedDryDuration,.5);
});
test('Покрытие: клетка, большую часть прогона занятая водой, — озеро, а не русло',()=>{
 const {field,drainage}=Y(),H=hist(6,{elig:[1,1,1,1,.4,1],wet:[0,0,0,0,.6,0]});
 const a=Rivers.build(field,drainage,H);assert.equal(a.minCoverage,.5);assert.equal(a.summary.activeCells,4);assert.equal(a.rivers.find(r=>r.mouth.type!=='tributary').mouth.type,'lake');
 const b=Rivers.build(field,drainage,H,{minCoverage:.3});assert.equal(b.summary.activeCells,5);
 for(const bad of [0,-1,1.5,NaN])assert.throws(()=>Rivers.build(field,drainage,H,{minCoverage:bad}));
});
test('Неверные входы отклоняются',()=>{
 const {field,drainage}=Y(),H=hist(6);
 for(const bad of [[null,drainage,H],[field,null,H],[field,drainage,null],[field,drainage,{...H,peakFlow:new Float64Array(2)}],[field,drainage,{...H,w:7}],[field,{...drainage,accumulation:null},H],[field,drainage,H,{threshold:0}],[field,drainage,H,{threshold:NaN}],[field,drainage,H,{x:1}]])assert.throws(()=>Rivers.build(...bad),undefined,String(bad.length));
 assert.throws(()=>Rivers.build({...field,land:Uint8Array.of(1,1,2,1,1,0)},drainage,H));
 // цикл по активным клеткам
 const cyc=world([1,1,1,1],[1,2,0,-2],[1,1,1,1]);assert.throws(()=>Rivers.build(cyc.field,cyc.drainage,hist(4)));
});
test('Выбор по масштабу: порядок и площадь водосбора; выбранный приток тянет реку, в которую впадает',()=>{
 const {field,drainage}=Y(),R=Rivers.build(field,drainage,hist(6,{mean:[1,2,3,3,3,0]}));
 let s=Select.select(R,{minOrder:2});assert.deepEqual(s.rivers,[1]);assert.deepEqual(s.reaches,[1,2]);assert.equal(s.counts.addedForConnectivity,0);
 s=Select.select(R,{});assert.deepEqual(s.rivers,[0,1]);
 const odd=JSON.parse(JSON.stringify(R));odd.rivers.find(r=>r.id===1).catchmentSteradians=0;s=Select.select(odd,{minCatchmentSteradians:.5});assert.deepEqual(s.rivers,[0,1]);assert.equal(s.counts.addedForConnectivity,1);assert.equal(s.counts.chosenByCriteria,1);
 const sc=Scale.create({radiusKm:3000});s=Select.select(R,{minCatchmentKm2:2e7},sc);assert.deepEqual(s.rivers,[1]);   // 1 ср = 9e6 км², 5 ср = 4.5e7 км²: порог 2e7 км² отсекает приток (1 ср)
 for(const bad of [{minOrder:0},{minOrder:1.5},{minCatchmentSteradians:-1},{x:1},{minCatchmentKm2:1}])assert.throws(()=>Select.select(R,bad));assert.throws(()=>Select.select(null));
 const {lakes}=Select.select(Rivers.build(Lk().field,Lk().drainage,hist(8),{catalog:Lk().catalog,links:Lk().links}),{});assert.deepEqual(lakes,[2]);
});
test('Физические величины: длина по радиусу, перепад в метрах, водосбор в км²; без шкалы не считаются',()=>{
 const {field,drainage}=Y(),R=Rivers.build(field,drainage,hist(6,{mean:[1,2,3,3,3,0]})),sc=Scale.create({radiusKm:6000,metersPerUnit:8000}),P=Rivers.physical(R,field,sc);
 const r2=P.reaches.find(r=>r.id===2);near(r2.lengthKm,3*.01*6000);near(r2.dropM,(field.height[2]-0)*8000);near(r2.slopeMPerKm,r2.dropM/r2.lengthKm);near(r2.catchmentKm2,5*6000*6000);
 const rv=P.rivers.find(r=>r.id===1);near(rv.lengthKm,P.reaches.find(r=>r.id===1).lengthKm+r2.lengthKm);assert.deepEqual(P.record,sc.record);
 assert.throws(()=>Rivers.physical(R,field,null));assert.throws(()=>Rivers.physical(null,field,sc));
});
// --- настоящие модули ---
function run(seed,w,h,mode,steps=mode==='const'?20:40){
 const base=G.generate({seed:'riv-'+seed,w,h,continents:4}),field=Relief.build({w,h,land:base.land},base.height),dr=Drainage.build(field),hi=Hier.build(field,dr),m=Surface.create(field,hi,Fill),hist=FH.create(w,h);let st=m.empty();
 for(let s=0;s<steps;s++){const P=(mode==='const'||s<20)?.02:0,rt=Routing.build(field,dr,{precipitation:P,runoffCoefficient:.5},st.redistribution.depth);hist.observe(field,dr,rt,.05);st=m.advance(st,{precipitation:P,evaporation:.001,runoffCoefficient:.5},.05);}
 const cat=Objects.build(field,{w,h,depth:st.redistribution.depth},{adjacency:'hydrology'}),links=Links.build(field,hi,st.redistribution,cat);
 return {field,dr,hist:hist.snapshot(),cat,links};
}
test('Реальные данные: русла разбиты на участки без пропусков и повторов; реки = цепочки участков; один исток на реку',()=>{
 let rivers=0;for(const [w,h] of [[144,72],[360,180]])for(const seed of ['a','c','e'])for(const mode of ['const','wetdry']){
  const x=run(seed,w,h,mode),R=Rivers.build(x.field,x.dr,x.hist,{catalog:x.cat,links:x.links}),tag=w+'x'+h+' '+seed+' '+mode;
  assert.equal(R.reaches.reduce((a,r)=>a+r.cellCount,0),R.summary.activeCells,tag);
  const seen=new Set();for(const rv of R.rivers)for(const id of rv.reaches){assert(!seen.has(id),tag);seen.add(id);}assert.equal(seen.size,R.reaches.length,tag);
  const byId=new Map(R.reaches.map(r=>[r.id,r]));for(const rv of R.rivers){for(let k=0;k+1<rv.reaches.length;k++)assert.equal(byId.get(rv.reaches[k]).downstream,rv.reaches[k+1],tag);assert.equal(byId.get(rv.reaches[0]).river,rv.id);}
  const hasIncoming=new Set(R.reaches.filter(r=>r.downstream!==null).map(r=>r.downstream));assert.equal(R.rivers.length,R.reaches.filter(r=>!hasIncoming.has(r.id)).length,tag+' истоки');
  assert.equal(R.rivers.length,R.summary.riverCount);assert.equal(R.summary.tributaries+R.summary.toOcean+R.summary.toClosedBasin+R.summary.toLake+R.summary.belowThreshold,R.rivers.length,tag+' устья');
  for(const r of R.reaches)if(r.endMeanFlow<r.startMeanFlow-1e-18){assert(r.cells.slice(0,-1).some(c=>x.hist.wetTime[c]>0),tag+' сток убывает вниз без перехвата озером');}
  const rid=new Map(R.rivers.map(r=>[r.id,r]));for(const rv of R.rivers)if(rv.mouth.type==='tributary'){const p=rid.get(rv.mouth.joinsRiver);assert(p&&p.catchmentSteradians>=rv.catchmentSteradians*(1-1e-12),tag+' водосбор притока меньше');assert(p.order>=rv.order,tag+' порядок притока');}
  assert.equal(R.regime.dryPhaseObserved,mode==='wetdry',tag);assert.equal(R.regime.throughout+R.regime.intermittent,R.rivers.length);if(mode==='const')assert.equal(R.regime.intermittent,0);
  for(const rv of R.rivers)if(rv.mouth.type==='closed'&&rv.mouth.lakeAnchor!==null)assert(x.links.links.some(l=>l.anchorCell===rv.mouth.lakeAnchor),tag);
  for(const l of R.lakes)if(l.outlet&&x.field.land[l.outlet.toCell]){assert(l.outlet.continuesInReach!==null||l.outlet.endsAt,tag);if(l.outlet.continuesInReach===null)assert(l.outlet.endsAt.type==='closed'||l.outlet.endsAt.type==='ocean',tag+' '+JSON.stringify(l.outlet.endsAt));else assert.equal(l.outlet.endsAt,null);}
  rivers+=R.rivers.length;}
 assert(rivers>10000,'рек '+rivers);
});
test('Реальные данные: топология не зависит от сухой фазы, режим зависит; результат детерминирован',()=>{
 const a=run('c',360,180,'const'),b=run('c',360,180,'wetdry'),Ra=Rivers.build(a.field,a.dr,a.hist),Rb=Rivers.build(b.field,b.dr,b.hist);
 assert.deepEqual(Ra.reaches.map(r=>[r.id,r.river,r.end.type,r.end.cell]),Rb.reaches.map(r=>[r.id,r.river,r.end.type,r.end.cell]));
 assert.equal(Ra.regime.dryPhaseObserved,false);assert.equal(Rb.regime.dryPhaseObserved,true);assert(Rb.regime.intermittent>=Rb.rivers.length*.99,'в сухой фазе источники прекращают сток: '+Rb.regime.intermittent+'/'+Rb.rivers.length);
 assert.deepEqual(JSON.parse(JSON.stringify(Rivers.build(a.field,a.dr,a.hist))),JSON.parse(JSON.stringify(Ra)));
});
test('Реальные данные: выбор по порядку замкнут по притокам и убывает; физические величины конечны и согласованы',()=>{
 const x=run('c',360,180,'const'),R=Rivers.build(x.field,x.dr,x.hist,{catalog:x.cat,links:x.links});let prev=Infinity;
 for(let o=1;o<=R.summary.maxOrder;o++){const s=Select.select(R,{minOrder:o});assert.equal(s.counts.addedForConnectivity,0,'порядок '+o);assert(s.rivers.length<=prev);prev=s.rivers.length;}
 const s3=Select.select(R,{minOrder:3});assert(s3.rivers.length>0&&s3.rivers.length<R.rivers.length/5,'порядок>=3: '+s3.rivers.length+' из '+R.rivers.length);
 const sc=Scale.create({radiusKm:6371}),P=Rivers.physical(R,x.field,sc),landKm2=sc.describe(x.field).landAreaKm2;
 for(const r of P.rivers){assert(Number.isFinite(r.lengthKm)&&r.lengthKm>0&&r.dropM>=0&&r.catchmentKm2<=landKm2*(1+1e-9));}
 const longest=P.rivers.reduce((a,r)=>r.lengthKm>a.lengthKm?r:a);console.log('  360x180 R=6371: рек '+R.rivers.length+', порядок до '+R.summary.maxOrder+', >=3: '+s3.rivers.length+'; длиннейшая '+Math.round(longest.lengthKm)+' км, перепад '+Math.round(longest.dropM)+' м, водосбор '+Math.round(longest.catchmentKm2).toLocaleString('en')+' км²');
});
console.log(JSON.stringify({passed:true,scope:'river objects/selection/physical on hand-built graphs and real modules 144x72 and 360x180',notChecked:'discharge, groundwater, seasons, session/UI wiring, browser, Electron, CI'}));
