 'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Page=require('../src/terrain-editor-page');
const ledger={inputTotal:1,storedTotal:.7,boundaryTotal:.1,evapTotal:.1,seepTotal:.1,residual:0};
const runFor=mode=>{const schedule=Page.waterSchedule(mode);return {steps:schedule.map(({dt,...forcing})=>({dt,forcing})),totalTime:schedule.reduce((v,s)=>v+s.dt,0)};};
for(const [mode,count,last] of [['constant',20,.02],['wet-dry',40,0],['wet-dry-wet',60,.02]]){const a=Page.waterSchedule(mode);assert.equal(a.length,count);assert.equal(a.at(-1).precipitation,last);assert(a.every(v=>v.dt===.05&&v.evaporation===.001&&v.runoffCoefficient===.5));a[0].precipitation=99;assert.equal(Page.waterSchedule(mode)[0].precipitation,.02);}
assert.throws(()=>Page.waterSchedule('season'));assert.match(Page.waterRunText({ledger,waterRun:runFor('wet-dry')}),/40 шагов/);assert.match(Page.waterRunText({ledger,waterRun:runFor('wet-dry')}),/Шаги 21–40: dt=0.05, P=0/);assert(!Page.waterRunText({ledger}).includes('20 шагов'));assert.match(Page.waterRunText({ledger:null}),/нет/);
function harness(){
 const elements=new Map(),events=new Map();let task=null,published=null,busy=false,received=null;const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},clearRect(){},fillRect(){}};
 function element(id=''){
  const e={id,value:id==='brushRadius'?'5':id==='brushAmount'?'.05':'',checked:true,disabled:false,style:{},width:4,height:2,files:[],textContent:'',parentNode:{appendChild(){}},setAttribute(){},append(){},getContext:()=>ctx,hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0,width:4,height:2}),setPointerCapture(){},releasePointerCapture(){},addEventListener(name,fn){const key=id+':'+name;if(!events.has(key))events.set(key,[]);events.get(key).push(fn);},insertAdjacentElement(){}};
  Object.defineProperty(e,'innerHTML',{set(text){for(const m of text.matchAll(/id="([^"]+)"/g))get(m[1]);if(text.includes('id="waterScenario"'))get('waterScenario').value='constant';}});return e;
 }
 function get(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id);}
 const snapshot=()=>({w:4,h:2,land:new Uint8Array(8).fill(1),height:new Float64Array(8).fill(.2),revision:0,basins:1,busy,canUndo:false,canRedo:false,depth:published?new Float64Array(8):null,ledger:published?ledger:null,waterRun:published,rivers:null});
 const session={snapshot,runWater(progress,options){received=options;busy=true;progress(1,options.schedule.length);return new Promise((resolve,reject)=>{task={finish(){published={steps:options.schedule.map(({dt,...forcing})=>({dt,forcing})),totalTime:options.schedule.reduce((v,s)=>v+s.dt,0)};busy=false;resolve({status:'completed'});},cancel(){busy=false;resolve({status:'cancelled'});},error(){busy=false;reject(Error('injected'));}};});},cancel(){task.cancel();},clearWater(){published=null;},save:()=>({}),load(){published=null;},stroke(){published=null;},undo(){published=null;},redo(){published=null;}};
 const doc={title:'test',getElementById:get,createElement:()=>element(),querySelector:()=>element(),head:{appendChild(script){script.onload();}}};
 const win={addEventListener(){}};
 const sandbox={document:doc,window:win,console,setTimeout,ThreeBlockPrototype:{create:()=>({})},EqualAreaABCandidate:{create:()=>({frame:()=>({})})},RegionalMaterialTerrain:{create:()=>({heights:()=>[]})},MaterialReliefLayer:{},RegionalReliefIntegration:{build:()=>({})},TerrainEditSession:{create:()=>session},RunoffReachDisplay:{},TerrainEditCore:{},SphericalDrainage:{},BasinSpillHierarchy:{},CoupledBasinWater:{},BasinFillSpill:{},RainfallRunoffRouting:{},RunoffReachNetwork:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/terrain-editor-page'),'utf8'),sandbox);
 return {get,events,session,received:()=>received,task:()=>task};
}
(async()=>{
 const h=harness();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(h.get('waterScenario').disabled,false);assert.equal(h.get('waterScenario').value,'constant');
 h.get('waterScenario').value='wet-dry';const first=h.get('calculateWater').onclick();assert.equal(h.get('waterScenario').disabled,true);assert.equal(h.received().schedule.length,40);assert.match(h.get('waterInfo').textContent,/1 \/ 40/);h.task().finish();await first;const saved=h.get('waterInfo').textContent;assert.match(saved,/40 шагов/);
 h.get('waterScenario').value='wet-dry-wet';h.get('showWater').onchange();assert.equal(h.get('waterInfo').textContent,saved);const cancelled=h.get('calculateWater').onclick();assert.equal(h.received().schedule.length,60);h.get('cancelWater').onclick();await cancelled;assert(h.get('waterInfo').textContent.startsWith(saved));assert.match(h.get('waterInfo').textContent,/отменён/);
 const failed=h.get('calculateWater').onclick();h.task().error();await failed;assert(h.get('waterInfo').textContent.startsWith(saved));assert.match(h.get('waterInfo').textContent,/injected/);assert.equal(h.get('waterScenario').disabled,false);
 let release;h.get('openEdits').files=[{size:1,text:()=>new Promise(r=>{release=r;})}];const opening=h.get('openEdits').onchange();assert.equal(h.get('waterScenario').disabled,true);release('{}');await opening;assert.equal(h.get('waterScenario').disabled,false);
 const down=h.events.get('editorMap:pointerdown');for(const fn of down)fn({button:0,pointerId:1,clientX:1,clientY:1,preventDefault(){},stopImmediatePropagation(){}});assert.equal(h.get('waterScenario').disabled,true);for(const fn of h.events.get('editorMap:pointercancel'))fn();assert.equal(h.get('waterScenario').disabled,false);
 h.get('clearWater').onclick();assert.match(h.get('waterInfo').textContent,/нет/);
 console.log(JSON.stringify({passed:true,scope:'candidate page helpers and page execution in Node VM with controlled DOM/session; no native browser, physical solver, PNG or generated world',checks:'three prescribed schedules; detached values; provenance-only summary; real click-handler options/progress; busy/file/gesture locks; cancel/error preserve published summary; clear'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
