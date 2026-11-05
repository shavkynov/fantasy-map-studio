(function(root){'use strict';
function create(field,hierarchy,frame,deps){
 const {Surface,Fill,Projection,Join,Moisture}=deps||{};
 if(typeof Surface?.create!=='function'||typeof Fill?.redistribute!=='function'||typeof Projection?.create!=='function'||typeof field?.neighbors!=='function')throw Error('Spill capture dependencies required');
 const neighbors=field.neighbors,copyNeighbors=i=>neighbors.call(field,i);
 function options(value,names){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!names.includes(k))||Object.values(value).some(v=>typeof v!=='boolean'))throw Error('Invalid spill capture options');return {...value};}
 function close(a,b){if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b< -1e-10*Math.max(1,a)||Math.abs(a-b)>1e-10*Math.max(1,Math.abs(a),Math.abs(b)))throw Error('Spill step budget mismatch');}
 function build(f,H,opts){const actual=typeof f.neighbors==='function'?f:{...f,neighbors:copyNeighbors},projection=Projection.create(actual,H,frame,Fill),model=Surface.create(actual,H,projection.fill,{...opts,trackRouting:true});return {model,projection};}
 function wrap(model,projection,combined){const saved=new WeakMap();
 function advance(before,forcing,dt){if(!Number.isFinite(dt)||dt<=0)throw Error('Invalid spill step dt');const prior=combined?before?.water:before,oldStored=prior?.ledger?.storedTotal;if(!Number.isFinite(oldStored)||oldStored<0)throw Error('Invalid prior spill inventory');
 const result=model.advance(before,forcing,dt),water=combined?result.water:result,journal=water?.routingTrace,stats=water?.stepStats;if(!journal||journal.recession!==water.redistribution?.routingTrace||!stats)throw Error('Spill step journal required');
 const inflow=projection.projectJournal(frame,journal.inflow),recession=projection.project(frame,water.redistribution);
 close(inflow.summary.initialVolume,oldStored+stats.inputTotal);close(recession.summary.initialVolume,inflow.summary.storedVolume-stats.evapTotal-stats.seepTotal);close(inflow.summary.boundaryVolume+recession.summary.boundaryVolume,stats.exported);close(recession.summary.storedVolume,water.ledger.storedTotal);if(combined)close(stats.inputTotal,result.stepStats?.acceptedSurfaceInput);
 saved.set(result,{dt,combined,inflow,recession,budget:{oldStored,input:stats.inputTotal,evaporation:stats.evapTotal,seepage:stats.seepTotal,exported:stats.exported,stored:water.ledger.storedTotal},metadata:{units:'relative-height*steradian inventories, not flow rates',scope:'two validated redistribution phases of this exact outer result; no extra advance'}});return result;
 }
 function spillStep(f,result){const value=saved.get(result);if(f!==frame||!value)throw Error('Foreign or incomplete spill step');return structuredClone(value);}
 return {...model,empty:(...args)=>model.empty(...args),advance,spillStep};
 }
 function surface(value={}){const opts=options(value,['trackEvaporation']),built=build(field,hierarchy,opts);return wrap(built.model,built.projection,false);}
 function atmosphere(value={}){const opts=options(value,['returnEvaporation']);if(typeof Join?.create!=='function'||typeof Moisture?.create!=='function')throw Error('Atmosphere capture dependencies required');let built=null;
 const surfaceAPI={...Surface,create(f,H,fill,opts={}){if(built||fill!==Fill)throw Error('Unexpected atmospheric surface factory');built=build(f,H,opts);return built.model;}};
 const model=Join.create(field,hierarchy,Moisture,surfaceAPI,Fill,opts);if(!built)throw Error('Atmospheric surface was not constructed');return wrap(model,built.projection,true);
 }
 return {surface,atmosphere};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpillStepCapture=api;
})(typeof globalThis!=='undefined'?globalThis:this);
