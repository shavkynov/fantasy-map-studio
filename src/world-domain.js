(function(root){
'use strict';
const PI=Math.PI,TAU=2*PI;
function finite(x,name){if(!Number.isFinite(x))throw new TypeError(name+' must be finite');return x;}
function unit(v,n,name){if(!v||v.length!==n)throw new TypeError(name+' must have '+n+' components');const a=Array.from(v);for(const x of a)finite(x,name);const length=Math.hypot(...a);if(!length||!Number.isFinite(length))throw new RangeError(name+' must be nonzero and normalizable');return a.map(x=>x/length);}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function longitude(x){finite(x,'longitude');return ((x+PI)%TAU+TAU)%TAU-PI;}
function angleUnits(a,b){return Math.atan2(Math.hypot(...cross(a,b)),Math.max(-1,Math.min(1,dot(a,b))));}
function applyUnit(q,p){const t=cross(q.slice(1),p).map(x=>2*x),s=cross(q.slice(1),t);return unit(p.map((x,i)=>x+q[0]*t[i]+s[i]),3,'rotated point');}
function createSphere(options={}){
 if(!options||typeof options!=='object')throw new TypeError('options must be an object');
 const R=options.radiusKm===undefined?6371:finite(options.radiusKm,'radiusKm'),R2=R*R,total=4*PI*R2;
 if(R<=0||!Number.isFinite(total)||total<=0)throw new RangeError('radiusKm is outside supported numeric range');
 function fromLonLat(lon,lat){lon=longitude(lon);finite(lat,'latitude');if(lat< -PI/2||lat>PI/2)throw new RangeError('latitude must be in [-pi/2, pi/2]');const c=Math.cos(lat);if(Math.abs(c)<1e-15)return [0,0,lat<0?-1:1];return [c*Math.cos(lon),c*Math.sin(lon),Math.sin(lat)];}
 function toLonLat(point){const p=unit(point,3,'point'),horizontal=Math.hypot(p[0],p[1]);return {lon:horizontal<1e-15?0:longitude(Math.atan2(p[1],p[0])),lat:Math.atan2(p[2],horizontal)};}
 function project(point){const p=toLonLat(point);return {u:(p.lon+PI)/TAU,v:Math.max(0,Math.min(1,(PI/2-p.lat)/PI))};}
 function unproject(u,v){finite(u,'u');finite(v,'v');if(v<0||v>1)throw new RangeError('v must be in [0,1]; latitude is not periodically wrapped');u=((u%1)+1)%1;return fromLonLat(u*TAU-PI,PI/2-v*PI);}
 function axisRotation(axis,radians){const a=unit(axis,3,'axis');finite(radians,'rotation angle');const half=radians/2,s=Math.sin(half);return unit([Math.cos(half),a[0]*s,a[1]*s,a[2]*s],4,'rotation');}
 function apply(rotation,point){return applyUnit(unit(rotation,4,'rotation'),unit(point,3,'point'));}
 function inverse(rotation){const q=unit(rotation,4,'rotation');return [q[0],-q[1],-q[2],-q[3]];}
 // compose(a,b) applies b first, then a; right-handed Cartesian coordinates.
 function compose(a,b){a=unit(a,4,'rotation a');b=unit(b,4,'rotation b');const av=a.slice(1),bv=b.slice(1),c=cross(av,bv);return unit([a[0]*b[0]-dot(av,bv),...av.map((x,i)=>a[0]*bv[i]+b[0]*x+c[i])],4,'composed rotation');}
 function rotatePoints(rotation,points){if(!Array.isArray(points))throw new TypeError('points must be an array of vectors');const q=unit(rotation,4,'rotation');return points.map(p=>applyUnit(q,unit(p,3,'point')));}
 function angle(a,b){return angleUnits(unit(a,3,'point a'),unit(b,3,'point b'));}
 function distanceKm(a,b){return R*angle(a,b);}
 function triangleAreaKm2(a,b,c){a=unit(a,3,'triangle a');b=unit(b,3,'triangle b');c=unit(c,3,'triangle c');for(const [p,q] of [[a,b],[b,c],[c,a]])if(Math.hypot(...p.map((x,i)=>x+q[i]))<1e-12)throw new RangeError('Antipodal edge has no unique minor great-circle arc');const det=Math.abs(dot(a,cross(b,c))),den=1+dot(a,b)+dot(b,c)+dot(c,a);if(det<1e-14&&den<=0)throw new RangeError('Ambiguous great-circle triangle');return 2*Math.atan2(det,den)*R2;}
 function cellAreaKm2(width,height,row){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(row)||row<0||row>=height)throw new RangeError('Invalid full-sphere raster cell');const mid=PI/2-PI*(row+0.5)/height;return R2*(TAU/width)*2*Math.cos(mid)*Math.sin(PI/(2*height));}
 return Object.freeze({kind:'sphere',radiusKm:R,totalAreaKm2:total,longitude,fromLonLat,toLonLat,project,unproject,axisRotation,apply,inverse,compose,rotatePoints,angle,distanceKm,triangleAreaKm2,cellAreaKm2});
}
const api=Object.freeze({createSphere});if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WorldDomain=api;
})(typeof globalThis!=='undefined'?globalThis:this);
