(function(root){'use strict';
function attach(d){
 if(!d||['getField','getSurface','getVisible','isLocked'].some(k=>typeof d[k]!=='function')||d.water?.records?.length!==2||d.view?.panes?.length!==2||typeof d.objects?.build!=='function')throw Error('Inspector dependencies required');
 const $=id=>d.doc.getElementById(id),cache=new WeakMap(),selection=[null,null],listeners=[];let disposed=false;
 for(let i=0;i<2;i++)if(!d.view.panes[i]||!$('waterObject'+i))throw Error('Water object readouts required');
 function ready(i){const r=d.water.records[i],p=d.view.panes[i];return r&&p.current&&p.current.f===r.frame&&r.frame?.w===720&&r.frame?.h===360?r:null;}
 function blocked(r){return r.busy||(d.isLocked&&d.isLocked());}
 function data(r){let byFrame=cache.get(r.state);if(!byFrame){byFrame=new WeakMap();cache.set(r.state,byFrame);}let result=byFrame.get(r.frame);if(!result){result=d.objects.build(d.getField(r.frame),r.state.redistribution);byFrame.set(r.frame,result);}return result;}
 function refresh(i){if(disposed)return;const el=$('waterObject'+i),r=ready(i),s=selection[i];if(!r||!r.state){selection[i]=null;el.textContent='Водные области: сначала завершите расчёт воды.';return;}if(s&&(s.frame!==r.frame||s.state!==r.state))selection[i]=null;
 if(blocked(r)){el.textContent='Водные области: операция выполняется, выбор временно недоступен.';return;}
 if(d.getSurface()!=='regional'||!d.getVisible()){el.textContent='Водные области: слой воды скрыт.';return;}
 const hit=selection[i];if(!hit){el.textContent='Нажмите на рассчитанную воду, чтобы выбрать область. Это снимок, не устойчивое озеро.';return;}
 try{if(!r.frame.land[hit.cell]){el.textContent='Океанская маска: глубина океана не задана, объект не выделяется.';return;}const c=data(r),id=c.labels[hit.cell];if(id<0){el.textContent='В выбранной клетке нет воды выше порога '+c.metadata.depthThreshold+'.';return;}const o=c.objects[id],n=v=>Number(v).toPrecision(6);el.textContent='Водная область '+(id+1)+' из '+c.objects.length+' (номер только этого снимка). Клеток: '+o.cellCount+'. Площадь: '+n(o.areaSteradians)+' ср ('+n(100*o.areaSteradians/(4*Math.PI))+'% сферы). Объём: '+n(o.volume)+' усл. высота·ср. Глубина средняя / максимальная: '+n(o.meanDepth)+' / '+n(o.maxDepth)+' усл. Уровень поверхности min / max: '+n(o.minSurfaceLevel)+' / '+n(o.maxSurfaceLevel)+'. Соседство по стороне с маской океана: '+(o.touchesOceanMask?'да':'нет')+'; это не доказательство стока. Область не классифицирована как устойчивое озеро или река.';
 }catch(e){el.textContent='Не удалось прочитать водную область: '+String(e.message||e);}}
 function click(i,e){const r=ready(i);if(!r||!r.state||blocked(r)||d.getSurface()!=='regional'||!d.getVisible())return;const b=d.view.panes[i].canvas.getBoundingClientRect(),u=(e.clientX-b.left)/b.width,v=(e.clientY-b.top)/b.height;if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>=1||v<0||v>=1)return;selection[i]={frame:r.frame,state:r.state,cell:Math.floor(v*r.frame.h)*r.frame.w+Math.floor(u*r.frame.w)};refresh(i);}
 function listen(el,event,fn){if(!el)return;el.addEventListener(event,fn);listeners.push([el,event,fn]);}
 const refreshAll=()=>{for(let i=0;i<2;i++)refresh(i);};
 for(let i=0;i<2;i++)listen(d.view.panes[i].canvas,'click',e=>click(i,e));
 for(const id of ['surfaceMode','waterVisible'])listen($(id),'change',refreshAll);
 const observer=typeof d.win.MutationObserver==='function'?new d.win.MutationObserver(refreshAll):null;
 if(observer)for(const id of ['waterBalance0','waterBalance1','projectStatus']){const el=$(id);if(el)observer.observe(el,{childList:true,characterData:true,subtree:true});}
 refreshAll();return {refreshAll,dispose(){if(disposed)return;disposed=true;if(observer)observer.disconnect();for(const [el,event,fn] of listeners)el.removeEventListener(event,fn);selection.fill(null);}};
}
const api={attach};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SurfaceWaterInspector=api;
})(typeof globalThis!=='undefined'?globalThis:this);
