'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const ctx={window:{FM:{hashString:s=>{s=String(s);let h=1779033703^s.length;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),3432918353);h=(h<<13)|(h>>>19);}h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return (h^(h>>>16))>>>0;},mulberry32:a=>()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;}}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/composition-v3.js'),'utf8'),ctx);
const L=ctx.window.FM.naturalLayout;let cases=0,improved=0,moves=0;
for(const K of [3,4,5,6])for(let seed=0;seed<20;seed++){
 const p=L.plan('s'+seed,K,480,320);assert.equal(p.targets.length,K);assert.equal(JSON.stringify(p),JSON.stringify(L.plan('s'+seed,K,1440,960)));
 const items=Array.from({length:K},(_,i)=>({id:i,cx:0.16+(i%3)*0.32,cy:0.14+Math.floor(i/3)*0.35,r:0.065}));
 const result=L.relax(p,items,q=>{const out=[];for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){const x=q.cx+dx*0.015,y=q.cy+dy*0.015;if(x<0.09||x>0.91||y<0.09||y>2/3-0.09)continue;if(items.some(b=>b!==q&&Math.hypot(x-b.cx,y-b.cy)<q.r+b.r+0.025))continue;out.push({x,y});}return out;},(q,c)=>{q.cx=c.x;q.cy=c.y;});
 assert(result.after<=result.before+1e-12);if(result.after<result.before-1e-9)improved++;moves+=result.moves;
 for(let a=0;a<K;a++)for(let b=a+1;b<K;b++)assert(Math.hypot(items[a].cx-items[b].cx,items[a].cy-items[b].cy)>=items[a].r+items[b].r+0.025-1e-9);cases++;
}
const prep=require('../scripts/enable-natural-v3.cjs');assert.equal(prep.hash(''),'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
const htmlOld=prep.rules['src/index.html'].edits[2][0],htmlNew=prep.rules['src/index.html'].edits[2][1];assert(htmlNew.includes('display:none'));assert(htmlNew.includes('id="epochs"'));assert(htmlNew.includes('id="epochsV"'));
for(const [file,r] of Object.entries(prep.rules))for(const [old,value,n] of r.edits){assert(old&&value&&n>0);assert.equal(typeof value,'string');}
console.log(JSON.stringify({syntheticLayouts:cases,improved,moves,nonIncreasingEnergy:true,syntheticGapsPreserved:true,scaleIndependentPlans:true,epochIdsRetained:true,scope:'Synthetic circles and rule checks, not rendered world validation'},null,2));
