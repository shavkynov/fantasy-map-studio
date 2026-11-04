(function(root){'use strict';
const owned=new WeakSet();
function mask(catalog,id){
 const {w,h,labels,objects}=catalog||{},n=w*h;
 if(!Number.isInteger(w)||w<4||w>720||w%2||!Number.isInteger(h)||h<2||h>360||!(labels instanceof Int32Array)||labels.length!==n||!Array.isArray(objects)||!Number.isInteger(id)||id<0||id>=objects.length||objects[id]?.id!==id)throw Error('Invalid water highlight selection');
 for(const label of labels)if(label< -1||label>=objects.length)throw Error('Invalid catalog label');
 const pixels=new Uint8ClampedArray(n*4);let cellCount=0,boundaryCellCount=0;
 for(let i=0;i<n;i++){if(labels[i]!==id)continue;cellCount++;const x=i%w,y=Math.floor(i/w),edge=labels[y*w+(x+w-1)%w]!==id||labels[y*w+(x+1)%w]!==id||(y>0&&labels[i-w]!==id)||(y<h-1&&labels[i+w]!==id);if(edge)boundaryCellCount++;pixels.set(edge?[255,235,120,230]:[255,210,65,56],4*i);}
 if(!cellCount)throw Error('Selected water object has no cells');return {w,h,pixels,cellCount,boundaryCellCount};
}
function attach({doc,canvases}){
 if(!doc||!Array.isArray(canvases)||canvases.length!==2||new Set(canvases).size!==2||canvases.some(c=>!c||!c.parentNode||owned.has(c)))throw Error('Two unowned mounted canvases required');
 const panes=[];let disposed=false;
 function remove(p){if(p.canvas.parentNode===p.wrapper&&p.wrapper.parentNode)p.wrapper.parentNode.insertBefore(p.canvas,p.wrapper);if(p.overlay.parentNode===p.wrapper)p.wrapper.removeChild(p.overlay);if(p.wrapper.parentNode&&(p.wrapper.childNodes||p.wrapper.children).length===0)p.wrapper.parentNode.removeChild(p.wrapper);owned.delete(p.canvas);}
 try{for(const canvas of canvases){const wrapper=doc.createElement('div'),overlay=doc.createElement('canvas');wrapper.style.cssText='position:relative;width:100%;line-height:0';overlay.width=canvas.width;overlay.height=canvas.height;overlay.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;image-rendering:pixelated';overlay.setAttribute('aria-hidden','true');const p={canvas,wrapper,overlay,last:null};panes.push(p);owned.add(canvas);canvas.parentNode.insertBefore(wrapper,canvas);wrapper.appendChild(canvas);wrapper.appendChild(overlay);}}catch(e){for(const p of panes.reverse())remove(p);throw e;}
 function pane(i){if(disposed||!Number.isInteger(i)||i<0||i>1)throw Error('Invalid highlight pane');return panes[i];}
 function clear(i){const p=pane(i);p.last=null;p.overlay.getContext('2d').clearRect(0,0,p.overlay.width,p.overlay.height);}
 function show(i,catalog,id){const p=pane(i);if(p.last?.catalog===catalog&&p.last.id===id)return;try{if(catalog?.w!==p.overlay.width||catalog?.h!==p.overlay.height)throw Error('Highlight dimensions mismatch');const result=mask(catalog,id),ctx=p.overlay.getContext('2d'),im=ctx.createImageData(result.w,result.h);im.data.set(result.pixels);ctx.putImageData(im,0,0);p.last={catalog,id};}catch(e){clear(i);throw e;}}
 return {show,clear,dispose(){if(disposed)return;disposed=true;for(const p of panes.slice().reverse()){p.last=null;remove(p);}}};
}
const api={mask,attach};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SurfaceWaterHighlight=api;
})(typeof globalThis!=='undefined'?globalThis:this);
