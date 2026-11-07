(function(){
'use strict';
let grid=null;
function footprint(w,h,center,radius){
 if(!Number.isInteger(w)||w<4||w%2||!Number.isInteger(h)||h<2||!Number.isInteger(center)||center<0||center>=w*h||!Number.isFinite(radius)||radius<=0||radius>Math.PI)throw Error('Invalid preview footprint');
 if(!grid||grid.w!==w||grid.h!==h){
  const p=new Float64Array(w*h*3);
  for(let i=0;i<w*h;i++){const lat=Math.PI*(.5-(Math.floor(i/w)+.5)/h),lon=2*Math.PI*((i%w+.5)/w-.5),c=Math.cos(lat);p.set([c*Math.cos(lon),c*Math.sin(lon),Math.sin(lat)],i*3);}
  grid={w,h,p};
 }
 const p=grid.p,k=center*3,mask=new Uint8Array(w*h);
 for(let i=0;i<mask.length;i++){const j=i*3,dot=p[k]*p[j]+p[k+1]*p[j+1]+p[k+2]*p[j+2],distance=i===center?0:Math.acos(Math.max(-1,Math.min(1,dot)));if(distance<radius)mask[i]=1;}
 return mask;
}
function editable(target){return !!(target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));}
function shortcut(e,activeElement){
 if(e.defaultPrevented||e.altKey||!(e.metaKey||e.ctrlKey)||editable(e.target)||editable(activeElement))return null;
 const key=String(e.key||'').toLowerCase();
 if(e.code==='KeyZ'||key==='z')return e.shiftKey?'redo':'undo';
 if((e.code==='KeyY'||key==='y')&&e.ctrlKey&&!e.metaKey&&!e.shiftKey)return 'redo';
 return null;
}
function install(doc,win){
 const canvas=doc.getElementById('editorMap'),radius=doc.getElementById('brushRadius'),mode=doc.getElementById('brushMode');
 if(!canvas||!radius||!mode)throw Error('Editor controls missing');
 const preview=doc.createElement('canvas');preview.id='brushPreview';preview.width=canvas.width;preview.height=canvas.height;preview.setAttribute('aria-hidden','true');
 Object.assign(preview.style,{position:'absolute',inset:'0',width:'100%',pointerEvents:'none',zIndex:'2'});canvas.parentNode.appendChild(preview);
 const ctx=preview.getContext('2d');let cell=null,active=false,pointer=null,cached=null,closed=false;
 function at(e){const b=canvas.getBoundingClientRect(),u=(e.clientX-b.left)/b.width,v=(e.clientY-b.top)/b.height;return Number.isFinite(u)&&Number.isFinite(v)&&u>=0&&u<1&&v>=0&&v<1?Math.floor(v*canvas.height)*canvas.width+Math.floor(u*canvas.width):null;}
 function draw(){
  ctx.clearRect(0,0,preview.width,preview.height);
  const degrees=Number(radius.value);if(closed||cell===null||(radius.disabled&&!active)||!Number.isFinite(degrees)||degrees<1||degrees>30)return;
  if(!cached||cached.cell!==cell||cached.degrees!==degrees)cached={cell,degrees,mask:footprint(canvas.width,canvas.height,cell,degrees*Math.PI/180)};
  const mask=cached.mask,w=canvas.width,h=canvas.height;ctx.fillStyle='#67f7ff';
  for(let i=0;i<mask.length;i++)if(mask[i]){const x=i%w,y=Math.floor(i/w);if(y===0||y===h-1||!mask[y*w+(x+w-1)%w]||!mask[y*w+(x+1)%w]||!mask[i-w]||!mask[i+w])ctx.fillRect(x,y,1,1);}
 }
 function reset(){cell=null;active=false;pointer=null;draw();}
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;active=!!e.defaultPrevented&&canvas.hasPointerCapture(e.pointerId);pointer=active?e.pointerId:null;cell=at(e);draw();});
 canvas.addEventListener('pointermove',e=>{if(active&&e.pointerId!==pointer)return;if(active&&!canvas.hasPointerCapture(pointer)){active=false;pointer=null;}cell=at(e);draw();});
 canvas.addEventListener('pointerup',e=>{if(active&&e.pointerId!==pointer)return;active=false;pointer=null;cell=at(e);draw();});
 canvas.addEventListener('pointerleave',()=>{cell=null;draw();});
 for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,reset);
 for(const control of [radius,mode])for(const name of ['input','change'])control.addEventListener(name,draw);
 win.addEventListener('keydown',e=>{const action=shortcut(e,doc.activeElement);if(!action)return;const button=doc.getElementById(action);if(!button||button.disabled)return;e.preventDefault();if(!e.repeat)button.click();});
 win.addEventListener('blur',()=>{cell=null;draw();});
 let observer=null;if(win.MutationObserver){observer=new win.MutationObserver(draw);observer.observe(radius,{attributes:true,attributeFilter:['disabled','value']});}
 win.addEventListener('pagehide',()=>{closed=true;reset();if(observer)observer.disconnect();});
 draw();
}
const api={footprint,shortcut,install};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else install(document,window);
})();
