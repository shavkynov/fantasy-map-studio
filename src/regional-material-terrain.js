(function(root){'use strict';
const W=256,H=171,TAU=2*Math.PI,SHA='d4faef01c8ab64447c04171c36211426374b9728a257c72e3cfc137f73b58947';
function create(base,relief){
 if(!base||base.labelsSha256!==SHA||!base.labels||base.labels.length!==W*H||!relief||typeof relief.sourceUV!=='function')throw Error('Invalid terrain source');
 const labels=Int8Array.from(base.labels),n=W*H,coast=new Float64Array(n).fill(Infinity),values=new Float32Array(n).fill(NaN),p=new Float64Array(n*3),heap=[];
 let seed=2166136261;for(const c of 'vondoran-227|regional-relief-v1')seed=Math.imul(seed^c.charCodeAt(0),16777619);
 function random(){seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;}
 const waves=Array.from({length:12},()=>{const z=2*random()-1,a=TAU*random(),r=Math.sqrt(1-z*z);return [r*Math.cos(a),r*Math.sin(a),z,TAU*random()];});
 function noise(q,frequency,offset=0){let sum=0;for(let j=0;j<6;j++){const a=waves[(j+offset)%12];sum+=Math.sin(frequency*(q[0]*a[0]+q[1]*a[1]+q[2]*a[2])+a[3]);}return sum/6;}
 function push(i,d){let k=heap.length;heap.push([i,d]);while(k){const parent=(k-1)>>1;if(heap[parent][1]<=d)break;heap[k]=heap[parent];k=parent;}heap[k]=[i,d];}
 function pop(){const first=heap[0],last=heap.pop();if(heap.length){let k=0;while(2*k+1<heap.length){let j=2*k+1;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=last[1])break;heap[k]=heap[j];k=j;}heap[k]=last;}return first;}
 function at(x,y){if(y<0){y=-y-1;x+=W/2;}if(y>=H){y=2*H-y-1;x+=W/2;}return y*W+(x%W+W)%W;}
 function distance(i,j){const a=3*i,b=3*j,ax=p[a],ay=p[a+1],az=p[a+2],bx=p[b],by=p[b+1],bz=p[b+2];return Math.atan2(Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx),ax*bx+ay*by+az*bz);}
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,z=1-2*(y+.5)/H,r=Math.sqrt(1-z*z),lon=TAU*((x+.5)/W-.5);p.set([r*Math.cos(lon),r*Math.sin(lon),z],3*i);if(labels[i]<0){coast[i]=0;push(i,0);}}
 if(!heap.length)throw Error('Terrain source has no ocean');
 while(heap.length){const [i,d]=pop();if(d!==coast[i])continue;const x=i%W,y=Math.floor(i/W);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const j=at(x+dx,y+dy);if(labels[j]<0)continue;const nd=d+distance(i,j);if(nd<coast[j]){coast[j]=nd;push(j,nd);}}}
 for(let i=0;i<n;i++)if(labels[i]>=0){const q=p.subarray(3*i,3*i+3),regional=noise(q,4),warped=noise(q,7,3)+.18*noise(q,19,6),belt=Math.exp(-Math.pow(warped/.075,2)),segment=Math.max(0,Math.min(1,(noise(q,5,6)+.2)*2)),detail=noise(q,45,4),inland=1-Math.exp(-coast[i]/.07),upland=.07+.2*(regional+1)/2,mountains=.65*belt*segment*(.85+.15*detail);values[i]=.008+inland*(upland+mountains+.025*detail);if(!Number.isFinite(values[i])||values[i]<=0)throw Error('Invalid terrain height');}
 function materialElevation(u,v){if(!Number.isFinite(u)||!Number.isFinite(v)||v<0||v>1)throw Error('Invalid source coordinate');u=(u%1+1)%1;const x=u*W-.5,y=v*H-.5,X=Math.floor(x),Y=Math.floor(y),a=x-X,b=y-Y;let sum=0,weight=0;for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){const i=at(X+dx,Y+dy),w=(dx?a:1-a)*(dy?b:1-b);if(labels[i]>=0){sum+=w*values[i];weight+=w;}}if(weight<=1e-14)throw Error('Source coordinate has no land support');return sum/weight;}
 function heights(model,frame){const out=new Float32Array(frame.w*frame.h).fill(-1);for(let i=0;i<out.length;i++)if(frame.land[i]){const k=frame.owner[i],point=model.pointAt(frame.w,frame.h,i),q=model.transport(point,k,-frame.angle);if(!model.sourceLand(q,k))throw Error('Land material mismatch');const uv=relief.sourceUV(model,point,k,frame.angle);out[i]=materialElevation(uv[0],uv[1]);}return out;}
 return {heights,materialElevation,sourceValues:values.slice(),coastDistanceRadians:coast.slice(),metadata:Object.freeze({heightUnit:'relative',coastDistance:'eight-neighbor spherical graph distance to ocean-cell centers',tectonicUplift:false,coastline:'original source coast, not newly opened rifts',seed:'vondoran-227|regional-relief-v1',erosion:false})};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RegionalMaterialTerrain=api;
})(typeof globalThis!=='undefined'?globalThis:this);
