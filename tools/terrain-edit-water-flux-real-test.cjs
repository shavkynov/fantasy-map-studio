'use strict';
// Потоки воды и связи озёр через настоящую сессию (сфера 144×72, три расписания страницы): публикация, согласованность с реестром и балансом,
// отсутствие влияния на числа модели, отмена/ошибка/очистка. Не проверяются: браузер, Electron, сетки больше 144×72, CI.
const assert=require('node:assert/strict'),G=require('../src/terrain-edit-spherical-base'),Shape=require('../src/terrain-edit-shaping'),Core=Shape.extend(require('../src/terrain-edit-smooth').extend(require('../src/terrain-edit-core'))),Session=require('../src/terrain-edit-session'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hierarchy=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill'),Routing=require('../src/rainfall-runoff-routing'),Reaches=require('../src/runoff-reach-network'),FlowHistory=require('../src/runoff-flow-history'),Objects=require('../src/surface-water-objects'),Identity=require('../src/surface-water-identity'),Flux=require('../src/surface-water-flux'),Links=require('../src/surface-water-links'),Page=require('../src/terrain-editor-page');
const base={Core,Relief,Drainage,Hierarchy,Surface,Fill,Routing,Reaches,FlowHistory,Objects,Identity,yieldStep:()=>Promise.resolve()},full={...base,Flux,Links};
let count=0;async function test(name,fn){await fn();console.log('PASS '+(++count)+' '+name);}
const fresh=(seed,d)=>Shape.createWorkspace(G.generate({seed,w:144,h:72,continents:4}),d,Session).session;
const near=(a,b,t=1e-9)=>assert(Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),a+' != '+b);
(async()=>{
 for(const mode of ['constant','wet-dry','wet-dry-wet'])await test('Потоки и связи публикуются и сходятся с балансом сессии: '+mode,async()=>{
  const s=fresh('ident-a',full),sched=Page.waterSchedule(mode);assert.equal((await s.runWater(()=>{},{schedule:sched})).status,'completed');
  const sn=s.snapshot(),f=sn.waterFlux,l=sn.waterLinks;assert(f&&l);assert.equal(f.steps.length,sched.length);
  near(f.totals.rainInput,sn.ledger.inputTotal,1e-10);near(f.totals.exportedToWater,sn.ledger.boundaryTotal,1e-9);
  for(const st of f.steps){assert(st.maxPoolResidual<1e-12);assert(st.hopVolume>=0&&st.rainInput>=0);}
  assert(l.summary.objectCount>0,'в сценарии нет озёр');assert.equal(l.summary.consistent,true);assert.deepEqual(l.mismatches,[]);assert.equal(l.summary.objectCount,sn.waterBodies.current.length);
  // идентификаторы реестра = якоря связей (одна и та же смежность и порог)
  assert.deepEqual(l.links.map(x=>x.anchorCell).sort((a,b)=>a-b),sn.waterBodies.current.map(o=>o.id).sort((a,b)=>a-b));
  const hop=f.totals.hopVolume,rain=f.totals.rainInput;assert(rain>0);console.log('  '+mode+': новая вода '+rain.toPrecision(4)+', переходы '+hop.toPrecision(4)+' (x'+(hop/rain).toFixed(2)+'), озёр '+l.summary.objectCount);
 });
 await test('Включение потоков и связей не меняет глубины, запасы и баланс',async()=>{
  const a=fresh('flux-b',base),b=fresh('flux-b',full),sc=Page.waterSchedule('wet-dry-wet');await a.runWater(()=>{},{schedule:sc});await b.runWater(()=>{},{schedule:sc});
  const x=a.snapshot(),y=b.snapshot();assert.deepEqual(Array.from(x.depth.map(v=>Number.isNaN(v)?-1:v)),Array.from(y.depth.map(v=>Number.isNaN(v)?-1:v)));assert.deepEqual(x.ledger,y.ledger);assert.deepEqual(x.waterBodies,y.waterBodies);assert.equal(x.waterFlux,null);assert.equal(x.waterLinks,null);
 });
 await test('Отмена, ошибка расписания, очистка и правка сохраняют или сбрасывают результат целиком; Links без Objects отклоняется',async()=>{
  const s=fresh('flux-c',full);await s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry')});const before=JSON.stringify([s.snapshot().waterFlux,s.snapshot().waterLinks]);assert(before!=='[null,null]');
  await assert.rejects(async()=>s.runWater(()=>{},{schedule:[{dt:0,precipitation:.02,evaporation:.001,runoffCoefficient:.5}]}));assert.equal(JSON.stringify([s.snapshot().waterFlux,s.snapshot().waterLinks]),before);
  const t=s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry-wet')});s.cancel();assert.equal((await t).status,'cancelled');assert.equal(JSON.stringify([s.snapshot().waterFlux,s.snapshot().waterLinks]),before);
  s.clearWater();assert.equal(s.snapshot().waterFlux,null);assert.equal(s.snapshot().waterLinks,null);
  await s.runWater();const i=s.snapshot().land.findIndex(v=>v);assert(s.stroke({cells:[i],mode:'raise',radius:.1,amount:.2}));assert.equal(s.snapshot().waterFlux,null);assert.equal(s.snapshot().waterLinks,null);
  const {Objects:_o,Identity:_i,...noObjects}=full;assert.throws(()=>fresh('flux-c',{...noObjects}),/Objects/);
 });
 await test('Текст страницы: строки про воду прогона и озёра',async()=>{
  const s=fresh('flux-d',full);await s.runWater();const sn=s.snapshot(),txt=Page.waterRunText(sn);
  assert(/Вода прогона: новая [\d.e+-]+, ушла за границу/.test(txt),txt);assert(txt.includes('в сумму воды не входит'));assert(/Озёра и гидрология: объектов \d+, соответствие пулам полное/.test(txt),txt);
 });
 console.log(JSON.stringify({passed:true,scope:'real session 144x72, three page schedules, flux/links publish, equality with ledger, atomic semantics',notChecked:'browser, Electron, bigger grids, rivers, per-pool evaporation, CI'}));
})().catch(e=>{console.error(e);process.exit(1);});
