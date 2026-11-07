'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),View=require('../src/terrain-editor-view');
const root=path.join(__dirname,'..');let count=0;
function test(name,fn){fn();console.log('\n['+(++count)+'] '+name+'\n    PASS');}
function fixture(){
 const handlers={},windows={};let notify=()=>{},clears=0;
 function node(id){return {id,disabled:false,style:{},attributes:{},addEventListener(name,fn){handlers[id+':'+name]=fn;},setAttribute(k,v){this.attributes[k]=v;}};}
 const viewport=Object.assign(node('mapViewport'),{clientWidth:800,clientHeight:400,scrollLeft:0,scrollTop:0}),map=node('map'),canvas=Object.assign(node('editorMap'),{width:360,height:180,parentNode:map});
 map.getBoundingClientRect=()=>({width:parseFloat(map.style.width)||800,height:(parseFloat(map.style.width)||800)/2});
 const elements={mapViewport:viewport,editorMap:canvas,brushRadius:node('brushRadius'),viewInfo:node('viewInfo'),view1:node('view1'),view2:node('view2'),view4:node('view4'),brushPreview:{width:360,height:180,getContext:()=>({clearRect(){clears++;}})}};
 const doc={getElementById:id=>elements[id]},win={addEventListener(name,fn){windows[name]=fn;},MutationObserver:class{constructor(fn){notify=fn;}observe(){}disconnect(){}}};
 const view=View.install(doc,win);return {elements,map,viewport,canvas,view,get clears(){return clears;},notify:()=>notify(),fire(id,name,e){assert.equal(typeof handlers[id+':'+name],'function');handlers[id+':'+name](e);},window(name){assert.equal(typeof windows[name],'function');windows[name]();}};
}
test('Fit, 2x and 4x change CSS size only and preserve view center',()=>{
 const f=fixture();assert.equal(f.map.style.width,'800px');f.fire('view2','click');assert.equal(f.map.style.width,'1600px');assert.equal(f.viewport.scrollLeft,400);assert.equal(f.viewport.scrollTop,200);f.fire('view4','click');assert.equal(f.map.style.width,'3200px');assert.equal(f.viewport.scrollLeft,1200);assert.equal(f.viewport.scrollTop,600);assert.equal(f.elements.view4.attributes['aria-pressed'],'true');assert.equal(f.canvas.width,360);assert.equal(f.canvas.height,180);f.fire('view1','click');assert.equal(f.viewport.scrollLeft,0);assert.equal(f.viewport.scrollTop,0);assert.equal(f.map.style.width,'800px');assert.equal(f.view.setScale(3),false);
});
test('Disabled brush freezes navigation, blocks wheel and defers resize',()=>{
 const f=fixture();f.view.setScale(2);const left=f.viewport.scrollLeft,top=f.viewport.scrollTop;f.elements.brushRadius.disabled=true;f.notify();assert(f.elements.view4.disabled);assert.equal(f.view.setScale(4),false);let prevented=false;f.fire('mapViewport','wheel',{preventDefault(){prevented=true;}});assert(prevented);f.viewport.scrollLeft=999;f.viewport.scrollTop=999;f.fire('mapViewport','scroll');assert.equal(f.viewport.scrollLeft,left);assert.equal(f.viewport.scrollTop,top);f.viewport.clientWidth=600;f.viewport.clientHeight=300;f.window('resize');assert.equal(f.map.style.width,'1600px');f.elements.brushRadius.disabled=false;f.notify();assert.equal(f.map.style.width,'1200px');assert.equal(f.elements.view4.disabled,false);
});
test('Navigation clears stale contour; pagehide permanently disables zoom',()=>{
 const f=fixture(),before=f.clears;f.fire('mapViewport','scroll');assert(f.clears>before);f.window('pagehide');assert(f.elements.view2.disabled);assert.equal(f.view.setScale(2),false);f.window('resize');assert.equal(f.map.style.width,'800px');
});
test('Actual brush and preview coordinate functions agree after scale and scroll',()=>{
 const page=fs.readFileSync(path.join(root,'src/terrain-editor-page.js'),'utf8'),preview=fs.readFileSync(path.join(root,'src/terrain-editor-ui2.js'),'utf8');
 const main=page.match(/^function cellAt\(e\).+$/m),hover=preview.match(/^ function at\(e\).+$/m);assert(main);assert(hover);
 for(const factor of [1,2,4])for(const offset of [0,175,900]){
  const rect={left:40-offset,top:60-offset/2,width:800*factor,height:400*factor},canvas={width:360,height:180,getBoundingClientRect:()=>rect};
  const cell=vm.runInNewContext('(function(){'+main[0]+';return cellAt;})()',{canvas}),at=vm.runInNewContext('(function(){'+hover[0]+';return at;})()',{canvas});
  for(const [x,y] of [[0,0],[359,179],[180,90],[1,17]]){const e={clientX:rect.left+(x+.5)*rect.width/360,clientY:rect.top+(y+.5)*rect.height/180};assert.equal(cell(e),y*360+x);assert.equal(at(e),y*360+x);}
  assert.equal(cell({clientX:rect.left-1,clientY:rect.top}),null);assert.equal(at({clientX:rect.left+rect.width,clientY:rect.top}),null);
 }
});
test('Page wires all layers into one viewport; numerical geometry and PNG source remain separate',()=>{
 const html=fs.readFileSync(path.join(root,'src/terrain-editor.html'),'utf8'),source=fs.readFileSync(path.join(root,'src/terrain-editor-view.js'),'utf8'),page=fs.readFileSync(path.join(root,'src/terrain-editor-page.js'),'utf8');assert(html.includes('editor-ui3'));for(const id of ['mapViewport','view1','view2','view4','viewInfo'])assert(html.includes('id="'+id+'"'));assert(html.includes('src="terrain-editor-view.js"'));assert(html.indexOf('src="terrain-editor-ui2.js"')<html.indexOf('src="terrain-editor-view.js"'));assert(page.includes('canvas.toBlob('));assert(!source.includes('toBlob'));assert(!source.includes('session.'));assert(!source.includes('canvas.width='));assert(!source.includes('canvas.height='));
});
console.log('\nSUMMARY: '+count+' groups passed.');
console.log('SCOPE: viewport handlers with DOM doubles; actual existing brush/preview coordinate functions with scaled, shifted rectangles; source wiring and full-canvas PNG contract.');
console.log('NOT CHECKED: real browser layout, native trackpad/scrollbars, full procedural boot or actual PNG/Mac.');
