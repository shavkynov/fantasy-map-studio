'use strict';
const assert=require('assert/strict'),TOL=1e-12;
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function normalized(v){assert(Array.isArray(v)&&v.length===3&&v.every(Number.isFinite));const n=Math.hypot(...v);assert(n>1e-12);return v.map(x=>x/n);}
function constraints(rows){
 assert(Array.isArray(rows)&&rows.length<=10000);
 return rows.map(r=>{for(const v of [r.point,r.normal])assert(Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)&&Math.abs(Math.hypot(...v)-1)<1e-8);assert(Math.abs(dot(r.point,r.normal))<1e-8);return normalized(cross(r.point,r.normal));});
}
function clip(poly,a,b,c){
 const out=[];if(!poly.length)return out;
 for(let i=0;i<poly.length;i++){
  const p=poly[i],q=poly[(i+1)%poly.length],gp=a*p[0]+b*p[1]+c,gq=a*q[0]+b*q[1]+c;
  if(gp>=0)out.push(p.slice());
  if((gp>=0)!==(gq>=0)){const t=gp/(gp-gq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
 }
 return out;
}
function linear4(matrix,rhs){
 const m=matrix.map((row,i)=>[...row,rhs[i]]);
 for(let c=0;c<4;c++){
  let p=c;for(let i=c+1;i<4;i++)if(Math.abs(m[i][c])>Math.abs(m[p][c]))p=i;
  if(Math.abs(m[p][c])<1e-12)return null;[m[c],m[p]]=[m[p],m[c]];
  const d=m[c][c];for(let j=c;j<5;j++)m[c][j]/=d;
  for(let i=0;i<4;i++)if(i!==c){const f=m[i][c];for(let j=c;j<5;j++)m[i][j]-=f*m[c][j];}
 }
 return m.map(row=>row[4]);
}
function certificate(A){
 if(A.length<4)return null;let seed=0x12345678;
 const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let attempt=0;attempt<20000;attempt++){
  const ids=[];while(ids.length<4){const i=Math.floor(next()*A.length);if(!ids.includes(i))ids.push(i);}
  const rows=ids.map(i=>A[i]),m=[0,1,2].map(j=>rows.map(r=>r[j]));m.push([1,1,1,1]);
  const weights=linear4(m,[0,0,0,1]);if(!weights||!weights.every(x=>x>1e-6))continue;
  const residual=Math.hypot(...[0,1,2].map(j=>rows.reduce((s,r,i)=>s+weights[i]*r[j],0)));
  let rankDet=0;for(let omit=0;omit<4;omit++){const v=rows.filter((_,i)=>i!==omit);rankDet=Math.max(rankDet,Math.abs(dot(v[0],cross(v[1],v[2]))));}
  if(residual<1e-10&&Math.abs(weights.reduce((s,x)=>s+x,0)-1)<1e-10&&rankDet>1e-7)return {indices:ids,weights,residual,maxRank3Minor:rankDet};
 }
 return null;
}
function solve(input){
 assert(Array.isArray(input)&&input.length<=10000);const A=input.map(normalized),slices=[];let witness=null,uncertain=false;
 for(let fixed=0;fixed<3;fixed++)for(const sign of [-1,1]){
  const free=[0,1,2].filter(j=>j!==fixed);let poly=[[-1,-1],[1,-1],[1,1],[-1,1]];
  for(const a of A){poly=clip(poly,a[free[0]],a[free[1]],sign*a[fixed]+TOL);if(!poly.length)break;}
  const slice={fixed,sign,vertices:poly.length};
  if(poly.length){
   const v=[0,0,0];v[fixed]=sign;free.forEach((j,k)=>v[j]=poly.reduce((s,p)=>s+p[k],0)/poly.length);
   const minimumDot=A.length?Math.min(...A.map(a=>dot(a,v))):0;slice.minimumDot=minimumDot;slice.candidate=v;
   if(v.every(Number.isFinite)&&minimumDot>=-1e-9){if(!witness)witness={vector:v,minimumDot};}else uncertain=true;
  }
  slices.push(slice);
 }
 if(witness)return {status:'candidate-within-tolerance',witness,slices,certificate:null,tolerance:TOL};
 if(uncertain||slices.some(s=>s.vertices))return {status:'inconclusive-numerics',witness:null,slices,certificate:null,tolerance:TOL};
 return {status:'numerical-zero-cone',witness:null,slices,certificate:certificate(A),tolerance:TOL};
}
function extract(report){
 assert(report.time===0&&Array.isArray(report.pair)&&report.pair.length===2&&report.pair.every(Number.isInteger)&&report.pair.every(x=>x>=0)&&report.pair[0]!==report.pair[1]);
 const rows=report.rows||(report.cases&&report.cases[0]&&report.cases[0].rows);constraints(rows);
 if(report.cases)for(const c of report.cases){assert.equal(c.rows.length,rows.length);c.rows.forEach((r,i)=>{assert.deepEqual(r.point,rows[i].point);assert.deepEqual(r.normal,rows[i].normal);});}
 return rows;
}
function unit(){
 const basis=[[1,0,0],[0,1,0],[0,0,1]],opposites=basis.flatMap(a=>[a,a.map(x=>-x)]);
 assert.equal(solve([]).status,'candidate-within-tolerance');assert.equal(solve([[1,0,0]]).status,'candidate-within-tolerance');
 assert.equal(solve([[1,0,0],[-1,0,0]]).status,'candidate-within-tolerance');assert.equal(solve(basis).status,'candidate-within-tolerance');
 assert.equal(solve(opposites).status,'numerical-zero-cone');
 const tetra=[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],before=JSON.stringify(tetra),r=solve(tetra);assert.equal(r.status,'numerical-zero-cone');assert(r.certificate&&r.certificate.residual<1e-10);assert.equal(JSON.stringify(tetra),before);
 assert.equal(solve(tetra.slice().reverse()).status,r.status);assert.throws(()=>solve([[0,0,0]]));assert.throws(()=>solve([[NaN,0,1]]));
 const rows=[{point:[1,0,0],normal:[0,1,0]}];assert.deepEqual(constraints(rows),[[0,0,1]]);assert.equal(extract({time:0,pair:[5,9],rows}).length,1);assert.throws(()=>constraints([{point:[1,0,0],normal:[1,0,0]}]));assert.throws(()=>extract({time:1,pair:[0,1],rows}));
 return true;
}
module.exports={constraints,solve,extract,unit};
if(require.main===module){
 unit();
 if(process.argv.includes('--unit-only'))console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false}));
 else{
  const fs=require('fs'),path=require('path'),crypto=require('crypto'),arg=process.argv[2];assert(arg,'Use --k4-02 or a boundary report JSON path');
  let input,origin,verify;
  if(arg==='--k4-02'){
   const F=require('./world-source-fixture.cjs'),B=require('./world-k4-boundary-02.cjs'),source=F.load(path.join(__dirname,'fixtures/world-source/vondoran-227-k4.json'),'1bb053646f0b6746767ae2d1a93c90098cff17944126c76b6bcabb20952c31a6');
   const before=JSON.stringify(source);input={time:0,pair:[0,2],rows:B.edges(source)};origin='existing-vondoran-227-k4';verify=()=>assert.equal(JSON.stringify(source),before);
  }else{
   assert(fs.statSync(arg).size<=20000000);const before=fs.readFileSync(arg);input=JSON.parse(before.toString('utf8'));origin=path.resolve(arg);verify=()=>assert(fs.readFileSync(arg).equals(before));
  }
  const before=JSON.stringify(input),rows=extract(input),A=constraints(rows),result=solve(A);assert.equal(JSON.stringify(input),before);verify();
  assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
  const report={unitChecksPassed:true,integrationRun:true,inputOrigin:origin,inputSha256:crypto.createHash('sha256').update(before).digest('hex'),inputUnchanged:true,generatorImported:false,pair:input.pair,time:0,constraintCount:A.length,constraints:A,sourceEdges:rows.map((r,i)=>({index:i,edge:r.edge===undefined?i:r.edge,cell0:r.cell0,cell2:r.cell2})),...result,scope:'Floating-point initial midpoint cone only; no formal interval proof, continuous safety, new motion, geometry change or app integration.'};
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});const jsonFile=path.join(dir,'world-boundary-cone-'+Date.now()+'.json');fs.writeFileSync(jsonFile,JSON.stringify(report,null,2),{encoding:'utf8',flag:'wx'});assert(fs.statSync(jsonFile).size>0);
  console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,inputUnchanged:true,generatorImported:false,pair:input.pair,constraintCount:A.length,status:result.status,witness:result.witness,certificate:result.certificate,jsonFile},null,2));
 }
}
