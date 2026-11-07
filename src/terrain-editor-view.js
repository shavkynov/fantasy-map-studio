(function(){
'use strict';
function install(doc,win){
 const canvas=doc.getElementById('editorMap'),viewport=doc.getElementById('mapViewport'),map=canvas.parentNode,radius=doc.getElementById('brushRadius'),status=doc.getElementById('viewInfo');
 const buttons=[1,2,4].map(scale=>({scale,button:doc.getElementById('view'+scale)}));
 let scale=1,pending=false,closed=false,wasLocked=false,frozen={left:0,top:0};
 function clearPreview(){const p=doc.getElementById('brushPreview');if(p)p.getContext('2d').clearRect(0,0,p.width,p.height);}
 function apply(next){
  if(closed||radius.disabled||![1,2,4].includes(next))return false;
  const old=map.getBoundingClientRect(),vw=viewport.clientWidth,vh=viewport.clientHeight;
  if(vw<=0||vh<=0)return false;
  const cx=old.width>0?(viewport.scrollLeft+vw/2)/old.width:.5,cy=old.height>0?(viewport.scrollTop+vh/2)/old.height:.5;
  const width=Math.min(1080,vw,vh*canvas.width/canvas.height)*next;
  map.style.maxWidth='none';map.style.width=width+'px';
  scale=next;pending=false;
  viewport.scrollLeft=next===1?0:Math.max(0,Math.min(width-vw,cx*width-vw/2));
  const height=width*canvas.height/canvas.width;
  viewport.scrollTop=next===1?0:Math.max(0,Math.min(height-vh,cy*height-vh/2));
  for(const item of buttons)item.button.setAttribute('aria-pressed',String(item.scale===scale));
  status.textContent=(scale===1?'Вся карта':'Масштаб ×'+scale)+' · сетка '+canvas.width+'×'+canvas.height+' без изменения детализации';clearPreview();return true;
 }
 function sync(){
  const locked=!!radius.disabled;
  if(locked&&!wasLocked)frozen={left:viewport.scrollLeft,top:viewport.scrollTop};
  wasLocked=locked;for(const item of buttons)item.button.disabled=locked||closed;
  if(!locked&&pending&&!closed)apply(scale);
 }
 for(const item of buttons)item.button.addEventListener('click',()=>apply(item.scale));
 viewport.addEventListener('wheel',e=>{if(radius.disabled)e.preventDefault();},{passive:false});
 viewport.addEventListener('scroll',()=>{if(radius.disabled){viewport.scrollLeft=frozen.left;viewport.scrollTop=frozen.top;}clearPreview();});
 win.addEventListener('resize',()=>{pending=true;sync();if(!radius.disabled&&!closed&&pending)apply(scale);});
 let observer=null;if(win.MutationObserver){observer=new win.MutationObserver(sync);observer.observe(radius,{attributes:true,attributeFilter:['disabled']});}
 win.addEventListener('pagehide',()=>{closed=true;if(observer)observer.disconnect();sync();});
 pending=true;sync();return {setScale:apply,get scale(){return scale;}};
}
if(typeof module!=='undefined'&&module.exports)module.exports={install};else install(document,window);
})();
