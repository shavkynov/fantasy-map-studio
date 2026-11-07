(function(root){'use strict';
function create(d){const cache=new WeakMap();
 return {describe(r,c,id){
 if(!r?.state||!Number.isInteger(id)||!c?.objects?.[id])throw Error('Invalid selected water object');
 const t=r.trace,result=r.transportState||r.state,model=r.transportContext||r.context;
 if(!t||!r.traceContext||t.frame!==r.frame||t.surface!==r.state||t.result!==result)return ' Контакты: данных этого завершённого шага нет.';
 const cut=Number(d.getThreshold());if(!Number.isFinite(cut)||cut<=0)throw Error('Порог водотоков должен быть положительным');
 let hit=cache.get(t);if(!hit||hit.frame!==r.frame||hit.context!==r.traceContext||hit.model!==model||hit.cut!==cut){const context=d.getContext(r.frame),routing=r.traceContext.diagnose(t,r.frame,result,d.routing,context.drainage),network=d.reaches.build(context.field,context.drainage,routing,{threshold:cut}),hasSpill=typeof model?.spillStep==='function',spill=hasSpill?model.spillStep(r.frame,result):null,value=d.contacts.build(context.field,routing,network,r.state.redistribution,spill,d.objects);hit={frame:r.frame,context:r.traceContext,model,cut,value,hasSpill};cache.set(t,hit);}
 const value=hit.value,o=c.objects[id],mapped=value.finalCatalog.objects[id];if(c.w!==value.w||c.h!==value.h||!mapped||mapped.seedCell!==o.seedCell||mapped.cellCount!==o.cellCount||mapped.volume!==o.volume||c.metadata.depthThreshold!==value.finalCatalog.metadata.depthThreshold)throw Error('Каталог карточки не совпадает с контактами');
 const entries=value.entries.filter(e=>e.finalPatchAtCell===id).length;
 let text=' Контакты при пороге водотоков '+cut+': окончаний у начально мокрых клеток, совпавших с этой конечной областью, '+entries+'. Это пространственное совпадение, не доказательство притока именно в нынешнюю область. Начальные и конечные номера областей независимы.';
 if(!hit.hasSpill)text+=' Данных подтверждённых переливов нет.';else for(const phase of ['inflow','recession']){const events=value.crossings.filter(e=>e.phase===phase),incoming=events.filter(e=>e.toFinalPatchAtCell===id&&e.fromFinalPatchAtCell!==id).length,outgoing=events.filter(e=>e.fromFinalPatchAtCell===id&&e.toFinalPatchAtCell!==id).length,internal=events.filter(e=>e.fromFinalPatchAtCell===id&&e.toFinalPatchAtCell===id).length;text+=' Переливы, '+(phase==='inflow'?'фаза поступления':'фаза осушения')+': приёмник внутри / источник снаружи '+incoming+', источник внутри / приёмник снаружи '+outgoing+', обе клетки внутри '+internal+'.';}
 return text+' Принадлежность клеток перелива относится к конечному кадру, не к воде в момент события. События обеих фаз не складываются в расход. Связи вход → выход и русла через водоём не выводятся. Карточка учитывает порог водотоков независимо от видимости диагностических слоёв.';
 }};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WaterContactReadout=api;
})(typeof globalThis!=='undefined'?globalThis:this);
