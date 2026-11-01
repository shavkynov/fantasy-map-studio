(function(FM){
'use strict';
function plan(seed,K,W,H){
 const r=FM.mulberry32(FM.hashString(seed+'|composition-v4')),h=H/W,flip=r()<0.5,belt=r()<0.4,targets=[];
 for(let i=0;i<K;i++){
  const g=K<3?i%2:i<Math.ceil(K*0.55)?0:1,ids=Array.from({length:K},(_,j)=>j).filter(j=>(K<3?j%2:j<Math.ceil(K*0.55)?0:1)===g),j=ids.indexOf(i),t=ids.length===1?0:j/(ids.length-1)-0.5;
  let x,y;
  if(K===1){x=0.46;y=h*0.5;}
  else if(belt){const u=i/Math.max(1,K-1);x=0.17+0.66*u;y=h*(0.48+0.19*Math.sin(u*4.5+0.5));}
  else {x=(g?0.72:0.29)+t*(0.17+0.06*r());y=h*(g?0.64:0.38)+t*h*(g?-0.28:0.3);}
  x=Math.max(0.12,Math.min(0.88,x+(r()-0.5)*0.055));y=Math.max(h*0.14,Math.min(h*0.86,y+(r()-0.5)*h*0.09));
  targets.push({x:flip?1-x:x,y,g,rot:(g?0.7:-0.4)+(r()-0.5)*1.2});
 }
 const pairs=[];for(let a=0;a<K;a++)for(let b=a+1;b<K;b++)pairs.push({a,b,d:Math.hypot(targets[a].x-targets[b].x,targets[a].y-targets[b].y),w:targets[a].g===targets[b].g?1.4:0.22});
 return {targets,pairs,kind:belt?'broken-belt':'continental-groups'};
}
function anchor(p,i,x,y){const t=p.targets[i];return 0.45*((x-t.x)**2+(y-t.y)**2);}
function energy(p,states){let e=0;for(let i=0;i<states.length;i++)if(states[i])e+=anchor(p,i,states[i].x,states[i].y);for(const q of p.pairs){const a=states[q.a],b=states[q.b];if(a&&b)e+=q.w*(Math.hypot(a.x-b.x,a.y-b.y)-q.d)**2;}return e;}
function score(p,i,x,y,placed){let e=anchor(p,i,x,y);for(const q of p.pairs){const j=q.a===i?q.b:q.b===i?q.a:-1;if(j<0)continue;const b=placed.find(b=>b.cat==='main'&&b.id===j);if(b)e+=q.w*(Math.hypot(x-b.cx,y-b.cy)-q.d)**2;}return e;}
function relax(p,items,candidates,commit){const s=[];for(const q of items)s[q.id]={x:q.cx,y:q.cy};const before=energy(p,s);let moves=0;
 for(let pass=0;pass<10;pass++){let changed=false;for(const q of items){let best=null,e0=energy(p,s);const old=s[q.id];for(const c of candidates(q)){s[q.id]={x:c.x,y:c.y};const e=energy(p,s);if(e<e0-1e-12){e0=e;best=c;}}s[q.id]=old;if(best){commit(q,best);s[q.id]={x:best.x,y:best.y};moves++;changed=true;}}if(!changed)break;}
 return {before,after:energy(p,s),moves};
}
FM.naturalLayout={plan,energy,score,relax};
})(window.FM);
