(function(root){'use strict';
function redistribute(field,hierarchy,volumes){
 const {w,h,land,height,area}=field,n=w*h,B=hierarchy.basins.length,water=B;
 if(hierarchy.w!==w||hierarchy.h!==h||hierarchy.waterNode!==water||hierarchy.cellBasin.length!==n||height.length!==n||area.length!==n||land.length!==n||!volumes||volumes.length!==B)throw Error('Invalid redistribution input');
 const parent=Int32Array.from({length:B+1},(_,i)=>i),volume=Float64Array.from({length:B+1},(_,i)=>i<B?volumes[i]:0),groups=Array.from({length:B},()=>[]),leaves=Array.from({length:B},(_,i)=>[i]),edgeSets=Array.from({length:B},()=>new Set()),queue=[],queued=new Uint8Array(B+1);let initialTotal=0,boundaryOutflow=0,transfers=0,mergeCount=0,operations=0;
 for(let b=0;b<B;b++){if(!Number.isFinite(volume[b])||volume[b]<0)throw Error('Invalid supplied volume');initialTotal+=volume[b];}
 for(let i=0;i<n;i++)if(land[i]){const b=hierarchy.cellBasin[i];if(!Number.isInteger(b)||b<0||b>=B||!Number.isFinite(height[i])||height[i]<=0||!Number.isFinite(area[i])||area[i]<=0)throw Error('Invalid redistribution sample');groups[b].push(i);}
 function curve(ids){if(!ids.length)throw Error('Empty pool');ids.sort((a,b)=>height[a]-height[b]||a-b);const a=new Float64Array(ids.length+1),z=new Float64Array(ids.length+1);for(let k=0;k<ids.length;k++){a[k+1]=a[k]+area[ids[k]];z[k+1]=z[k]+area[ids[k]]*height[ids[k]];}return {ids,a,z};}
 const curves=groups.map(curve);
 for(let k=0;k<hierarchy.edges.length;k++){const e=hierarchy.edges[k];if(!Number.isInteger(e.a)||!Number.isInteger(e.b)||e.a<0||e.b<0||e.a>water||e.b>water||e.a===e.b||!Number.isFinite(e.level)||e.level<0)throw Error('Invalid spill edge');for(const b of [e.a,e.b])if(b<B){if(e.level<height[curves[b].ids[0]])throw Error('Spill below pool floor');edgeSets[b].add(k);}}
 function find(b){let r=b;while(parent[r]!==r)r=parent[r];while(parent[b]!==b){const next=parent[b];parent[b]=r;b=next;}return r;}
 function enqueue(b){b=find(b);if(b!==water&&!queued[b]){queued[b]=1;queue.push(b);}}
 function lowest(b){let best=-1;for(const k of edgeSets[b]){const e=hierarchy.edges[k];if(find(e.a)===find(e.b))continue;if(best<0||e.level<hierarchy.edges[best].level||(e.level===hierarchy.edges[best].level&&k<best))best=k;}return best;}
 function capacity(b,level){const c=curves[b];let lo=0,hi=c.ids.length;while(lo<hi){const m=(lo+hi)>>1;if(height[c.ids[m]]<level)lo=m+1;else hi=m;}return Math.max(0,level*c.a[lo]-c.z[lo]);}
 function stage(b){const c=curves[b],v=volume[b];if(v===0)return height[c.ids[0]];for(let k=1;k<=c.ids.length;k++){const next=k<c.ids.length?height[c.ids[k]]:Infinity;if(v<=next*c.a[k]-c.z[k]||k===c.ids.length)return (v+c.z[k])/c.a[k];}throw Error('Invalid pool curve');}
 function merge(a,b){if(curves[a].ids.length<curves[b].ids.length){const t=a;a=b;b=t;}parent[b]=a;volume[a]+=volume[b];volume[b]=0;curves[a]=curve(curves[a].ids.concat(curves[b].ids));curves[b]=null;for(const k of edgeSets[b])edgeSets[a].add(k);edgeSets[b]=null;for(const leaf of leaves[b])leaves[a].push(leaf);leaves[b]=null;mergeCount++;enqueue(a);}
 for(let b=0;b<B;b++)if(volume[b]>0)enqueue(b);
 for(let q=0;q<queue.length;q++){const b=queue[q];queued[b]=0;if(find(b)!==b)continue;if(++operations>200000)throw Error('Redistribution operation bound exceeded');const k=lowest(b);if(k<0)continue;const e=hierarchy.edges[k],other=find(e.a)===b?find(e.b):find(e.a),cap=capacity(b,e.level);if(volume[b]<cap)continue;
  if(other===water){const excess=Math.max(0,volume[b]-cap);volume[b]-=excess;boundaryOutflow+=excess;continue;}
  const next=lowest(other);if(next>=0&&hierarchy.edges[next].level===e.level&&volume[other]>=capacity(other,e.level)&&volume[b]+volume[other]>0){merge(b,other);continue;}
  const excess=Math.max(0,volume[b]-cap);if(excess>0){volume[b]-=excess;volume[other]+=excess;transfers++;enqueue(other);enqueue(b);}}
 const depth=new Float64Array(n).fill(NaN),poolByBasin=new Int32Array(B),basinStorage=new Float64Array(B),pools=[];let storedTotal=0,geometricStorage=0;
 for(let b=0;b<B;b++)poolByBasin[b]=find(b);
 for(let b=0;b<B;b++)if(find(b)===b){const level=stage(b),k=lowest(b);if(k>=0&&volume[b]>capacity(b,hierarchy.edges[k].level)+1e-10*Math.max(1,volume[b]))throw Error('Unresolved pool overflow');let wetArea=0;for(const i of curves[b].ids){const d=volume[b]>0?Math.max(0,level-height[i]):0;depth[i]=d;const v=d*area[i];basinStorage[hierarchy.cellBasin[i]]+=v;geometricStorage+=v;if(d>0)wetArea+=area[i];}storedTotal+=volume[b];pools.push({id:b,basins:leaves[b].slice(),volume:volume[b],level,wetAreaSteradians:wetArea});}
 const residual=initialTotal-storedTotal-boundaryOutflow,geometryResidual=storedTotal-geometricStorage;if(!Number.isFinite(residual)||!Number.isFinite(geometryResidual)||Math.abs(residual)>1e-10*Math.max(1,initialTotal)||Math.abs(geometryResidual)>1e-10*Math.max(1,initialTotal))throw Error('Redistribution volume imbalance');
 return {w,h,pools,poolByBasin,basinStorage,depth,boundaryOutflow,stats:{initialTotal,storedTotal,boundaryOutflow,residual,geometryResidual,mergeCount,transfers,operations,wetPools:pools.filter(p=>p.volume>0).length},metadata:Object.freeze({method:'lowest-saddle fill/spill; merge only mutually spill-ready pools',scope:'instantaneous redistribution of prescribed volume, not flow speed or climate',units:'relative-height*steradian volume',water:'all existing water shares external boundary',forcing:false,evaporation:false,terrainModified:false,compatibility:'merged basinStorage may exceed old local capacity; do not feed directly to local-only advance'})};
}
const api={redistribute};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BasinFillSpill=api;
})(typeof globalThis!=='undefined'?globalThis:this);
