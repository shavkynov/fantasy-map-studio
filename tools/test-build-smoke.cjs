'use strict';
// Смоук интегрированной тестовой сборки (после scripts/prepare-test-build.cjs): запуск из корня собранного дерева.
// Проверяет: нет выбора размера и плашки с экспериментальными ссылками, все файлы из index.html отдаются (нет 404), генерация идёт моделью v3
// на самом большом размере (1440x960), страница без ошибок, тема «Мировой атлас» доступна и применяется. Не заменяет ручную приёмку.
const { chromium } = require('playwright'), http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../src');
(async () => {
  const srv = http.createServer((q, r) => { try { const f = path.resolve(root, '.' + new URL(q.url, 'http://x').pathname); if (!f.startsWith(root + path.sep)) throw Error(); r.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'); r.end(fs.readFileSync(f)); } catch { r.statusCode = 404; r.end(); } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1500, height: 950 } }), errs = [], bad = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200))); p.on('response', r => { if (r.status() >= 400) bad.push(r.url()); });
  try {
    await p.goto('http://127.0.0.1:' + srv.address().port + '/index.html');
    assert.equal(await p.locator('#sizeSeg').count(), 0, 'size selector must be gone');
    assert.equal(await p.locator('#testBuildBanner').count(), 0, 'no experimental-links banner');
    assert.equal(await p.locator('a[href$=".html"]').count(), 0, 'no links to other pages');
    assert.equal(await p.locator('#themeSeg button[data-t="atlas"]').count(), 1, 'atlas theme present');
    await p.evaluate(() => { window.__m = null; const g = FM.generateAsync; FM.generateAsync = async (...a) => (window.__m = await g(...a)); });
    await p.fill('#seed', 'smoke-v3'); await p.locator('#setupGo').click();
    await p.waitForFunction(() => window.__m && document.getElementById('stats').textContent.includes('Городов:'), null, { timeout: 600000 });
    const r = await p.evaluate(() => ({ gv: __m.genVersion, W: __m.W, H: __m.H, natural: !!__m.natural, version: FM.VERSION }));
    assert.deepEqual([r.gv, r.W, r.H, r.natural], [3, 1440, 960, true], 'Natural World v3 at the largest size');
    await p.locator('#layersSec .fold-h').click(); await p.locator('#themeSeg button[data-t="atlas"]').click();
    await p.waitForFunction(() => FM.WorldAtlas && FM.WorldAtlas.inspect() && FM.WorldAtlas.inspect().mode === 'atlas-ui1', null, { timeout: 120000 });
    assert.deepEqual(errs, [], 'page errors'); assert.deepEqual(bad, [], 'HTTP >= 400');
    console.log('PASS test build smoke: ' + JSON.stringify(r));
  } finally { await b.close(); srv.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
