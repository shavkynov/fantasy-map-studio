(function(root){
'use strict';
function extend(Core){
 function create(field,options){
  const core=Core.create(field,options),original=core.stroke,{w,h}=field,n=w*h;let positions=null;
  function distance(a,b){if(a===b)return 0;if(!positions){positions=new Float64Array(n*3);for(let i=0;i<n;i++){const lat=Math.PI*(.5-(Math.floor(i/w)+.5)/h),lon=2*Math.PI*((i%w+.5)/w-.5),c=Math.cos(lat);positions.set([c*Math.cos(lon),c*Math.sin(lon),Math.sin(lat)],i*3);}}const k=a*3,j=b*3;return Math.acos(Math.max(-1,Math.min(1,positions[k]*positions[j]+positions[k+1]*positions[j+1]+positions[k+2]*positions[j+2])));}
  core.stroke=function(command){
   if(!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).some(k=>!['cells','mode','radius','amount','profile','target'].includes(k)))throw Error('Invalid brush stroke');
   const {cells,mode,radius,target}=command,amount=command.amount===undefined?.05:command.amount,profile=command.profile===undefined?'linear':command.profile;
   if(!Array.isArray(cells)||!cells.length||cells.length>128||cells.some(i=>!Number.isInteger(i)||i<0||i>=n)||!['raise','lower','land','ocean','smooth','flatten'].includes(mode)||!Number.isFinite(radius)||radius<=0||radius>Math.PI||!Number.isFinite(amount)||amount<=0||amount>1||!['linear','soft','hard'].includes(profile)||(mode==='flatten'?(!Number.isFinite(target)||target<1e-6||target>10):target!==undefined))throw Error('Invalid brush stroke');
   if(profile==='linear'&&mode!=='flatten')return original({cells,mode,radius,amount});
   const before=core.snapshot(),weight=new Float64Array(n),height=before.height.slice(),land=before.land.slice();
   for(const center of new Set(cells))for(let i=0;i<n;i++){const d=distance(center,i);if(d<radius){const u=1-d/radius;weight[i]=Math.max(weight[i],profile==='hard'?1:profile==='soft'?u*u*(3-2*u):u);}}
   for(let i=0;i<n;i++)if(weight[i]>0){
    if(mode==='ocean'){land[i]=0;height[i]=NaN;}
    else if(mode==='land'){if(!before.land[i]){land[i]=1;height[i]=Math.max(1e-6,amount*weight[i]);}}
    else if(before.land[i]){
     if(mode==='flatten')height[i]=before.height[i]+amount*weight[i]*(target-before.height[i]);
     else if(mode==='smooth'){
      const x=i%w,y=Math.floor(i/w),px=(x+w/2)%w,neighbours=new Set([y*w+(x+w-1)%w,y*w+(x+1)%w,y===0?px:i-w,y===h-1?(h-1)*w+px:i+w]);let total=1,delta=0,low=before.height[i],high=low;
      for(const j of neighbours)if(j!==i&&before.land[j]){const q=(Math.PI/h/Math.max(1e-12,distance(i,j)))**2;total+=q;delta+=q*(before.height[j]-before.height[i]);low=Math.min(low,before.height[j]);high=Math.max(high,before.height[j]);}
      height[i]=Math.max(low,Math.min(high,before.height[i]+amount*weight[i]*delta/total));
     }else height[i]=Math.max(1e-6,Math.min(10,before.height[i]+(mode==='raise'?1:-1)*amount*weight[i]));
     height[i]=Math.max(1e-6,Math.min(10,height[i]));
    }
   }
   const patch=core.exportPatch();patch.changes=[];
   for(let i=0;i<n;i++){const v=land[i]?height[i]:null;if(land[i]!==patch.base.land[i]||v!==patch.base.height[i])patch.changes.push([i,land[i],v]);}
   return core.importPatch(patch);
  };
  core.metadata=Object.freeze({...core.metadata,shaping:'flatten existing land toward target [0.000001,10]; max influence per gesture; linear preserves old tools; soft smoothstep and hard disc profiles; no terrain-volume conservation'});return core;
 }
 return {...Core,create};
}
function heightPixels(field){
 const data=new Uint8ClampedArray(field.w*field.h*4);
 for(let i=0;i<field.land.length;i++){const v=field.land[i]?Math.round(35+220*Math.log1p(20*field.height[i])/Math.log(201)):0;data.set(field.land[i]?[v,v,v,255]:[24,66,91,255],i*4);}return data;
}
function install(doc,win){
 const get=id=>doc.getElementById(id),canvas=get('editorMap'),mode=get('brushMode'),amount=get('brushAmount'),radius=get('brushRadius'),profile=get('brushProfile'),target=get('brushTarget'),display=get('heightDisplay'),readout=get('heightReadout');let live=null,snapshot=null,previous=mode.value;
 const defaults={raise:.05,lower:.05,land:.05,ocean:.05,smooth:.5,flatten:1},saved={};
 const layer=doc.createElement('canvas');layer.id='heightLayer';layer.width=canvas.width;layer.height=canvas.height;Object.assign(layer.style,{position:'absolute',inset:'0',width:'100%',pointerEvents:'none',zIndex:'1',display:'none'});layer.setAttribute('aria-hidden','true');canvas.parentNode.appendChild(layer);get('gesture').style.zIndex='2';
 const comparing=()=>get('comparisonLayer')?.style.display==='block';
 function refresh(){
  const blocked=!live||radius.disabled;profile.disabled=blocked||mode.value==='ocean';target.disabled=blocked||mode.value!=='flatten';display.disabled=blocked;get('targetLabel').hidden=mode.value!=='flatten';
  get('brushAmountLabel').textContent=({raise:'Прибавка высоты',lower:'Убавка высоты',land:'Высота новой суши в центре',ocean:'Сила (для удаления не используется)',smooth:'Доля сглаживания',flatten:'Доля приближения к цели'})[mode.value];
  layer.style.display=snapshot&&display.value==='height'&&!comparing()?'block':'none';
  if(layer.style.display==='block'){const ctx=layer.getContext('2d'),im=ctx.createImageData(snapshot.w,snapshot.h);im.data.set(heightPixels(snapshot));ctx.putImageData(im,0,0);}
 }
 mode.addEventListener('change',()=>{saved[previous]=amount.value;previous=mode.value;amount.value=saved[previous]===undefined?defaults[previous]:saved[previous];refresh();});display.addEventListener('change',refresh);
 canvas.addEventListener('pointermove',e=>{
  if(!snapshot)return;if(comparing()){readout.textContent='Просмотр сравнения: для чтения текущей высоты вернитесь к текущей карте.';return;}
  const b=canvas.getBoundingClientRect(),u=(e.clientX-b.left)/b.width,v=(e.clientY-b.top)/b.height;if(u<0||u>=1||v<0||v>=1)return;const i=Math.floor(v*snapshot.h)*snapshot.w+Math.floor(u*snapshot.w);readout.textContent='Клетка '+i+' · '+(snapshot.land[i]?'Высота: '+snapshot.height[i].toPrecision(7)+' (условные единицы)':'Океан · высота суши не задана');
 });canvas.addEventListener('pointerleave',()=>{readout.textContent='Наведите указатель на текущую карту: высота читается из данных, не из цвета.';});
 const Session=win.TerrainEditSession,originalCreate=Session.create;
 Session.create=function(base,deps){
  const session=originalCreate(base,deps);live=session;const update=()=>{snapshot=session.snapshot();refresh();};
  for(const name of ['stroke','undo','redo','load','clearWater']){const original=session[name];session[name]=function(...args){
   if(name==='stroke'){const c={...args[0],profile:mode.value==='ocean'?'linear':profile.value};if(c.mode==='flatten')c.target=Number(target.value);args[0]=c;}
   const result=original.apply(session,args);update();return result;
  };}
  const run=session.runWater;session.runWater=function(...args){const task=run.apply(session,args);update();return task.finally(update);};update();return session;
 };
 let watched=null;const observer=new win.MutationObserver(()=>{const comparison=get('comparisonLayer');if(comparison&&comparison!==watched){watched=comparison;observer.observe(comparison,{attributes:true,attributeFilter:['style']});}refresh();});observer.observe(radius,{attributes:true,attributeFilter:['disabled']});observer.observe(canvas.parentNode,{childList:true});win.addEventListener('pagehide',()=>{observer.disconnect();layer.style.display='none';});refresh();
}
const api={extend,heightPixels,install};if(typeof module!=='undefined'&&module.exports)module.exports=api;else{root.TerrainEditCore=extend(root.TerrainEditCore);install(document,root);}
})(typeof globalThis!=='undefined'?globalThis:this);
