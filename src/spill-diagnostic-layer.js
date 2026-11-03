(function(root){'use strict';
function createRenderer(render,drain,spill,getTerrain,getLayer,onSummary=()=>{}){
 const cache=new WeakMap(),pane=new WeakMap(),models=render.models.map((m,k)=>({...m,frame(...args){const f=m.frame(...args);pane.set(f,k);return f;}}));
 function data(f,mode=getTerrain()){if(!['regional','legacy'].includes(mode))throw Error('Spill diagnostics require heights');let hit=cache.get(f);if(!hit){hit={};cache.set(f,hit);}if(!hit[mode]){const field=render.field(f,mode),drainage=drain.build(field),hierarchy=spill.build(field,drainage);let positiveCells=0,maxDepth=0,totalCapacity=0;for(let i=0;i<f.land.length;i++)if(f.land[i]&&hierarchy.potentialDepth[i]>0){positiveCells++;maxDepth=Math.max(maxDepth,hierarchy.potentialDepth[i]);totalCapacity+=hierarchy.potentialDepth[i]*field.area[i];}hit[mode]={field,drainage,hierarchy,summary:{...hierarchy.stats,totalLandAreaSteradians:drainage.stats.totalAreaSteradians,positiveCells,maxDepth,totalCapacity}};}return hit[mode];}
 function compose(f,low,h){const normal=render.compose(f,low,h),mode=getTerrain(),layer=getLayer();if(!['terrain','potential','saddles'].includes(layer))throw Error('Unknown spill layer');if(mode==='material'||layer==='terrain'){onSummary(pane.get(f),null);return normal;}const d=data(f,mode),s=d.hierarchy,pixels=new Uint8ClampedArray(normal.pixels);
  if(layer==='potential'){for(let i=0;i<f.land.length;i++)if(f.land[i]&&s.potentialDepth[i]>0){const alpha=.35+.5*Math.min(1,s.potentialDepth[i]/.1),c=[195,85,220];for(let k=0;k<3;k++)pixels[4*i+k]=Math.round((1-alpha)*pixels[4*i+k]+alpha*c[k]);}}
  else{const marked=new Set();for(const b of s.basins)if(b.kind==='closed-minimum'&&b.localSpillEdge>=0){const e=s.edges[b.localSpillEdge];for(const i of [e.fromCell,e.toCell])if(f.land[i])marked.add(i);}for(const i of marked){const x=i%f.w,y=Math.floor(i/f.w);for(const [dx,dy] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]){const Y=y+dy;if(Y<0||Y>=f.h)continue;const j=Y*f.w+(x+dx+f.w)%f.w;if(f.land[j])pixels.set([255,204,60,255],4*j);}}}
  onSummary(pane.get(f),d.summary);return {...normal,pixels,spillSummary:d.summary};
 }
 return {models,compose,data};
}
const api={createRenderer};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpillDiagnosticLayer=api;
})(typeof globalThis!=='undefined'?globalThis:this);
