(function(root){'use strict';
function createRenderer(render,drainage,getTerrain,getLayer,getThreshold,onSummary=()=>{}){
 const cache=new WeakMap(),pane=new WeakMap(),models=render.models.map((model,k)=>({...model,frame(...args){const f=model.frame(...args);pane.set(f,k);return f;}}));
 function data(f,mode=getTerrain()){if(!['regional','legacy'].includes(mode))throw Error('Drainage requires a height mode');let hit=cache.get(f);if(!hit){hit={};cache.set(f,hit);}if(!hit[mode])hit[mode]=drainage.build(render.field(f,mode));return hit[mode];}
 function compose(f,low,h){const normal=render.compose(f,low,h),mode=getTerrain(),layer=getLayer();if(!['terrain','network','basins'].includes(layer))throw Error('Unknown drainage layer');if(layer==='terrain'||mode==='material'){onSummary(pane.get(f),null);return normal;}const d=data(f,mode),threshold=Number(getThreshold());if(!Number.isFinite(threshold)||threshold<=0)throw Error('Positive catchment-area threshold required');const pixels=new Uint8ClampedArray(normal.pixels),closed=new Set(d.basins.filter(b=>b.kind==='closed-minimum').map(b=>b.terminal));let networkCells=0,closedTerminals=0;
  for(let i=0;i<f.land.length;i++){if(!f.land[i])continue;const isClosed=closed.has(d.terminal[i]);if(layer==='basins'){let hash=Math.imul(d.terminal[i]+1,2654435761)>>>0;const color=isClosed?[195+hash%50,80+(hash>>>8)%80,65+(hash>>>16)%60]:[50+hash%60,135+(hash>>>8)%70,175+(hash>>>16)%65];for(let k=0;k<3;k++)pixels[4*i+k]=Math.round(.35*pixels[4*i+k]+.65*color[k]);}else if(d.accumulation[i]>=threshold){if(d.receiver[i]>=0){pixels.set(isClosed?[164,102,230,255]:[45,188,235,255],4*i);networkCells++;}else{pixels.set([245,88,160,255],4*i);closedTerminals++;}}}
  const summary={...d.stats,networkCells,closedTerminals,thresholdSteradians:threshold};onSummary(pane.get(f),summary);return {...normal,pixels,drainageSummary:summary};
 }
 return {models,compose,data};
}
const api={createRenderer};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DrainageOverlay=api;
})(typeof globalThis!=='undefined'?globalThis:this);
