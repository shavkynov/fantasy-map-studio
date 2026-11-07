'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Compare=require('../src/terrain-editor-page'),Core=require('../src/terrain-edit-smooth').extend(require('../src/terrain-edit-core')),Session=require('../src/terrain-edit-session'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hierarchy=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill');
const make=()=>({w:8,h:4,revision:0,land:new Uint8Array(32).fill(1),height:new Float64Array(32).fill(.2),east:new Float64Array(32),north:new Float64Array(32)});let groups=0;
async function test(name,fn){await fn();console.log('\n['+(++groups)+'] '+name+'\n    PASS');}
(async()=>{
 await test('Exact changed-cell mask and height-only denominator',()=>{
  const a=make(),b=make();a.land[2]=0;a.height[2]=NaN;b.height[0]=.3;b.height[1]=.4;b.height[2]=.5;b.land[3]=0;b.height[3]=NaN;const s=Compare.measure(a,b);assert.equal(s.changedCells,4);assert.equal(s.heightCells,2);assert.equal(s.added,1);assert.equal(s.removed,1);assert(Math.abs(s.maxAbs-.2)<1e-12);assert(Math.abs(s.meanAbs-.15)<1e-12);assert.deepEqual(Array.from(s.mask.slice(0,5)),[1,1,2,3,0]);
 });
 await test('A real smooth gesture reports measurable changes; flat no-op is explicit',()=>{
  const f=make();f.height[9]=.8;const core=Core.create(f),before=core.snapshot();core.stroke({cells:[9],mode:'smooth',radius:.01,amount:.5});const m=Compare.measure(before,core.snapshot());assert.equal(m.changedCells,1);assert(m.maxAbs>0);assert.equal(m.maxAbs,m.meanAbs);const flat=Core.create(make()),a=flat.snapshot();flat.stroke({cells:[9],mode:'smooth',radius:.5,amount:1});const zero=Compare.measure(a,flat.snapshot());assert.equal(zero.changedCells,0);assert.equal(zero.maxAbs,0);assert.equal(zero.meanAbs,0);
 });
 await test('Detached terrain-only snapshots; revision invalidation and mode guards',()=>{
  const a=make(),b=make();b.revision=1;b.height[0]=.4;b.depth=new Float64Array(32).fill(.1);const tracker=Compare.createComparison(),pair=tracker.record(a,b,'smooth');a.height[0]=5;b.height[0]=6;assert.equal(pair.before.height[0],.2);assert.equal(pair.after.height[0],.4);assert.equal(pair.before.depth,undefined);assert.equal(pair.after.depth,undefined);assert.equal(tracker.select('before',1),true);assert.equal(tracker.mode,'before');assert.equal(tracker.select('invalid',1),false);assert.equal(tracker.current(2),null);assert.equal(tracker.mode,'current');assert.equal(tracker.select('after',2),false);tracker.record(make(),make(),'smooth');tracker.clear();assert.equal(tracker.current(0),null);
 });
 await test('Fixed palette can hide a numeric change; highlight reveals the exact cell',()=>{
  const a=make(),b=make();a.height[9]=2;b.height[9]=1.9;const before=Compare.terrainPixels(a),after=Compare.terrainPixels(b),m=Compare.measure(a,b);assert.deepEqual(before,after);assert(m.maxAbs>0);const highlighted=Compare.terrainPixels(b,false,m.mask);assert.notDeepEqual(highlighted,after);assert.deepEqual(Array.from(highlighted.slice(9*4,9*4+4)),[255,220,30,255]);assert.deepEqual(Array.from(highlighted.slice(0,4)),Array.from(after.slice(0,4)));
 });
 await test('Same renderer for both views; water excluded from comparison',()=>{
  const a=make();a.depth=new Float64Array(32).fill(.1);const tracker=Compare.createComparison(),pair=tracker.record(a,a,'smooth');assert.deepEqual(Compare.terrainPixels(pair.before),Compare.terrainPixels(pair.after));assert.notDeepEqual(Compare.terrainPixels(a,true),Compare.terrainPixels(pair.before));assert.deepEqual(Compare.terrainPixels(a,false),Compare.terrainPixels(pair.after));
 });
 await test('Viewing before/after does not change real session, history or new water',async()=>{
  const f=make();f.height[9]=.8;f.land[15]=0;f.height[15]=NaN;const deps={Core,Relief,Drainage,Hierarchy,Surface,Fill,yieldStep:()=>Promise.resolve()},session=Session.create(Relief.build(f,f.height),deps);await session.runWater();const before=session.snapshot();session.stroke({cells:[9],mode:'smooth',radius:.01,amount:.5});const after=session.snapshot(),tracker=Compare.createComparison();tracker.record(before,after,'smooth');await session.runWater();const published=session.snapshot();for(const mode of ['before','after','changes','current']){assert(tracker.select(mode,published.revision));const pair=tracker.current(published.revision);Compare.terrainPixels(mode==='before'?pair.before:pair.after,false,mode==='changes'?pair.stats.mask:null);}assert.deepEqual(session.snapshot(),published);session.undo();assert.equal(tracker.current(session.snapshot().revision),null);
 });
 await test('Browser source contracts: readonly capture, isolated overlay, clearing and full-map PNG',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/terrain-editor-page.js'),'utf8');for(const text of ["comparison.mode!=='current'","e.stopImmediatePropagation()","},true);","comparisonLayer","compare-ui1","session[name]();comparison.clear();paint();","session.load(value);comparison.clear();paint();","canvas.toBlob("])assert(source.includes(text));assert(!source.includes('comparisonCanvas.toBlob'));assert(!source.includes('overlay.toBlob'));assert(source.includes("im.data.set(terrainPixels(s,$('showWater').checked))"));
 });
 console.log('\nSUMMARY: '+groups+' groups passed.');console.log('SCOPE: real smoothing snapshots, exact metrics, shared pixel renderer, saturated-colour counterexample, revision guards and real numerical water/session isolation. Browser wiring checked as source contracts.');console.log('NOT CHECKED: native UI clicks, actual PNG export, full procedural boot or Mac.');
})().catch(error=>{console.error(error);process.exitCode=1;});
