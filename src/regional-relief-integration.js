(function(root){'use strict';
function build(frame,z){
 const {w,h}=frame||{},n=w*h;if(!Number.isInteger(w)||!Number.isInteger(h)||w<4||w%2||h<2||!Number.isSafeInteger(n)||frame.land?.length!==n||z?.length!==n)throw Error('Invalid spherical field');
 // Validate before Uint8 conversion: e.g. 256 must not silently become ocean.
 for(const value of frame.land)if(value!==0&&value!==1)throw Error('Invalid land mask: expected numeric 0 or 1');
 if(frame.waterBoundary!==undefined&&frame.waterBoundary!=='external-zero-level-v1')throw Error('Unsupported water boundary: internal lakes require depth on land');
 const land=Uint8Array.from(frame.land),height=Float64Array.from(z,(v,i)=>{if(!land[i])return NaN;if(!Number.isFinite(v)||v<=0)throw Error('Invalid land height');return v;}),positions=new Float64Array(n*3),area=new Float64Array(n),east=new Float64Array(n).fill(NaN),north=new Float64Array(n).fill(NaN),TAU=2*Math.PI;
 for(let y=0;y<h;y++){const lat=Math.PI*(.5-(y+.5)/h),c=Math.cos(lat),s=Math.sin(lat),a=TAU/w*(Math.sin(Math.PI*(.5-y/h))-Math.sin(Math.PI*(.5-(y+1)/h)));for(let x=0;x<w;x++){const i=y*w+x,lon=TAU*((x+.5)/w-.5);positions.set([c*Math.cos(lon),c*Math.sin(lon),s],3*i);area[i]=a;}}
 function check(i){if(!Number.isInteger(i)||i<0||i>=n)throw Error('Invalid cell');}
 function distance(i,j){check(i);check(j);const a=positions.subarray(3*i,3*i+3),b=positions.subarray(3*j,3*j+3);return Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),a[0]*b[0]+a[1]*b[1]+a[2]*b[2]);}
 function neighbors(i){check(i);const x=i%w,y=Math.floor(i/w),out=[],seen=new Set([i]);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;let X=x+dx,Y=y+dy;if(Y<0){Y=-Y-1;X+=w/2;}else if(Y>=h){Y=2*h-Y-1;X+=w/2;}const j=Y*w+(X%w+w)%w;if(!seen.has(j)){seen.add(j);out.push(j);}}return out;}
 for(let i=0;i<n;i++){if(!land[i])continue;const p=positions.subarray(3*i,3*i+3),lon=TAU*((i%w+.5)/w-.5),lat=Math.PI*(.5-(Math.floor(i/w)+.5)/h),e=[-Math.sin(lon),Math.cos(lon),0],b=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)];let xx=0,xy=0,yy=0,xz=0,yz=0,count=0;
  for(const j of neighbors(i)){if(!land[j])continue;const q=positions.subarray(3*j,3*j+3),d=distance(i,j),s=Math.sin(d),dot=p[0]*q[0]+p[1]*q[1]+p[2]*q[2];if(d<=0||Math.abs(s)<1e-14)continue;const t=q.map((v,k)=>(v-dot*p[k])*d/s),a=t[0]*e[0]+t[1]*e[1]+t[2]*e[2],c=t[0]*b[0]+t[1]*b[1]+t[2]*b[2],v=height[j]-height[i],weight=1/(d*d);xx+=weight*a*a;xy+=weight*a*c;yy+=weight*c*c;xz+=weight*a*v;yz+=weight*c*v;count++;}
  const det=xx*yy-xy*xy;if(count>=2&&det>1e-12*xx*yy){east[i]=(xz*yy-yz*xy)/det;north[i]=(yz*xx-xz*xy)/det;}}
 return {w,h,land,height,east,north,area,neighbors,angularDistance:distance,waterBoundary:'external-zero-level-v1',units:Object.freeze({height:'relative',gradient:'relative/radian',area:'steradian',waterHeight:'unknown'})};
}
function createRenderer(models,baseCompose,getMode,regional,legacy){
 const owner=new WeakMap(),cache=new WeakMap(),wrapped=models.map(model=>({...model,frame(...args){if(args.length>3&&args[3]!==4)throw Error('Four-block frame required');const f=model.frame(...args);owner.set(f,model);return f;}}));
 function field(f,mode='regional'){if(!['regional','legacy'].includes(mode))throw Error('Unknown terrain mode');const model=owner.get(f);if(!model)throw Error('Unknown terrain frame');let hit=cache.get(f);if(!hit){hit={};cache.set(f,hit);}if(!hit[mode])hit[mode]=build(f,(mode==='regional'?regional:legacy).heights(model,f));return hit[mode];}
 function compose(f,low,h){const normal=baseCompose(f,low,h),mode=getMode();if(mode==='material')return normal;const g=field(f,mode),pixels=new Uint8ClampedArray(normal.pixels),stops=[[0,[108,150,101]],[.2,[146,170,114]],[.38,[197,182,129]],[.58,[182,161,140]],[.78,[201,199,194]],[1,[240,238,230]]];
  for(let i=0;i<g.height.length;i++){if(!g.land[i])continue;const t=Math.max(0,Math.min(1,g.height[i]/.9));let c=stops[5][1];for(let j=1;j<stops.length;j++)if(t<=stops[j][0]){const a=stops[j-1],b=stops[j],v=(t-a[0])/(b[0]-a[0]);c=a[1].map((x,k)=>x+(b[1][k]-x)*v);break;}const nx=Number.isFinite(g.east[i])?-.15*g.east[i]:0,ny=Number.isFinite(g.north[i])?-.15*g.north[i]:0,shade=.62+.45*Math.max(0,(-.5*nx+.5*ny+Math.SQRT1_2)/Math.hypot(nx,ny,1));pixels.set([...c.map(v=>Math.max(0,Math.min(255,Math.round(v*shade)))),255],4*i);}
  return {...normal,pixels};}
 return {models:wrapped,compose,field};
}
const api={build,createRenderer};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RegionalReliefIntegration=api;
})(typeof globalThis!=='undefined'?globalThis:this);
