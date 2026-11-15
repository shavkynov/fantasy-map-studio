'use strict';
// Панель «Шкала высот» в настоящем Chromium: задать/снять шкалу, показ высоты в метрах, импорт 16-битного PNG (в т.ч. с уменьшением блоками),
// отказ на неверном файле, вода после импорта, запись шкалы в файле карты. Не проверяются: Electron/Mac, нативные диалоги, большие файлы.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'../src'),out=path.resolve('artifacts/editor-elevation');let page,browser,server;const errors=[],results=[];let accept=true;
async function test(name,fn){await fn();results.push({name,status:'passed'});console.log('['+results.length+'] PASS '+name);}
async function download(id){const event=page.waitForEvent('download');await page.locator('#'+id).click();return fs.readFile(await(await event).path());}
const saved=async()=>JSON.parse((await download('saveMap')).toString());
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})(),crc=b=>{let c=0xFFFFFFFF;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
const chunk=(type,data)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length,0);b.write(type,4,'latin1');Buffer.from(data).copy(b,8);b.writeUInt32BE(crc(b.subarray(4,8+data.length)),8+data.length);return b;};
function png(w,h,f,depth=16){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=depth;const rows=[];for(let y=0;y<h;y++){const row=Buffer.alloc(w*2+1);for(let x=0;x<w;x++)row.writeUInt16BE(f(x,y),1+x*2);rows.push(row);}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),chunk('IEND',[])]);}
// остров: значение 0..65535, вне острова — 0 (при диапазоне -500..8500 это -500 м, океан)
const island=(w,h)=>(x,y)=>{const lon=2*Math.PI*((x+.5)/w-.5),lat=Math.PI*(.5-(y+.5)/h),d=Math.hypot(lon*Math.cos(lat),lat-.15);return d<.9?Math.round(65535*(500+4000*(1-d/.9))/9000):0;};
async function pick(buffer,name='h.png'){await page.locator('#elevFile').setInputFiles({name,mimeType:'image/png',buffer});await page.waitForFunction(()=>!document.getElementById('elevFile').disabled&&!document.getElementById('openMap').disabled);}
const text=id=>page.locator('#'+id).textContent();
(async()=>{
 await fs.mkdir(out,{recursive:true});server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>accept?d.accept():d.dismiss());await page.goto('http://127.0.0.1:'+server.address().port+'/terrain-editor.html');await page.waitForFunction(()=>!document.getElementById('newOcean').disabled&&!document.getElementById('elevApply').disabled,null,{timeout:120000});
 await test('Карта без шкалы: статус «не задана», файл v1',async()=>{assert((await text('elevStatus')).includes('Шкала не задана'));assert(await page.locator('#elevClear').isDisabled());const d=await saved();assert.equal(d.schema,'fm-terrain-workspace-v1');assert(!('scale' in d));});
 await test('Задать шкалу: статус в км и метрах, файл v2 со шкалой, показ высоты клетки в метрах',async()=>{
  await page.fill('#elevRadius','6000');await page.fill('#elevMpu','8000');await page.locator('#elevApply').click();
  await page.waitForFunction(()=>document.getElementById('elevStatus').textContent.includes('Радиус'));const s=await text('elevStatus');assert(/Радиус 6\s?000 км/.test(s),s);assert(s.includes('1,0 = 8'),s);assert(s.includes('Суша:'),s);
  const d=await saved();assert.equal(d.schema,'fm-terrain-workspace-v2');assert.equal(d.scale.radiusKm,6000);assert.equal(d.scale.metersPerUnit,8000);assert(await page.locator('#elevClear').isEnabled());
  const b=await page.locator('#editorMap').boundingBox();await page.locator('#mapViewport').scrollIntoViewIfNeeded();
  // найти клетку суши по сохранённой карте и навести указатель
  const land=d.patch.base.land.findIndex(v=>v===1);assert(land>=0);await page.evaluate(i=>{const v=document.getElementById('mapViewport'),c=document.getElementById('editorMap'),r=c.getBoundingClientRect();v.scrollLeft=(i%360+.5)*r.width/360-v.clientWidth/2;v.scrollTop=(Math.floor(i/360)+.5)*r.height/180-v.clientHeight/2;},land);
  const b2=await page.locator('#editorMap').boundingBox();await page.mouse.move(b2.x+(land%360+.5)*b2.width/360,b2.y+(Math.floor(land/360)+.5)*b2.height/180);await page.waitForFunction(()=>document.getElementById('heightReadout').textContent.includes('м над уровнем воды'));
 });
 await test('Снять шкалу: вернулись условные единицы и файл v1',async()=>{await page.locator('#elevClear').click();await page.waitForFunction(()=>document.getElementById('elevStatus').textContent.includes('Шкала не задана'));const d=await saved();assert.equal(d.schema,'fm-terrain-workspace-v1');});
 let imported;
 await test('Импорт 16-битного PNG 360×180: метры, шкала в файле, имя карты, статус',async()=>{
  await page.fill('#elevRadius','6371');await page.fill('#elevMpu','8000');await page.fill('#elevMin','-500');await page.fill('#elevMax','8500');await page.fill('#elevSea','0');
  await pick(png(360,180,island(360,180)));await page.waitForFunction(()=>document.getElementById('elevMessage').textContent.startsWith('Импортировано'));
  const m=await text('elevMessage');assert(m.includes('360×180 → 360×180'),m);imported=await saved();assert.equal(imported.schema,'fm-terrain-workspace-v2');assert.equal(imported.name,'Импорт рельефа');assert.equal(imported.scale.radiusKm,6371);
  const land=imported.patch.base.land.reduce((a,v)=>a+v,0);assert(land>500,'клеток суши '+land);const maxRel=Math.max(...imported.patch.base.height.filter(v=>v!==null));
  assert(Math.abs(maxRel*8000-4000)<150,'максимум в метрах '+maxRel*8000);
  await page.waitForFunction(()=>document.getElementById('elevStatus').textContent.includes('макс.'));
 });
 await test('Импорт 720×360 с уменьшением блоками 2×2',async()=>{
  await pick(png(720,360,island(720,360)));await page.waitForFunction(()=>document.getElementById('elevMessage').textContent.includes('уменьшение блоками 2×2'));
  const d=await saved();const a=imported.patch.base.land.reduce((x,v)=>x+v,0),b=d.patch.base.land.reduce((x,v)=>x+v,0);assert(Math.abs(a-b)/a<.08,'суша '+a+' vs '+b);
 });
 await test('Неверный файл отклонён, карта не изменена; отказ от замены тоже',async()=>{
  const keep=JSON.stringify(await saved());await pick(png(360,180,island(360,180),8));await page.waitForFunction(()=>document.getElementById('elevMessage').textContent.includes('Импорт отклонён'));assert(((await text('elevMessage'))).includes('16-bit'));assert.equal(JSON.stringify(await saved()),keep);
  await pick(Buffer.from('это не растр'),'bad.json');await page.waitForFunction(()=>document.getElementById('elevMessage').textContent.includes('neither'));assert.equal(JSON.stringify(await saved()),keep);
  await page.fill('#mapName','Другое имя');await page.locator('#mapName').press('Tab');accept=false;await pick(png(360,180,island(360,180)));await page.waitForFunction(()=>document.getElementById('elevMessage').textContent.includes('Импорт отменён'));accept=true;assert.equal((await saved()).name,'Другое имя');
 });
 await test('После импорта считается вода',async()=>{
  await pick(png(360,180,island(360,180)));await page.waitForFunction(()=>document.getElementById('elevMessage').textContent.startsWith('Импортировано'));
  await page.locator('#calculateWater').click();await page.waitForFunction(()=>document.getElementById('waterInfo').textContent.includes('Завершено: 20 шагов'),null,{timeout:120000});
 });
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'elevation.png'),fullPage:true});console.log('SUMMARY: '+results.length+' elevation browser scenarios passed. Electron/Mac and native dialogs not covered.');
})().catch(async e=>{results.push({status:'failed',error:String(e.stack||e)});console.error(e);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}).finally(async()=>{await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify({results,pageErrors:errors},null,2));if(browser)await browser.close();if(server)server.close();});
