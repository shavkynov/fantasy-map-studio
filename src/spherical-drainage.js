(function(root){'use strict';
function build(field){
 const {w,h,land,height,area}=field,n=w*h;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||n>2147483647||!land||land.length!==n||!height||height.length!==n||!area||area.length!==n||typeof field.neighbors!=='function'||typeof field.angularDistance!=='function')throw Error('Invalid drainage field');
 const receiver=new Int32Array(n).fill(-2),terminal=new Int32Array(n).fill(-1),accumulation=new Float64Array(n),seen=new Uint8Array(n),indegree=new Uint32Array(n),order=[],basins=[];
 let landCount=0,totalArea=0;
 function neighbors(i){const result=field.neighbors(i);for(const j of result)if(!Number.isInteger(j)||j<0||j>=n||j===i)throw Error('Invalid drainage neighbor');return result;}
 for(let i=0;i<n;i++)if(land[i]){if(!Number.isFinite(height[i])||height[i]<=0||!Number.isFinite(area[i])||area[i]<=0)throw Error('Invalid land sample');receiver[i]=-1;landCount++;totalArea+=area[i];accumulation[i]=area[i];}
 // Zero is the water surface boundary, not an assigned ocean-floor depth.
 for(let i=0;i<n;i++)if(land[i]){let best=0;for(const j of neighbors(i)){const lower=land[j]?height[j]:0;if(lower>=height[i])continue;const d=field.angularDistance(i,j);if(!Number.isFinite(d)||d<=0)throw Error('Invalid angular distance');const slope=(height[i]-lower)/d;if(slope>best||(slope===best&&(receiver[i]<0||j<receiver[i]))){best=slope;receiver[i]=j;}}}
 // Route exact-height plateaus by breadth-first distance to descending exits.
 for(let start=0;start<n;start++)if(land[start]&&!seen[start]){const component=[start];seen[start]=1;for(let k=0;k<component.length;k++)for(const j of neighbors(component[k]))if(land[j]&&!seen[j]&&height[j]===height[start]){seen[j]=1;component.push(j);}
  const queue=[];for(const i of component)if(receiver[i]>=0)queue.push(i);
  if(!queue.length){let root=component[0];for(const i of component)if(i<root)root=i;queue.push(root);receiver[root]=-1;}
  const reached=new Set(queue);for(let k=0;k<queue.length;k++)for(const j of neighbors(queue[k]))if(land[j]&&height[j]===height[start]&&!reached.has(j)){reached.add(j);receiver[j]=queue[k];queue.push(j);}
  if(queue.length!==component.length)throw Error('Asymmetric plateau graph');
 }
 for(let i=0;i<n;i++)if(land[i]&&receiver[i]>=0&&land[receiver[i]])indegree[receiver[i]]++;
 const queue=[];for(let i=0;i<n;i++)if(land[i]&&indegree[i]===0)queue.push(i);
 for(let k=0;k<queue.length;k++){const i=queue[k],j=receiver[i];order.push(i);if(j>=0&&land[j]){accumulation[j]+=accumulation[i];if(--indegree[j]===0)queue.push(j);}}
 if(order.length!==landCount)throw Error('Drainage cycle');
 let terminalArea=0,oceanArea=0,closedArea=0;
 for(let k=order.length-1;k>=0;k--){const i=order[k],j=receiver[i];if(j>=0&&land[j])terminal[i]=terminal[j];else{terminal[i]=i;const kind=j>=0?'water-outlet':'closed-minimum';basins.push({terminal:i,receiver:j,kind,areaSteradians:accumulation[i]});terminalArea+=accumulation[i];if(j>=0)oceanArea+=accumulation[i];else closedArea+=accumulation[i];}}
 const balanceError=Math.abs(totalArea-terminalArea);if(balanceError>1e-10*Math.max(1,totalArea))throw Error('Catchment area imbalance');
 function network(threshold){if(!Number.isFinite(threshold)||threshold<=0)throw Error('Positive area threshold required');const edges=[];for(const i of order)if(receiver[i]>=0&&accumulation[i]>=threshold)edges.push([i,receiver[i]]);return edges;}
 return {w,h,receiver,terminal,accumulation,basins,network,stats:{landCount,basinCount:basins.length,totalAreaSteradians:totalArea,waterOutletAreaSteradians:oceanArea,closedAreaSteradians:closedArea,balanceError},metadata:Object.freeze({method:'single-flow steepest descent with exact-flat BFS',basinDefinition:'one last land cell at each water outlet or one root per closed plateau',accumulationUnit:'steradian',input:'uniform unit contribution per land area, not precipitation',waterBoundary:'zero surface; depth unknown',depressions:'retained, not filled; not simulated lakes',flats:'grid-index tie-break, not calibrated water flow'})};
}
const api={build};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SphericalDrainage=api;
})(typeof globalThis!=='undefined'?globalThis:this);
