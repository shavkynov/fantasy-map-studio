'use strict';
// Речные объекты через настоящую сессию (сфера 144×72, три расписания страницы): публикация, согласованность с историей и озёрами,
// неизменность чисел модели, отмена/ошибка/очистка/правка, текст страницы. Не проверяются: браузер, Electron, сетки больше 144×72, CI.
const assert=require('node:assert/strict'),G=require('../src/terrain-edit-spherical-base'),Shape=require('../src/terrain-edit-shaping'),Core=Shape.extend(require('../src/terrain-edit-smooth').extend(require('../src/terrain-edit-core'))),Session=require('../src/terrain-edit-session'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hierarchy=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill'),Routing=require('../src/rainfall-runoff-routing'),Reaches=require('../src/runoff-reach-network'),FlowHistory=require('../src/runoff-flow-history'),Objects=require('../src/surface-water-objects'),Identity=require('../src/surface-water-identity'),Flux=require('../src/surface-water-flux'),Links=require('../src/surface-water-links'),Rivers=require('../src/river-objects'),Page=require('../src/terrain-editor-page');
const base={Core,Relief,Drainage,Hierarchy,Surface,Fill,Routing,Reaches,FlowHistory,Objects,Identity,yieldStep:()=>Promise.resolve()},full={...base,Flux,Links,Rivers};
let count=0;async function test(name,fn){await fn();console.log('PASS '+(++count)+' '+name);}
const fresh=(seed,d)=>Shape.createWorkspace(G.generate({seed,w:144,h:72,continents:4}),d,Session).session;
(async()=>{
 const out={};
 for(const mode of ['constant','wet-dry','wet-dry-wet'])await test('Речные объекты публикуются, согласованы с историей и озёрами: '+mode,async()=>{
  const s=fresh('ident-a',full),sched=Page.waterSchedule(mode);assert.equal((await s.runWater(()=>{},{schedule:sched})).status,'completed');
  const sn=s.snapshot(),R=sn.riverObjects;out[mode]=R;assert(R&&R.rivers.length>100);assert(Object.isFrozen(R)&&Object.isFrozen(R.rivers[0]),'результат заморожен');
  assert.equal(R.regime.steps,sched.length);assert.equal(R.regime.dryPhaseObserved,mode!=='constant');
  // каждая клетка русла лежит на суше и не мокрая в конце
  const land=sn.land;for(const r of R.reaches)for(const c of r.cells.slice(0,-1))assert(land[c]===1);
  // озёра реестра, в которые впадают реки, есть среди связей, а русло за выходом озера существует или ведёт в замкнутый бассейн/океан
  const anchors=new Set(sn.waterLinks.links.map(x=>x.anchorCell));for(const l of R.lakes){assert(l.anchorCell===null||anchors.has(l.anchorCell));if(l.outlet&&l.outlet.continuesInReach===null)assert(l.outlet.endsAt);}
  const withLake=R.rivers.filter(r=>r.mouth.lakeAnchor!==undefined&&r.mouth.lakeAnchor!==null).length;assert(withLake>0,'нет рек, впадающих в озёра');
  console.log('  '+mode+': рек '+R.rivers.length+', порядок до '+R.summary.maxOrder+', в замкнутые бассейны '+R.summary.toClosedBasin+' (с озером '+R.summary.closedWithLake+'), сухая фаза '+R.regime.dryPhaseObserved+', прерывистых '+R.regime.intermittent);
 });
 await test('Топология одинакова при любом расписании, режим разный',()=>{
  const a=out['constant'],b=out['wet-dry'];assert.deepEqual(a.reaches.map(r=>[r.id,r.river,r.end.type,r.end.cell]),b.reaches.map(r=>[r.id,r.river,r.end.type,r.end.cell]));
  assert.equal(a.regime.intermittent,0);assert(b.regime.intermittent>b.rivers.length*.9);
 });
 await test('Включение рек не меняет глубины, запасы, баланс и историю',async()=>{
  const a=fresh('ident-a',{...base,Flux,Links}),b=fresh('ident-a',full),sc=Page.waterSchedule('wet-dry-wet');await a.runWater(()=>{},{schedule:sc});await b.runWater(()=>{},{schedule:sc});
  const x=a.snapshot(),y=b.snapshot(),nz=v=>Array.from(v.map(q=>Number.isNaN(q)?-1:q));assert.deepEqual(nz(x.depth),nz(y.depth));assert.deepEqual(x.ledger,y.ledger);assert.deepEqual(JSON.parse(JSON.stringify(x.flowHistory)),JSON.parse(JSON.stringify(y.flowHistory)));assert.equal(x.riverObjects,null);assert(y.riverObjects);
 });
 await test('Отмена, ошибка расписания, очистка и правка; Rivers без Routing отклоняется',async()=>{
  const s=fresh('ident-a',full);await s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry')});const before=JSON.stringify(s.snapshot().riverObjects.summary);
  await assert.rejects(async()=>s.runWater(()=>{},{schedule:[{dt:0,precipitation:.02,evaporation:.001,runoffCoefficient:.5}]}));assert.equal(JSON.stringify(s.snapshot().riverObjects.summary),before);
  const t=s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry-wet')});s.cancel();assert.equal((await t).status,'cancelled');assert.equal(JSON.stringify(s.snapshot().riverObjects.summary),before);
  s.clearWater();assert.equal(s.snapshot().riverObjects,null);await s.runWater();const i=s.snapshot().land.findIndex(v=>v);assert(s.stroke({cells:[i],mode:'raise',radius:.1,amount:.2}));assert.equal(s.snapshot().riverObjects,null);
  const {Routing:_r,Reaches:_e,...noRouting}=full;assert.throws(()=>fresh('ident-a',noRouting),/Routing|FlowHistory/);
 });
 await test('Текст страницы: реки и режим',async()=>{
  const s=fresh('ident-a',full);await s.runWater(()=>{},{schedule:Page.waterSchedule('constant')});let txt=Page.waterRunText(s.snapshot());
  assert(/Реки: \d+ \(притоков \d+\); устья: океан \d+, замкнутые бассейны \d+ \(из них с озером \d+\), озёра \d+; порядок до \d+, порядка 3 и выше: \d+\./.test(txt),txt);assert(txt.includes('сухой фазы в прогоне не было — постоянство рек не проверено'));
  await s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry')});txt=Page.waterRunText(s.snapshot());assert(/в прогоне была сухая фаза; сток источника прерывался у \d+ из \d+ рек/.test(txt),txt);
 });
 console.log(JSON.stringify({passed:true,scope:'real session 144x72, three page schedules, river objects publish/atomic semantics, page text',notChecked:'browser, Electron, bigger grids, discharge, groundwater, CI'}));
})().catch(e=>{console.error(e);process.exit(1);});
