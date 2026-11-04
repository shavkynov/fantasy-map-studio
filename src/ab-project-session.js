(function(root){'use strict';
function create(d){
 if(!d||!d.recipe||!d.api||['replay','stage','capture','setLocked'].some(k=>typeof d[k]!=='function'))throw Error('Project session dependencies required');
 let active=null,serial=0;
 function report(value){if(d.onStatus)try{d.onStatus(value);}catch(_){/* Observers cannot change transaction outcome. */}}
 function begin(kind){if(active)return null;const op={id:++serial,kind,cancelled:false};active=op;try{d.setLocked(true);}catch(e){active=null;try{d.setLocked(false);}catch(_){}throw e;}report({phase:kind,id:op.id});return op;}
 function valid(op){return active===op&&!op.cancelled;}
 function end(op){if(active!==op)return;active=null;d.setLocked(false);}
 async function open(){const op=begin('opening');if(!op)return {status:'busy'};let publication=null;
 try{const text=await d.api.openWorld();if(!valid(op)||text===null)return {status:'cancelled'};
 const value=d.recipe.decode(text);if(!valid(op))return {status:'cancelled'};
 const candidate=await d.replay(value,{cancelled:()=>!valid(op),onProgress:p=>{if(valid(op))report({phase:'replay',id:op.id,...p});}});
 if(!valid(op))return {status:'cancelled'};
 publication=await d.stage(candidate);if(!publication||typeof publication.commit!=='function'||typeof publication.rollback!=='function')throw Error('Transactional publication required');
 if(!valid(op))return {status:'cancelled'};
 const result=publication.commit();if(result&&typeof result.then==='function')throw Error('Publication commit must be synchronous');
 publication=null;report({phase:'opened',id:op.id});return {status:'opened'};
 }catch(e){if(!valid(op))return {status:'cancelled'};report({phase:'error',id:op.id,message:String(e.message||e)});throw e;
 }finally{try{if(publication)publication.rollback();}finally{end(op);}}}
 async function save(){const op=begin('saving');if(!op)return {status:'busy'};
 try{const text=d.recipe.encode(d.capture()),path=await d.api.saveWorld(text,'map-ab.fmworld');const status=path===null?'cancelled':'saved';report({phase:status,id:op.id});return {status};
 }catch(e){report({phase:'error',id:op.id,message:String(e.message||e)});throw e;}finally{end(op);}}
 function cancel(){if(!active||active.kind!=='opening')return false;active.cancelled=true;report({phase:'cancelling',id:active.id});return true;}
 return {open,save,cancel,get busy(){return active!==null;}};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ABProjectSession=api;
})(typeof globalThis!=='undefined'?globalThis:this);
