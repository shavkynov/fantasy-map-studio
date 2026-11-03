(function(root){'use strict';
function create(base,options={}){
const E=options.eastEnd===undefined?8:options.eastEnd,W=options.westEnd===undefined?8:options.westEnd;
if(![2,8].includes(E)||![2,8].includes(W))throw Error('Only bounded A/B endpoints supported');
const SHA='d4faef01c8ab64447c04171c36211426374b9728a257c72e3cfc137f73b58947',labels=base.labels,R=Math.PI/180;
if(base.labelsSha256!==SHA||!labels||labels.length!==256*171)throw Error('Source fingerprint mismatch');
const east=[-.8235748954314995,.3772551392061318,-.4235598559324959],west=[.7089598567538721,.36325595649079556,.6045006464723478];
function check(t,max){if(!Number.isFinite(t)||t<0||t>max)throw Error('Unsupported angle');}
function uv(p){return [(Math.atan2(p[1],p[0])/(2*Math.PI)+1.5)%1,(1-Math.max(-1,Math.min(1,p[2])))/2];}
function zrot(p,a){const c=Math.cos(a),s=Math.sin(a);return [c*p[0]-s*p[1],s*p[0]+c*p[1],p[2]];}
function rotate(p,axis,a){const c=Math.cos(a),s=Math.sin(a),d=p.reduce((v,x,i)=>v+x*axis[i],0),v=[axis[1]*p[2]-axis[2]*p[1],axis[2]*p[0]-axis[0]*p[2],axis[0]*p[1]-axis[1]*p[0]];return p.map((x,i)=>x*c+v[i]*s+axis[i]*d*(1-c));}
const cuts=[[.985081455310967,.17208871666215453,.03100164879625663,31.381018529180437,2.218549282303313,.5276997559399234],[-.44312671004776755,.8964589889349327,.035294951797462996,32.585263387765735,4.224933476956096,.006538030583400712],[.33420003095018225,.9425021693942658,.03410004460439085,24.412538460455835,4.454583942974918,.38370395211010894]];
function cut(x,y,k){const [nx,ny,amp,freq,phase,level]=cuts[k],t=-ny*x+nx*y,s=(x*256+.5-117.25)/2.5,b=k===1&&Math.abs(s)<1?.001*(1+Math.cos(Math.PI*s)):0;return nx*x+ny*y+amp*Math.sin(t*freq+phase)+amp*.35*Math.sin(t*freq*2.1-phase)-level-b;}
const profile=[];for(let j=0;j<171;j++){let lo=-1,hi=2;for(let n=0;n<56;n++){const mid=(lo+hi)/2;if(cut(mid,j/256,0)>=0)hi=mid;else lo=mid;}let q=(lo+hi)/2*256;if(Math.abs(q-Math.round(q))<1e-10)q=Math.round(q);profile.push(Math.ceil(q)/256);}
function initial3(p){const [u,v]=uv(p),b=profile[Math.min(170,Math.floor(v*171))],d=(u-b+1.5)%1-.5;return d<0?0:cut(b+d-20/360-.5/256,(v*171-.5)/256,1)<0?1:2;}
function transport1(p,k,d){if(![0,1,2].includes(k)||!Number.isFinite(d)||Math.abs(d)>E)throw Error('Unsupported first transport');return k?rotate(p,east,(k===1?-1:1)*d*R/2):p.slice();}
function state3(p,t){check(t,E);for(let k=0;k<3;k++)if(initial3(transport1(p,k,-t))===k)return {owner:k,gap:false};return {owner:initial3(p),gap:true};}
function land3(p,k){const [u,v]=uv(zrot(p,(k?-20:20)*R)),id=labels[Math.min(170,Math.floor(v*171))*256+Math.min(255,Math.floor(u*256))];return k?(id===0||id===3||id===4)&&(k===1?cut(u-.5/256,(v*171-.5)/256,1)<0:cut(u-.5/256,(v*171-.5)/256,1)>=0):(id===1||id===2||id===5);}
function split(p){const [u,v]=uv(zrot(p,20*R));return cut(u-.5/256,(v*171-.5)/256,2)<0?0:1;}
function initial4(p){const k=state3(p,E).owner;return k===0?split(p):k+1;}
function transport(p,k,d){if(![0,1,2,3].includes(k)||!Number.isFinite(d)||Math.abs(d)>W)throw Error('Unsupported second transport');return k<2?rotate(p,west,(k===0?-1:1)*d*R/2):p.slice();}
function state(p,t){check(t,W);for(let k=0;k<4;k++)if(initial4(transport(p,k,-t))===k)return {owner:k,gap:false};return {owner:initial4(p),gap:true};}
function sourceLand(p,k){return k<2?land3(p,0)&&split(p)===k:land3(transport1(p,k-1,-E),k-1);}
function scan(p,k,t,segments,stateFn,transportFn,landFn,max){check(t,max);if(!Number.isInteger(segments)||segments<32||segments>128)throw Error('Unsupported sampling');if(stateFn(p,t).owner!==k)throw Error('Endpoint owner mismatch');const at=s=>stateFn(transportFn(p,k,s-t),s).owner===k,started=at(0),q=transportFn(p,k,-t),continental=started&&landFn(q,k);let prev=started,survives=started,birth=null;
const steps=Math.max(segments,Math.ceil(t*32));
for(let j=1;j<=steps;j++){const s=t*j/steps,inside=at(s);if(prev&&!inside){survives=false;if(continental)throw Error('Historical continental loss');}if(!prev&&inside){let lo=t*(j-1)/steps,hi=s;while(hi-lo>1e-9){const mid=(lo+hi)/2;if(at(mid))hi=mid;else lo=mid;}birth=(lo+hi)/2;}prev=inside;}
if(!prev)throw Error('Endpoint trajectory mismatch');if(!survives&&birth===null)throw Error('Missing birth event');return {survives,birth,started,source:q};}
function history1(p,k,t=E,segments=64){const r=scan(p,k,t,segments,state3,transport1,land3,E);return {kind:r.survives?'old':'new',birthEpisode:r.survives?null:1,birthAngle:r.birth,ageInBirthEpisode:r.survives?null:t-r.birth,renewed:!r.survives&&r.started};}
function history(p,k,t,segments=64){const r=scan(p,k,t,segments,state,transport,sourceLand,W);if(r.survives)return {...history1(r.source,k<2?0:k-1,E,segments),secondEpisodeSourceConsumed:false};return {kind:'new',birthEpisode:2,birthAngle:r.birth,ageInBirthEpisode:t-r.birth,renewed:r.started,secondEpisodeSourceConsumed:r.started};}
function pointAt(w,h,i){const lat=Math.PI*(.5-(Math.floor(i/w)+.5)/h),lon=2*Math.PI*((i%w+.5)/w-.5);return [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];}
function frame(w,h,t,blocks=4){check(t,blocks===3?E:W);if(!Number.isInteger(w)||!Number.isInteger(h)||w<64||h<32||w>720||h>360||![3,4].includes(blocks))throw Error('Unsupported frame');const owner=new Uint8Array(w*h),land=new Uint8Array(w*h),gap=new Uint8Array(w*h);let gapCount=0,sphericalLandFraction=0;const tr=blocks===3?transport1:transport,init=blocks===3?initial3:initial4,landFn=blocks===3?land3:sourceLand;
for(let i=0;i<w*h;i++){const p=pointAt(w,h,i),raw=[],ls=[];for(let k=0;k<blocks;k++){const q=tr(p,k,-t);raw.push(init(q)===k);ls.push(landFn(q,k));}const n=raw.filter(Boolean).length,k=n?raw.findIndex(Boolean):init(p);if(ls.filter(Boolean).length>1||ls.some((v,j)=>v&&(j!==k||n-Number(raw[j])>0)))throw Error('Continental frame conflict');owner[i]=k;land[i]=Number(ls.some(Boolean));gap[i]=Number(!n);gapCount+=gap[i];if(land[i]){const y=Math.floor(i/w);sphericalLandFraction+=(Math.sin(Math.PI*(.5-y/h))-Math.sin(Math.PI*(.5-(y+1)/h)))/(2*w);}}
return {w,h,angle:t,owner,land,gap,gapCount,sphericalLandFraction};}
async function historyField(f,{segments=64,cancelled=()=>false,progress=()=>{}}={}){if(f.w*f.h>180*90)throw Error('History bounded to 180x90');if(!Number.isInteger(segments)||segments<32||segments>128)throw Error('Unsupported sampling');const episode=new Uint8Array(f.w*f.h),birth=new Float64Array(episode.length),renewed=new Uint8Array(episode.length);birth.fill(NaN);for(let y=0;y<f.h;y++){if(cancelled())throw Error('Cancelled');for(let x=0;x<f.w;x++){const i=y*f.w+x,r=history(pointAt(f.w,f.h,i),f.owner[i],f.angle,segments);if(f.land[i]&&r.kind!=='old')throw Error('Continental replacement');episode[i]=r.birthEpisode||0;birth[i]=r.birthAngle===null?NaN:r.birthAngle;renewed[i]=Number(r.renewed);}if((y+1)%2===0){progress((y+1)/f.h);await new Promise(resolve=>setTimeout(resolve,0));}}if(cancelled())throw Error('Cancelled');return {episode,birth,renewed};}
return {frame,history,history1,historyField,state,state3,transport,transport1,sourceLand,pointAt,limits:{eastEnd:E,westEnd:W},labelsSha256:SHA};}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EqualAreaABCandidate=api;
})(typeof globalThis!=='undefined'?globalThis:this);
