'use strict';
// Прототип тектонической истории на сфере: инварианты, не вид карты.
// Проверяет: детерминизм, сохранение объёма коры точек, объём воды = объём океана при найденном уровне моря, предел мощности, доля суши,
// эффект параметров (вода, возраст), префиксность истории (stopAtMyr), ошибки параметров.
// Не проверяет: красоту силуэтов, сходство с Землёй по распределению масс, браузер, Electron.
const assert=require('node:assert/strict'),T=require('../src/sphere-tectonic-history');
let n=0;const test=(name,fn)=>{fn();console.log('PASS '+(++n)+' '+name);};
const same=(a,b)=>{if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;};
const run=(o)=>T.generate(Object.assign({seed:'t1',w:180},o));
const base=run({});
test('Детерминизм: одинаковые параметры дают побитно одинаковые поля',()=>{const b=run({});assert(same(base.thickness,b.thickness));assert(same(base.elevationKm,b.elevationKm));assert.equal(base.seaLevelKm,b.seaLevelKm);});
test('Разные seed дают разные миры',()=>{const c=run({seed:'t2'});assert(!same(base.thickness,c.thickness));});
test('Объём коры точек сохраняется всю историю; на сетке «после эрозии + потерянный осадок» = «до эрозии»',()=>{
 const s=base.stats;assert(s.arcAddedVolume>0&&Math.abs(s.pointVolumeEnd/(s.pointVolumeStart+s.arcAddedVolume+s.hotspotAddedVolume)-1)<1e-6,'arc '+s.arcAddedVolume+' '+s.pointVolumeEnd+' '+s.pointVolumeStart);assert(s.sedimentLostVolume>=0&&Math.abs((s.crustVolumeAfterErosion+s.sedimentLostVolume)/s.crustVolumeBeforeErosion-1)<2e-3,[s.crustVolumeAfterErosion,s.sedimentLostVolume,s.crustVolumeBeforeErosion].join());});
test('Мощность коры ограничена (обрушение), нет NaN и отрицательных значений',()=>{let mx=0;for(const v of base.thickness){assert(Number.isFinite(v)&&v>=0);if(v>mx)mx=v;}assert(mx<=66,'max '+mx);});
test('Уровень моря: объём воды выше дна совпадает с заданным',()=>{
 const A=base.cellArea,e=base.elevationKm;let v=0;for(let i=0;i<e.length;i++)if(e[i]<0)v+=-e[i]*A[i];
 assert(Math.abs(v-2.62*4*Math.PI)/(2.62*4*Math.PI)<1e-3,v);});
test('Доля суши — результат модели: с обычной водой в пределах 0.15..0.45',()=>{const f=base.stats.landFraction;assert(f>.15&&f<.45,f);});
test('Больше воды — меньше суши; меньше воды — больше',()=>{const wet=run({waterDepthKm:3.6}),dry=run({waterDepthKm:1.6});
 assert(wet.stats.landFraction<base.stats.landFraction&&base.stats.landFraction<dry.stats.landFraction,[wet.stats.landFraction,base.stats.landFraction,dry.stats.landFraction].join());
 assert(same(wet.thickness,base.thickness),'вода не должна менять тектонику');});
test('История: эпохи записаны, плит 4..8, угловые скорости положительны и физичны (<~12 см/год)',()=>{
 assert.equal(base.history.length,base.stats.epochs);for(const e of base.history){assert(e.plates>=4&&e.plates<=8);for(const w of e.omegaRadPerMyr)assert(w>0&&w<.02);}});
test('Меньшая планета: те же скорости в км/год дают бо́льшие углы (другая карта)',()=>{const sm=run({radiusKm:3500});assert(!same(sm.thickness,base.thickness));});
test('Префиксность: остановка на половине возраста = состояние на середине полной истории',()=>{
 const full=run({ageMyr:900,epochMyr:150,snapshotEveryMyr:450}),half=run({ageMyr:900,epochMyr:150,stopAtMyr:450});
 const mid=full.snapshots.find(s=>s.tMyr===450);assert(mid,'нет снимка на 450');
 const ref=T.generate({seed:'t1',w:180,ageMyr:900,epochMyr:150,stopAtMyr:450,snapshotEveryMyr:450}).snapshots.find(s=>s.tMyr===450);
 assert(same(mid.thickness,ref.thickness));assert.equal(half.stats.time,450);});
test('Ошибки параметров',()=>{for(const bad of[{seed:''},{seed:'x',w:181},{seed:'x',w:1000},{seed:'x',radiusKm:100},{seed:'x',activity:3},{seed:'x',ageMyr:10},{seed:'x',epochMyr:5},{seed:'x',waterDepthKm:20},{seed:'x',continentalFraction:.9},{seed:'x',stopAtMyr:99999},{seed:'x',extra:1}])assert.throws(()=>T.generate(bad),bad.seed+JSON.stringify(bad));});
test('Летопись затоплений: уровень моря на каждой эпохе, морские осадки только на континентальной коре, есть суша с морскими осадками',()=>{
 assert.equal(base.seaLevelHistoryKm.length,base.stats.epochs);assert(base.seaLevelHistoryKm.every(Number.isFinite));
 let sub=0;for(let i=0;i<base.w*base.h;i++){assert(base.marineSedimentKm[i]>=0&&base.submergedMyr[i]>=0&&base.submergedMyr[i]<=base.stats.time+1e-3);if(base.marineSedimentKm[i]>0)sub++;}
 assert(sub>0&&base.stats.landWithMarineSedimentFraction>=0&&base.stats.landWithMarineSedimentFraction<=1);});
test('Океаническая кора: возраст дна конечен, средний возраст реалистичен (30..110 млн лет), есть молодое и старое дно',()=>{
 let aw=0,ag=0,young=0,old=0;for(let i=0;i<base.w*base.h;i++){if(base.thickness[i]<8){const a=base.oceanAgeMyr[i],w=base.cellArea[i];assert(Number.isFinite(a)&&a>=0&&a<=280,'age '+a);aw+=w;ag+=a*w;if(a<30)young+=w;if(a>120)old+=w;}}
 const m=ag/aw;assert(m>30&&m<110,'mean '+m);assert(young>0&&old>0);});
test('Силы: скорости плит получаются из сил (не одинаковы, 0..12 см/год), выше активность — быстрее в среднем',()=>{
 const mean=a=>{let s=0,c=0,mx=0;for(const seed of['t1','t2']){const r=T.generate({seed,w:180,activity:a});for(const e of r.history)for(const o of e.omegaRadPerMyr){const v=o*637.1;s+=v;c++;mx=Math.max(mx,v);}}return{m:s/c,mx};};
 const lo=mean(.5),hi=mean(1.5);assert(hi.m>lo.m,lo.m+' '+hi.m);assert(hi.mx<=12.1&&lo.m>.3,JSON.stringify([lo,hi]));
 const sp=new Set(base.history[1].omegaRadPerMyr.map(o=>o.toFixed(6)));assert(sp.size>1);});
console.log('Тесты тектонической истории пройдены: '+n);
