(function(root){'use strict';
function build(field,drainage){
 const {w,h,land,height,area}=field,n=w*h;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||land.length!==n||height.length!==n||area.length!==n||drainage.w!==w||drainage.h!==h||drainage.terminal.length!==n||typeof field.neighbors!=='function'||!drainage.receiver||drainage.receiver.length!==n||!Array.isArray(drainage.basins))throw Error('Invalid spill input');
 // Validate the supplied drainage forest against CURRENT terrain, not object identity.
 const receiver=drainage.receiver,indegree=new Uint32Array(n),queue=[],areaByTerminal=new Map();let landCount=0;
 for(let i=0;i<n;i++){
  if(land[i]!==0&&land[i]!==1)throw Error('Invalid spill land mask');
  if(!land[i]){if(receiver[i]!==-2||drainage.terminal[i]!==-1)throw Error('Drainage water-mask mismatch');continue;}
  landCount++;
  if(!Number.isFinite(height[i])||height[i]<=0||!Number.isFinite(area[i])||area[i]<=0)throw Error('Invalid basin sample');
  const r=receiver[i],t=drainage.terminal[i];
  if(!Number.isInteger(r)||r< -1||r>=n||r===i||!Number.isInteger(t)||t<0||t>=n||land[t]!==1)throw Error('Invalid drainage forest');
  if(r<0){if(t!==i)throw Error('Drainage terminal mismatch');}
  else{
   if(!Array.from(field.neighbors(i)).includes(r))throw Error('Drainage receiver is not a neighbor');
   if(land[r]){if(height[r]>height[i])throw Error('Stale drainage: uphill receiver');if(t!==drainage.terminal[r])throw Error('Drainage terminal mismatch');indegree[r]++;}
   else if(t!==i)throw Error('Drainage outlet mismatch');
  }
  const a=(areaByTerminal.get(t)||0)+area[i];if(!Number.isFinite(a))throw Error('Catchment area overflow');areaByTerminal.set(t,a);
 }
 for(let i=0;i<n;i++)if(land[i]&&indegree[i]===0)queue.push(i);
 for(let k=0;k<queue.length;k++){const r=receiver[queue[k]];if(r>=0&&land[r]&&--indegree[r]===0)queue.push(r);}
 if(queue.length!==landCount)throw Error('Drainage forest cycle');
 if(areaByTerminal.size!==drainage.basins.length)throw Error('Drainage basin count mismatch');
 const roots=new Set();
 for(const b of drainage.basins){
  const a=areaByTerminal.get(b.terminal),r=receiver[b.terminal];
  if(a===undefined||roots.has(b.terminal)||drainage.terminal[b.terminal]!==b.terminal||!Number.isFinite(b.areaSteradians)||Math.abs(a-b.areaSteradians)>1e-10*Math.max(1,a)||b.receiver!==r||b.kind!==(r>=0?'water-outlet':'closed-minimum'))throw Error('Drainage basin metadata mismatch');
  roots.add(b.terminal);
 }
 const basins=drainage.basins.map(b=>({...b})).sort((a,b)=>a.terminal-b.terminal),B=basins.length,water=B,index=new Map(),cellBasin=new Int32Array(n).fill(-1),floor=new Float64Array(B).fill(Infinity),edgeMap=new Map();
 for(let b=0;b<B;b++){if(index.has(basins[b].terminal))throw Error('Duplicate terminal');index.set(basins[b].terminal,b);}
 for(let i=0;i<n;i++)if(land[i]){const b=index.get(drainage.terminal[i]);if(b===undefined||!Number.isFinite(height[i])||height[i]<=0||!Number.isFinite(area[i])||area[i]<=0)throw Error('Invalid basin sample');cellBasin[i]=b;floor[b]=Math.min(floor[b],height[i]);}
 for(let b=0;b<B;b++)if(!Number.isFinite(floor[b]))throw Error('Empty basin');
 for(let i=0;i<n;i++)if(land[i])for(const j of field.neighbors(i)){if(!Number.isInteger(j)||j<0||j>=n||j===i)throw Error('Invalid spill neighbor');const a=cellBasin[i],b=land[j]?cellBasin[j]:water;if(a===b)continue;const lo=Math.min(a,b),hi=Math.max(a,b),level=Math.max(height[i],land[j]?height[j]:0),key=lo+':'+hi,old=edgeMap.get(key);if(!old||level<old.level||(level===old.level&&(i<old.fromCell||(i===old.fromCell&&j<old.toCell))))edgeMap.set(key,{a:lo,b:hi,level,fromCell:i,toCell:j});}
 const edges=[...edgeMap.values()].sort((a,b)=>a.level-b.level||a.a-b.a||a.b-b.b),adj=Array.from({length:B+1},()=>[]),local=new Float64Array(B).fill(Infinity),localEdge=new Int32Array(B).fill(-1);
 for(let k=0;k<edges.length;k++){const e=edges[k];adj[e.a].push([e.b,k]);adj[e.b].push([e.a,k]);for(const b of [e.a,e.b])if(b<B&&e.level<local[b]){local[b]=e.level;localEdge[b]=k;}}
 const escape=new Float64Array(B+1).fill(Infinity),parent=new Int32Array(B+1).fill(-1),parentEdge=new Int32Array(B+1).fill(-1),done=new Uint8Array(B+1),heap=[];
 function push(b,d){let k=heap.length;heap.push([b,d]);while(k){const p=(k-1)>>1;if(heap[p][1]<=d)break;heap[k]=heap[p];k=p;}heap[k]=[b,d];}
 function pop(){const first=heap[0],last=heap.pop();if(heap.length){let k=0;while(2*k+1<heap.length){let j=2*k+1;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=last[1])break;heap[k]=heap[j];k=j;}heap[k]=last;}return first;}
 escape[water]=0;push(water,0);while(heap.length){const [b,d]=pop();if(done[b]||d!==escape[b])continue;done[b]=1;for(const [other,k] of adj[b]){if(done[other])continue;const nd=Math.max(d,edges[k].level);if(nd<escape[other]){escape[other]=nd;parent[other]=b;parentEdge[other]=k;push(other,nd);}}}
 const union=Int32Array.from({length:B+1},(_,i)=>i),node=Int32Array.from(union),touch=new Uint8Array(B+1),merges=[];touch[water]=1;
 function find(b){let r=b;while(union[r]!==r)r=union[r];while(union[b]!==b){const next=union[b];union[b]=r;b=next;}return r;}
 for(let k=0;k<edges.length;k++){const e=edges[k],a=find(e.a),b=find(e.b);if(a===b)continue;const id=B+1+merges.length;merges.push({id,left:node[a],right:node[b],level:e.level,edge:k,touchesWater:!!(touch[a]||touch[b])});union[b]=a;node[a]=id;touch[a]|=touch[b];}
 const localCapacity=new Float64Array(B),escapeCapacity=new Float64Array(B),potentialDepth=new Float64Array(n).fill(NaN);let potentialArea=0;
 for(let i=0;i<n;i++)if(land[i]){const b=cellBasin[i];if(Number.isFinite(local[b]))localCapacity[b]+=Math.max(0,local[b]-height[i])*area[i];if(Number.isFinite(escape[b])){potentialDepth[i]=Math.max(0,escape[b]-height[i]);escapeCapacity[b]+=potentialDepth[i]*area[i];if(potentialDepth[i]>0)potentialArea+=area[i];}}
 for(let b=0;b<B;b++)Object.assign(basins[b],{index:b,floor:floor[b],localSpillLevel:local[b],localSpillEdge:localEdge[b],escapeToWaterLevel:escape[b],escapeParent:parent[b],escapeParentEdge:parentEdge[b],localCapacity:Number.isFinite(local[b])?localCapacity[b]:NaN,escapeCapacity:Number.isFinite(escape[b])?escapeCapacity[b]:NaN});
 return {w,h,basins,waterNode:water,cellBasin,edges,merges,potentialDepth,stats:{basinCount:B,closedMinima:basins.filter(b=>b.kind==='closed-minimum').length,unreachableBasins:basins.filter(b=>!Number.isFinite(b.escapeToWaterLevel)).length,potentialFilledAreaSteradians:potentialArea},metadata:Object.freeze({method:'minimum basin saddles, minimax escape, Kruskal merge forest',levels:'relative heights on cell-neighbor graph',capacityUnit:'relative-height*steradian; not cubic meters',potentialDepth:'hypothetical fill-to-water-spill envelope; not actual lake depth',water:'all existing water cells share external zero-level boundary',equalSaddles:'deterministic binary tie order, not physical chronology',rainfall:false,evaporation:false,terrainModified:false})};
}
const api={build};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BasinSpillHierarchy=api;
})(typeof globalThis!=='undefined'?globalThis:this);
