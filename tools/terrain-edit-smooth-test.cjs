'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Base=require('../src/terrain-edit-core'),Core=require('../src/terrain-edit-smooth').extend(Base),Session=require('../src/terrain-edit-session'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hierarchy=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill');
const field=(w=12,h=6)=>({w,h,land:new Uint8Array(w*h).fill(1),height:new Float64Array(w*h).fill(.2)}),values=s=>({land:Array.from(s.land),height:Array.from(s.height)});let groups=0;
async function test(name,fn){await fn();console.log('\n['+(++groups)+'] '+name+'\n    PASS');}
(async()=>{
 await test('Flat surface no-op and original modes unchanged',()=>{
  const f=field(),c=Core.create(f),before=values(c.snapshot());assert.equal(c.stroke({cells:[30],mode:'smooth',radius:1,amount:1}).changedCells,0);assert.deepEqual(values(c.snapshot()),before);assert.equal(c.canUndo,false);
  for(const mode of ['raise','lower','land','ocean']){const a=Base.create(f),b=Core.create(f),command={cells:[30],mode,radius:.7,amount:.1};a.stroke(command);b.stroke(command);assert.deepEqual(values(b.snapshot()),values(a.snapshot()));}
 });
 await test('Peak reduced within original range; coast, ocean and input preserved',()=>{
  const f=field(),center=30;f.height[center]=.8;f.land[center-1]=0;f.height[center-1]=NaN;const input=values(f),c=Core.create(f);c.stroke({cells:[center],mode:'smooth',radius:.000001,amount:.5});const s=c.snapshot();assert(s.height[center]<.8&&s.height[center]>.2);assert.deepEqual(Array.from(s.land),input.land);assert(Number.isNaN(s.height[center-1]));for(let i=0;i<s.height.length;i++)if(s.land[i])assert(s.height[i]>=.2&&s.height[i]<=.8);assert.deepEqual(values(f),input);
 });
 await test('Seam and both polar neighbours without top-bottom raster wrap',()=>{
  for(const [center,near,far] of [[36,47,0],[0,6,60],[60,66,0]]){
   const run=farHeight=>{const f=field();f.land.fill(0);f.height.fill(NaN);for(const [i,v] of [[center,.8],[near,.2],[far,farHeight]]){f.land[i]=1;f.height[i]=v;}const c=Core.create(f);c.stroke({cells:[center],mode:'smooth',radius:.000001,amount:1});return c.snapshot().height[center];};
   assert(run(.9)<.8);assert.equal(run(.9),run(.1));
  }
 });
 await test('One undo, duplicate/order independence and no new extremes',()=>{
  const f=field();for(let i=0;i<f.height.length;i++)f.height[i]=.1+(i%7)*.1;
  const a=Core.create(f),b=Core.create(f),before=values(a.snapshot()),command={mode:'smooth',radius:.9,amount:.8};a.stroke({...command,cells:[29,30,29]});b.stroke({...command,cells:[30,29]});const after=values(a.snapshot());assert.deepEqual(after,values(b.snapshot()));assert.notDeepEqual(after,before);for(const v of after.height)assert(v>=.1&&v<=.7000000000000001);a.undo();assert.deepEqual(values(a.snapshot()),before);assert.equal(a.canUndo,false);a.redo();assert.deepEqual(values(a.snapshot()),after);
 });
 await test('JSON stays compatible with original core; rejected commands are atomic',()=>{
  const f=field();f.height[30]=.8;const c=Core.create(f);c.stroke({cells:[30],mode:'smooth',radius:.8,amount:.5});const patch=JSON.parse(JSON.stringify(c.exportPatch())),other=Base.create(f);other.importPatch(patch);assert.deepEqual(values(other.snapshot()),values(c.snapshot()));assert.equal(patch.schema,Base.SCHEMA);const before=values(c.snapshot());
  for(const command of [{cells:[-1],mode:'smooth',radius:1},{cells:[30],mode:'smooth',radius:0},{cells:[30],mode:'smooth',radius:1,amount:NaN},{cells:[30],mode:'smooth',radius:1,extra:true}])assert.throws(()=>c.stroke(command),/stroke/);assert.deepEqual(values(c.snapshot()),before);
 });
 await test('Real water lifecycle after smoothing and no-op water preservation',async()=>{
  const f=field(8,4);f.height[9]=.8;f.land[15]=0;f.height[15]=NaN;
  const deps={Core,Relief,Drainage,Hierarchy,Surface,Fill,yieldStep:()=>Promise.resolve()},s=Session.create(Relief.build(f,f.height),deps);
  assert.equal((await s.runWater()).status,'completed');assert(s.snapshot().depth);const before=values(s.snapshot());assert(s.stroke({cells:[9],mode:'smooth',radius:.01,amount:.5}));assert.equal(s.snapshot().depth,null);const after=values(s.snapshot());s.undo();assert.deepEqual(values(s.snapshot()),before);s.redo();assert.deepEqual(values(s.snapshot()),after);assert.equal((await s.runWater()).status,'completed');assert(Math.abs(s.snapshot().ledger.residual)<1e-10);
  const flat=field(8,4),q=Session.create(Relief.build(flat,flat.height),deps);await q.runWater();const previous=q.snapshot();assert.equal(q.stroke({cells:[9],mode:'smooth',radius:.5,amount:1}),false);assert.deepEqual(q.snapshot().ledger,previous.ledger);assert.equal(q.snapshot().revision,previous.revision);
 });
 await test('Page loads extension before session and exposes the new mode',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/terrain-editor.html'),'utf8');assert(html.includes('editor-ui4'));assert(html.includes('value="smooth"'));assert(html.indexOf('src="terrain-edit-core.js"')<html.indexOf('src="terrain-edit-smooth.js"'));assert(html.indexOf('src="terrain-edit-smooth.js"')<html.indexOf('src="terrain-edit-session.js"'));
 });
 console.log('\nSUMMARY: '+groups+' groups passed.');console.log('SCOPE: actual extended core on small grids; land-only neighbour filter, history, original-schema JSON and real numerical water after smoothing.');console.log('NOT CHECKED: full 360x180 procedural boot, appearance, real pointer gestures, performance or Mac.');
})().catch(error=>{console.error(error);process.exitCode=1;});
