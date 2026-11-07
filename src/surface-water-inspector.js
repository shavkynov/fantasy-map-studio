(function(root){'use strict';
const attached=new WeakSet();
function attach(d){
 if(!d||['getField','getSurface','getVisible','isLocked'].some(k=>typeof d[k]!=='function')||d.water?.records?.length!==2||d.view?.panes?.length!==2||typeof d.objects?.build!=='function')throw Error('Inspector dependencies required');
 if(d.describeContacts!==undefined&&typeof d.describeContacts!=='function')throw Error('Invalid contact adapter');
 if(d.highlight!==undefined&&(!d.highlight||typeof d.highlight.show!=='function'||typeof d.highlight.clear!=='function'))throw Error('Invalid highlight adapter');
 const $=id=>d.doc.getElementById(id),cache=new WeakMap(),selection=[null,null],listeners=[],wrappers=[];let disposed=false;
 for(let i=0;i<2;i++)if(!d.view.panes[i]||!$('waterObject'+i))throw Error('Water object readouts required');
 if(attached.has(d.view))throw Error('Water inspector already attached');attached.add(d.view);
 function ready(i){const r=d.water.records[i],p=d.view.panes[i];return r&&p.current&&p.current.f===r.frame&&r.frame?.w===720&&r.frame?.h===360?r:null;}
 function blocked(r){return r.busy||(d.isLocked&&d.isLocked());}
 function data(r){let byFrame=cache.get(r.state);if(!byFrame){byFrame=new WeakMap();cache.set(r.state,byFrame);}let result=byFrame.get(r.frame);if(!result){result=d.objects.build(d.getField(r.frame),r.state.redistribution);byFrame.set(r.frame,result);}return result;}
 function contacts(r,c,id){if(!d.describeContacts)return '';try{return d.describeContacts(r,c,id);}catch(e){return ' Контакты недоступны: '+String(e.message||e)+'.';}}
 function clearHighlight(i){if(d.highlight)d.highlight.clear(i);}
 function text(i,value,catalog=null,id=-1){let warning='';if(d.highlight)try{if(catalog)d.highlight.show(i,catalog,id);else clearHighlight(i);}catch(e){try{clearHighlight(i);}catch(_){}warning=' Подсветка недоступна: '+String(e.message||e)+'.';}$('waterObject'+i).textContent=value+warning;}
 function refresh(i){if(disposed)return;const r=ready(i),s=selection[i];if(!r||!r.state){selection[i]=null;text(i,'Водные области: сначала завершите расчёт воды.');return;}if(s&&(s.frame!==r.frame||s.state!==r.state))selection[i]=null;
 if(blocked(r)){text(i,'Водные области: операция выполняется, выбор временно недоступен.');return;}
 if(d.getSurface()!=='regional'||!d.getVisible()){text(i,'Водные области: слой воды скрыт.');return;}
 const hit=selection[i];if(!hit){text(i,'Нажмите на рассчитанную воду, чтобы выбрать область. Это снимок, не устойчивое озеро.');return;}
 try{if(!r.frame.land[hit.cell]){text(i,'Океанская маска: глубина океана не задана, объект не выделяется.');return;}const c=data(r),id=c.labels[hit.cell];if(id<0){text(i,'В выбранной клетке нет воды выше порога '+c.metadata.depthThreshold+'.');return;}const o=c.objects[id],n=v=>Number(v).toPrecision(6);text(i,'Водная область '+(id+1)+' из '+c.objects.length+' (номер только этого снимка). Клеток: '+o.cellCount+'. Площадь: '+n(o.areaSteradians)+' ср ('+n(100*o.areaSteradians/(4*Math.PI))+'% сферы). Объём: '+n(o.volume)+' усл. высота·ср. Глубина средняя / максимальная: '+n(o.meanDepth)+' / '+n(o.maxDepth)+' усл. Уровень поверхности min / max: '+n(o.minSurfaceLevel)+' / '+n(o.maxSurfaceLevel)+'. Соседство по стороне с маской океана: '+(o.touchesOceanMask?'да':'нет')+'; это не доказательство стока. Область не классифицирована как устойчивое озеро или река.'+contacts(r,c,id),c,id);
 }catch(e){text(i,'Не удалось прочитать водную область: '+String(e.message||e));}}
 function click(i,e){const r=ready(i);if(!r||!r.state||blocked(r)||d.getSurface()!=='regional'||!d.getVisible())return;const b=d.view.panes[i].canvas.getBoundingClientRect(),u=(e.clientX-b.left)/b.width,v=(e.clientY-b.top)/b.height;if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>=1||v<0||v>=1)return;selection[i]={frame:r.frame,state:r.state,cell:Math.floor(v*r.frame.h)*r.frame.w+Math.floor(u*r.frame.w)};refresh(i);}
 function listen(el,event,fn){if(!el)return;el.addEventListener(event,fn);listeners.push([el,event,fn]);}
 const refreshAll=()=>{if(disposed)return;for(let i=0;i<2;i++)try{refresh(i);}catch(e){try{text(i,'Не удалось обновить карточку воды: '+String(e.message||e));}catch(_){}}};
 for(let i=0;i<2;i++)listen(d.view.panes[i].canvas,'click',e=>click(i,e));
 for(const id of ['surfaceMode','waterVisible','reachThreshold'])listen($(id),'change',refreshAll);
 function replace(el,key,fn){const before=el[key];el[key]=fn;wrappers.push([el,key,before,fn]);}
 function wrap(id,key){const el=$(id),before=el&&el[key];if(typeof before!=='function')return;replace(el,key,async function(...args){if(disposed)return before.apply(this,args);try{const task=before.apply(this,args);refreshAll();return await task;}finally{refreshAll();}});}
 for(let i=0;i<2;i++){const el=d.view.panes[i].canvas,before=el.onclick;if(typeof before==='function')replace(el,'onclick',function(...args){if(!disposed&&(d.isLocked()||d.water.records[i].busy))return;return before.apply(this,args);});}
 for(let i=0;i<2;i++)for(const prefix of ['waterWet','waterDry','waterContinue','waterCancel','waterReset','history'])wrap(prefix+i,'onclick');
 for(const id of ['apply','projectOpen','projectSave','projectCancel'])wrap(id,'onclick');
 for(const id of ['surfaceMode','drainageLayer','catchmentThreshold','waterVisible','rainScenario','rainVisible','returnEvaporation'])wrap(id,'onchange');
 const observer=typeof d.win?.MutationObserver==='function'?new d.win.MutationObserver(refreshAll):null;
 if(observer)for(const id of ['waterBalance0','waterBalance1','projectStatus']){const el=$(id);if(el)observer.observe(el,{childList:true,characterData:true,subtree:true});}
 refreshAll();return {refreshAll,dispose(){if(disposed)return;disposed=true;for(let i=0;i<2;i++)try{clearHighlight(i);}catch(_){}if(observer)observer.disconnect();for(const [el,event,fn] of listeners)el.removeEventListener(event,fn);for(const [el,key,before,fn] of wrappers.reverse())if(el[key]===fn)el[key]=before;selection.fill(null);attached.delete(d.view);}};
}
const api={attach};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SurfaceWaterInspector=api;
})(typeof globalThis!=='undefined'?globalThis:this);
