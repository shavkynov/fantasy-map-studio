(function(root){
'use strict';
function create(w,h){
 if(!Number.isInteger(w)||w<4||w>720||w%2||!Number.isInteger(h)||h<2||h>360)throw Error('Invalid history grid');
 const n=w*h,integral=new Float64Array(n),flowTime=new Float64Array(n),eligibleTime=new Float64Array(n),wetTime=new Float64Array(n),peak=new Float64Array(n),dryRun=new Float64Array(n),maxDry=new Float64Array(n);
 let land=null,receiver=null,totalTime=0,steps=0;
 function observe(field,drainage,routing,dt){
  if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(totalTime+dt)||totalTime+dt===totalTime)throw Error('Invalid observation duration');
  if(field?.w!==w||field?.h!==h||drainage?.w!==w||drainage?.h!==h||routing?.w!==w||routing?.h!==h||field.land?.length!==n||drainage.receiver?.length!==n||routing.flow?.length!==n||routing.kind?.length!==n)throw Error('Invalid history input');
  // Validate every sample before changing accumulated statistics.
  for(let i=0;i<n;i++){
   const l=field.land[i],r=drainage.receiver[i],q=routing.flow[i],k=routing.kind[i];
   if(l!==0&&l!==1)throw Error('Invalid history land');
   if(land&&(l!==land[i]||r!==receiver[i]))throw Error('History graph changed; start a new history');
   if(!l){if(r!==-2)throw Error('Invalid history ocean');continue;}
   if(!Number.isInteger(r)||r< -1||r>=n||r===i||!Number.isFinite(q)||q<0||!Number.isInteger(k)||k<0||k>3||(k===1&&q!==0)||(k!==1&&k!==(r<0?3:field.land[r]===0?2:0)))throw Error('Invalid history sample');
   if(!Number.isFinite(integral[i]+q*dt))throw Error('History overflow');
  }
  if(!land){land=Uint8Array.from(field.land);receiver=Int32Array.from(drainage.receiver);}
  for(let i=0;i<n;i++)if(land[i]){
   const q=routing.flow[i];integral[i]+=q*dt;peak[i]=Math.max(peak[i],q);
   if(routing.kind[i]===1){wetTime[i]+=dt;dryRun[i]=0;continue;}
   eligibleTime[i]+=dt;
   if(q>0){flowTime[i]+=dt;dryRun[i]=0;}else{dryRun[i]+=dt;maxDry[i]=Math.max(maxDry[i],dryRun[i]);}
  }
  totalTime+=dt;steps++;
 }
 function snapshot(){
  const mean=new Float64Array(n).fill(NaN),occurrence=new Float64Array(n).fill(NaN),coverage=new Float64Array(n).fill(NaN);
  if(land)for(let i=0;i<n;i++)if(land[i]&&totalTime>0){mean[i]=integral[i]/totalTime;coverage[i]=eligibleTime[i]/totalTime;if(eligibleTime[i]>0)occurrence[i]=flowTime[i]/eligibleTime[i];}
  return {w,h,steps,totalTime,meanFlow:mean,peakFlow:peak.slice(),flowTime:flowTime.slice(),eligibleTime:eligibleTime.slice(),wetTime:wetTime.slice(),occurrence,coverage,maxObservedDryDuration:maxDry.slice(),metadata:{scope:'time-weighted dry-land rainfall runoff observations; not total river discharge',wetCells:'unobserved for channel flow; zero routing flow in a lake is not a dry river',classification:'none; no season, year, baseflow or permanence inferred',units:'routing rate and arbitrary model time',limitations:'no groundwater, snowmelt, wet-pool releases or climate extrapolation; dry durations censored at observation boundaries; session rebuild required after terrain changes',terrainModified:false,waterModified:false}};
 }
 return {observe,snapshot};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RunoffFlowHistory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
