(function(root){
'use strict';
function create(base,deps){
 const Core=deps.Core,initial=Core.create(base).exportPatch(),limit=32;
 let changes=[],undo=[],redo=[],revision=0,epoch=0,busy=false,water=null;
 const envelope=c=>({...initial,changes:c});
 function prepare(c){
  const core=Core.create(base);core.importPatch(envelope(c));
  const snap=core.snapshot(),frame={w:base.w,h:base.h,land:snap.land},field=deps.Relief.build(frame,snap.height),drainage=deps.Drainage.build(field),hierarchy=deps.Hierarchy.build(field,drainage);
  return {core,field,drainage,hierarchy};
 }
 let scene=prepare(changes);
 function install(next,c){epoch++;busy=false;water=null;scene=next;changes=c;revision++;}
 function commit(next,c){undo.push(changes);if(undo.length>limit)undo.shift();redo=[];install(next,c);}
 function stroke(command){
  const candidate=Core.create(base);candidate.importPatch(envelope(changes));
  const result=candidate.stroke(command);if(!result.changedCells)return false;
  const c=candidate.exportPatch().changes,next=prepare(c);commit(next,c);return true;
 }
 function history(from,to){if(!from.length)return false;const c=from[from.length-1],next=prepare(c);from.pop();to.push(changes);install(next,c);return true;}
 function load(value){const candidate=Core.create(base);candidate.importPatch(value);const c=candidate.exportPatch().changes;if(JSON.stringify(c)===JSON.stringify(changes))return false;const next=prepare(c);commit(next,c);return true;}
 function snapshot(){return {w:base.w,h:base.h,land:scene.field.land.slice(),height:scene.field.height.slice(),east:scene.field.east.slice(),north:scene.field.north.slice(),depth:water?water.redistribution.depth.slice():null,ledger:water?{...water.ledger}:null,revision,busy,canUndo:undo.length>0,canRedo:redo.length>0,basins:scene.hierarchy.basins.length};}
 function cancel(){epoch++;busy=false;}
 async function runWater(onProgress=()=>{}){
  if(busy)return {status:'busy'};
  const current=scene,token=++epoch;busy=true;
  try{
   const model=deps.Surface.create(current.field,current.hierarchy,deps.Fill);let state=model.empty();
   for(let step=1;step<=20;step++){
    if(token!==epoch||current!==scene)return {status:'cancelled'};
    state=model.advance(state,{precipitation:.02,evaporation:.001,runoffCoefficient:.5},.05);
    onProgress(step,20);await deps.yieldStep();
   }
   if(token!==epoch||current!==scene)return {status:'cancelled'};
   water=state;return {status:'completed'};
  }finally{if(token===epoch)busy=false;}
 }
 return {stroke,undo:()=>history(undo,redo),redo:()=>history(redo,undo),load,save:()=>JSON.parse(JSON.stringify(envelope(changes))),snapshot,cancel,runWater,clearWater(){cancel();water=null;}};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TerrainEditSession=api;
})(typeof globalThis!=='undefined'?globalThis:this);
