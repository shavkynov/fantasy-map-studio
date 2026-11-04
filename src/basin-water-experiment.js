(function(root){'use strict';
function run(model,options){
 if(!model||!Number.isInteger(model.basinCount)||!options||!Array.isArray(options.segments)||!options.segments.length)throw Error('Invalid budget experiment');const B=model.basinCount;
 function inventory(value){const a=value===undefined?new Float64Array(B):Float64Array.from(value);if(a.length!==B||!a.every(v=>Number.isFinite(v)&&v>=0))throw Error('Invalid experiment inventory');return a;}
 let storage=inventory(options.initialStorage);const pending=inventory(options.initialPending),boundary=new Float64Array(B),evaporation=new Float64Array(B),seepage=new Float64Array(B),trace=[];
 const sum=a=>a.reduce((s,v)=>s+v,0),initialTotal=sum(storage)+sum(pending);let inputTotal=0,time=0,step=0,maxResidual=0,requestedSteps=0;
 for(const s of options.segments){if(!Number.isInteger(s.steps)||s.steps<1||!Number.isFinite(s.dt)||s.dt<=0||!s.forcing)throw Error('Invalid experiment segment');requestedSteps+=s.steps;}
 if(requestedSteps>4096)throw Error('Experiment limited to 4096 steps');
 for(const segment of options.segments)for(let k=0;k<segment.steps;k++){const result=model.advance(storage,segment.forcing,segment.dt);storage=result.storage;for(let b=0;b<B;b++){pending[b]+=result.pendingSpill[b];boundary[b]+=result.boundaryOutflow[b];evaporation[b]+=result.evaporation[b];seepage[b]+=result.seepage[b];}inputTotal+=result.stats.inputTotal;time+=segment.dt;step++;
  const storedTotal=sum(storage),pendingTotal=sum(pending),boundaryTotal=sum(boundary),evapTotal=sum(evaporation),seepTotal=sum(seepage),residual=initialTotal+inputTotal-storedTotal-pendingTotal-boundaryTotal-evapTotal-seepTotal;
  if(!Number.isFinite(residual)||Math.abs(residual)>1e-10*Math.max(1,initialTotal+inputTotal))throw Error('Cumulative water budget imbalance');maxResidual=Math.max(maxResidual,Math.abs(residual));trace.push({step,time,storedTotal,pendingTotal,boundaryTotal,evapTotal,seepTotal,inputTotal,residual});
 }
 return {storage,pendingSpill:pending,boundaryOutflow:boundary,evaporation,seepage,trace,stats:{initialTotal,...trace[trace.length-1],maximumResidual:maxResidual},metadata:Object.freeze({forcing:'explicit prescribed test inputs, not climate',pending:'cumulative unresolved transfer inventory; not routed, evaporated or geographically stored',time:'arbitrary model units, not years',scope:'local basins only; no merging or persistent-lake determination'})};
}
const api={run};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BasinWaterExperiment=api;
})(typeof globalThis!=='undefined'?globalThis:this);
