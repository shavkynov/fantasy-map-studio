'use strict';
// Запись шкалы высот в файле карты (fm-terrain-workspace-v2) на настоящем рабочем пространстве 144×72.
// Не проверяются: диалоги выбора файла в странице, Electron/Mac, большие сетки, CI.
const assert=require('node:assert/strict'),Scale=require('../src/elevation-scale'),ImportF=require('../src/elevation-import'),G=require('../src/terrain-edit-spherical-base'),Shape=require('../src/terrain-edit-shaping'),Core=Shape.extend(require('../src/terrain-edit-smooth').extend(require('../src/terrain-edit-core'))),Session=require('../src/terrain-edit-session'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hierarchy=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill');
const Imp=ImportF.create(Scale),scale=Scale.create({radiusKm:5500,metersPerUnit:7000});
const deps={Scale,Core,Relief,Drainage,Hierarchy,Surface,Fill,yieldStep:()=>Promise.resolve()},bare={...deps};delete bare.Scale;
const mk=(d=deps)=>Shape.createWorkspace(G.generate({seed:'persist-a',w:144,h:72,continents:4}),d,Session);
const raster=(w,h)=>{const m=new Float64Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const lon=2*Math.PI*((x+.5)/w-.5),lat=Math.PI*(.5-(y+.5)/h),d=Math.hypot(lon*Math.cos(lat),lat-.2);m[y*w+x]=d<1?Math.round(3000*(1-d)+40):-1500;}return {w,h,meters:m};};
let count=0;const test=(name,fn)=>{fn();console.log('PASS '+(++count)+' '+name);};
const json=v=>JSON.parse(JSON.stringify(v));
test('Импорт сохраняет запись шкалы; файл v2 открывается с теми же высотами и шкалой, без «грязи»',()=>{
 const a=mk();a.stageImported(raster(144,72),scale,Imp).commit();const doc=json(a.document());assert.equal(doc.schema,'fm-terrain-workspace-v2');assert.deepEqual(doc.scale,scale.record);assert.deepEqual(a.info().scale,scale.record);
 const b=mk(),text=JSON.stringify(doc);b.stageOpen(JSON.parse(text)).commit();assert.deepEqual(b.info().scale,scale.record);assert.equal(b.info().persisted,true);assert.equal(b.info().dirty,false);assert.deepEqual(b.session.snapshot().height,a.session.snapshot().height);
 assert(b.markSaved(JSON.stringify(b.document())));assert.deepEqual(json(b.document()),doc);
});
test('Карта без шкалы пишется как прежний v1 без поля scale; v1 открывается без шкалы',()=>{
 const a=mk(),doc=json(a.document());assert.equal(doc.schema,'fm-terrain-workspace-v1');assert(!('scale' in doc));assert.equal(a.info().scale,null);
 const b=mk();b.stageImported(raster(144,72),scale,Imp).commit();assert(b.info().scale);b.stageOpen(doc).commit();assert.equal(b.info().scale,null,'открытие v1 сбрасывает шкалу прежней карты');assert.equal(json(b.document()).schema,'fm-terrain-workspace-v1');
});
test('setScale: привязка к карте, «грязное» состояние, сброс, повтор без изменений, неверная запись',()=>{
 const w=mk();assert.equal(w.info().dirty,false);
 assert.equal(w.setScale(scale.record),true);assert.equal(w.info().dirty,true);assert.equal(json(w.document()).schema,'fm-terrain-workspace-v2');assert.equal(w.setScale(scale.record),false);
 assert.throws(()=>w.setScale({...scale.record,radiusKm:9000}));assert.throws(()=>w.setScale({...scale.record,version:'x'}));assert.throws(()=>w.setScale({}));assert.deepEqual(w.info().scale,scale.record);
 assert.equal(w.setScale(null),true);assert.equal(w.info().scale,null);assert.equal(json(w.document()).schema,'fm-terrain-workspace-v1');assert.equal(w.setScale(null),false);
 assert.throws(()=>mk(bare).setScale(scale.record),/шкалы/);
});
test('Правка кистью сохраняет шкалу и меняет документ',()=>{
 const w=mk();w.stageImported(raster(144,72),scale,Imp).commit();const i=w.session.snapshot().land.findIndex(v=>v),before=JSON.stringify(w.document());
 assert(w.session.stroke({cells:[i],mode:'raise',radius:.1,amount:.2}));assert.notEqual(JSON.stringify(w.document()),before);assert.deepEqual(w.info().scale,scale.record);assert.equal(json(w.document()).scale.metersPerUnit,7000);
});
test('Неверные файлы v2 отклоняются и карта не меняется',()=>{
 const src=mk();src.stageImported(raster(144,72),scale,Imp).commit();const good=json(src.document()),w=mk(),keep=JSON.stringify(w.document());
 const bad=[{...good,scale:undefined},{...good,scale:null},{...good,scale:[]},{...good,scale:{...good.scale,version:'elevation-scale-v0'}},{...good,scale:{...good.scale,radiusKm:100}},{...good,scale:{...good.scale,metersPerUnit:-1}},{...good,scale:{...good.scale,extra:1}},{...good,extra:1},{...good,schema:'fm-terrain-workspace-v3'},{...json(mk().document()),scale:good.scale}];
 bad.forEach((v,k)=>{assert.throws(()=>{if(v.scale===undefined)delete v.scale;w.stageOpen(v);},undefined,'вариант '+k);});assert.equal(JSON.stringify(w.document()),keep);
 assert.throws(()=>mk(bare).stageOpen(good),/шкалы/);
});
console.log(JSON.stringify({passed:true,scope:'workspace document v1/v2 round trip, setScale, validation, edit; real modules 144x72',notChecked:'page file dialogs, Electron/Mac, CI, display of the scale in the editor'}));
