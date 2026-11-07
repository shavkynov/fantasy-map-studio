'use strict';
const assert=require('node:assert/strict');
const Core=require('../src/terrain-edit-core');
const w=8,h=4,n=w*h;
const field={w,h,land:new Uint8Array(n).fill(1),height:new Float64Array(n).fill(.2)};
const values=s=>({land:Array.from(s.land),height:Array.from(s.height)});
let groups=0;
function test(name,fn){fn();console.log('\n['+(++groups)+'] '+name+'\n    PASS');}

test('Atomic stroke / detached input / one undo',()=>{
 const e=Core.create(field),before=values(e.snapshot());
 assert(e.stroke({cells:[8,9],mode:'raise',radius:.9,amount:.1}).changedCells>0);
 const after=values(e.snapshot());assert.notDeepEqual(after,before);
 assert.deepEqual(Array.from(field.height),new Array(n).fill(.2));
 e.undo();assert.deepEqual(values(e.snapshot()),before);assert.equal(e.canUndo,false);
 e.redo();assert.deepEqual(values(e.snapshot()),after);
 const copy=e.snapshot();copy.land.fill(0);assert.equal(e.snapshot().land[8],1);
});

test('Longitude seam / physical polar distance / duplicate samples',()=>{
 const e=Core.create(field);e.stroke({cells:[8,8],mode:'raise',radius:.9,amount:.1});
 const s=e.snapshot();assert(s.height[15]>.2);assert(s.height[12]===.2);
 const other=Core.create(field);other.stroke({cells:[8],mode:'raise',radius:.9,amount:.1});
 assert.deepEqual(values(other.snapshot()),values(s));
 const polar=Core.create(field);polar.stroke({cells:[0],mode:'raise',radius:1,amount:.1});
 assert(polar.snapshot().height[4]>.2);
});

test('Coast changes / height clamps / no-op history',()=>{
 const e=Core.create(field);
 e.stroke({cells:[9],mode:'lower',radius:.01,amount:1});assert.equal(e.snapshot().height[9],1e-6);
 e.stroke({cells:[9],mode:'ocean',radius:.01});assert.equal(e.snapshot().land[9],0);assert(Number.isNaN(e.snapshot().height[9]));
 const revision=e.snapshot().revision;e.stroke({cells:[9],mode:'raise',radius:.01});assert.equal(e.snapshot().revision,revision);
 e.stroke({cells:[9],mode:'land',radius:.01,amount:.3});assert.equal(e.snapshot().height[9],.3);
 e.undo();assert.equal(e.snapshot().land[9],0);e.redo();assert.equal(e.snapshot().land[9],1);
});

test('History limit / new branch clears redo',()=>{
 const e=Core.create(field,{maxHistory:2});
 for(const cell of [8,9,10])e.stroke({cells:[cell],mode:'raise',radius:.01});
 e.undo();e.undo();assert.equal(e.canUndo,false);assert(e.snapshot().height[8]>.2);
 e.stroke({cells:[11],mode:'raise',radius:.01});assert.equal(e.canRedo,false);
});

test('JSON round trip / exact base guard / import is replace and undoable',()=>{
 const e=Core.create(field);e.stroke({cells:[8],mode:'ocean',radius:.01});
 const patch=JSON.parse(JSON.stringify(e.exportPatch())),other=Core.create(field);
 other.stroke({cells:[10],mode:'raise',radius:.01});const prior=values(other.snapshot());
 other.importPatch(patch);assert.deepEqual(values(other.snapshot()),values(e.snapshot()));
 other.undo();assert.deepEqual(values(other.snapshot()),prior);
 const wrong=structuredClone(patch);wrong.base.height[1]=.3;
 const before=values(other.snapshot());assert.throws(()=>other.importPatch(wrong),/another base/);assert.deepEqual(values(other.snapshot()),before);
 const bad=structuredClone(patch);bad.changes.push([8,1,.3]);assert.throws(()=>other.importPatch(bad),/patch cell/);assert.deepEqual(values(other.snapshot()),before);
});

test('Rejected command leaves state and history unchanged',()=>{
 const e=Core.create(field),before=values(e.snapshot());
 for(const command of [{cells:[-1],mode:'raise',radius:1},{cells:[8],mode:'raise',radius:0},{cells:[8],mode:'raise',radius:1,amount:NaN}])assert.throws(()=>e.stroke(command),/stroke/);
 assert.deepEqual(values(e.snapshot()),before);assert.equal(e.canUndo,false);
});
console.log('\nSUMMARY: '+groups+' groups passed.');
console.log('SCOPE: actual detached brush/history/patch core on small grids.');
console.log('NOT CHECKED: page input, real A/B water rebuild, A/B Save/Open integration, PNG or Mac.');
