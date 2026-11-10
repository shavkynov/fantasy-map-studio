(function(root){
'use strict';
const VERSION='spherical-terrain-v2-kinematic',LAYOUT_VERSION='spherical-terrain-v1',clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
function random(seed){let s=2166136261;for(let i=0;i<seed.length;i++){s^=seed.charCodeAt(i);s=Math.imul(s,16777619);}return ()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
function options(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['seed','w','h','continents','landRatio','maxAttempts'].includes(k)))throw Error('Invalid generation options');
 const p={seed:input.seed,w:input.w===undefined?360:input.w,h:input.h===undefined?180:input.h,continents:input.continents===undefined?4:input.continents,landRatio:input.landRatio===undefined?.34:input.landRatio,maxAttempts:input.maxAttempts===undefined?32:input.maxAttempts};
 if(typeof p.seed!=='string'||!p.seed.trim()||p.seed.length>128)throw Error('Seed must be a nonempty string, at most 128 code units');
 if(!Number.isInteger(p.w)||!Number.isInteger(p.h)||p.w!==p.h*2||p.h<16||p.w>720||p.h>360)throw Error('Expected bounded 2:1 editor grid, h >= 16');
 if(!Number.isInteger(p.continents)||p.continents<1||p.continents>7)throw Error('Continents must be 1..7');
 if(!Number.isFinite(p.landRatio)||p.landRatio<.18||p.landRatio>.45)throw Error('Land ratio must be 0.18..0.45');
 if(!Number.isInteger(p.maxAttempts)||p.maxAttempts<1||p.maxAttempts>64)throw Error('Attempts must be 1..64');return p;
}
function neighbours(i,w,h){const x=i%w,y=Math.floor(i/w),opposite=(x+w/2)%w;return [y*w+(x+w-1)%w,y*w+(x+1)%w,y===0?opposite:i-w,y===h-1?(h-1)*w+opposite:i+w];}
function measure(field){
 const {w,h,land}=field;if(!Number.isInteger(w)||!Number.isInteger(h)||w!==2*h||!land||land.length!==w*h)throw Error('Invalid field');
 const weights=new Float64Array(h);for(let y=0;y<h;y++)weights[y]=Math.sin(Math.PI*(.5-y/h))-Math.sin(Math.PI*(.5-(y+1)/h));
 const seen=new Uint8Array(w*h),queue=new Int32Array(w*h),areas=[];let landArea=0;
 for(let i=0;i<land.length;i++){if(land[i]!==0&&land[i]!==1)throw Error('Invalid land mask');if(!land[i]||seen[i])continue;let head=0,tail=1,area=0;queue[0]=i;seen[i]=1;while(head<tail){const j=queue[head++];area+=weights[Math.floor(j/w)]/(2*w);for(const k of neighbours(j,w,h))if(land[k]&&!seen[k]){seen[k]=1;queue[tail++]=k;}}areas.push(area);landArea+=area;}
 areas.sort((a,b)=>b-a);return {components:areas.length,landRatio:landArea,componentAreas:areas};
}
function layout(p,attempt){
 const r=random(p.seed+'|'+LAYOUT_VERSION+'|layout|'+attempt),centers=[],point=()=>{const z=2*r()-1,a=2*Math.PI*r(),c=Math.sqrt(1-z*z);return [c*Math.cos(a),c*Math.sin(a),z];};
 for(let k=0;k<p.continents;k++){let best=null,score=-Infinity;for(let j=0;j<64;j++){const q=point(),d=centers.length?Math.min(...centers.map(c=>1-dot(c.center,q))):r();if(d>score){score=d;best=q;}}const e=unit(cross(Math.abs(best[2])<.9?[0,0,1]:[1,0,0],best)),n=cross(best,e);centers.push({center:best,e,n,phase:2*Math.PI*r(),stretch:.82+.36*r(),size:.88+.24*r(),a:2*Math.PI*r(),b:2*Math.PI*r(),c:2*Math.PI*r()});}return centers;
}
function motion(a,b,p,n){
 const v=cross(a.map((x,i)=>x-b[i]),p),t=cross(p,n);
 return {convergence:dot(v,n),shear:Math.abs(dot(v,t)),speed:Math.hypot(...v)};
}
function boundaryMotion(a,b,point,normal){
 for(const v of [a,b,point,normal])if(!v||v.length!==3||!Array.from(v).every(Number.isFinite))throw Error('Invalid boundary vector');
 if(Math.hypot(...point)<1e-12)throw Error('Invalid boundary point');
 const p=unit(Array.from(point)),d=dot(normal,p),t=Array.from(normal,(x,i)=>x-d*p[i]);
 if(Math.hypot(...t)<1e-12)throw Error('Invalid boundary normal');
 const result=motion(Array.from(a),Array.from(b),p,unit(t));
 if(!Object.values(result).every(Number.isFinite))throw Error('Boundary motion overflow');
 return result;
}
function tectonicField(points,seed){
 const r=random(seed+'|euler-relief-v1'),plates=[],count=12,band=.08;
 const point=()=>{const z=2*r()-1,a=2*Math.PI*r(),c=Math.sqrt(1-z*z);return [c*Math.cos(a),c*Math.sin(a),z];};
 for(let k=0;k<count;k++){
  let center=null,best=-Infinity;
  for(let j=0;j<32;j++){const q=point(),score=plates.length?Math.min(...plates.map(p=>1-dot(q,p.center))):r();if(score>best){best=score;center=q;}}
  const axis=point(),rate=.2+.8*r();plates.push({id:k,center,omega:axis.map(x=>x*rate)});
 }
 const N=points.length/3,plateId=new Uint8Array(N),uplift=new Float64Array(N),rift=new Float64Array(N),shear=new Float64Array(N),scale=2*Math.max(...plates.map(p=>Math.hypot(...p.omega)));
 let boundarySamples=0,convergentSamples=0,divergentSamples=0;
 for(let i=0;i<N;i++){
  const q=points.subarray(3*i,3*i+3);let a=-1,b=-1,first=-Infinity,second=-Infinity;
  for(let k=0;k<count;k++){const d=dot(q,plates[k].center);if(d>first){second=first;b=a;first=d;a=k;}else if(d>second){second=d;b=k;}}
  plateId[i]=a;
  const normal=unit(plates[b].center.map((x,k)=>x-plates[a].center[k])),d=dot(q,normal),distance=Math.asin(clamp(Math.abs(d),0,1));
  if(distance>=band)continue;
  const p=unit(Array.from(q,(x,k)=>x-d*normal[k])),support=dot(p,plates[a].center);
  // Reject a supporting-circle projection hidden behind a third plate.
  if(plates.some((s,k)=>k!==a&&k!==b&&dot(p,s.center)>support+1e-12))continue;
  const v=motion(plates[a].omega,plates[b].omega,p,normal),weight=(1-distance/band)**2;
  uplift[i]=Math.max(0,v.convergence/scale)*weight;rift[i]=Math.max(0,-v.convergence/scale)*weight;shear[i]=v.shear/scale*weight;
  boundarySamples++;if(v.convergence>1e-12)convergentSamples++;else if(v.convergence< -1e-12)divergentSamples++;
 }
 return {plateId,uplift,rift,shear,plates,metadata:{model:'euler-relief-v1',plateCount:count,boundaryBandRadians:band,boundarySamples,convergentSamples,divergentSamples,units:'prescribed relative angular velocity per arbitrary model time; heights relative',scope:'instantaneous spherical Voronoi plate kinematics; nearest-two valid-boundary sampling; heuristic relief, not crust evolution'}};
}
function generate(input){
 const p=options(input),{w,h}=p,N=w*h,points=new Float64Array(N*3),weights=new Float64Array(h),score=new Float64Array(N),owner=new Uint8Array(N);
 for(let y=0;y<h;y++){const lat=Math.PI*(.5-(y+.5)/h),c=Math.cos(lat);weights[y]=(Math.sin(Math.PI*(.5-y/h))-Math.sin(Math.PI*(.5-(y+1)/h)))/(2*w);for(let x=0;x<w;x++){const lon=2*Math.PI*((x+.5)/w-.5),i=y*w+x;points.set([c*Math.cos(lon),c*Math.sin(lon),Math.sin(lat)],i*3);}}
 const tectonics=tectonicField(points,p.seed);
 for(let attempt=0;attempt<p.maxAttempts;attempt++){
  const centers=layout(p,attempt);
  for(let i=0;i<N;i++){const q=points.subarray(i*3,i*3+3);let best=-Infinity,bestK=0;for(let k=0;k<centers.length;k++){const c=centers[k],distance=Math.acos(clamp(dot(q,c.center),-1,1)),angle=Math.atan2(dot(q,c.n),dot(q,c.e))-c.phase,ellipse=1/Math.sqrt((Math.cos(angle)/c.stretch)**2+(Math.sin(angle)*c.stretch)**2),coast=1+.12*Math.sin(3*angle+c.a)+.075*Math.sin(5*angle+c.b)+.035*Math.sin(9*angle+c.c),value=1-distance/(c.size*ellipse*coast);if(value>best){best=value;bestK=k;}}score[i]=best;owner[i]=bestK;}
  const order=Array.from({length:N},(_,i)=>i).sort((a,b)=>score[b]-score[a]||a-b),land=new Uint8Array(N);let area=0,threshold=Infinity;
  for(const i of order){const weight=weights[Math.floor(i/w)];if(area>=p.landRatio||Math.abs(area+weight-p.landRatio)>Math.abs(area-p.landRatio))break;land[i]=1;area+=weight;threshold=score[i];}
  const stats=measure({w,h,land});if(stats.components!==p.continents||stats.componentAreas.some(a=>a<p.landRatio/(p.continents*5)))continue;
  const height=new Float64Array(N).fill(NaN);for(let i=0;i<N;i++)if(land[i]){const q=points.subarray(i*3,i*3+3),c=centers[owner[i]],inland=clamp((score[i]-threshold)/Math.max(.1,1-threshold),0,1),province=.5+.5*Math.sin(5*q[0]+3*q[1]-2*q[2]+c.a);height[i]=clamp(.005+Math.sqrt(inland)*(.12+.36*province+.55*tectonics.uplift[i]-.12*tectonics.rift[i]),1e-6,10);}
  return {w,h,land,height,tectonics,metadata:{tectonics:tectonics.metadata,generator:VERSION,seed:p.seed,requestedContinents:p.continents,requestedLandRatio:p.landRatio,attempt:attempt+1,...stats,limitations:'Procedural coastlines with instantaneous spherical plate-kinematic relief; no continental drift, crust evolution, subduction, climate or erosion; four-neighbour continents; undefined ocean elevation.'}};
 }
 throw Error('Не удалось разместить отдельные материки за '+p.maxAttempts+' попыток. Измените seed или уменьшите долю суши.');
}
function installUI(doc,win,getWork,repaint){
 const get=id=>doc.getElementById(id),panel=doc.createElement('section');let running=false,alive=true,observed=null,unsubscribe=null;
 panel.innerHTML='<h2>Новый сферический мир · generation-ui1</h2><label>Seed <input id="worldSeed" maxlength="128" value="world-1"></label><label>Материков <input id="worldContinents" type="number" min="1" max="7" step="1" value="4"></label><label>Суша, % площади сферы <input id="worldLandPercent" type="number" min="18" max="45" step="1" value="34"></label><button id="generateWorld" disabled>Создать новый мир</button><p id="generationStatus" role="status">Готовится редактор…</p><p>Seed и параметры воспроизводят основу в этой версии генератора. Берега процедурные; рельеф учитывает сферическую кинематику плит. Это не история планеты. Острова отдельно не создаются. Число материков проверяется по четырём соседям. Seed и поле плит не записываются в файл; точная основа и правки сохраняются целиком. Генерация синхронная и может ненадолго задержать интерфейс.</p>';
 get('mapName').closest('section').after(panel);doc.title+=' · generation-ui1';doc.querySelector('h1').append(' · generation-ui1');
 get('newProcedural').textContent='Новая · фиксированная основа A';
 function refresh(){const w=getWork();if(w&&w!==observed){if(unsubscribe)unsubscribe();observed=w;unsubscribe=w.subscribe(refresh);}const blocked=!alive||running||!w||w.session.snapshot().busy||get('brushRadius').disabled;for(const id of ['worldSeed','worldContinents','worldLandPercent','generateWorld'])get(id).disabled=blocked;}
 get('generationStatus').textContent='Задайте seed, число материков и долю суши. Пустой океан и фиксированная основа A доступны отдельно.';
 get('generateWorld').onclick=async()=>{
  if(!alive||running||get('generateWorld').disabled)return;
  const work=getWork(),seed=get('worldSeed').value,continents=Number(get('worldContinents').value),landRatio=Number(get('worldLandPercent').value)/100;
  if(!seed.trim()||seed.length>128||!Number.isInteger(continents)||continents<1||continents>7||!Number.isFinite(landRatio)||landRatio<.18||landRatio>.45){get('generationStatus').textContent='Проверьте параметры: seed 1–128 символов, материков 1–7, суша 18–45%.';return;}
  running=true;work.hold(true);repaint();refresh();get('generationStatus').textContent='Создаётся сферическая основа…';
  try{
   await new Promise(r=>win.setTimeout(r,0));if(!alive)return;
   if(getWork()!==work)throw Error('Рабочая карта была заменена.');
   work.hold(false);
   const prepared=work.stageGenerated({seed,continents,landRatio},{generate});
   work.hold(true);repaint();
   if(work.info().dirty&&!win.confirm('В карте есть несохранённые изменения. Заменить её новым миром без сохранения?')){get('generationStatus').textContent='Создание отменено. Прежняя карта сохранена.';return;}
   if(!alive)return;
   prepared.commit();const m=prepared.metadata;
   get('generationStatus').textContent='Создано: '+m.components+' материков; суша '+(100*m.landRatio).toFixed(2)+'%; попытка '+m.attempt+'. Seed: '+seed+'. Вода ещё не рассчитана. Это отчёт о последней генерации, не свойства позднее открытого файла.';
   get('mapFileStatus').textContent='Новый мир готов кправкам и сохранению целиком. Прежние вода и история не перенесены.';
  }catch(error){if(alive)get('generationStatus').textContent='Новый мир не создан. Прежняя карта сохранена. '+error.message;}
  finally{work.hold(false);running=false;if(alive){repaint();refresh();}}
 };
 const observer=new win.MutationObserver(refresh);observer.observe(get('brushRadius'),{attributes:true,attributeFilter:['disabled']});
 win.addEventListener('pagehide',()=>{alive=false;observer.disconnect();if(unsubscribe)unsubscribe();});refresh();
}
const api={VERSION,generate,measure,neighbours,boundaryMotion,installUI};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SphericalTerrainBase=api;
})(typeof globalThis!=='undefined'?globalThis:this);
