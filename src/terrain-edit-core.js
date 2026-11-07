(function(root){
'use strict';
const SCHEMA='fm-terrain-edits-v1',MIN=1e-6,MAX=10;
function keys(value,allowed){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Invalid edit options');
}
function create(field,options={}){
 keys(options,['maxHistory']);
 const {w,h}=field||{},n=w*h,limit=options.maxHistory===undefined?32:options.maxHistory;
 if(!Number.isInteger(w)||w<4||w>720||w%2||!Number.isInteger(h)||h<2||h>360||field.land?.length!==n||field.height?.length!==n||!Number.isInteger(limit)||limit<1||limit>128)throw Error('Invalid edit field');
 const baseLand=new Uint8Array(n),baseHeight=new Float64Array(n),positions=new Float64Array(n*3);
 for(let i=0;i<n;i++){
  if(field.land[i]!==0&&field.land[i]!==1)throw Error('Invalid edit land');
  baseLand[i]=field.land[i];
  if(baseLand[i]&&(!Number.isFinite(field.height[i])||field.height[i]<MIN||field.height[i]>MAX))throw Error('Invalid edit height');
  baseHeight[i]=baseLand[i]?field.height[i]:NaN;
  const lat=Math.PI*(.5-(Math.floor(i/w)+.5)/h),lon=2*Math.PI*((i%w+.5)/w-.5),c=Math.cos(lat);
  positions.set([c*Math.cos(lon),c*Math.sin(lon),Math.sin(lat)],i*3);
 }
 let land=baseLand.slice(),height=baseHeight.slice(),revision=0;
 const undoStack=[],redoStack=[];
 const same=(a,b)=>a===b||(Number.isNaN(a)&&Number.isNaN(b));
 function snapshot(){return {w,h,land:land.slice(),height:height.slice(),revision};}
 function commit(nextLand,nextHeight){
  const patch=[];
  for(let i=0;i<n;i++)if(land[i]!==nextLand[i]||!same(height[i],nextHeight[i]))patch.push([i,land[i],height[i],nextLand[i],nextHeight[i]]);
  if(!patch.length)return {changedCells:0,revision};
  land=nextLand;height=nextHeight;undoStack.push(patch);
  if(undoStack.length>limit)undoStack.shift();
  redoStack.length=0;revision++;
  return {changedCells:patch.length,revision};
 }
 function stroke(command){
  keys(command,['cells','mode','radius','amount']);
  const {cells,mode,radius}=command,amount=command.amount===undefined?.05:command.amount;
  if(!Array.isArray(cells)||cells.length<1||cells.length>128||cells.some(i=>!Number.isInteger(i)||i<0||i>=n)||!['raise','lower','land','ocean'].includes(mode)||!Number.isFinite(radius)||radius<=0||radius>Math.PI||!Number.isFinite(amount)||amount<=0||amount>1)throw Error('Invalid brush stroke');
  const weight=new Float64Array(n);
  for(const center of new Set(cells)){
   const k=center*3;
   for(let i=0;i<n;i++){
    const j=i*3,dot=positions[k]*positions[j]+positions[k+1]*positions[j+1]+positions[k+2]*positions[j+2],distance=i===center?0:Math.acos(Math.max(-1,Math.min(1,dot)));
    if(distance<radius)weight[i]=Math.max(weight[i],1-distance/radius);
   }
  }
  const nextLand=land.slice(),nextHeight=height.slice();
  for(let i=0;i<n;i++)if(weight[i]>0){
   if(mode==='ocean'){nextLand[i]=0;nextHeight[i]=NaN;}
   else if(mode==='land'){if(!land[i]){nextLand[i]=1;nextHeight[i]=Math.max(MIN,amount*weight[i]);}}
   else if(land[i])nextHeight[i]=Math.max(MIN,Math.min(MAX,height[i]+(mode==='raise'?1:-1)*amount*weight[i]));
  }
  return commit(nextLand,nextHeight);
 }
 function history(from,to,reverse){
  if(!from.length)return {changedCells:0,revision};
  const patch=from.pop();
  for(const p of patch){land[p[0]]=p[reverse?1:3];height[p[0]]=p[reverse?2:4];}
  to.push(patch);revision++;
  return {changedCells:patch.length,revision};
 }
 function exportPatch(){
  const changes=[];
  for(let i=0;i<n;i++)if(land[i]!==baseLand[i]||!same(height[i],baseHeight[i]))changes.push([i,land[i],land[i]?height[i]:null]);
  return {schema:SCHEMA,w,h,base:{land:Array.from(baseLand),height:Array.from(baseHeight,(v,i)=>baseLand[i]?v:null)},changes};
 }
 function importPatch(value){
  keys(value,['schema','w','h','base','changes']);keys(value.base,['land','height']);
  if(value.schema!==SCHEMA||value.w!==w||value.h!==h||!Array.isArray(value.base.land)||!Array.isArray(value.base.height)||value.base.land.length!==n||value.base.height.length!==n||!Array.isArray(value.changes)||value.changes.length>n)throw Error('Invalid terrain patch');
  for(let i=0;i<n;i++)if(value.base.land[i]!==baseLand[i]||value.base.height[i]!== (baseLand[i]?baseHeight[i]:null))throw Error('Terrain patch belongs to another base');
  const nextLand=baseLand.slice(),nextHeight=baseHeight.slice();let previous=-1;
  for(const p of value.changes){
   if(!Array.isArray(p)||p.length!==3||!Number.isInteger(p[0])||p[0]<=previous||p[0]>=n||(p[1]!==0&&p[1]!==1)||(p[1]?(!Number.isFinite(p[2])||p[2]<MIN||p[2]>MAX):p[2]!==null))throw Error('Invalid terrain patch cell');
   previous=p[0];nextLand[p[0]]=p[1];nextHeight[p[0]]=p[1]?p[2]:NaN;
  }
  return commit(nextLand,nextHeight);
 }
 return {stroke,snapshot,undo:()=>history(undoStack,redoStack,true),redo:()=>history(redoStack,undoStack,false),exportPatch,importPatch,get canUndo(){return undoStack.length>0;},get canRedo(){return redoStack.length>0;},metadata:Object.freeze({radius:'great-circle radians; no polar-edge raster wrap',stroke:'max linear radial influence across sampled centers; duplicate samples do not compound; one command is one undo',coast:'binary mask; land adds only ocean cells, ocean clears all cells inside footprint',heights:'relative; land heights clamped to [0.000001,10]; raise/lower do not change coast',persistence:'separate terrain patch with exact base arrays, not A/B project v1; import replaces all edits and is one undo',integration:'detached snapshots only; caller must rebuild frame, relief gradients, drainage and water contexts; never reuse old water on edited geometry',history:'bounded in memory; not exported',terrainInputModified:false,waterCalculated:false})};
}
const api={create,SCHEMA};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TerrainEditCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
