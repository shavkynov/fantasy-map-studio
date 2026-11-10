(function(){
'use strict';
function measure(before,after){
 if(before.w!==after.w||before.h!==after.h||before.land.length!==after.land.length||before.height.length!==after.height.length)throw Error('Incompatible comparison fields');
 const mask=new Uint8Array(after.land.length);let changedCells=0,heightCells=0,added=0,removed=0,maxAbs=0,sumAbs=0;
 for(let i=0;i<mask.length;i++){
  if(before.land[i]!==after.land[i]){mask[i]=after.land[i]?2:3;changedCells++;if(after.land[i])added++;else removed++;}
  else if(after.land[i]&&before.height[i]!==after.height[i]){const d=Math.abs(after.height[i]-before.height[i]);if(!Number.isFinite(d))throw Error('Invalid comparison height');mask[i]=1;changedCells++;heightCells++;sumAbs+=d;maxAbs=Math.max(maxAbs,d);}
 }
 return {mask,changedCells,heightCells,added,removed,maxAbs,meanAbs:heightCells?sumAbs/heightCells:0};
}
function terrainPixels(s,withWater=false,mask=null,withRivers=false,reachDisplay=null){
 const data=new Uint8ClampedArray(s.w*s.h*4);
 for(let i=0;i<s.land.length;i++){
  let c=[24,66,91];
  if(s.land[i]){const t=Math.min(1,s.height[i]/.9);c=t<.5?[100+180*t,145+60*t,95+70*t]:[190+100*(t-.5),175+120*(t-.5),130+200*(t-.5)];const x=Number.isFinite(s.east?.[i])?-.15*s.east[i]:0,y=Number.isFinite(s.north?.[i])?-.15*s.north[i]:0,k=.62+.45*Math.max(0,(-.5*x+.5*y+Math.SQRT1_2)/Math.hypot(x,y,1));c=c.map(v=>v*k);}
  if(s.land[i]&&s.depth&&withWater&&s.depth[i]>1e-9){const a=.35+.5*Math.min(1,s.depth[i]/.05);c=c.map((v,k)=>(1-a)*v+a*[110,115,225][k]);}
  if(mask?.[i])c=mask[i]===2?[70,255,120]:mask[i]===3?[255,90,190]:[255,220,30];
  data.set([...c.map(v=>Math.max(0,Math.min(255,Math.round(v)))),255],i*4);
 }
 if(withWater&&withRivers&&!mask&&s.rivers){
  if(!reachDisplay||typeof reachDisplay.paint!=='function')throw Error('Reach display unavailable');
  return reachDisplay.paint({pixels:data},s.rivers.network,s.rivers.routing).pixels;
 }
 return data;
}
function createComparison(){
 let pair=null,mode='current';
 const detached=s=>({w:s.w,h:s.h,revision:s.revision,land:s.land.slice(),height:s.height.slice(),east:s.east?.slice(),north:s.north?.slice()});
 function clear(){pair=null;mode='current';}
 function current(revision){if(pair&&pair.after.revision!==revision)clear();return pair;}
 function record(before,after,kind){const next={before:detached(before),after:detached(after),kind,stats:measure(before,after)};pair=next;mode='current';return next;}
 function select(next,revision){if(!['current','before','after','changes'].includes(next))return false;if(next!=='current'&&!current(revision))return false;mode=next;return true;}
 return {record,clear,current,select,get mode(){return mode;}};
}
function waterSchedule(mode){
 if(!['constant','wet-dry','wet-dry-wet'].includes(mode))throw Error('Unknown water scenario');
 const periods=mode==='constant'?[true]:mode==='wet-dry'?[true,false]:[true,false,true];
 return periods.flatMap(wet=>Array.from({length:20},()=>({dt:.05,precipitation:wet?.02:0,evaporation:.001,runoffCoefficient:.5})));
}
function waterRunText(s){
 if(!s.ledger)return 'Завершённого расчёта нет. Вода сбрасывается после изменения рельефа.';
 const run=s.waterRun,number=v=>Number(v.toPrecision(7)).toString(),lines=[];
 if(run){
  lines.push('Завершено: '+run.steps.length+' шагов; время: '+number(run.totalTime)+' (условное).');
  let start=0;
  while(start<run.steps.length){let end=start+1;const a=run.steps[start],f=a.forcing;while(end<run.steps.length){const b=run.steps[end],g=b.forcing;if(a.dt!==b.dt||f.precipitation!==g.precipitation||f.evaporation!==g.evaporation||f.runoffCoefficient!==g.runoffCoefficient||(f.seepage||0)!==(g.seepage||0))break;end++;}
   lines.push('Шаги '+(start+1)+'–'+end+': dt='+number(a.dt)+', P='+number(f.precipitation)+', E='+number(f.evaporation)+', C='+number(f.runoffCoefficient)+', S='+number(f.seepage||0));start=end;
  }
 }else lines.push('Завершено; расписание этого результата недоступно.');
 const l=s.ledger;lines.push('Приход: '+l.inputTotal.toPrecision(7),'Запас: '+l.storedTotal.toPrecision(7),'Граница: '+l.boundaryTotal.toPrecision(7),'Испарение: '+l.evapTotal.toPrecision(7),'Просачивание: '+l.seepTotal.toPrecision(7),'Невязка: '+l.residual.toPrecision(7));
 return lines.join('\n');
}
if(typeof module!=='undefined'&&module.exports&&typeof document==='undefined'){module.exports={measure,terrainPixels,createComparison,waterSchedule,waterRunText};return;}
const $=id=>document.getElementById(id),canvas=$('editorMap'),overlay=$('gesture'),comparison=createComparison();
let session=null,gesture=null,locked=false;
const waterDescription=$('waterInfo').nextElementSibling;if(waterDescription)waterDescription.textContent='Каждая действительная правка, отмена или повтор сбрасывает воду и перестраивает водосборы. Воздействия задаются выбранным испытательным расписанием, не климатом. Условные высоты и время. Океан — внешняя граница.';
const riverControls=document.createElement('div');
riverControls.innerHTML='<label><input id="showRivers" type="checkbox" checked> Показывать дождевые водотоки</label><p id="riverInfo" role="status">Завершённой речной диагностики нет.</p><p>Водотоки последнего дождевого шага, порог 0.000001 в условных единицах расхода. Это не постоянные реки. Вход в воду определяется по началу шага; видимая вода — по его концу. Проходов через озёра и выходов из них здесь ещё нет. Голубые клетки — пути; зелёные — начала ветвей, белые — слияния, фиолетовые — входы в начальную воду, синие — океан, красные — замкнутые окончания. Слой входит в PNG при включённых воде и водотоках.</p>';
$('waterInfo').insertAdjacentElement('afterend',riverControls);
const scenarioControls=document.createElement('div');
scenarioControls.innerHTML='<label>Испытательный сценарий <select id="waterScenario" disabled><option value="constant">Равномерный дождь · 20 шагов</option><option value="wet-dry">Дождь → сухой период · 40 шагов</option><option value="wet-dry-wet">Дождь → сухой период → дождь · 60 шагов</option></select></label><p>Каждый период: 20 шагов, dt=0.05; дождь P=0.02, сухой период P=0; всегда E=0.001, C=0.5, S=0. Высоты и время условные. Это заданные испытания, не климат, сезоны или подтверждение постоянных рек. Каждый запуск начинается с пустого водного состояния. Смена выбора не меняет уже рассчитанный результат; выполненное расписание показано ниже. Речной слой относится только к последнему шагу.</p>';
$('calculateWater').insertAdjacentElement('beforebegin',scenarioControls);
$('calculateWater').textContent='Рассчитать с нуля · выбранный сценарий';
const controlIds=['waterScenario','brushMode','brushRadius','brushAmount','undo','redo','calculateWater','clearWater','saveEdits','openEdits','saveImage'];
const comparisonPanel=document.createElement('section');
comparisonPanel.innerHTML='<h2>Результат последнего жеста · compare-ui1</h2><p id="compareSummary" role="status">Завершите жест, чтобы измерить его результат.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding:12px;background:#203b49;line-height:1.7"><div>Изменено клеток<br><output id="compareCells">—</output></div><div>С изменённой высотой<br><output id="compareHeights">—</output></div><div>Максимальное |Δh|<br><output id="compareMax">—</output></div><div>Среднее |Δh|<br><output id="compareMean">—</output></div><div>Добавлено суши<br><output id="compareAdded">—</output></div><div>Убрано суши<br><output id="compareRemoved">—</output></div></div><p><button id="compareCurrent">Текущая карта · рисовать</button><button id="compareBefore">До</button><button id="compareAfter">После</button><button id="compareChanges">Где изменилось</button></p><p id="compareHint" style="line-height:1.7">До/после — только рельеф, без воды, с одной цветовой шкалой. Жёлтый: изменилась высота; зелёный: новая суша; розовый: убрана суша. Цвет подсветки обозначает факт изменения, не его величину. Среднее |Δh| считается только по клеткам с изменённой высотой, остающимся сушей. Высоты условные, не метры. В видах сравнения рисование заблокировано. PNG всегда сохраняет текущую карту без сравнения и подсветки. Undo/Redo и успешное открытие файла очищают сравнение.</p>';
$('mapViewport').insertAdjacentElement('afterend',comparisonPanel);
document.title+=' · compare-ui1';const heading=document.querySelector('h1');if(heading)heading.append(' · compare-ui1');
const comparisonCanvas=document.createElement('canvas');comparisonCanvas.id='comparisonLayer';comparisonCanvas.width=canvas.width;comparisonCanvas.height=canvas.height;comparisonCanvas.setAttribute('aria-hidden','true');Object.assign(comparisonCanvas.style,{position:'absolute',inset:'0',width:'100%',pointerEvents:'none',zIndex:'3',display:'none'});canvas.parentNode.appendChild(comparisonCanvas);
const compareButtons={current:$('compareCurrent'),before:$('compareBefore'),after:$('compareAfter'),changes:$('compareChanges')};
function comparisonUi(s){
 const pair=comparison.current(s?.revision),blocked=!s||locked||!!gesture||!!s.busy;
 for(const [name,button] of Object.entries(compareButtons)){button.disabled=blocked||(name!=='current'&&!pair);button.setAttribute('aria-pressed',String(comparison.mode===name));}
 if(!pair){for(const id of ['compareCells','compareHeights','compareMax','compareMean','compareAdded','compareRemoved'])$(id).textContent='—';$('compareSummary').textContent='Нет сравнения последнего жеста. Завершите новый жест.';}
 else{const t=pair.stats,number=v=>v===0?'0':v.toExponential(4);$('compareCells').textContent=String(t.changedCells);$('compareHeights').textContent=String(t.heightCells);$('compareMax').textContent=number(t.maxAbs);$('compareMean').textContent=number(t.meanAbs);$('compareAdded').textContent=String(t.added);$('compareRemoved').textContent=String(t.removed);const label={raise:'Поднятие',lower:'Опускание',land:'Добавление суши',ocean:'Уборка суши',smooth:'Сглаживание'}[pair.kind]||'Жест';$('compareSummary').textContent=label+': '+(t.changedCells?'изменения измерены.':'Высоты не изменились; маска суши тоже прежняя.');}
 comparisonCanvas.style.display=pair&&comparison.mode!=='current'?'block':'none';
 if(pair&&comparison.mode!=='current'){const field=comparison.mode==='before'?pair.before:pair.after,ctx=comparisonCanvas.getContext('2d'),im=ctx.createImageData(field.w,field.h);im.data.set(terrainPixels(field,false,comparison.mode==='changes'?pair.stats.mask:null));ctx.putImageData(im,0,0);}
}
for(const [name,button] of Object.entries(compareButtons))button.onclick=()=>{if(!session||locked||gesture||session.snapshot().busy)return;comparison.select(name,session.snapshot().revision);sync();};
canvas.addEventListener('pointerdown',e=>{if(e.button===0&&comparison.mode!=='current'){e.preventDefault();e.stopImmediatePropagation();$('compareSummary').textContent='Это просмотр сравнения. Для правки нажмите «Текущая карта · рисовать».';}},true);
function sync(){
 const s=session?.snapshot(),busy=!!s?.busy;
 for(const id of controlIds)$(id).disabled=!s||locked||!!gesture||busy;
 if(s&&!locked&&!gesture&&!busy){$('undo').disabled=!s.canUndo;$('redo').disabled=!s.canRedo;$('clearWater').disabled=!s.depth;}
 $('cancelWater').disabled=!busy;comparisonUi(s);
}
function paint(){
 const s=session.snapshot(),ctx=canvas.getContext('2d'),im=ctx.createImageData(s.w,s.h);im.data.set(terrainPixels(s,$('showWater').checked,null,$('showRivers').checked,RunoffReachDisplay));ctx.putImageData(im,0,0);
 $('editorStatus').textContent='Ревизия: '+s.revision+'\nСуша, клеток: '+s.land.reduce((a,b)=>a+b,0)+'\nВодосборов: '+s.basins+'\nUndo / Redo: '+(s.canUndo?'доступно':'нет')+' / '+(s.canRedo?'доступно':'нет');
 $('waterInfo').textContent=waterRunText(s);
 const net=s.rivers?.network,counts={};if(net)for(const node of net.nodes)counts[node.kind]=(counts[node.kind]||0)+1;
 $('riverInfo').textContent=net?'Дождевой шаг: '+s.rivers.step+'; участков: '+net.reaches.length+'; начал ветвей: '+(counts.headwater||0)+'; слияний: '+(counts.confluence||0)+'; входов в начальную воду: '+(counts['wet-entry']||0)+'; океанских окончаний: '+(counts.ocean||0)+'; замкнутых: '+(counts.closed||0)+'.'+(!$('showWater').checked||!$('showRivers').checked?' Слой скрыт.':''):'Завершённой речной диагностики нет. Пересчитайте воду.';
 sync();
}
function clearGesture(){const g=gesture;gesture=null;overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);if(g&&canvas.hasPointerCapture(g.pointer))canvas.releasePointerCapture(g.pointer);sync();}
function cellAt(e){const b=canvas.getBoundingClientRect(),u=(e.clientX-b.left)/b.width,v=(e.clientY-b.top)/b.height;if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>=1||v<0||v>=1)return null;return Math.floor(v*canvas.height)*canvas.width+Math.floor(u*canvas.width);}
function append(cell){if(cell===null||!gesture)return;const g=gesture,last=g.cells.at(-1),w=canvas.width;
 const add=i=>{if(g.cells.includes(i))return;g.cells.push(i);if(g.cells.length>128)throw Error('Жест длиннее 128 точек. Он отменён; рисуйте несколькими жестами.');const ctx=overlay.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(i%w,Math.floor(i/w),1,1);};
 if(last===undefined){add(cell);return;}
 let dx=cell%w-last%w;if(dx>w/2)dx-=w;if(dx< -w/2)dx+=w;
 const dy=Math.floor(cell/w)-Math.floor(last/w),steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/Math.max(1,g.radius*w/(4*Math.PI))));
 for(let k=1;k<=steps;k++){const x=(Math.round(last%w+dx*k/steps)%w+w)%w,y=Math.round(Math.floor(last/w)+dy*k/steps);add(y*w+x);}
}
canvas.addEventListener('pointerdown',e=>{if(!session||locked||gesture||session.snapshot().busy||e.button!==0)return;try{const radius=Number($('brushRadius').value),amount=Number($('brushAmount').value);if(!Number.isFinite(radius)||radius<1||radius>30||!Number.isFinite(amount)||amount<.001||amount>1)throw Error('Радиус: 1–30°, сила: 0.001–1.');const cell=cellAt(e);if(cell===null)return;gesture={pointer:e.pointerId,cells:[],radius:radius*Math.PI/180,amount,mode:$('brushMode').value};canvas.setPointerCapture(e.pointerId);append(cell);sync();e.preventDefault();}catch(error){clearGesture();$('editorStatus').textContent='Ошибка кисти: '+error.message;}});
canvas.addEventListener('pointermove',e=>{if(gesture?.pointer!==e.pointerId)return;try{append(cellAt(e));}catch(error){clearGesture();$('editorStatus').textContent=error.message;}});
canvas.addEventListener('pointerup',e=>{if(gesture?.pointer!==e.pointerId)return;const command={cells:gesture.cells.slice(),radius:gesture.radius,amount:gesture.amount,mode:gesture.mode};clearGesture();let before,after;try{before=session.snapshot();session.stroke(command);after=session.snapshot();}catch(error){$('editorStatus').textContent='Правка отклонена. Прежняя карта сохранена.\n'+error.message;sync();return;}paint();try{comparison.record(before,after,command.mode);sync();}catch(error){comparison.clear();sync();$('compareSummary').textContent='Правка применена, но сравнение недоступно: '+error.message;}});
for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{if(gesture)clearGesture();});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&gesture)clearGesture();});
for(const name of ['undo','redo'])$(name).onclick=()=>{try{session[name]();comparison.clear();paint();}catch(error){$('editorStatus').textContent='Операция отклонена: '+error.message;sync();}};
$('showWater').onchange=()=>{if(session)paint();};
$('showRivers').onchange=()=>{if(session)paint();};
$('calculateWater').onclick=async()=>{try{comparison.select('current',session.snapshot().revision);const schedule=waterSchedule($('waterScenario').value);const task=session.runWater((step,total)=>{$('waterInfo').textContent='Расчёт воды\nШаг: '+step+' / '+total;},{schedule});sync();const result=await task;paint();if(result.status==='cancelled')$('waterInfo').textContent+='\nНовый расчёт отменён; прежний завершённый результат сохранён.';}catch(error){paint();$('waterInfo').textContent+='\nОшибка расчёта: '+error.message;}finally{sync();}};
$('cancelWater').onclick=()=>session.cancel();
$('clearWater').onclick=()=>{session.clearWater();paint();};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('saveEdits').onclick=()=>{download(new Blob([JSON.stringify(session.save())],{type:'application/json'}),'terrain-edits.json');$('fileInfo').textContent='Файл правок передан браузеру для сохранения. Вода и Undo не включены.';};
$('openEdits').onchange=async()=>{const file=$('openEdits').files[0];if(!file)return;locked=true;sync();try{if(file.size>32*1024*1024)throw Error('Файл больше 32 МиБ');const value=JSON.parse(await file.text());session.load(value);comparison.clear();paint();$('fileInfo').textContent='Правки открыты. Это заменяет все текущие правки; доступна отмена.';}catch(error){$('fileInfo').textContent='Открытие отклонено. Прежняя карта сохранена.\n'+error.message;}finally{locked=false;$('openEdits').value='';sync();}};
$('saveImage').onclick=()=>{canvas.toBlob(async blob=>{try{if(!blob)throw Error('PNG не создан');if(window.api?.savePNG)await window.api.savePNG(await blob.arrayBuffer(),'terrain-editor.png');else download(blob,'terrain-editor.png');$('fileInfo').textContent='PNG текущей карты передан для сохранения. Сравнение, подсветка и точки жеста не включены.';}catch(error){$('fileInfo').textContent='Ошибка PNG: '+error.message;}});};
window.addEventListener('pagehide',()=>{if(session)session.cancel();comparison.clear();clearGesture();});
sync();
function loadRiverModule(src){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('Не загружен модуль '+src));document.head.appendChild(script);});}
Promise.all(['rainfall-runoff-routing.js','runoff-reach-network.js','runoff-reach-display.js'].map(loadRiverModule)).then(()=>ThreeBlockPrototype.create()).then(base=>{
 const model=EqualAreaABCandidate.create(base,{eastEnd:2,westEnd:2}),frame=model.frame(360,180,2,4),terrain=RegionalMaterialTerrain.create(base,MaterialReliefLayer),field=RegionalReliefIntegration.build(frame,terrain.heights(model,frame));
 session=TerrainEditSession.create(field,{Core:TerrainEditCore,Relief:RegionalReliefIntegration,Drainage:SphericalDrainage,Hierarchy:BasinSpillHierarchy,Surface:CoupledBasinWater,Fill:BasinFillSpill,Routing:RainfallRunoffRouting,Reaches:RunoffReachNetwork,yieldStep:()=>new Promise(r=>setTimeout(r,0))});paint();
}).catch(error=>{$('editorStatus').textContent='Редактор не запущен: '+error.message;});
})();
