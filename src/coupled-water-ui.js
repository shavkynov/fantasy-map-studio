(function(root){'use strict';
function create(models,baseCompose,getContext,coupled,fill,doc,win,getVisible,getSurface){
 const $=id=>doc.getElementById(id),frames=new WeakMap(),records=models.map(()=>({token:0,busy:false,frame:null,args:null,context:null,state:null,ticks:0}));let view=null;
 const status=(i,s)=>{const e=$('waterStatus'+i);if(e)e.textContent=s;};
 function sync(i,preserve=false){const r=records[i],p=view&&view.panes[i],ready=!!(p&&p.current&&p.current.f===r.frame),regional=getSurface()==='regional';
 for(const [name,disabled] of [['Wet',!ready||!regional||r.busy],['Dry',!ready||!regional||r.busy||!r.state],['Cancel',!r.busy],['Reset',!ready||(!r.state&&!r.busy)]]){const e=$('water'+name+i);if(e)e.disabled=disabled;}
 if(!preserve)for(const name of ['history','export']){const e=$(name+i);if(e)e.disabled=!ready||r.busy;}}
 function cancel(i,viewer=true){const r=records[i],was=r.busy;r.token++;r.busy=false;if(viewer&&view)view.panes[i].generation++;if(was)status(i,'Отменено. Сохранён предыдущий завершённый результат.');sync(i);}
 const wrapped=models.map((m,i)=>({...m,frame(...a){const f=m.frame(...a);if(f.w===720&&f.h===360){cancel(i,false);Object.assign(records[i],{frame:f,args:null,context:null,state:null,ticks:0});frames.set(f,i);status(i,'Водный эксперимент не запущен');}return f;}}));
 function compose(f,low,h){const normal=baseCompose(f,low,h),i=frames.get(f);if(i===undefined)return normal;const r=records[i];r.args={f,low,h};if(!r.state||!getVisible()||getSurface()!=='regional')return normal;const pixels=new Uint8ClampedArray(normal.pixels),depth=r.state.redistribution.depth;
 for(let j=0;j<f.land.length;j++)if(f.land[j]&&depth[j]>1e-9){const alpha=.35+.5*Math.min(1,depth[j]/.05);for(let k=0;k<3;k++)pixels[4*j+k]=Math.round((1-alpha)*pixels[4*j+k]+alpha*[110,115,225][k]);}return {...normal,pixels};}
 function refresh(i){const r=records[i],p=view&&view.panes[i],a=r.args;if(!p||!a||!p.current||p.current.f!==a.f)return;const result=compose(a.f,a.low,a.h),ctx=p.canvas.getContext('2d'),im=ctx.createImageData(a.f.w,a.f.h);im.data.set(result.pixels);ctx.putImageData(im,0,0);}
 const yieldStep=()=>new Promise(resolve=>win.setTimeout(resolve,0));
 async function run(i,kind){if(!['wet','dry'].includes(kind))throw Error('Unknown water operation');const r=records[i],p=view&&view.panes[i];if(!p||!p.current||p.current.f!==r.frame||r.busy||getSurface()!=='regional'||(kind==='dry'&&!r.state))return;
 const frame=r.frame,token=++r.token,generation=++p.generation;r.busy=true;sync(i);const valid=()=>r.token===token&&r.frame===frame&&p.current&&p.current.f===frame&&p.generation===generation;
 try{status(i,'Подготовка водного эксперимента…');await yieldStep();if(!valid())return;if(!r.context){const c=getContext(frame);r.context=coupled.create(c.field,c.hierarchy,fill);}let state=kind==='wet'?r.context.empty():r.state;const forcing=kind==='wet'?{precipitation:.02,evaporation:.001,runoffCoefficient:.5}:{precipitation:0,evaporation:.02,runoffCoefficient:.5};
 for(let n=1;n<=20;n++){if(!valid())return;state=r.context.advance(state,forcing,.05);status(i,(kind==='wet'?'Наполнение: ':'Высыхание: ')+n+'/20');await yieldStep();if(!valid())return;}
 r.state=state;r.ticks=kind==='wet'?20:r.ticks+20;refresh(i);status(i,'Готово. Вода: '+state.ledger.storedTotal.toPrecision(7)+'; невязка: '+state.ledger.residual.toExponential(2)+'. Единицы условные.');
 }catch(e){if(valid())status(i,'Ошибка: '+e.message+'. Предыдущий завершённый результат сохранён.');}finally{if(r.token===token){r.busy=false;sync(i,p.generation!==generation);}}}
 function reset(i){cancel(i);records[i].state=null;records[i].ticks=0;refresh(i);status(i,'Вода сброшена');sync(i);}
 function attach(v){view=v;records.forEach((r,i)=>{for(const [name,fn] of [['Wet',()=>run(i,'wet')],['Dry',()=>run(i,'dry')],['Cancel',()=>cancel(i)],['Reset',()=>reset(i)]])$('water'+name+i).onclick=fn;});syncAll();}
 function syncAll(){records.forEach((r,i)=>sync(i));}
 return {models:wrapped,compose,attach,run,reset,cancelAll:()=>records.forEach((r,i)=>cancel(i)),refreshAll:()=>records.forEach((r,i)=>refresh(i)),syncAll,records};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CoupledWaterUI=api;
})(typeof globalThis!=='undefined'?globalThis:this);
