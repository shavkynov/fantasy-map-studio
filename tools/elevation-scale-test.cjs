'use strict';
// Физическая шкала высот: единицы, площади, уклоны, запись шкалы; на синтетике и на реальном поле рельефа 144×72.
// Не проверяется: импорт растра, правка клеток, браузер, Electron, согласованность с картами локаций.
const assert=require('node:assert/strict'),S=require('../src/elevation-scale'),G=require('../src/terrain-edit-spherical-base'),Relief=require('../src/regional-relief-integration');
let n=0;const test=(name,fn)=>{fn();console.log('PASS '+(++n)+' '+name);};
const near=(a,b,t=1e-9)=>assert(Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),a+' != '+b);
test('Перевод высот туда и обратно, значение по умолчанию',()=>{
 const s=S.create({radiusKm:6371});assert.equal(s.record.metersPerUnit,8000);near(s.toMeters(.5),4000);near(s.toRelative(s.toMeters(.123)),.123,1e-15);
 const t=S.create({radiusKm:6371,metersPerUnit:8848});near(t.toMeters(1),8848);
});
test('Площади и расстояния: сфера Земли',()=>{
 const s=S.create({radiusKm:6371});near(s.areaKm2(4*Math.PI),4*Math.PI*6371**2);near(s.distanceKm(Math.PI/2),6371*Math.PI/2);near(s.distanceKm(2*Math.PI),40030.17359,1e-6);
});
test('Уклон: относительная высота на радиан → метры на километр',()=>{
 const s=S.create({radiusKm:6371,metersPerUnit:10000});near(s.slopeMetersPerKm(6371),10000);near(s.slopeMetersPerKm(0),0);near(S.create({radiusKm:3000,metersPerUnit:10000}).slopeMetersPerKm(3000),10000);
});
test('Границы радиуса: Меркурий … Земля (экваториальный)',()=>{
 assert.equal(S.MIN_RADIUS_KM,2440);assert.equal(S.EARTH_RADIUS_KM,6371);for(const r of [2440,3390,6052,6371,6378.137])assert.doesNotThrow(()=>S.create({radiusKm:r}));
});
test('Запись шкалы замкнута, неизменяема и восстанавливается',()=>{
 const s=S.create({radiusKm:5000,metersPerUnit:7000});assert(Object.isFrozen(s.record));assert.throws(()=>{'use strict';s.record.radiusKm=1;});
 const r=S.fromRecord(JSON.parse(JSON.stringify(s.record)));assert.deepEqual(r.record,s.record);assert.throws(()=>S.fromRecord({...s.record,version:'x'}));assert.throws(()=>S.fromRecord(null));assert.throws(()=>S.fromRecord({...s.record,extra:1}),/match/);assert.throws(()=>S.fromRecord({...s.record,datum:'sea floor'}),/match/);assert.throws(()=>S.fromRecord({version:s.record.version,radiusKm:5000,metersPerUnit:7000}),/match/);assert.throws(()=>S.fromRecord([]));
});
test('Неверные входные данные отклоняются',()=>{
 for(const o of [undefined,null,[],{},{radiusKm:0},{radiusKm:-1},{radiusKm:NaN},{radiusKm:2439},{radiusKm:6378.2},{radiusKm:6371,metersPerUnit:0},{radiusKm:6371,metersPerUnit:Infinity},{radiusKm:6371,extra:1}])assert.throws(()=>S.create(o),String(JSON.stringify(o)));
 const s=S.create({radiusKm:6371});assert.throws(()=>s.toMeters(NaN));assert.throws(()=>s.areaKm2(-1));assert.throws(()=>s.distanceKm(Infinity));assert.throws(()=>s.describe({}));
 assert.throws(()=>s.describe({w:2,h:1,land:Uint8Array.of(1,0),height:Float64Array.of(NaN,NaN),area:Float64Array.of(1,1)}),/finite/);
});
test('describe на синтетическом поле: площадь суши и среднее по площади',()=>{
 const s=S.create({radiusKm:3000,metersPerUnit:1000}),f={w:2,h:1,land:Uint8Array.of(1,1),height:Float64Array.of(.1,.3),area:Float64Array.of(1,3)},d=s.describe(f);
 near(d.landAreaKm2,4*9e6);near(d.landFraction,1);near(d.meanLandHeightM,250);near(d.minLandHeightM,100);near(d.maxLandHeightM,300);
});
test('Реальное поле 144×72: сумма площадей = 4πR², ширина клетки, высоты в метрах',()=>{
 const w=G.generate({seed:'scale-a',w:144,h:72,continents:4}),frame={w:144,h:72,land:w.land},field=Relief.build(frame,w.height),s=S.create({radiusKm:6371}),d=s.describe(field);
 near(d.totalAreaKm2,4*Math.PI*6371**2,1e-12);near(d.equatorCellWidthKm,40030.17359/144,1e-6);near(d.meridianCellHeightKm,6371*Math.PI/72,1e-12);
 assert(d.landFraction>.18&&d.landFraction<.45,'доля суши '+d.landFraction);assert(d.minLandHeightM>0&&d.maxLandHeightM>d.meanLandHeightM&&d.meanLandHeightM>d.minLandHeightM);
 console.log('  144x72 R=6371:',JSON.stringify({cellKm:+d.equatorCellWidthKm.toFixed(1),landFraction:+d.landFraction.toFixed(3),minM:Math.round(d.minLandHeightM),meanM:Math.round(d.meanLandHeightM),maxM:Math.round(d.maxLandHeightM)}));
});
console.log(JSON.stringify({passed:true,scope:'unit conversions and describe() on synthetic fields and a real 144x72 relief field',notChecked:'raster import, per-cell edit, session/UI integration, location-map consistency, CI'}));
