(function(root){
'use strict';
function create(base,deps,initialPatch){
 const Core=deps.Core,initial=Core.create(base).exportPatch(),limit=32;
 if(!!deps.Routing!==!!deps.Reaches)throw Error('Routing and Reaches must be supplied together');
 let changes=[],undo=[],redo=[],revision=0,epoch=0,busy=false,water=null,rivers=null;
 if(initialPatch!==undefined){const candidate=Core.create(base);candidate.importPatch(initialPatch);changes=candidate.exportPatch().changes;}
 const envelope=c=>({...initial,changes:c});
 function prepare(c){
  const core=Core.create(base);core.importPatch(envelope(c));
  const snap=core.snapshot(),frame={w:base.w,h:base.h,land:snap.land},field=deps.Relief.build(frame,snap.height),drainage=deps.Drainage.build(field),hierarchy=deps.Hierarchy.build(field,drainage);
  return {core,field,drainage,hierarchy};
 }
 let scene=prepare(changes);
 function install(next,c){epoch++;busy=false;water=null;rivers=null;scene=next;changes=c;revision++;}
 function commit(next,c){undo.push(changes);if(undo.length>limit)undo.shift();redo=[];install(next,c);}
 function stroke(command){
  const candidate=Core.create(base);candidate.importPatch(envelope(changes));
  const result=candidate.stroke(command);if(!result.changedCells)return false;
  const c=candidate.exportPatch().changes,next=prepare(c);commit(next,c);return true;
 }
 function history(from,to){if(!from.length)return false;const c=from[from.length-1],next=prepare(c);from.pop();to.push(changes);install(next,c);return true;}
 function load(value){const candidate=Core.create(base);candidate.importPatch(value);const c=candidate.exportPatch().changes;if(JSON.stringify(c)===JSON.stringify(changes))return false;const next=prepare(c);commit(next,c);return true;}
 function riverSnapshot(){
  if(!rivers)return null;
  const network=rivers.network;
  return {step:rivers.step,routing:{w:network.w,h:network.h,flow:rivers.routing.flow.slice()},network:{...network,nodes:network.nodes.map(v=>({...v})),reaches:network.reaches.map(v=>({...v,cells:v.cells.slice()})),summary:{...network.summary},metadata:{...network.metadata}}};
 }
 function snapshot(){return {w:base.w,h:base.h,land:scene.field.land.slice(),height:scene.field.height.slice(),east:scene.field.east.slice(),north:scene.field.north.slice(),depth:water?water.redistribution.depth.slice():null,ledger:water?{...water.ledger}:null,rivers:riverSnapshot(),revision,busy,canUndo:undo.length>0,canRedo:redo.length>0,basins:scene.hierarchy.basins.length};}
 function cancel(){epoch++;busy=false;}
 async function runWater(onProgress=()=>{}){
  if(busy)return {status:'busy'};
  const current=scene,token=++epoch;busy=true;
  try{
   const model=deps.Surface.create(current.field,current.hierarchy,deps.Fill);let state=model.empty(),nextRivers=null;
   const forcing={precipitation:.02,evaporation:.001,runoffCoefficient:.5};
   for(let step=1;step<=20;step++){
    if(token!==epoch||current!==scene)return {status:'cancelled'};
    // Diagnose the final step with its INITIAL wet mask, before advancing water.
    if(step===20&&deps.Routing){
     const routing=deps.Routing.build(current.field,current.drainage,{precipitation:forcing.precipitation,runoffCoefficient:forcing.runoffCoefficient},state.redistribution.depth);
     const network=deps.Reaches.build(current.field,current.drainage,routing,{threshold:1e-6});
     nextRivers={step,routing,network};
    }
    state=model.advance(state,forcing,.05);
    onProgress(step,20);await deps.yieldStep();
   }
   if(token!==epoch||current!==scene)return {status:'cancelled'};
   // Publish a matched pair only after every calculation and cancellation check succeeds.
   water=state;rivers=nextRivers;return {status:'completed'};
  }finally{if(token===epoch)busy=false;}
 }
 return {stroke,undo:()=>history(undo,redo),redo:()=>history(redo,undo),load,save:()=>JSON.parse(JSON.stringify(envelope(changes))),snapshot,cancel,runWater,clearWater(){cancel();water=null;rivers=null;}};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TerrainEditSession=api;
})(typeof globalThis!=='undefined'?globalThis:this);
