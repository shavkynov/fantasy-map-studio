'use strict';
const assert=require('node:assert/strict');
const D=require('../src/spherical-drainage.js'),H=require('../src/basin-spill-hierarchy.js');
function line(z){return {w:z.length,h:1,land:Uint8Array.from(z,v=>v===null?0:1),height:Float64Array.from(z,v=>v===null?NaN:v),area:new Float64Array(z.length).fill(1),neighbors:i=>[i-1,i+1].filter(j=>j>=0&&j<z.length),angularDistance:()=>1};}
function clone(d){return {...d,receiver:d.receiver.slice(),terminal:d.terminal.slice(),basins:d.basins.map(b=>({...b}))};}
const f=line([null,2,3,4,4,5,5,2]),d=D.build(f);
f.height=Float64Array.from([NaN,5,2,6,2,3,1,5]);
assert.throws(()=>H.build(f,d),/uphill/);
const fresh=H.build(f,D.build(f));
assert.deepEqual(Array.from(fresh.potentialDepth).slice(1),[0,3,0,4,3,5,1]);
const g=line([null,3,2,1]),good=D.build(g),before=JSON.stringify(good);
H.build(g,good);assert.equal(JSON.stringify(good),before);
const bad=clone(good);bad.receiver[3]=0;assert.throws(()=>H.build(g,bad),/not a neighbor/);
const terminal=clone(good);terminal.terminal[2]=1;assert.throws(()=>H.build(g,terminal),/terminal mismatch/);
const metadata=clone(good);metadata.basins[0].kind='wrong';assert.throws(()=>H.build(g,metadata),/metadata mismatch/);
const roots=clone(good);roots.basins.push({...roots.basins[0]});assert.throws(()=>H.build(g,roots),/count mismatch/);
const missing=clone(good);delete missing.receiver;assert.throws(()=>H.build(g,missing),/Invalid spill input/);
g.area[1]=2;assert.throws(()=>H.build(g,good),/metadata mismatch/);g.area[1]=1;
g.land[1]=0;assert.throws(()=>H.build(g,good),/water-mask mismatch/);g.land[1]=1;
g.land[1]=2;assert.throws(()=>H.build(g,good),/land mask/);g.land[1]=1;
const plateau=line([1,1,1]);plateau.neighbors=i=>[0,1,2].filter(j=>i!==j);
const cycle={...D.build(plateau),receiver:new Int32Array([1,0,-1]),terminal:new Int32Array([2,2,2]),basins:[{terminal:2,receiver:-1,kind:'closed-minimum',areaSteradians:3}]};
assert.throws(()=>H.build(plateau,cycle),/cycle/);
const compatible=line([null,4,3,2]),same=D.build(compatible);
compatible.height=Float64Array.from([NaN,5,4,3]);
assert.deepEqual(H.build(compatible,same),H.build(compatible,D.build(compatible)));
H.build(line([null,null]),D.build(line([null,null])));
console.log('PASS hierarchy input guard: stale terrain, fresh rebuild, non-neighbor receiver, terminal, metadata, duplicate/missing basins, area/mask mismatch, plateau cycle and compatible terrain change');
