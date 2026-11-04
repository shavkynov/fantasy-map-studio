(function(root){'use strict';
function create(field,hierarchy,fill){
 const {w,h,land,height,area}=field,n=w*h,B=hierarchy.basins.length,groups=Array.from({length:B},()=>[]);
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||land.length!==n||height.length!==n||area.length!==n||hierarchy.w!==w||hierarchy.h!==h||hierarchy.cellBasin.length!==n||typeof fill.redistribute!=='function')throw Error('Invalid coupled field');
 for(let i=0;i<n;i++)if(land[i]){const b=hierarchy.cellBasin[i];if(!Number.isInteger(b)||b<0||b>=B||!Number.isFinite(height[i])||height[i]<=0||!Number.isFinite(area[i])||area[i]<=0)throw Error('Invalid coupled basin');groups[b].push(i);}
 const edges=hierarchy.edges.slice().sort((a,b)=>a.level-b.level||a.a-b.a||a.b-b.b);
 const metadata=Object.freeze({units:'relative-height*steradian; arbitrary model time',forcing:'prescribed, not generated climate',order:'initial-wet rain/runoff, instantaneous routing, frozen-post-inflow-area losses with saddle splits, final routing',losses:'rates frozen for this step; timestep dependent',climate:false,persistentLakes:false,terrainModified:false});
 function empty(){return {redistribution:fill.redistribute(field,hierarchy,new Float64Array(B)),ledger:{initialTotal:0,inputTotal:0,storedTotal:0,pendingTotal:0,boundaryTotal:0,evapTotal:0,seepTotal:0,residual:0},metadata};}
 function sample(v,i,name,max=Infinity){const x=typeof v==='number'?v:v&&v.length===n?v[i]:NaN;if(!Number.isFinite(x)||x<0||x>max)throw Error('Invalid '+name);return x;}
 function advance(state,forcing,dt){
  const old=state&&state.redistribution,ledger=state&&state.ledger;if(!old||!ledger||old.w!==w||old.h!==h||old.depth.length!==n||old.basinStorage.length!==B||!forcing||!Number.isFinite(dt)||dt<=0||ledger.pendingTotal!==0)throw Error('Invalid coupled state');
  for(const k of ['initialTotal','inputTotal','storedTotal','boundaryTotal','evapTotal','seepTotal'])if(!Number.isFinite(ledger[k])||ledger[k]<0)throw Error('Invalid coupled ledger');
  for(const v of old.basinStorage)if(!Number.isFinite(v)||v<0)throw Error('Invalid source inventory');
  const oldVolume=old.basinStorage.reduce((a,b)=>a+b,0),pre=ledger.initialTotal+ledger.inputTotal-oldVolume-ledger.boundaryTotal-ledger.evapTotal-ledger.seepTotal;if(!Number.isFinite(pre)||Math.abs(pre)>1e-10*Math.max(1,ledger.initialTotal+ledger.inputTotal)||Math.abs(oldVolume-ledger.storedTotal)>1e-10*Math.max(1,oldVolume))throw Error('Unbalanced coupled source');
  const supplied=Float64Array.from(old.basinStorage),geometry=new Float64Array(B),e=new Float64Array(n),s=new Float64Array(n);let inputTotal=0;
  for(let i=0;i<n;i++)if(land[i]){if(!Number.isFinite(old.depth[i])||old.depth[i]<0)throw Error('Invalid old depth');geometry[hierarchy.cellBasin[i]]+=old.depth[i]*area[i];const p=sample(forcing.precipitation,i,'precipitation'),c=sample(forcing.runoffCoefficient,i,'runoff coefficient',1);e[i]=sample(forcing.evaporation,i,'evaporation');s[i]=sample(forcing.seepage===undefined?0:forcing.seepage,i,'seepage');const v=p*(old.depth[i]>0?1:c)*area[i]*dt;supplied[hierarchy.cellBasin[i]]+=v;inputTotal+=v;}
  if(forcing.externalInflow!==undefined){if(!forcing.externalInflow||forcing.externalInflow.length!==B)throw Error('Invalid external inflow');for(let b=0;b<B;b++){const v=forcing.externalInflow[b]*dt;if(!Number.isFinite(v)||v<0)throw Error('Invalid external inflow');supplied[b]+=v;inputTotal+=v;}}
  for(let b=0;b<B;b++)if(Math.abs(geometry[b]-old.basinStorage[b])>1e-10*Math.max(1,oldVolume))throw Error('Source depth/inventory mismatch');
  const wet=fill.redistribute(field,hierarchy,supplied),parent=Int32Array.from({length:B},(_,i)=>i),rank=new Uint32Array(B),nodes=new Array(B),positive=new Set(wet.pools.filter(p=>p.volume>0).map(p=>p.id));
  function node(ids,E,S,left=null,right=null,saddle=null){ids.sort((a,b)=>height[a]-height[b]||a-b);const A=new Float64Array(ids.length+1),Z=new Float64Array(ids.length+1);for(let k=0;k<ids.length;k++){A[k+1]=A[k]+area[ids[k]];Z[k+1]=Z[k]+area[ids[k]]*height[ids[k]];}return {ids,A,Z,E,S,left,right,saddle};}
  for(let b=0;b<B;b++){let E=0,S=0;for(const i of groups[b])if(wet.depth[i]>0){E+=e[i]*area[i];S+=s[i]*area[i];}nodes[b]=node(groups[b].slice(),E,S);}
  function find(b){let r=b;while(parent[r]!==r)r=parent[r];while(parent[b]!==b){const next=parent[b];parent[b]=r;b=next;}return r;}
  for(const edge of edges)if(edge.a<B&&edge.b<B&&wet.poolByBasin[edge.a]===wet.poolByBasin[edge.b]&&positive.has(wet.poolByBasin[edge.a])){let a=find(edge.a),b=find(edge.b);if(a===b)continue;if(rank[a]<rank[b]){const t=a;a=b;b=t;}const left=nodes[a],right=nodes[b];nodes[a]=node(left.ids.concat(right.ids),left.E+right.E,left.S+right.S,left,right,edge.level);parent[b]=a;if(rank[a]===rank[b])rank[a]++;}
  function capacity(c,L){let lo=0,hi=c.ids.length;while(lo<hi){const m=(lo+hi)>>1;if(height[c.ids[m]]<L)lo=m+1;else hi=m;}return Math.max(0,L*c.A[lo]-c.Z[lo]);}
  function level(c,v){if(v===0)return height[c.ids[0]];for(let k=1;k<=c.ids.length;k++){const next=k<c.ids.length?height[c.ids[k]]:Infinity;if(v<=next*c.A[k]-c.Z[k]||k===c.ids.length)return (v+c.Z[k])/c.A[k];}throw Error('Invalid loss curve');}
  const remaining=new Float64Array(B),stack=[];let evapTotal=0,seepTotal=0,splitEvents=0;
  for(const pool of wet.pools)if(pool.volume>0){const r=find(pool.basins[0]);if(pool.basins.some(b=>find(b)!==r))throw Error('Disconnected wet pool');stack.push({c:nodes[r],v:pool.volume,t:dt});}
  function account(loss,c){const rate=c.E+c.S;if(rate>0){evapTotal+=loss*c.E/rate;seepTotal+=loss*c.S/rate;}}
  while(stack.length){const {c,v,t}=stack.pop(),rate=c.E+c.S,target=Math.max(0,v-rate*t),leftCap=c.left?capacity(c.left,c.saddle):0,rightCap=c.right?capacity(c.right,c.saddle):0,splitCap=leftCap+rightCap;if(c.left&&v<splitCap-1e-10*Math.max(1,v))throw Error('Pool below internal saddle');
   if(c.left&&target<splitCap){const atSaddle=Math.min(v,splitCap),loss=v-atSaddle,used=rate>0?loss/rate:0,lv=splitCap>0?atSaddle*leftCap/splitCap:0;account(loss,c);splitEvents++;stack.push({c:c.left,v:lv,t:Math.max(0,t-used)},{c:c.right,v:atSaddle-lv,t:Math.max(0,t-used)});}
   else{account(v-target,c);if(target>0){const L=level(c,target);for(const i of c.ids)remaining[hierarchy.cellBasin[i]]+=Math.max(0,L-height[i])*area[i];}}}
  const final=fill.redistribute(field,hierarchy,remaining);if(final.boundaryOutflow>1e-10*Math.max(1,wet.stats.storedTotal))throw Error('Unexpected export during recession');
  const next={initialTotal:ledger.initialTotal,inputTotal:ledger.inputTotal+inputTotal,storedTotal:final.stats.storedTotal,pendingTotal:0,boundaryTotal:ledger.boundaryTotal+wet.boundaryOutflow+final.boundaryOutflow,evapTotal:ledger.evapTotal+evapTotal,seepTotal:ledger.seepTotal+seepTotal};next.residual=next.initialTotal+next.inputTotal-next.storedTotal-next.boundaryTotal-next.evapTotal-next.seepTotal;if(!Number.isFinite(next.residual)||Math.abs(next.residual)>1e-10*Math.max(1,next.initialTotal+next.inputTotal))throw Error('Coupled water imbalance');
  return {redistribution:final,ledger:next,stepStats:{inputTotal,evapTotal,seepTotal,exported:wet.boundaryOutflow+final.boundaryOutflow,inflowMerges:wet.stats.mergeCount,splitEvents},metadata};
 }
 return {empty,advance,metadata};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CoupledBasinWater=api;
})(typeof globalThis!=='undefined'?globalThis:this);
