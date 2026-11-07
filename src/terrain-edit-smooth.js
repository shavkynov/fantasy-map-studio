(function(root){
'use strict';
function extend(Core){
 if(!Core||typeof Core.create!=='function')throw Error('Terrain edit core missing');
 function create(field,options){
  const core=Core.create(field,options),originalStroke=core.stroke,{w,h}=core.snapshot(),n=w*h,positions=new Float64Array(n*3),step=Math.PI/h;
  for(let i=0;i<n;i++){const lat=Math.PI*(.5-(Math.floor(i/w)+.5)/h),lon=2*Math.PI*((i%w+.5)/w-.5),c=Math.cos(lat);positions.set([c*Math.cos(lon),c*Math.sin(lon),Math.sin(lat)],i*3);}
  function distance(a,b){if(a===b)return 0;const k=a*3,j=b*3,dot=positions[k]*positions[j]+positions[k+1]*positions[j+1]+positions[k+2]*positions[j+2];return Math.acos(Math.max(-1,Math.min(1,dot)));}
  core.stroke=function(command){
   if(command?.mode!=='smooth')return originalStroke(command);
   if(!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).some(k=>!['cells','mode','radius','amount'].includes(k)))throw Error('Invalid brush stroke');
   const {cells,radius}=command,amount=command.amount===undefined?.05:command.amount;
   if(!Array.isArray(cells)||cells.length<1||cells.length>128||cells.some(i=>!Number.isInteger(i)||i<0||i>=n)||!Number.isFinite(radius)||radius<=0||radius>Math.PI||!Number.isFinite(amount)||amount<=0||amount>1)throw Error('Invalid brush stroke');
   const before=core.snapshot(),weight=new Float64Array(n),nextHeight=before.height.slice();
   for(const center of new Set(cells))for(let i=0;i<n;i++){const d=distance(center,i);if(d<radius)weight[i]=Math.max(weight[i],1-d/radius);}
   for(let i=0;i<n;i++)if(before.land[i]&&weight[i]>0){
    const x=i%w,y=Math.floor(i/w),polarX=(x+w/2)%w;
    const neighbours=new Set([y*w+(x+w-1)%w,y*w+(x+1)%w,y===0?polarX:i-w,y===h-1?(h-1)*w+polarX:i+w]);
    let total=1,delta=0,low=before.height[i],high=low;
    for(const j of neighbours)if(j!==i&&before.land[j]){const d=Math.max(1e-12,distance(i,j)),q=(step/d)**2;total+=q;delta+=q*(before.height[j]-before.height[i]);low=Math.min(low,before.height[j]);high=Math.max(high,before.height[j]);}
    nextHeight[i]=Math.max(low,Math.min(high,before.height[i]+amount*weight[i]*delta/total));
   }
   const patch=core.exportPatch(),changes=[];
   for(let i=0;i<n;i++){const value=before.land[i]?nextHeight[i]:null;if(before.land[i]!==patch.base.land[i]||value!==patch.base.height[i])changes.push([i,before.land[i],value]);}
   patch.changes=changes;return core.importPatch(patch);
  };
  core.metadata=Object.freeze({...core.metadata,smoothing:'one Jacobi pass over four cardinal land neighbours plus self; inverse squared great-circle distance weights; longitude wraps; polar neighbour is on the same edge row at opposite longitude; coast unchanged; ocean excluded; not isotropic erosion or volume conservation'});
  return core;
 }
 return {...Core,create};
}
const api={extend};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TerrainEditCore=extend(root.TerrainEditCore);
})(typeof globalThis!=='undefined'?globalThis:this);
