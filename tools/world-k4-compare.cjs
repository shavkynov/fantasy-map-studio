'use strict';
const assert=require('assert/strict'),{assess}=require('./world-frame-validity.cjs');
const escape=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const colors=['#d69455','#8ac18b','#d4c56e','#b695d4'];
function validate(s){
 assert(s&&Number.isInteger(s.width)&&Number.isInteger(s.height)&&s.width>0&&s.height>0&&s.width*s.height<=2100000);
 assert(Number.isFinite(s.time)&&s.centralMeridian===0);
 const n=s.width*s.height;assert(s.owner&&s.coverage&&s.owner.length===n&&s.coverage.length===n);
 let overlap=0;
 for(let i=0;i<n;i++){
  const c=s.coverage[i],o=s.owner[i];assert(Number.isInteger(c)&&c>=0&&c<=4);
  if(c===0)assert.equal(o,-1);
  else if(c===1)assert(Number.isInteger(o)&&o>=0&&o<4);
  else{overlap++;assert.equal(o,-2);}
 }
 const status=assess(s);assert.equal(overlap,s.diagnostics.overlapCells);return status;
}
function svg(s,base,difference){
 let rects='';
 const color=i=>s.coverage[i]>1?'#ff00b7':difference?(s.owner[i]!==base.owner[i]||s.coverage[i]!==base.coverage[i]?'#ffac1c':s.coverage[i]?'#65717e':'#172b42'):s.coverage[i]?colors[s.owner[i]]:'#172b42';
 for(let y=0;y<s.height;y++)for(let x=0;x<s.width;){
  const fill=color(y*s.width+x);let end=x+1;
  while(end<s.width&&color(y*s.width+end)===fill)end++;
  rects+='<rect x="'+x+'" y="'+y+'" width="'+(end-x)+'" height="1" fill="'+fill+'"/>';x=end;
 }
 return '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+(difference?'Изменения относительно time=0':'Фрагменты и пересечения')+'" viewBox="0 0 '+s.width+' '+s.height+'" shape-rendering="crispEdges">'+rects+'</svg>';
}
function render(frames,title='K4: геометрическое сравнение'){
 assert(Array.isArray(frames)&&frames.length>0);const statuses=frames.map(validate),base=frames[0];assert.equal(base.time,0);
 for(const s of frames){assert.equal(s.width,base.width);assert.equal(s.height,base.height);}
 const sections=frames.map((s,i)=>{
  const status=statuses[i],label=status.validSampledGeometry?'ДОПУСТИМ В РАСТРЕ — НЕ ПРИНЯТ':'ОТКЛОНЁН: fragment-overlap — НЕ КАНДИДАТ';
  return '<section><h2>time='+s.time+'</h2><p class="'+(status.validSampledGeometry?'valid':'invalid')+'">'+label+'</p><p>overlapCells='+s.diagnostics.overlapCells+'; overlapAreaFraction='+s.diagnostics.overlapAreaFraction+'</p><div class="maps"><div><h3>Фрагменты</h3>'+svg(s,base,false)+'</div><div><h3>Изменения относительно time=0</h3>'+svg(s,base,true)+'</div></div></section>';
 }).join('');
 return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>'+escape(title)+'</title><style>body{font:16px system-ui;background:#101820;color:#eef2f5;margin:24px}section{border-top:1px solid #576574;padding:12px 0}.maps{display:flex;flex-wrap:wrap;gap:16px}.maps>div{flex:1 1 540px;max-width:720px}svg{display:block;width:100%;background:#172b42}.valid{color:#9ee3a2}.invalid{color:#ff8ed8}h3{font-size:16px}p{max-width:1100px}</style><h1>'+escape(title)+'</h1><p>Источник: vondoran-227 K4; исходные скорости. Сетка '+base.width+'×'+base.height+', эквидистантная цилиндрическая проекция, centralMeridian=0. Один прямоугольник покрывает целые растровые клетки: увеличение не повышает разрешение геометрии.</p><p>Четыре цвета обозначают фрагменты 0–3 в порядке: охра, зелёный, жёлтый, фиолетовый. Вода — тёмно-синяя. На карте изменений неизменная суша серая, изменившиеся owner/coverage — оранжевые. Пересечения в обоих видах — ярко-розовые. Новых метрик и визуальных эталонов нет.</p><p>Это материалы сравнения, не выбор кадра, не визуальная приёмка и не включение движения в приложение. Отсутствие растрового пересечения не доказывает непрерывную безопасность или качество океанов.</p>'+sections+'</html>';
}
function unit(){
 const frame=(time,owner,coverage)=>{const n=coverage.filter(c=>c>1).length;return {time,width:4,height:2,centralMeridian:0,owner,coverage,diagnostics:{overlapCells:n,overlapAreaFraction:n?0.1:0,validSampledGeometry:n===0}};};
 const a=frame(0,[-1,0,0,-1,-1,-1,-1,-1],[0,1,1,0,0,0,0,0]),b=frame(0.1,[-1,-1,0,-2,-1,-1,-1,-1],[0,0,1,2,0,0,0,0]);
 const before=JSON.stringify([a,b]),html=render([a,b],'<test>&');
 assert(html.includes('&lt;test&gt;&amp;'));assert(html.includes('НЕ КАНДИДАТ'));assert(html.includes('НЕ ПРИНЯТ'));
 assert(html.includes('#ff00b7'));assert(html.includes('#ffac1c'));assert(!html.includes('<script'));
 assert.equal((html.match(/<svg /g)||[]).length,4);assert(html.includes('width="2" height="1" fill="#d69455"'));
 assert.equal(JSON.stringify([a,b]),before);
 assert.throws(()=>render([]));assert.throws(()=>render([{...a,time:1}]));assert.throws(()=>render([{...a,coverage:[0]}]));
 assert.throws(()=>render([{...a,owner:[-2,...a.owner.slice(1)]}]));assert.throws(()=>render([{...a,centralMeridian:1}]));
 assert.throws(()=>render([{...a,diagnostics:{...a.diagnostics,overlapCells:1}}]));
 return true;
}
module.exports={render,unit};
if(require.main===module){
 unit();
 if(process.argv.includes('--unit-only'))console.log(JSON.stringify({unitChecksPassed:true,integrationRun:false,htmlWritten:false}));
 else{
  const fs=require('fs'),path=require('path'),crypto=require('crypto'),F=require('./world-source-fixture.cjs'),D=require('../src/world-drift.js');
  const source=F.load(path.join(__dirname,'fixtures/world-source/vondoran-227-k4.json'),'1bb053646f0b6746767ae2d1a93c90098cff17944126c76b6bcabb20952c31a6');
  const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'),before=hash(source),world=D.fromSource(source);
  const times=[0,1/2048,1/1024,1/512,1/256],frames=times.map(t=>world.snapshot(t,{width:360,height:180,centralMeridian:0}));
  const html=render(frames);assert.equal(hash(source),before);
  assert(!Object.keys(require.cache).some(f=>f.endsWith(path.sep+'world-v4.js')));
  const dir=path.join(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'k4-compare-'+Date.now()+'.html');
  fs.writeFileSync(file,html,{encoding:'utf8',flag:'wx'});assert(fs.statSync(file).size>0);
  console.log(JSON.stringify({unitChecksPassed:true,integrationRun:true,htmlWritten:true,file,sources:1,snapshots:frames.length,grid:{width:360,height:180,centralMeridian:0},sourceInputsUnchanged:true,generatorImported:false,frames:frames.map(s=>({time:s.time,overlapCells:s.diagnostics.overlapCells,...assess(s)})),visualAccepted:false,appIntegrated:false},null,2));
 }
}
