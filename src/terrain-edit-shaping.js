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
     if(mode==='flatten'){
      const influence=amount*weight[i];
      height[i]=influence===1?target:before.height[i]+influence*(target-before.height[i]);
     }
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
function createWorkspace(base,deps,Factory){
 const procedural=deps.Core.create(base).snapshot(),listeners=new Set();let active=Factory.create(procedural,deps),name='Процедурная карта',revision=0,locked=false,persisted=false;
 const documentValue=()=>({schema:'fm-terrain-workspace-v1',name,patch:active.save()}),signature=()=>JSON.stringify(documentValue());let current=signature(),checkpoint=current;
 const validName=v=>{if(typeof v!=='string'||!v.trim()||v!==v.trim()||v.length>100||/[\u0000-\u001f\u007f]/.test(v))throw Error('Недопустимое имя карты');return v;};
 const info=()=>({name,dirty:current!==checkpoint,persisted,locked,revision});
 function notify(type){for(const fn of listeners)try{fn(type,info());}catch(error){if(typeof console!=='undefined')console.error('Workspace observer:',error);}}
 function changed(){revision++;current=signature();notify('change');}
 function available(){if(locked)throw Error('Операция с файлом ещё не завершена');}
 const session={snapshot:()=>({...active.snapshot(),revision,busy:locked||active.snapshot().busy}),save:()=>active.save(),cancel:()=>active.cancel(),clearWater:()=>active.clearWater(),runWater:(...args)=>locked?Promise.resolve({status:'busy'}):active.runWater(...args)};
 for(const method of ['stroke','undo','redo','load'])session[method]=(...args)=>{available();const result=active[method](...args);if(result)changed();return result;};
 function stage(nextName,nextBase,patch,fromFile){
  validName(nextName);const candidate=Factory.create(nextBase,deps,patch),expected=revision;let used=false;
  return {commit(){if(used||revision!==expected)throw Error('Подготовленная карта устарела');used=true;active.cancel();active=candidate;name=nextName;revision++;current=signature();checkpoint=fromFile?current:null;persisted=fromFile;notify('replace');}};
 }
 function stageOpen(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['schema','name','patch'].includes(k))||value.schema!=='fm-terrain-workspace-v1')throw Error('Не файл карты редактора');
  const p=value.patch;if(!p||p.w!==procedural.w||p.h!==procedural.h||!Array.isArray(p.base?.land)||!Array.isArray(p.base?.height)||p.base.land.length!==p.w*p.h||p.base.height.length!==p.w*p.h)throw Error('Несовместимая сетка или основа карты');
  const nextBase={w:p.w,h:p.h,land:p.base.land.slice(),height:p.base.height.map(v=>v===null?NaN:v)};return stage(value.name,nextBase,p,true);
 }
 function stageNew(kind){if(!['ocean','procedural'].includes(kind))throw Error('Неизвестная основа');const b=kind==='ocean'?{w:procedural.w,h:procedural.h,land:new Uint8Array(procedural.w*procedural.h),height:new Float64Array(procedural.w*procedural.h).fill(NaN)}:deps.Core.create(procedural).snapshot();return stage(kind==='ocean'?'Новая карта':'Процедурная карта',b,undefined,false);}
 function stageGenerated(options,Generator){available();if(!Generator||typeof Generator.generate!=='function')throw Error('Генератор недоступен');const field=Generator.generate({...options,w:procedural.w,h:procedural.h});if(field.w!==procedural.w||field.h!==procedural.h)throw Error('Несовместимая сетка генератора');const prepared=stage('Новый сферический мир',field,undefined,false);return {metadata:JSON.parse(JSON.stringify(field.metadata)),commit:prepared.commit};}
 return {session,info,document:documentValue,stageOpen,stageNew,stageGenerated,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},hold(value){locked=!!value;notify('lock');},rename(value){available();validName(value);if(name!==value){name=value;changed();}},markSaved(text){if(text!==current)return false;checkpoint=current;persisted=true;notify('saved');return true;}};
}
function installWorkspace(doc,win){
 const get=id=>doc.getElementById(id),panel=doc.createElement('section');let work=null;
 panel.innerHTML='<h2>Карта · workspace-ui1</h2><label>Название <input id="mapName" maxlength="100" value="Процедурная карта" disabled></label><p><button id="newOcean" disabled>Новая · пустой океан</button><button id="newProcedural" disabled>Новая · процедурная основа</button><button id="saveMap" disabled>Сохранить карту целиком</button><label>Открыть карту <input id="openMap" type="file" accept=".fmworld,.json,application/json" disabled></label></p><p id="mapState" role="status">Загрузка карты…</p><p id="mapFileStatus" role="status">Полный файл карты хранит название, исходную основу и правки. Вода и история не сохраняются. Старый JSON правок остаётся отдельным форматом.</p>';
 doc.querySelector('fieldset').before(panel);doc.title=doc.title.replace('editor-ui5','editor-ui6')+' · workspace-ui1';const h=doc.querySelector('h1');h.textContent=h.textContent.replace('editor-ui5','editor-ui6')+' · workspace-ui1';h.nextElementSibling.innerHTML='Самостоятельные карты редактора, сетка 360×180. Новая процедурная карта использует принятую фиксированную основу A; это не новый случайный мир. <a href="water-contacts-candidate.html">Водный цикл A/B .17</a> остаётся отдельным. Полный файл редактора не является проектом A/B.';
 function refresh(){const blocked=!work||work.session.snapshot().busy||get('brushRadius').disabled;for(const id of ['mapName','newOcean','newProcedural','saveMap','openMap'])get(id).disabled=blocked;if(work){const i=work.info();if(doc.activeElement!==get('mapName'))get('mapName').value=i.name;get('mapState').textContent=i.name+'\n'+(i.dirty?'Есть несохранённые изменения':i.persisted?'Карта соответствует открытому или сохранённому файлу':'Без изменений; полный файл ещё не сохранён');if(i.locked)get('cancelWater').disabled=true;}}
 function repaint(){if(get('showWater').onchange)get('showWater').onchange();refresh();}
 const Session=win.TerrainEditSession,create=Session.create;
 Session.create=function(base,deps){work=createWorkspace(base,deps,{create});work.subscribe(type=>{if(type==='replace'){work.session.clearWater();get('heightDisplay').value='terrain';get('heightDisplay').dispatchEvent(new win.Event('change'));get('heightReadout').textContent='Наведите указатель на новую карту.';repaint();const preview=get('brushPreview');if(preview)preview.getContext('2d').clearRect(0,0,preview.width,preview.height);get('mapName').value=work.info().name;}else refresh();});refresh();return work.session;};
 const replaceAllowed=()=>!work.info().dirty||win.confirm('В карте есть несохранённые изменения. Заменить её без сохранения?');
 for(const [id,kind] of [['newOcean','ocean'],['newProcedural','procedural']])get(id).onclick=()=>{if(!work||get(id).disabled||!replaceAllowed())return;try{work.stageNew(kind).commit();get('mapFileStatus').textContent='Новая карта создана. История и вода предыдущей карты не перенесены.';}catch(e){get('mapFileStatus').textContent='Новая карта не создана; прежняя сохранена. '+e.message;}};
 get('mapName').addEventListener('change',()=>{try{work.rename(get('mapName').value.trim());get('mapName').value=work.info().name;}catch(e){get('mapName').value=work.info().name;get('mapFileStatus').textContent=e.message;}});
 get('openMap').onchange=async()=>{const file=get('openMap').files[0];if(!file||!work)return;work.hold(true);repaint();try{if(file.size>32*1024*1024)throw Error('Файл больше 32 МиБ');const text=await file.text(),stage=work.stageOpen(JSON.parse(text));if(!replaceAllowed()){get('mapFileStatus').textContent='Открытие отменено. Прежняя карта сохранена.';return;}stage.commit();get('mapFileStatus').textContent='Карта открыта целиком. Воду можно рассчитать заново.';}catch(e){get('mapFileStatus').textContent='Открытие отклонено. Прежняя карта сохранена. '+e.message;}finally{get('openMap').value='';work.hold(false);repaint();}};
 get('saveMap').onclick=async()=>{if(!work||get('saveMap').disabled)return;const text=JSON.stringify(work.document()),filename=work.info().name.replace(/[\\/:*?"<>|]/g,'_')+'.fmworld';work.hold(true);repaint();try{if(win.api?.saveWorld){const result=await win.api.saveWorld(text,filename);if(result){work.markSaved(text);get('mapFileStatus').textContent='Полная карта сохранена.';}else get('mapFileStatus').textContent='Сохранение отменено. Статус изменений не сброшен.';}else{const url=win.URL.createObjectURL(new win.Blob([text],{type:'application/json'})),a=doc.createElement('a');a.href=url;a.download=filename;a.click();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);get('mapFileStatus').textContent='Файл передан браузеру. Запись на диск не подтверждена; статус изменений не сброшен.';}}catch(e){get('mapFileStatus').textContent='Ошибка сохранения; изменения остаются в карте. '+e.message;}finally{work.hold(false);repaint();}};
 const observer=new win.MutationObserver(refresh);observer.observe(get('brushRadius'),{attributes:true,attributeFilter:['disabled']});win.addEventListener('pagehide',()=>observer.disconnect());refresh();
 const loader=doc.createElement('script');loader.src='terrain-edit-spherical-base.js';loader.onload=()=>win.SphericalTerrainBase.installUI(doc,win,()=>work,repaint);loader.onerror=()=>{const warning=doc.createElement('p');warning.textContent='Сферический генератор не загрузился. Существующие карты и редактор остаются доступны.';panel.appendChild(warning);};doc.head.appendChild(loader);
}
function install(doc,win){
 installWorkspace(doc,win);
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
const api={extend,heightPixels,createWorkspace,install};if(typeof module!=='undefined'&&module.exports)module.exports=api;else{root.TerrainEditCore=extend(root.TerrainEditCore);install(document,root);}
})(typeof globalThis!=='undefined'?globalThis:this);
