(function(root){'use strict';
const names=['precipitation','evaporation','runoffCoefficient','seepage'];
function build(field,options){
 if(!field||!Number.isInteger(field.w)||!Number.isInteger(field.h)||field.w<1||field.h<1)throw Error('Invalid field');
 const {w,h,land,area}=field,n=w*h;if(!Number.isSafeInteger(n)||!land||!area||land.length!==n||area.length!==n||!options||!options.base)throw Error('Invalid spatial forcing');
 function rates(v,partial){if(!v||typeof v!=='object')throw Error('Invalid rates');const out={};for(const k of Object.keys(v))if(!names.includes(k))throw Error('Unknown rate');for(const k of names){if(v[k]===undefined){if(!partial&&k!=='seepage')throw Error('Missing '+k);continue;}const x=v[k];if(!Number.isFinite(x)||x<0||(k==='runoffCoefficient'&&x>1))throw Error('Invalid '+k);out[k]=x;}return out;}
 const base={seepage:0,...rates(options.base,false)},regions=options.regions===undefined?[]:options.regions;if(!Array.isArray(regions))throw Error('Invalid regions');
 const checked=regions.map(r=>{if(!r||!Array.isArray(r.u)||!Array.isArray(r.v)||r.u.length!==2||r.v.length!==2||[...r.u,...r.v].some(x=>!Number.isFinite(x)||x<0||x>1)||r.u[0]===r.u[1]||r.v[0]>=r.v[1])throw Error('Invalid region bounds');return {u:r.u.slice(),v:r.v.slice(),rates:rates(r.rates,true)};});
 const target=options.precipitationMean;if(target!==undefined&&(!Number.isFinite(target)||target<0))throw Error('Invalid precipitation mean');
 const forcing=Object.fromEntries(names.map(k=>[k,new Float64Array(n).fill(NaN)]));let landArea=0,landCells=0,rawRain=0;const regionCells=new Uint32Array(checked.length);
 for(let i=0;i<n;i++){if(land[i]!==0&&land[i]!==1)throw Error('Invalid land mask');if(!land[i])continue;if(!Number.isFinite(area[i])||area[i]<=0)throw Error('Invalid land area');const u=(i%w+.5)/w,v=(Math.floor(i/w)+.5)/h;let hit=-1;
 for(let j=0;j<checked.length;j++){const r=checked[j],insideU=r.u[0]<r.u[1]?u>=r.u[0]&&u<r.u[1]:u>=r.u[0]||u<r.u[1];if(insideU&&v>=r.v[0]&&v<r.v[1]){if(hit>=0)throw Error('Overlapping regions on land');hit=j;}}
 const values=hit<0?base:{...base,...checked[hit].rates};if(hit>=0)regionCells[hit]++;for(const k of names)forcing[k][i]=values[k];landArea+=area[i];rawRain+=values.precipitation*area[i];landCells++;}
 if(!landCells||!Number.isFinite(landArea)||!Number.isFinite(rawRain))throw Error('Invalid forcing integral');const rawMean=rawRain/landArea;if(target>0&&rawMean===0)throw Error('Cannot normalize zero rainfall');const scale=target===undefined?1:target===0?0:target/rawMean;if(!Number.isFinite(scale))throw Error('Invalid rain scale');
 const integrals=Object.fromEntries(names.map(k=>[k,0]));for(let i=0;i<n;i++)if(land[i]){forcing.precipitation[i]*=scale;for(const k of names){if(!Number.isFinite(forcing[k][i]))throw Error('Forcing overflow');integrals[k]+=forcing[k][i]*area[i];}}
 if(Object.values(integrals).some(x=>!Number.isFinite(x)))throw Error('Forcing integral overflow');
 return {forcing,summary:{landCells,landAreaSteradians:landArea,regionCells:Array.from(regionCells),rawPrecipitationMean:rawMean,precipitationScale:scale,landAreaMeans:Object.fromEntries(names.map(k=>[k,integrals[k]/landArea]))},metadata:{climate:false,units:'relative-height per arbitrary model time; runoffCoefficient dimensionless',coordinates:'cell centers u=(x+.5)/w, v=(y+.5)/h, north v=0; half-open bounds; u0>u1 wraps seam',normalization:'precipitation only, weighted by land area; not effective wet/dry input',evaporation:'prescribed rate, not actual evaporation volume',ocean:'NaN; ignored by coupled land-water core',overlap:'reject overlapping selected land cells',snapshot:'fresh arrays; caller may mutate output; source field unchanged',terrainModified:false}};
}
const api={build};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpatialWaterForcing=api;
})(typeof globalThis!=='undefined'?globalThis:this);
