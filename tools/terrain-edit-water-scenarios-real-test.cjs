'use strict';
// Испытательные расписания воды на настоящих модулях: сферическая основа → рельеф → дренаж → иерархия впадин →
// связанная вода → дождевая маршрутизация → история стока, через настоящую сессию и расписания страницы редактора.
// Условные воздействия, не климат и не сезоны; реальный браузер, Electron и Mac здесь не проверяются.
const assert=require('node:assert/strict'),G=require('../src/terrain-edit-spherical-base'),Shape=require('../src/terrain-edit-shaping'),Core=Shape.extend(require('../src/terrain-edit-smooth').extend(require('../src/terrain-edit-core'))),Session=require('../src/terrain-edit-session'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hierarchy=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill'),Routing=require('../src/rainfall-runoff-routing'),Reaches=require('../src/runoff-reach-network'),FlowHistory=require('../src/runoff-flow-history'),Page=require('../src/terrain-editor-page');
const deps={Core,Relief,Drainage,Hierarchy,Surface,Fill,Routing,Reaches,FlowHistory,yieldStep:()=>Promise.resolve()};
const near=(a,b,t=1e-12)=>assert(Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),`${a} != ${b}`);
let count=0;async function test(name,fn){await fn();console.log('PASS '+(++count)+' '+name);}
const legacy=Array.from({length:20},()=>({dt:.05,precipitation:.02,evaporation:.001,runoffCoefficient:.5}));
const fresh=seed=>Shape.createWorkspace(G.generate({seed,w:144,h:72,continents:4}),deps,Session).session;
const same=(a,b)=>assert.deepEqual(a,b);
(async()=>{
 await test('Запуск по умолчанию, явное прежнее расписание и сценарий «равномерный дождь» совпадают',async()=>{
  const a=fresh('sched-a'),b=fresh('sched-a'),c=fresh('sched-a');
  assert.equal((await a.runWater()).status,'completed');assert.equal((await b.runWater(()=>{},{schedule:legacy})).status,'completed');assert.equal((await c.runWater(()=>{},{schedule:Page.waterSchedule('constant')})).status,'completed');
  const [x,y,z]=[a,b,c].map(s=>s.snapshot());for(const o of [y,z]){same(o.depth,x.depth);same(o.ledger,x.ledger);same(o.rivers,x.rivers);same(o.flowHistory,x.flowHistory);same(o.waterRun,x.waterRun);}
  assert.equal(x.waterRun.steps.length,20);near(x.waterRun.totalTime,1);near(x.flowHistory.totalTime,1);assert.equal(x.rivers.step,20);
 });
 const runs={};
 for(const mode of ['constant','wet-dry','wet-dry-wet'])await test('Согласованность результата: '+mode,async()=>{
  const s=fresh('sched-b'),schedule=Page.waterSchedule(mode);assert.equal((await s.runWater(()=>{},{schedule})).status,'completed');const sn=s.snapshot();runs[mode]=sn;
  assert.equal(sn.waterRun.steps.length,schedule.length);near(sn.waterRun.totalTime,schedule.length*.05);near(sn.flowHistory.totalTime,sn.waterRun.totalTime);assert.equal(sn.rivers.step,schedule.length);
  assert(Math.abs(sn.ledger.residual)<1e-10,'residual '+sn.ledger.residual);assert(sn.depth.every((d,i)=>sn.land[i]?Number.isFinite(d)&&d>=0:true),'глубина озёр на суше конечна и неотрицательна');
  const lastWet=schedule.at(-1).precipitation>0,reaches=sn.rivers.network.reaches.length;assert(lastWet?reaches>0:reaches===0,'сеть последнего шага: '+reaches+', осадки '+schedule.at(-1).precipitation);
  assert.equal(sn.waterRun.steps.at(-1).forcing.precipitation,schedule.at(-1).precipitation);
 });
 await test('Сухой период уменьшает запас и долю времени течения, вход воды не меняется; повторный дождь возобновляет сеть',()=>{
  const c=runs.constant,d=runs['wet-dry'],w=runs['wet-dry-wet'];
  near(d.ledger.inputTotal,c.ledger.inputTotal,1e-12);assert(d.ledger.storedTotal<=c.ledger.storedTotal);assert(d.ledger.evapTotal>c.ledger.evapTotal);
  assert(w.ledger.inputTotal>d.ledger.inputTotal);assert(w.rivers.network.reaches.length>0);
  assert(d.flowHistory.maxObservedDryDuration.some(v=>Number.isFinite(v)&&v>=1-1e-12),'сухой период 1.0 должен наблюдаться хотя бы в одной клетке');
  const occ=(h)=>h.occurrence.reduce((a,b)=>Number.isFinite(b)?a+b:a,0),occD=occ(d.flowHistory),occC=occ(c.flowHistory);assert(occD<occC,'доля времени течения при сухом периоде должна падать: '+occD+' vs '+occC);
 });
 await test('Повторный запуск заменяет результат целиком; отмена и неверное расписание сохраняют прежний',async()=>{
  const s=fresh('sched-c');await s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry')});const before=JSON.stringify(s.snapshot());
  await assert.rejects(async()=>s.runWater(()=>{},{schedule:[{dt:0,precipitation:.02,evaporation:.001,runoffCoefficient:.5}]}));assert.equal(JSON.stringify(s.snapshot()),before);
  const task=s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry-wet')});s.cancel();assert.equal((await task).status,'cancelled');assert.equal(JSON.stringify(s.snapshot()),before);
  assert.equal((await s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry-wet')})).status,'completed');assert.equal(s.snapshot().waterRun.steps.length,60);
  s.clearWater();const c=s.snapshot();assert.equal(c.waterRun,null);assert.equal(c.flowHistory,null);assert.equal(c.rivers,null);assert.equal(c.ledger,null);
 });
 await test('Правка рельефа сбрасывает расписание, историю и сеть',async()=>{
  const s=fresh('sched-d');await s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry')});const i=s.snapshot().land.findIndex(Boolean);s.stroke({cells:[i],mode:'raise',radius:.01,amount:.1});
  const c=s.snapshot();assert.equal(c.waterRun,null);assert.equal(c.flowHistory,null);assert.equal(c.rivers,null);assert.equal(c.depth,null);
 });
 console.log(JSON.stringify({passed:true,scope:'real spherical base→relief→drainage→spill hierarchy→coupled water→runoff routing→flow history through real session, 144x72, prescribed scenario schedules',notChecked:'native browser, Electron/Mac, 360x180 timing, climate or seasons, river objects'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
