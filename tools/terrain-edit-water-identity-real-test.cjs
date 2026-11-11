'use strict';
// Идентичность водоёмов на настоящих модулях через настоящую сессию (сфера 144×72, расписания страницы).
// Проверяется только трекер и его публикация в сессии; физика воды не менялась. Браузер, Electron и Mac здесь не проверяются.
const assert=require('node:assert/strict'),G=require('../src/terrain-edit-spherical-base'),Shape=require('../src/terrain-edit-shaping'),Core=Shape.extend(require('../src/terrain-edit-smooth').extend(require('../src/terrain-edit-core'))),Session=require('../src/terrain-edit-session'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hierarchy=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill'),Routing=require('../src/rainfall-runoff-routing'),Reaches=require('../src/runoff-reach-network'),FlowHistory=require('../src/runoff-flow-history'),Objects=require('../src/surface-water-objects'),Identity=require('../src/surface-water-identity'),Page=require('../src/terrain-editor-page');
const deps={Core,Relief,Drainage,Hierarchy,Surface,Fill,Routing,Reaches,FlowHistory,Objects,Identity,yieldStep:()=>Promise.resolve()};
let count=0;async function test(name,fn){await fn();console.log('PASS '+(++count)+' '+name);}
const fresh=(seed,d=deps)=>Shape.createWorkspace(G.generate({seed,w:144,h:72,continents:4}),d,Session).session;
(async()=>{
 const runs={};
 for(const mode of ['constant','wet-dry','wet-dry-wet'])await test('Водоёмы публикуются и согласованы с итоговой глубиной: '+mode,async()=>{
  const s=fresh('ident-a'),sched=Page.waterSchedule(mode);assert.equal((await s.runWater(()=>{},{schedule:sched})).status,'completed');
  const sn=s.snapshot(),wb=sn.waterBodies;runs[mode]=wb;assert(wb,'waterBodies отсутствуют');assert.equal(wb.steps.length,sched.length);
  const wet=sn.depth.reduce((a,d,i)=>a+(sn.land[i]&&d>1e-9?1:0),0),cells=wb.current.reduce((a,o)=>a+o.cellCount,0);
  assert(cells<=wet+0&&wb.counts.bodiesNow===wb.current.length,'клетки водоёмов не превышают мокрые клетки суши');
  assert(wb.counts.bodiesEver>=wb.counts.bodiesNow);for(const o of wb.current)assert(o.id>=0&&o.id<sn.height.length);
 });
 await test('Первые 20 шагов «constant» и «wet-dry» дают одинаковый ряд (расписания совпадают до 20-го шага)',()=>{
  // wet-dry = 20 влажных + 20 сухих, constant = 20 влажных; после 20 шагов тела должны совпадать.
  const a=runs.constant,b=runs['wet-dry'];assert(b.steps.length===40&&a.steps.length===20);
  assert.deepEqual(b.steps.slice(0,20),a.steps);
 });
 await test('Повторный запуск детерминирован; сессия без Identity даёт waterBodies=null',async()=>{
  const a=fresh('ident-a'),b=fresh('ident-a');const sc=Page.waterSchedule('wet-dry-wet');await a.runWater(()=>{},{schedule:sc});await b.runWater(()=>{},{schedule:sc});
  assert.deepEqual(a.snapshot().waterBodies,b.snapshot().waterBodies);
  const {Identity:_i,Objects:_o,...bare}=deps,c=fresh('ident-a',bare);await c.runWater();assert.equal(c.snapshot().waterBodies,null);
  assert.throws(()=>fresh('ident-a',{...bare,Identity}),/together/);
 });
 await test('Отмена, ошибка расписания, очистка и правка рельефа сохраняют или сбрасывают результат целиком',async()=>{
  const s=fresh('ident-c');await s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry')});const before=JSON.stringify(s.snapshot().waterBodies);assert(before!=='null');
  await assert.rejects(async()=>s.runWater(()=>{},{schedule:[{dt:0,precipitation:.02,evaporation:.001,runoffCoefficient:.5}]}));assert.equal(JSON.stringify(s.snapshot().waterBodies),before);
  const t=s.runWater(()=>{},{schedule:Page.waterSchedule('wet-dry-wet')});s.cancel();assert.equal((await t).status,'cancelled');assert.equal(JSON.stringify(s.snapshot().waterBodies),before);
  s.clearWater();assert.equal(s.snapshot().waterBodies,null);
  await s.runWater();assert(s.snapshot().waterBodies);const sn=s.snapshot();const i=sn.land.findIndex(v=>v);
  assert(s.stroke({cells:[i],mode:'raise',radius:.1,amount:.2}));assert.equal(s.snapshot().waterBodies,null);
  await s.runWater();assert(s.snapshot().waterBodies);assert(s.undo());assert.equal(s.snapshot().waterBodies,null);
 });
 await test('Сводка событий и текст страницы',()=>{
  const wb=runs['wet-dry-wet'],c=wb.counts;console.log('  wet-dry-wet:',JSON.stringify(c));
  assert.equal(c.merge,wb.events.filter(e=>e.type==='merge').length);
  const txt=Page.waterRunText({ledger:{inputTotal:1,storedTotal:1,boundaryTotal:1,evapTotal:1,seepTotal:1,residual:0},waterRun:null,waterBodies:wb});assert(/Водоёмы: сейчас \d+, всего \d+/.test(txt));
 });
 console.log(JSON.stringify({passed:true,scope:'real modules 144x72, three page schedules, session publish/cancel/clear/edit',notChecked:'browser UI, Electron, larger grids, CI'}));
})().catch(e=>{console.error(e);process.exit(1);});
