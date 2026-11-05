
'use strict';
const assert=require('assert'),UI=require('../src/coupled-water-ui.js');
let groups=0;const ok=n=>{groups++;console.log('ok',n);};
function env(extra){
 const els={};const doc={getElementById:id=>els[id]||(els[id]={id,disabled:false,textContent:''})};
 const f={w:720,h:360,land:new Uint8Array(4),angle:1};
 const panes=[{current:{f},generation:0,canvas:{getContext:()=>({createImageData:()=>({data:{set(){}}}),putImageData(){}})}},{current:{f:null},generation:0,canvas:null}];
 const models=[{frame:()=>f},{frame:()=>({w:720,h:360})}];
 const calls={plain:0,cap:0,adv:0,join:0};
 const mk=()=>{const m={empty:()=>({ledger:{storedTotal:1},redistribution:{depth:new Float64Array(4)}}),advance:()=>{calls.adv++;return {ledger:{storedTotal:1},redistribution:{depth:new Float64Array(4)}};}};return m;};
 const coupled={create:()=>{calls.plain++;return mk();}};
 const ctx={field:{neighbors(){}},hierarchy:{}};
 const spill={create:(fi,h,fr,deps)=>{calls.cap++;calls.deps=deps;const saved=new WeakMap();const wrap=()=>{const m=mk(),a=m.advance;m.advance=(...x)=>{const r=a(...x);saved.set(r,{c:1});return r;};m.spillStep=(fr2,res)=>{if(!saved.has(res))throw Error('Foreign');return structuredClone(saved.get(res));};return m;};return {surface:()=>wrap(),atmosphere:()=>wrap()};}};
 const ui=UI.create(models,()=>({pixels:new Uint8ClampedArray(16)}),()=>ctx,coupled,{},doc,{setTimeout:(fn)=>setTimeout(fn,0)},()=>true,()=>'regional',Object.assign({},extra&&extra(spill)));
 ui.models[0].frame(720,360,1);ui.attach({panes});
 return {ui,calls,panes,f,spill};
}
(async()=>{
 {const e=env();await e.ui.run(0,'wet');assert.strictEqual(e.calls.plain,1);assert.strictEqual(e.calls.cap,0);assert.strictEqual(e.ui.spillStep(0),null);assert(e.ui.records[0].state);ok('no extras: plain model, spillStep null');}
 {const e=env(s=>({spill:s,projection:{create(){}}}));await e.ui.run(0,'wet');assert.strictEqual(e.calls.cap,1);assert.strictEqual(e.calls.plain,0);const s=e.ui.spillStep(0);assert.deepStrictEqual(s,{c:1});assert.strictEqual(e.calls.deps.Surface!==undefined,true);ok('capture model, spillStep returns clone');}
 {const e=env(s=>({spill:s,projection:{create(){}}}));await e.ui.run(0,'wet');const m=e.ui.records[0].context;await e.ui.run(0,'dry');assert.strictEqual(e.ui.records[0].context,m);assert.strictEqual(e.calls.cap,1);assert.deepStrictEqual(e.ui.spillStep(0),{c:1});ok('Dry reuses the same capture model');}
 {const e=env(s=>({spill:s,projection:{create(){}}}));await e.ui.run(0,'wet');const old=e.ui.records[0].state;e.ui.records[0].busy=false;e.panes[0].current.f=null;assert.strictEqual(e.ui.spillStep(0),null);e.panes[0].current.f=e.f;e.ui.reset(0);assert.strictEqual(e.ui.spillStep(0),null);assert.notStrictEqual(old,null);ok('stale view and reset give null');}
 {const e=env(s=>({spill:s,projection:{create(){}}}));const r=e.ui.records[0];const p=e.ui.run(0,'wet');e.ui.cancelAll();await p;assert.strictEqual(r.state,null);assert.strictEqual(e.ui.spillStep(0),null);ok('cancel leaves no capture');}
 {const e=env(s=>({spill:s,projection:{create(){}}}));await e.ui.run(0,'wet');const r=e.ui.records[0],keep=r.state;const m=r.context;m.advance=()=>{throw Error('boom')};await e.ui.run(0,'dry');assert.strictEqual(r.state,keep);assert.deepStrictEqual(e.ui.spillStep(0),{c:1});ok('error keeps previous result and capture');}
 {assert.throws(()=>env(s=>({spill:s})),/Invalid spill capture API/);assert.throws(()=>env(s=>({projection:{create(){}}})),/Invalid spill capture API/);ok('spill and projection must come together');}
 {const e=env(s=>({spill:s,projection:{create(){}}}));await e.ui.run(0,'wet');const r=e.ui.records[0];r.state=Object.assign({},r.state);assert.throws(()=>e.ui.spillStep(0),/Foreign/);ok('foreign result is rejected, not hidden');}
 console.log('groups',groups);
})().catch(e=>{console.error(e);process.exit(1);});
