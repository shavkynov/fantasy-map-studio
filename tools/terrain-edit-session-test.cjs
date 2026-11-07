'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Session=require('../src/terrain-edit-session'),Core=require('../src/terrain-edit-core'),Relief=require('../src/regional-relief-integration'),Drainage=require('../src/spherical-drainage'),Hierarchy=require('../src/basin-spill-hierarchy'),Surface=require('../src/coupled-basin-water'),Fill=require('../src/basin-fill-spill');
const w=8,h=4,n=w*h,land=new Uint8Array(n).fill(1);land[15]=0;
const heights=Float64Array.from({length:n},(_,i)=>.1+(i%5)*.01),base=Relief.build({w,h,land},heights);
const deps={Core,Relief,Drainage,Hierarchy,Surface,Fill,yieldStep:()=>Promise.resolve()};
const values=s=>({land:Array.from(s.land),height:Array.from(s.height)});
let groups=0;
async function test(name,fn){await fn();console.log('\n['+(++groups)+'] '+name+'\n    PASS');}
(async()=>{
 await test('Actual geometry and numerical water / edit resets water / undo redo',async()=>{
  const s=Session.create(base,deps),old=values(s.snapshot());
  assert.equal((await s.runWater()).status,'completed');assert(s.snapshot().depth);assert(Math.abs(s.snapshot().ledger.residual)<1e-10);
  s.stroke({cells:[9],mode:'ocean',radius:.01});assert.equal(s.snapshot().land[9],0);assert.equal(s.snapshot().depth,null);
  const changed=values(s.snapshot());s.undo();assert.deepEqual(values(s.snapshot()),old);s.redo();assert.deepEqual(values(s.snapshot()),changed);
  assert.equal((await s.runWater()).status,'completed');assert(s.snapshot().depth);
 });
 await test('Cancelled or superseded water cannot publish',async()=>{
  const s=Session.create(base,deps);await s.runWater();const previous=s.snapshot().ledger;
  const cancelled=await s.runWater(step=>{if(step===3)s.cancel();});assert.equal(cancelled.status,'cancelled');assert.deepEqual(s.snapshot().ledger,previous);
  const changed=await s.runWater(step=>{if(step===2)s.stroke({cells:[9],mode:'raise',radius:.01});});assert.equal(changed.status,'cancelled');assert.equal(s.snapshot().depth,null);assert.equal(s.snapshot().busy,false);
 });
 await test('Rejected geometry and invalid file leave published state intact',async()=>{
  let reject=false;const s=Session.create(base,{...deps,Hierarchy:{build(...a){if(reject)throw Error('injected geometry rejection');return Hierarchy.build(...a);}}});
  await s.runWater();const before=s.snapshot();reject=true;
  assert.throws(()=>s.stroke({cells:[9],mode:'ocean',radius:.01}),/geometry rejection/);assert.deepEqual(values(s.snapshot()),values(before));assert.deepEqual(s.snapshot().ledger,before.ledger);assert.equal(s.snapshot().canUndo,false);
  const wrong=s.save();wrong.base.height[0]+=.01;assert.throws(()=>s.load(wrong),/another base/);assert.deepEqual(values(s.snapshot()),values(before));
 });
 await test('Edit file round trip and snapshot isolation',async()=>{
  const a=Session.create(base,deps),b=Session.create(base,deps);a.stroke({cells:[9],mode:'ocean',radius:.01});b.load(JSON.parse(JSON.stringify(a.save())));assert.deepEqual(values(a.snapshot()),values(b.snapshot()));assert.equal(b.snapshot().depth,null);b.undo();assert.deepEqual(values(b.snapshot()),values(Session.create(base,deps).snapshot()));const snap=a.snapshot();snap.land.fill(0);assert(a.snapshot().land[0]);
 });
 await test('Browser source contracts / isolated page and exports',()=>{
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'src/terrain-editor.html'),'utf8'),ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
  for(const id of ['brushMode','brushRadius','brushAmount','editorMap','gesture','undo','redo','calculateWater','cancelWater','openEdits','saveEdits','saveImage'])assert(ids.includes(id));
  for(const m of html.matchAll(/<script src="([^"]+)"/g))assert(fs.existsSync(path.join(root,'src',m[1])));
  const page=fs.readFileSync(path.join(root,'src/terrain-editor-page.js'),'utf8');new vm.Script(page);assert(page.includes("canvas.toBlob("));assert(!page.includes('overlay.toBlob'));assert(page.includes("'pointercancel','lostpointercapture'"));
  const generated=require('../scripts/prepare-contact-page.cjs').prepare();assert(generated.includes('href="terrain-editor.html"'));assert(generated.includes('4blocks-contacts-ui1'));
 });
 console.log('\nSUMMARY: '+groups+' groups passed.');
 console.log('SCOPE: real relief → drainage → hierarchy → water solver on small edited grids; cancellation, rollback and file round trip.');
 console.log('NOT CHECKED: real pointer events, full procedural 360×180 page boot, Electron file downloads or native PNG/Mac.');
})().catch(error=>{console.error(error);process.exitCode=1;});
