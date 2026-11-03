'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),api=require(path.resolve(process.argv[2]||'.','src/spherical-drainage.js'));
function graph(heights,edges,areas=heights.map(()=>1),dist=()=>1){return {w:heights.length,h:1,land:Uint8Array.from(heights,z=>Number(z!==null)),height:Float64Array.from(heights,z=>z===null?NaN:z),area:Float64Array.from(areas),neighbors:i=>edges[i],angularDistance:dist};}
function check(f){const before={land:Array.from(f.land),height:Array.from(f.height),area:Array.from(f.area)},r=api.build(f);assert.deepEqual(Array.from(f.land),before.land);assert.deepEqual(Array.from(f.height),before.height);assert.deepEqual(Array.from(f.area),before.area);assert.ok(r.stats.balanceError<1e-10);for(let i=0;i<f.land.length;i++)if(f.land[i]){let j=i;const visited=new Set();while(j>=0&&f.land[j]){assert.ok(!visited.has(j));visited.add(j);const next=r.receiver[j];if(next>=0&&f.land[next]){assert.ok(f.height[next]<=f.height[j]);assert.ok(r.accumulation[next]>=r.accumulation[j]);}j=next;}}return r;}
let r=check(graph([3,2,1,null],[[1],[0,2],[1,3],[2]],[2,3,5,100]));assert.deepEqual(Array.from(r.accumulation),[2,5,10,0]);assert.equal(r.basins[0].kind,'water-outlet');assert.equal(r.stats.waterOutletAreaSteradians,10);assert.deepEqual(r.network(5),[[1,2],[2,3]]);
r=check(graph([4,1,4],[[1],[0,2],[1]]));assert.equal(r.basins.length,1);assert.equal(r.receiver[1],-1);assert.equal(r.stats.closedAreaSteradians,3);
r=check(graph([2,2,2,1,null],[[1],[0,2],[1,3],[2,4],[3]]));assert.equal(r.basins.length,1);assert.equal(r.terminal[0],3);
r=check(graph([1,1,1],[[1,2],[0,2],[0,1]]));assert.equal(r.basins.length,1);assert.equal(r.basins[0].terminal,0);
r=check(graph([3,2,1],[[1,2],[0],[0]],[1,1,1],(i,j)=>i===2||j===2?10:1));assert.equal(r.receiver[0],1);
r=check(graph([null,null],[[],[]]));assert.equal(r.stats.basinCount,0);assert.throws(()=>r.network(0),/Positive/);
assert.throws(()=>api.build(graph([NaN],[[]])),/Invalid land/);assert.throws(()=>api.build(graph([1],[[1]])),/Invalid drainage neighbor/);
let seed=42;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
for(let k=0;k<100;k++){const z=Array.from({length:50},()=>random()<.15?null:1+Math.floor(random()*5)),edges=z.map((_,i)=>[(i+49)%50,(i+1)%50]);check(graph(z,edges,z.map(()=>.1+random())));}
const sphere=require(path.resolve(process.argv[2]||'.','src/regional-relief-integration.js'));
const w=720,h=360,n=w*h,land=new Uint8Array(n),z=new Float32Array(n).fill(-1);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(y>=90&&y<270){land[i]=1;z[i]=.2+.1*Math.cos(2*Math.PI*x/w)+.05*Math.sin(6*Math.PI*y/h);}}
const spherical=sphere.build({w,h,land},z),start=performance.now(),large=api.build(spherical),elapsedMs=performance.now()-start;
assert.equal(large.stats.landCount,129600);assert.ok(large.stats.balanceError<1e-10);assert.ok(large.stats.waterOutletAreaSteradians>0);assert.ok(large.stats.closedAreaSteradians>0);
const small=sphere.build({w:8,h:4,land:new Uint8Array(32).fill(1)},new Float32Array(32).fill(1));assert.ok(small.neighbors(0).includes(4));assert.ok(small.neighbors(8).includes(15));check(small);
console.log(JSON.stringify({passed:true,randomizedFields:100,sphericalLoad:{w,h,elapsedMs,...large.stats},scope:'synthetic fields using actual spherical-field module, including 720x360; no real A/B terrain run'}));

