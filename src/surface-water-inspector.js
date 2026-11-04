(function(root){'use strict';
const attached=new WeakSet();
function attach(d){
 if(attached.has(d.view))throw Error('Water inspector already attached');attached.add(d.view);
 const $=id=>d.doc.getElementById(id),cache=new WeakMap(),selection=[null,null],busy=()=>d.getProjectBusy()===true;
 function ready(i){const r=d.water.records[i],p=d.view.panes[i];return !!(r&&p&&r.frame&&p.current?.f===r.frame);}
 function catalog(i){const r=d.water.records[i];let byFrame=cache.get(r.state);if(!byFrame){byFrame=new WeakMap();cache.set(r.state,byFrame);}let hit=byFrame.get(r.frame);if(!hit){hit=d.Objects.build(d.getField(r.frame),r.state.redistribution);byFrame.set(r.frame,hit);}return hit;}
 function text(i,value){$('waterObject'+i).textContent=value;}
 function refresh(i){const r=d.water.records[i],s=selection[i];if(s&&(s.frame!==r.frame||s.state!==r.state))selection[i]=null;
 if(busy()||r.busy){text(i,'Водные области: дождитесь завершения операции.');return;}
 if(!ready(i)||!r.state){text(i,'Водные области: завершённого расчёта воды нет.');return;}
 if(d.getSurface()!=='regional'){text(i,'Водные области скрыты в режиме Материал.');return;}
 if(!d.getVisible()){text(i,'Водные области: включите отображение воды.');return;}
 const chosen=selection[i];if(!chosen){text(i,'Нажмите на рассчитанную воду, чтобы выбрать связную область.');return;}
 const hit=catalog(i),id=hit.labels[chosen.cell];if(id<0){selection[i]=null;text(i,'В этой клетке нет водной области выше порога отображения.');return;}
 const o=hit.objects[id],n=x=>Number(x).toPrecision(6);
 text(i,'Водная область '+(id+1)+' из '+hit.objects.length+' — текущий результат, не постоянное озеро. Клеток: '+o.cellCount+'. Площадь: '+n(o.areaSteradians)+' ср. Объём: '+n(o.volume)+' условн. высота × ср. Глубина средняя / максимальная: '+n(o.meanDepth)+' / '+n(o.maxDepth)+' условн. Уровень поверхности min / max: '+n(o.minSurfaceLevel)+' / '+n(o.maxSurfaceLevel)+'. '+(o.touchesOceanMask?'Соседствует стороной с океанской маской; это не доказательство физического выхода в океан.':'Не соседствует стороной с океанской маской.')+' Номер действует только в этом снимке.');
 }
 function refreshAll(){for(let i=0;i<2;i++)try{refresh(i);}catch(e){text(i,'Не удалось прочитать водную область: '+String(e.message||e));}}
 function choose(i,event){const r=d.water.records[i],p=d.view.panes[i];if(busy()||r.busy||!ready(i)||!r.state||d.getSurface()!=='regional'||!d.getVisible()){refreshAll();return;}
 try{const b=p.canvas.getBoundingClientRect(),u=(event.clientX-b.left)/b.width,v=(event.clientY-b.top)/b.height;if(!Number.isFinite(u)||!Number.isFinite(v)||b.width<=0||b.height<=0||u<0||u>=1||v<0||v>=1)return;const cell=Math.floor(v*r.frame.h)*r.frame.w+Math.floor(u*r.frame.w),hit=catalog(i);if(hit.labels[cell]<0){selection[i]=null;text(i,r.frame.land[cell]?'В этой клетке нет водной области выше порога отображения.':'Океанская маска: океан не входит в каталог поверхностной воды на суше.');return;}selection[i]={frame:r.frame,state:r.state,cell};refresh(i);}catch(e){text(i,'Не удалось выбрать водную область: '+String(e.message||e));}}
 for(let i=0;i<2;i++){const canvas=d.view.panes[i].canvas,before=canvas.onclick;canvas.onclick=function(event){if(busy()||d.water.records[i].busy)return;if(before)before.call(this,event);choose(i,event);};}
 function wrap(id,key){const el=$(id),before=el&&el[key];if(!before)return;el[key]=async function(...args){try{const task=before.apply(this,args);refreshAll();return await task;}finally{refreshAll();}};}
 for(let i=0;i<2;i++)for(const prefix of ['waterWet','waterDry','waterContinue','waterCancel','waterReset','history'])wrap(prefix+i,'onclick');for(const id of ['apply','projectOpen','projectSave','projectCancel'])wrap(id,'onclick');for(const id of ['surfaceMode','drainageLayer','catchmentThreshold','waterVisible','rainScenario','rainVisible','returnEvaporation'])wrap(id,'onchange');
 refreshAll();return {refreshAll,choose};
}
const api={attach};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SurfaceWaterInspector=api;
})(typeof globalThis!=='undefined'?globalThis:this);
