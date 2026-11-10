'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Session=require('../src/terrain-edit-session'),Routing=require('../src/rainfall-runoff-routing'),Reaches=require('../src/runoff-reach-network'),Display=require('../src/runoff-reach-display'),Page=require('../src/terrain-editor-page');
// Controlled core/geometry/water fixtures isolate publication, not solver physics.
const w=8,h=4,n=w*h,base={w,h,land:new Uint8Array(n),height:new Float64Array(n).fill(NaN)};
for(const i of [7,0,4,12]){base.land[i]=1;base.height[i]=.2;}
function fixture(){
 let failRouting=false,failWater=false,failGeometry=false;
 const Core={create(b){let changes=[];return {exportPatch:()=>({changes:changes.map(v=>v.slice())}),importPatch(p){if(!Array.isArray(p.changes))throw Error('patch');changes=p.changes.map(v=>v.slice());},snapshot(){const land=b.land.slice(),height=b.height.slice();for(const [i,l,z] of changes){land[i]=l;height[i]=z;}return {land,height};},stroke(c){if(c.noop)return {changedCells:0};changes=[[12,1,.3]];return {changedCells:1};}};}};
 const neighbors=i=>{const out=new Set(),x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;let X=x+dx,Y=y+dy;if(Y<0){Y=-Y-1;X+=w/2;}else if(Y>=h){Y=2*h-Y-1;X+=w/2;}const j=Y*w+(X%w+w)%w;if(j!==i)out.add(j);}return [...out];};
 const Relief={build(frame,height){if(failGeometry)throw Error('geometry failure');return {...frame,height,area:new Float64Array(n).fill(.1),east:new Float64Array(n),north:new Float64Array(n),neighbors};}};
 const Drainage={build(){const receiver=new Int32Array(n).fill(-2);receiver[7]=0;receiver[0]=4;receiver[4]=12;receiver[12]=20;return {w,h,receiver};}};
 const Hierarchy={build:()=>({basins:[{}]})},Fill={};
 const state=tick=>{const depth=new Float64Array(n);if(tick>0&&tick<20)depth[4]=.05;return {tick,redistribution:{depth},ledger:{inputTotal:tick,storedTotal:0,boundaryTotal:tick,evapTotal:0,residual:0}};};
 const Surface={create:()=>({empty:()=>state(0),advance(s){if(failWater)throw Error('water failure');return state(s.tick+1);}})};
 const deps={Core,Relief,Drainage,Hierarchy,Fill,Surface,Routing:{build(...args){if(failRouting)throw Error('routing failure');return Routing.build(...args);}},Reaches,yieldStep:()=>Promise.resolve()};
 return {deps,neighbors,setRoutingFailure:v=>failRouting=v,setWaterFailure:v=>failWater=v,setGeometryFailure:v=>failGeometry=v};
}
let groups=0;
async function group(name,fn){await fn();groups++;console.log('PASS '+name);}
(async()=>{
 await group('Final-step INITIAL mask, seam and polar paths, real routing and reach modules',async()=>{
  const f=fixture(),s=Session.create(base,f.deps);assert.equal(s.snapshot().rivers,null);assert.equal((await s.runWater()).status,'completed');const a=s.snapshot();assert.equal(a.rivers.step,20);assert.equal(a.depth[4],0);assert(a.rivers.network.nodes.some(v=>v.cell===4&&v.kind==='wet-entry'));assert(a.rivers.network.reaches.some(v=>v.cells.join(',')==='7,0,4'));assert(f.neighbors(7).includes(0));assert(f.neighbors(0).includes(4));assert.equal(a.rivers.routing.flow[4],0);
 });
 await group('Cancellation including final yield keeps matched old water/network',async()=>{
  const f=fixture(),s=Session.create(base,f.deps);await s.runWater();const before=s.snapshot();for(const stop of [3,20]){assert.equal((await s.runWater(k=>{if(k===stop)s.cancel();})).status,'cancelled');assert.deepEqual(s.snapshot(),before);}
 });
 await group('Routing or water failure rolls back both results and clears busy',async()=>{
  const f=fixture(),s=Session.create(base,f.deps);await s.runWater();const before=s.snapshot();f.setRoutingFailure(true);await assert.rejects(s.runWater(),/routing failure/);assert.deepEqual(s.snapshot(),before);f.setRoutingFailure(false);f.setWaterFailure(true);await assert.rejects(s.runWater(),/water failure/);assert.deepEqual(s.snapshot(),before);
 });
 await group('Edits supersede in-flight calculation; snapshots cannot mutate publication',async()=>{
  const f=fixture(),s=Session.create(base,f.deps);await s.runWater();const before=s.snapshot(),copy=s.snapshot();copy.rivers.routing.flow.fill(99);copy.rivers.network.nodes[0].cell=31;copy.rivers.network.reaches[0].cells.fill(31);copy.rivers.network.summary.maxRate=99;assert.deepEqual(s.snapshot(),before);assert.equal((await s.runWater(k=>{if(k===3)s.stroke({});})).status,'cancelled');assert.equal(s.snapshot().depth,null);assert.equal(s.snapshot().rivers,null);assert.equal(s.snapshot().busy,false);
 });
 await group('No-op and rejected edits preserve water; edit/undo/redo/load/clear reset both',async()=>{
  const f=fixture(),s=Session.create(base,f.deps);await s.runWater();const before=s.snapshot();assert.equal(s.stroke({noop:true}),false);assert.deepEqual(s.snapshot(),before);f.setGeometryFailure(true);assert.throws(()=>s.stroke({}),/geometry failure/);assert.deepEqual(s.snapshot(),before);f.setGeometryFailure(false);s.stroke({});const edited=s.save();for(const action of [()=>s.undo(),()=>s.redo(),()=>s.clearWater(),()=>s.load({changes:[]}),()=>s.load(edited)]){await s.runWater();action();assert.equal(s.snapshot().depth,null);assert.equal(s.snapshot().rivers,null);}
 });
 await group('Concurrent busy call cannot replace running task; legacy dependencies remain supported',async()=>{
  const f=fixture(),s=Session.create(base,f.deps),task=s.runWater();assert.equal((await s.runWater()).status,'busy');assert.equal((await task).status,'completed');const legacy={...f.deps};delete legacy.Routing;delete legacy.Reaches;const a=Session.create(base,legacy);await a.runWater();assert(a.snapshot().depth);assert.equal(a.snapshot().rivers,null);assert.throws(()=>Session.create(base,{...legacy,Routing}),/together/);
 });
 await group('Pixels share real reach painter, toggles do not mutate data; comparisons exclude rivers',async()=>{
  const s=Session.create(base,fixture().deps);await s.runWater();const a=s.snapshot(),before=s.snapshot(),normal=Page.terrainPixels(a,true),on=Page.terrainPixels(a,true,null,true,Display);assert.notDeepEqual(on,normal);assert.deepEqual(on,Display.paint({pixels:normal},a.rivers.network,a.rivers.routing).pixels);assert.deepEqual(Page.terrainPixels(a,false,null,true,Display),Page.terrainPixels(a,false));assert.deepEqual(Page.terrainPixels(a,true,null,false,Display),normal);const mask=new Uint8Array(n);mask[0]=1;assert.deepEqual(Page.terrainPixels(a,true,mask,true,Display),Page.terrainPixels(a,true,mask));const untouched=1;assert.deepEqual(on.slice(untouched*4,untouched*4+4),normal.slice(untouched*4,untouched*4+4));assert.deepEqual(s.snapshot(),before);
 });
 await group('Source contracts: modules before creation, all workspace sessions inherit dependencies, main-canvas PNG',()=>{
  const page=fs.readFileSync(path.join(__dirname,'../src/terrain-editor-page.js'),'utf8');new vm.Script(page);assert(page.includes("'rainfall-runoff-routing.js','runoff-reach-network.js','runoff-reach-display.js'"));assert(page.includes('Routing:RainfallRunoffRouting,Reaches:RunoffReachNetwork'));assert(page.includes("$('showRivers').onchange"));assert(page.includes('canvas.toBlob('));assert(page.includes("im.data.set(terrainPixels(s,$('showWater').checked,null,$('showRivers').checked,RunoffReachDisplay))"));
 });
 console.log(JSON.stringify({groups,scope:'real runoff/reach/pixel modules; controlled core, geometry and water fixtures; no real solver, generated world, browser, Electron, CI or Mac run'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
