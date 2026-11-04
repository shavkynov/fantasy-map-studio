(function(root){'use strict';
function create(field){
 const {w,h}=field||{},n=w*h;
 if(!Number.isInteger(w)||w<4||w>720||w%2||!Number.isInteger(h)||h<2||h>360||field.land?.length!==n||field.area?.length!==n||typeof field.neighbors!=='function')throw Error('Invalid trace field');
 const land=Uint8Array.from(field.land),area=Float64Array.from(field.area),saved=new WeakMap();
 for(let i=0;i<n;i++)if((field.land[i]!==0&&field.land[i]!==1)||!Number.isFinite(area[i])||area[i]<=0)throw Error('Invalid trace geometry');
 function samples(v,name,max=Infinity){const a=new Float64Array(n).fill(NaN);if(typeof v!=='number'&&v?.length!==n)throw Error('Invalid trace '+name);for(let i=0;i<n;i++)if(land[i]){const x=typeof v==='number'?v:v[i];if(!Number.isFinite(x)||x<0||x>max)throw Error('Invalid trace '+name);a[i]=x;}return a;}
 function close(a,b){if(!Number.isFinite(a)||a<0||!Number.isFinite(b)||b<0||Math.abs(a-b)>1e-10*Math.max(1,a,b))throw Error('Trace surface input mismatch');}
 function advance(frame,model,before,forcing,dt,combined=false){
 if(!frame||frame.w!==w||frame.h!==h||typeof model?.advance!=='function'||!forcing||typeof combined!=='boolean'||!Number.isFinite(dt)||dt<=0)throw Error('Invalid trace step');
 const prior=combined?before?.water:before,initialDepth=samples(prior?.redistribution?.depth,'initial depth'),C=samples(combined?forcing.surface?.runoffCoefficient:forcing.runoffCoefficient,'coefficient',1);
 if(!combined&&forcing.externalInflow!==undefined)throw Error('Trace does not support external inflow');
 let P=combined?null:samples(forcing.precipitation,'precipitation');
 const state=model.advance(before,forcing,dt),water=combined?state?.water:state;
 if(combined)P=samples(state?.atmosphere?.precipitation,'precipitation');
 let effectiveRate=0;for(let i=0;i<n;i++)if(land[i])effectiveRate+=P[i]*area[i]*(initialDepth[i]>0?1:C[i]);
 const accepted=water?.stepStats?.inputTotal;close(effectiveRate*dt,accepted);
 if(combined)close(accepted,state?.stepStats?.acceptedSurfaceInput);
 const trace=Object.freeze({frame,result:state,surface:water,dt,combined,effectiveSurfaceInput:effectiveRate,acceptedSurfaceInput:accepted});
 saved.set(trace,{initialDepth,P,C});return {state,trace};
 }
 function diagnose(trace,frame,result,routing,drainage){
 const s=saved.get(trace);if(!s||trace.frame!==frame||trace.result!==result||typeof routing?.build!=='function')throw Error('Stale or foreign water trace');
 const grid={w,h,land:land.slice(),area:area.slice(),neighbors:i=>field.neighbors(i)};
 const diagnostic=routing.build(grid,drainage,{precipitation:s.P.slice(),runoffCoefficient:s.C.slice()},s.initialDepth.slice());
 close(diagnostic?.summary?.effectiveSurfaceInput,trace.effectiveSurfaceInput);return diagnostic;
 }
 return {advance,diagnose};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WaterStepTrace=api;
})(typeof globalThis!=='undefined'?globalThis:this);
