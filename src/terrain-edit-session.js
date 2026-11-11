(function(root){
'use strict';
function prepareSchedule(options){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='schedule'))throw Error('Invalid water run options');
 const input=options.schedule===undefined?Array.from({length:20},()=>({dt:.05,precipitation:.02,evaporation:.001,runoffCoefficient:.5})):options.schedule;
 // The bound limits work per invocation; it is not a physical or climatic rule.
 if(!Array.isArray(input)||!input.length||input.length>2048)throw Error('Expected 1..2048 water steps');
 const steps=[];let totalTime=0;
 for(let i=0;i<input.length;i++){
  const v=input[i];
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['dt','precipitation','evaporation','runoffCoefficient','seepage'].includes(k)))throw Error('Invalid water schedule step');
  const {dt,precipitation,evaporation,runoffCoefficient,seepage}=v;
  if(!Number.isFinite(dt)||dt<=0||![precipitation,evaporation,runoffCoefficient].every(x=>Number.isFinite(x)&&x>=0)||runoffCoefficient>1||(seepage!==undefined&&(!Number.isFinite(seepage)||seepage<0))||!Number.isFinite(totalTime+dt)||totalTime+dt===totalTime)throw Error('Invalid water schedule rates or duration');
  totalTime+=dt;const forcing={precipitation,evaporation,runoffCoefficient};if(seepage!==undefined)forcing.seepage=seepage;
  steps.push(Object.freeze({dt,forcing:Object.freeze(forcing)}));
 }
 return Object.freeze({steps:Object.freeze(steps),totalTime,scope:'prescribed scalar forcing; arbitrary model time; not climate or seasons'});
}
function create(base,deps,initialPatch){
 const Core=deps.Core,initial=Core.create(base).exportPatch(),limit=32;
 if(!!deps.Routing!==!!deps.Reaches)throw Error('Routing and Reaches must be supplied together');
 if(!!deps.Identity!==!!deps.Objects)throw Error('Identity and Objects must be supplied together');
 const FlowHistory=deps.FlowHistory||(deps.Routing?root.RunoffFlowHistory:null);
 if(FlowHistory&&!deps.Routing)throw Error('FlowHistory requires Routing and Reaches');
 if(deps.Routing&&root.document&&!FlowHistory)throw Error('RunoffFlowHistory not loaded');
 let changes=[],undo=[],redo=[],revision=0,epoch=0,busy=false,water=null,rivers=null,flowHistory=null,waterRun=null,waterBodies=null;
 if(initialPatch!==undefined){const candidate=Core.create(base);candidate.importPatch(initialPatch);changes=candidate.exportPatch().changes;}
 const envelope=c=>({...initial,changes:c});
 function prepare(c){
  const core=Core.create(base);core.importPatch(envelope(c));
  const snap=core.snapshot(),frame={w:base.w,h:base.h,land:snap.land},field=deps.Relief.build(frame,snap.height),drainage=deps.Drainage.build(field),hierarchy=deps.Hierarchy.build(field,drainage);
  return {core,field,drainage,hierarchy};
 }
 let scene=prepare(changes);
 function install(next,c){epoch++;busy=false;water=null;rivers=null;flowHistory=null;waterRun=null;waterBodies=null;scene=next;changes=c;revision++;}
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
 function historySnapshot(){
  if(!flowHistory)return null;
  const result={...flowHistory,metadata:{...flowHistory.metadata}};
  for(const key of Object.keys(result))if(ArrayBuffer.isView(result[key]))result[key]=result[key].slice();
  return result;
 }
 function snapshot(){return {w:base.w,h:base.h,land:scene.field.land.slice(),height:scene.field.height.slice(),east:scene.field.east.slice(),north:scene.field.north.slice(),depth:water?water.redistribution.depth.slice():null,ledger:water?{...water.ledger}:null,rivers:riverSnapshot(),flowHistory:historySnapshot(),waterRun:waterRun?JSON.parse(JSON.stringify(waterRun)):null,waterBodies:waterBodies?JSON.parse(JSON.stringify(waterBodies)):null,revision,busy,canUndo:undo.length>0,canRedo:redo.length>0,basins:scene.hierarchy.basins.length};}
 function cancel(){epoch++;busy=false;}
 async function runWater(onProgress=()=>{},options={}){
  if(busy)return {status:'busy'};
  if(typeof onProgress!=='function')throw Error('Progress callback required');
  const plan=prepareSchedule(options),total=plan.steps.length;
  const current=scene,token=++epoch;busy=true;
  try{
   const model=deps.Surface.create(current.field,current.hierarchy,deps.Fill);let state=model.empty(),nextRivers=null;
   const observer=FlowHistory?FlowHistory.create(base.w,base.h):null;
   const identity=deps.Identity?deps.Identity.create(current.field,deps.Objects):null;let time=0;
   for(let step=1;step<=total;step++){
    const {dt,forcing}=plan.steps[step-1];
    if(token!==epoch||current!==scene)return {status:'cancelled'};
    // Observe initial wet masks; preserve the final-step display network.
    if(deps.Routing&&(observer||step===total)){
     const routing=deps.Routing.build(current.field,current.drainage,{precipitation:forcing.precipitation,runoffCoefficient:forcing.runoffCoefficient},state.redistribution.depth);
     if(observer)observer.observe(current.field,current.drainage,routing,dt);
     if(step===total){
     const network=deps.Reaches.build(current.field,current.drainage,routing,{threshold:1e-6});
     nextRivers={step,routing,network};
     }
    }
    state=model.advance(state,forcing,dt);time+=dt;
    if(identity)identity.observe(state.redistribution,step,time);
    onProgress(step,total);await deps.yieldStep();
   }
   if(token!==epoch||current!==scene)return {status:'cancelled'};
   const nextHistory=observer?observer.snapshot():null;
   // Publish water, history, last-step network and forcing provenance atomically.
   const nextBodies=identity?identity.snapshot():null;
   water=state;rivers=nextRivers;flowHistory=nextHistory;waterRun=plan;waterBodies=nextBodies;return {status:'completed'};
  }finally{if(token===epoch)busy=false;}
 }
 return {stroke,undo:()=>history(undo,redo),redo:()=>history(redo,undo),load,save:()=>JSON.parse(JSON.stringify(envelope(changes))),snapshot,cancel,runWater,clearWater(){cancel();water=null;rivers=null;flowHistory=null;waterRun=null;waterBodies=null;}};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TerrainEditSession=api;
})(typeof globalThis!=='undefined'?globalThis:this);
