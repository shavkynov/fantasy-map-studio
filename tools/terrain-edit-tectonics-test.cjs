'use strict';
const assert=require('node:assert/strict'),G=require('../src/terrain-edit-spherical-base');
const near=(a,b)=>assert(Math.abs(a-b)<1e-10*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
const p=[1,0,0],n=[0,1,0];
near(G.boundaryMotion([0,0,1],[0,0,-1],p,n).convergence,2);
near(G.boundaryMotion([0,0,-1],[0,0,1],p,n).convergence,-2);
const sliding=G.boundaryMotion([0,1,0],[0,-1,0],p,n);near(sliding.convergence,0);near(sliding.shear,2);
const same=G.boundaryMotion([.1,.2,.3],[.1,.2,.3],p,n);near(same.speed,0);
assert.throws(()=>G.boundaryMotion([0,0,0],[0,0,0],[0,0,0],n));
assert.throws(()=>G.boundaryMotion([NaN,0,0],[0,0,0],p,n));
assert.throws(()=>G.boundaryMotion([0,0,0],[0,0,0],p,p));
let seed=919;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
const vector=()=>[random()-.5,random()-.5,random()-.5];
function rotate(v){const c=Math.cos(.7),s=Math.sin(.7),d=Math.cos(1.1),t=Math.sin(1.1),x=c*v[0]-s*v[1],y=s*v[0]+c*v[1];return [x,d*y-t*v[2],t*y+d*v[2]];}
for(let i=0;i<1000;i++){
 const a=vector(),b=vector(),point=vector(),normal=vector(),c=vector(),m=G.boundaryMotion(a,b,point,normal),swapped=G.boundaryMotion(b,a,point,normal.map(x=>-x)),rotated=G.boundaryMotion(rotate(a),rotate(b),rotate(point),rotate(normal)),common=G.boundaryMotion(a.map((x,k)=>x+c[k]),b.map((x,k)=>x+c[k]),point,normal);
 for(const key of ['convergence','shear','speed']){near(m[key],swapped[key]);near(m[key],rotated[key]);near(m[key],common[key]);}
 near(m.speed*m.speed,m.convergence*m.convergence+m.shear*m.shear);
}
for(let continents=1;continents<=7;continents++){
 const params={seed:'test-a',w:144,h:72,continents},g=G.generate(params),again=G.generate(params);
 assert.deepEqual(g,again);assert.equal(G.measure(g).components,continents);assert.equal(g.tectonics.plates.length,12);
 assert.equal(g.tectonics.plateId.length,g.land.length);
 assert(g.tectonics.metadata.boundarySamples>0);assert(g.tectonics.metadata.convergentSamples>0);assert(g.tectonics.metadata.divergentSamples>0);
 for(let i=0;i<g.land.length;i++){
  assert(g.tectonics.plateId[i]<12);
  for(const key of ['uplift','rift','shear'])assert(Number.isFinite(g.tectonics[key][i])&&g.tectonics[key][i]>=0&&g.tectonics[key][i]<=1+1e-12);
  assert(!(g.tectonics.uplift[i]>0&&g.tectonics.rift[i]>0));
  assert(g.land[i]?Number.isFinite(g.height[i])&&g.height[i]>=1e-6&&g.height[i]<=10:Number.isNaN(g.height[i]));
 }
}
console.log(JSON.stringify({passed:true,analyticCases:4,invalidCases:3,invarianceCases:1000,generatedContinentCounts:7,scope:'production spherical generator and Euler boundary kinematics; no water/session/browser or geological evolution acceptance'}));
