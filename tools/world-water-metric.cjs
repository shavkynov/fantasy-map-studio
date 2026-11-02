'use strict';
const Domain=require('../src/world-domain.js');
// Four edge-neighbours; periodic longitude, no latitude wrap or pole shortcuts.
function measure(s){
 if(!s||!Number.isInteger(s.width)||!Number.isInteger(s.height)||s.width<1||s.height<1||s.width*s.height>2100000||!s.coverage||s.coverage.length!==s.width*s.height)throw Error('Invalid full-sphere grid');
 const W=s.width,H=s.height,N=W*H;
 for(const v of s.coverage){if(!Number.isInteger(v)||v<0||v>32)throw Error('Invalid coverage');if(v>1)throw Error('Overlapping frame is not eligible for water measurement');}
 const sphere=Domain.createSphere({radiusKm:1}),areas=Array.from({length:H},(_,y)=>sphere.cellAreaKm2(W,H,y)/sphere.totalAreaKm2),seen=new Uint8Array(N),queue=new Int32Array(N);let largest=0;
 for(let start=0;start<N;start++){
  if(seen[start]||s.coverage[start]!==0)continue;
  let head=0,tail=0,area=0;queue[tail++]=start;seen[start]=1;
  while(head<tail){const i=queue[head++],x=i%W,y=Math.floor(i/W);area+=areas[y];
   const neighbours=[y*W+(x+W-1)%W,y*W+(x+1)%W];if(y>0)neighbours.push(i-W);if(y+1<H)neighbours.push(i+W);
   for(const j of neighbours)if(!seen[j]&&s.coverage[j]===0){seen[j]=1;queue[tail++]=j;}
  }
  largest=Math.max(largest,area);
 }
 return {largestWaterComponentSphereFraction:Math.min(1,largest)};
}
module.exports={measure};
