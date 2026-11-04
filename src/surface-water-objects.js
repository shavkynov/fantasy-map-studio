(function(root){'use strict';
function build(field,water,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='depthThreshold'))throw Error('Invalid water-object options');
 const threshold=options.depthThreshold===undefined?1e-9:options.depthThreshold;
 if(!Number.isFinite(threshold)||threshold<0)throw Error('Invalid water depth threshold');
 const {w,h,land,height,area}=field||{},n=w*h,depth=water&&water.depth;
 if(!Number.isInteger(w)||w<4||w>720||w%2||!Number.isInteger(h)||h<2||h>360||land?.length!==n||height?.length!==n||area?.length!==n||water?.w!==w||water?.h!==h||depth?.length!==n)throw Error('Invalid water-object field');
 const labels=new Int32Array(n).fill(-1),queue=new Int32Array(n),objects=[];let landVolume=0,omittedVolume=0,wetCells=0,wetArea=0,mappedVolume=0;
 for(let i=0;i<n;i++){if(land[i]!==0&&land[i]!==1)throw Error('Invalid land mask');if(!land[i])continue;if(!Number.isFinite(height[i])||height[i]<=0||!Number.isFinite(area[i])||area[i]<=0||!Number.isFinite(depth[i])||depth[i]<0||!Number.isFinite(height[i]+depth[i]))throw Error('Invalid land water sample');const volume=depth[i]*area[i];if(!Number.isFinite(volume))throw Error('Water volume overflow');landVolume+=volume;if(depth[i]<=threshold)omittedVolume+=volume;}
 function neighbors(i){const x=i%w,y=Math.floor(i/w),out=[y*w+(x+w-1)%w,y*w+(x+1)%w];if(y>0)out.push(i-w);if(y<h-1)out.push(i+w);return out;}
 for(let seed=0;seed<n;seed++){if(!land[seed]||depth[seed]<=threshold||labels[seed]>=0)continue;const id=objects.length,o={id,seedCell:seed,cellCount:0,areaSteradians:0,volume:0,maxDepth:0,meanDepth:0,minSurfaceLevel:Infinity,maxSurfaceLevel:-Infinity,touchesOceanMask:false};let end=1;queue[0]=seed;labels[seed]=id;
 for(let q=0;q<end;q++){const i=queue[q],d=depth[i],level=height[i]+d;o.cellCount++;o.areaSteradians+=area[i];o.volume+=d*area[i];o.maxDepth=Math.max(o.maxDepth,d);o.minSurfaceLevel=Math.min(o.minSurfaceLevel,level);o.maxSurfaceLevel=Math.max(o.maxSurfaceLevel,level);for(const j of neighbors(i)){if(!land[j]){o.touchesOceanMask=true;continue;}if(depth[j]>threshold&&labels[j]<0){labels[j]=id;queue[end++]=j;}}}
 o.meanDepth=o.volume/o.areaSteradians;objects.push(o);wetCells+=o.cellCount;wetArea+=o.areaSteradians;mappedVolume+=o.volume;}
 if(![landVolume,omittedVolume,wetArea,mappedVolume].every(Number.isFinite))throw Error('Water catalog overflow');
 return {w,h,labels,objects,summary:{objectCount:objects.length,wetCells,wetAreaSteradians:wetArea,mappedVolume,omittedVolume,landVolume,volumeResidual:landVolume-mappedVolume-omittedVolume},metadata:Object.freeze({method:'edge-connected wet land cells; periodic longitude, no polar-edge crossing',depthThreshold:threshold,units:'relative height; steradian area; relative-height*steradian volume',scope:'instantaneous raster water patches, not persistent lakes, rivers or hydrologic pools',ids:'deterministic scan order within this snapshot; not persistent across steps',ocean:'ocean height/depth/area samples ignored; ocean is not a catalog object',terrainModified:false,waterModified:false})};
}
const api={build};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SurfaceWaterObjects=api;
})(typeof globalThis!=='undefined'?globalThis:this);
