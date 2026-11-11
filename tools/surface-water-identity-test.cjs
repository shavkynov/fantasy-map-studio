'use strict';
// Устойчивая идентичность водоёмов: синтетические поля, где слияния, разделения, шов по долготе, полюса и
// повторные появления можно проверить вручную. Реальные модули воды здесь не запускаются (см. terrain-edit-water-identity-real-test.cjs).
const assert=require('node:assert/strict'),Objects=require('../src/surface-water-objects'),Identity=require('../src/surface-water-identity');
let count=0;function test(name,fn){fn();console.log('PASS '+(++count)+' '+name);}
const W=8,H=4,N=W*H;
function field(heights){const height=new Float64Array(N).fill(5);for(const [i,v] of Object.entries(heights))height[i]=v;return {w:W,h:H,land:new Uint8Array(N).fill(1),height,area:new Float64Array(N).fill(1)};}
const wet=(cells,d=.5)=>{const depth=new Float64Array(N);for(const i of cells)depth[i]=d;return {w:W,h:H,depth};};
const types=t=>t.snapshot().events.map(e=>e.type);
test('Слияние: наследует идентификатор пятно с более низким якорем; разделение: прежний якорь сохраняет идентификатор',()=>{
 const f=field({9:1,13:2,10:3,11:3,12:3}),t=Identity.create(f,Objects);
 t.observe(wet([9,13]),1,.05);let s=t.snapshot();assert.deepEqual(s.current.map(o=>o.id),[9,13]);assert.deepEqual(s.events.map(e=>[e.type,e.to[0]]),[['appear',9],['appear',13]]);
 t.observe(wet([9,10,11,12,13]),2,.1);s=t.snapshot();assert.deepEqual(s.current.map(o=>o.id),[9]);const merge=s.events.find(e=>e.type==='merge');assert.deepEqual(merge,{step:2,time:.1,type:'merge',from:[9,13],to:[9],heir:9});
 t.observe(wet([9,10,12,13]),3,.15);s=t.snapshot();assert.deepEqual(s.current.map(o=>o.id),[9,13]);assert.deepEqual(s.events.find(e=>e.type==='split'),{step:3,time:.15,type:'split',from:[9],to:[9,13],keeps:9});
 t.observe(wet([]),4,.2);s=t.snapshot();assert.deepEqual(s.events.filter(e=>e.type==='dry').map(e=>e.from[0]),[9,13]);assert.equal(s.current.length,0);assert(s.bodies.every(b=>!b.active));
 t.observe(wet([13]),5,.25);s=t.snapshot();const b13=s.bodies.find(b=>b.id===13);assert.equal(b13.appearances,3);assert.equal(b13.firstStep,1);assert.equal(b13.lastStep,5);assert(b13.active);assert.equal(s.bodies.find(b=>b.id===9).appearances,1+0);
 assert.deepEqual(s.counts,{bodiesEver:2,bodiesNow:1,appear:3,dry:2,merge:1,split:1,reorganize:0,reanchor:0});assert.equal(s.steps.length,5);
});
test('Повторный запуск и второй трекер на тех же данных дают тот же результат',()=>{
 const f=field({9:1,13:2,10:3,11:3,12:3}),run=()=>{const t=Identity.create(f,Objects);t.observe(wet([9,13]),1,.05);t.observe(wet([9,10,11,12,13]),2,.1);return t.snapshot();};assert.deepEqual(run(),run());
});
test('Шов по долготе объединяет пятно; идентификатор — клетка с меньшей высотой, при равенстве меньший индекс',()=>{
 const f=field({8:2,15:1}),t=Identity.create(f,Objects);t.observe(wet([8,15]),1,1);assert.deepEqual(t.snapshot().current.map(o=>[o.id,o.cellCount]),[[15,2]]);
 const g=field({9:1,10:1}),u=Identity.create(g,Objects);u.observe(wet([9,10]),1,1);assert.equal(u.snapshot().current[0].id,9);
});
test('Диагональное соседство и полюса не объединяют; северный и южный края не замыкаются',()=>{
 const f=field({}),t=Identity.create(f,Objects);t.observe(wet([0,9]),1,1);assert.equal(t.snapshot().current.length,2);
 const u=Identity.create(f,Objects);u.observe(wet([0,24]),1,1);assert.equal(u.snapshot().current.length,2);
});
test('Перенос пятна без слияния: перепривязка якоря фиксируется отдельным событием, не как продолжение',()=>{
 const f=field({17:1,18:2,19:.5}),t=Identity.create(f,Objects);t.observe(wet([17,18]),1,1);t.observe(wet([18,19]),2,2);const e=t.snapshot().events.at(-1);assert.deepEqual(e,{step:2,time:2,type:'reanchor',from:[17],to:[19]});
});
test('Одновременные слияние и разделение — «reorganize»',()=>{
 const f=field({9:1,17:3,25:2,13:2,21:3,29:1}),t=Identity.create(f,Objects);t.observe(wet([9,17,25,13,21,29]),1,1);assert.deepEqual(t.snapshot().current.map(o=>o.id),[9,29]);
 t.observe(wet([9,10,11,12,13,25,26,27,28,29]),2,2);const e=t.snapshot().events.filter(e=>e.step===2);assert.equal(e.length,1);assert.equal(e[0].type,'reorganize');assert.equal(e[0].from.length,2);assert.equal(e[0].to.length,2);
});
test('Входные данные не изменяются; снимок независим от внутреннего состояния',()=>{
 const f=field({9:1}),w=wet([9]),before=JSON.stringify([Array.from(f.height),Array.from(w.depth)]),t=Identity.create(f,Objects);t.observe(w,1,1);assert.equal(JSON.stringify([Array.from(f.height),Array.from(w.depth)]),before);
 const s=t.snapshot();s.bodies[0].id=-1;s.events.push({});s.current.length=0;assert.equal(t.snapshot().bodies[0].id,9);assert.equal(t.snapshot().events.length,1);assert.equal(t.snapshot().current.length,1);assert(Object.isFrozen(t.snapshot().metadata));
});
test('Неверные входы отклоняются; состояние после ошибки не портится',()=>{
 assert.throws(()=>Identity.create(field({}),{}));assert.throws(()=>Identity.create({w:8,h:4,height:new Float64Array(3)},Objects));assert.throws(()=>Identity.create(field({}),Objects,{extra:1}));
 const t=Identity.create(field({9:1}),Objects);t.observe(wet([9]),2,1);for(const [wt,s,tm] of [[wet([9]),2,2],[wet([9]),1,2],[wet([9]),3,.5],[wet([9]),3,NaN],[wet([9]),1.5,3],[{w:W,h:H,depth:new Float64Array(3)},3,3],[null,3,3]])assert.throws(()=>t.observe(wt,s,tm));
 const snap=JSON.stringify(t.snapshot());t.observe(wet([9]),3,2);assert.equal(t.snapshot().steps.length,2);assert.equal(JSON.parse(snap).steps.length,1);
});
console.log(JSON.stringify({passed:true,scope:'synthetic 8x4 fields: merge/split/appear/dry/reanchor, seam, diagonal, poles, ties, immutability, validation',notChecked:'real generated worlds, session integration, UI'}));
