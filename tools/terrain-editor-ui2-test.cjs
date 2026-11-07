'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Tools=require('../src/terrain-editor-ui2'),Core=require('../src/terrain-edit-core');
let count=0;function test(name,fn){fn();console.log('\n['+(++count)+'] '+name+'\n    PASS');}
test('Footprint equals actual core affected cells: seam, both poles and narrow radius',()=>{
 const w=36,h=18,n=w*h,base={w,h,land:new Uint8Array(n).fill(1),height:new Float64Array(n).fill(.5)};
 for(const center of [9*w,9*w+w-1,0,w-1,(h-1)*w,(h-1)*w+17])for(const radius of [.000001,.2,.5]){
  const mask=Tools.footprint(w,h,center,radius),core=Core.create(base);core.stroke({cells:[center],radius,amount:.1,mode:'raise'});const s=core.snapshot();for(let i=0;i<n;i++)assert.equal(mask[i],Number(s.height[i]>.5),'cell '+i+' center '+center+' radius '+radius);
 }
 assert(Tools.footprint(w,h,9*w,.2)[9*w+w-1]);assert(Tools.footprint(w,h,0,.2)[w/2]);assert(Tools.footprint(w,h,(h-1)*w,.2)[(h-1)*w+w/2]);assert.throws(()=>Tools.footprint(w,h,-1,.2));
});
test('Shortcut selection: Mac, Ctrl, physical Z key, editable and modifier guards',()=>{
 const key={key:'z',code:'KeyZ',metaKey:true};assert.equal(Tools.shortcut(key),'undo');assert.equal(Tools.shortcut({...key,shiftKey:true}),'redo');assert.equal(Tools.shortcut({...key,key:'я'}),'undo');assert.equal(Tools.shortcut({key:'y',ctrlKey:true}),'redo');
 for(const e of [{...key,altKey:true},{...key,defaultPrevented:true},{key:'z'},{...key,target:{isContentEditable:true}},{...key,target:{closest:()=>({})}}])assert.equal(Tools.shortcut(e),null);
 assert.equal(Tools.shortcut(key,{isContentEditable:true}),null);
});
function fixture(){
 const handlers={},windowHandlers={},draws=[];let observer;
 function element(id){return {id,disabled:false,value:'5',style:{},addEventListener(name,fn){(handlers[id+':'+name]??=[]).push(fn);},setAttribute(){},getContext(){return {clearRect(){draws.length=0;},fillRect(...a){draws.push(a);}};}};}
 const canvas=element('editorMap');canvas.width=36;canvas.height=18;canvas.getBoundingClientRect=()=>({left:0,top:0,width:36,height:18});canvas.hasPointerCapture=()=>canvas.captured;canvas.parentNode={appendChild(node){elements[node.id]=node;}};
 const elements={editorMap:canvas,brushRadius:element('brushRadius'),brushMode:element('brushMode'),undo:element('undo'),redo:element('redo')};let clicks=0;elements.undo.click=elements.redo.click=()=>clicks++;
 const doc={activeElement:null,getElementById:id=>elements[id],createElement:()=>element('new')},win={addEventListener(name,fn){windowHandlers[name]=fn;},MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}}};
 Tools.install(doc,win);return {doc,win,elements,draws,get clicks(){return clicks;},notify:()=>observer(),fire(id,name,e){for(const fn of handlers[id+':'+name]||[])fn(e);},key(e){windowHandlers.keydown(e);}};
}
test('Installed handlers honour disabled buttons, repeat and focused input',()=>{
 const f=fixture();let prevented=0;const e={key:'z',metaKey:true,preventDefault(){prevented++;}};
 f.key(e);assert.equal(f.clicks,1);assert.equal(prevented,1);f.elements.undo.disabled=true;f.key(e);assert.equal(f.clicks,1);assert.equal(prevented,1);f.elements.undo.disabled=false;f.key({...e,repeat:true});assert.equal(f.clicks,1);f.doc.activeElement={closest:()=>({})};f.key(e);assert.equal(f.clicks,1);
});
test('Preview hides on lock and exit; accepted captured gesture keeps preview',()=>{
 const f=fixture(),e={clientX:10,clientY:8,pointerId:1,button:0};f.fire('editorMap','pointermove',e);assert(f.draws.length);f.elements.brushRadius.disabled=true;f.notify();assert.equal(f.draws.length,0);
 f.elements.editorMap.captured=true;f.fire('editorMap','pointerdown',{...e,defaultPrevented:true});assert(f.draws.length);f.fire('editorMap','pointermove',{...e,pointerId:2});assert(f.draws.length);f.fire('editorMap','lostpointercapture',e);assert.equal(f.draws.length,0);
 f.elements.brushRadius.disabled=false;f.fire('editorMap','pointermove',e);assert(f.draws.length);f.fire('editorMap','pointerleave',e);assert.equal(f.draws.length,0);f.fire('editorMap','pointermove',e);f.win.pagehide();assert.equal(f.draws.length,0);
});
test('Page wiring, marker and isolated PNG source contract',()=>{
 const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'src/terrain-editor.html'),'utf8'),page=fs.readFileSync(path.join(root,'src/terrain-editor-page.js'),'utf8'),tools=fs.readFileSync(path.join(root,'src/terrain-editor-ui2.js'),'utf8');assert(html.includes('editor-ui2'));assert(html.indexOf('src="terrain-editor-page.js"')<html.indexOf('src="terrain-editor-ui2.js"'));assert(html.includes('src="terrain-editor-ui2.js"'));assert(page.includes('canvas.toBlob('));assert(!tools.includes('toBlob('));
});
console.log('\nSUMMARY: '+count+' groups passed.');
console.log('SCOPE: footprint compared with real brush core; installed handlers with DOM doubles; page wiring and PNG source contract.');
console.log('NOT CHECKED: native pointer capture ordering, Electron shortcuts, raster appearance or actual PNG on Mac.');
