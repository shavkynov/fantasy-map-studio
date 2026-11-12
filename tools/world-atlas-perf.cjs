'use strict';
// Шаг 4 docs/DEVELOPMENT_PLAN.md: замеры на небольшом фиксированном наборе. Это измерение окружения, а не критерий и не заявление об улучшении.
// Запуск: NODE_PATH=<путь к playwright> node tools/world-atlas-perf.cjs [--sizes 3] [--seeds perf-a,perf-b,perf-c] [--reps 3]
// Выход: короткая таблица в stdout и один JSON-отчёт artifacts/world-atlas-perf/report-<время>.json (создаётся эксклюзивно, не перезаписывается).
// Память: только JS-куча страницы (performance.memory, опрос каждые 50 мс); холсты и память процесса браузера НЕ входят.
const { chromium } = require('playwright'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), http = require('node:http');
require('../scripts/prepare-world-atlas.cjs').prepare();
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const sizes = arg('sizes', '3').split(','), seeds = arg('seeds', 'perf-a,perf-b,perf-c').split(','), reps = +arg('reps', '3');
const root = path.resolve(__dirname, '../src'), outDir = path.resolve('artifacts/world-atlas-perf');
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }, r1 = (v) => Math.round(v * 10) / 10;

(async () => {
  const server = http.createServer(async (req, res) => { try { const f = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname); if (!f.startsWith(root + path.sep)) throw Error(); res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8'); res.end(await fs.readFile(f)); } catch { res.statusCode = 404; res.end(); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] }), rows = [];
  for (const size of sizes) for (const seed of seeds) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 2600 }, acceptDownloads: true }); page.setDefaultTimeout(600000); const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 120))); page.on('dialog', d => d.accept());
    await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
    await page.evaluate(() => { window.__peak = 0; setInterval(() => { const m = performance.memory; if (m && m.usedJSHeapSize > window.__peak) window.__peak = m.usedJSHeapSize; }, 50); const render = FM.renderMap; window.__cap = null; FM.renderMap = (map, opts) => { window.__cap = { map, opts }; return render(map, opts); }; });
    const row = { size, seed }, wall = async (fn) => { const t = Date.now(); await fn(); return Date.now() - t; };
    await page.fill('#seed', seed); await page.locator('#sizeSeg button[data-s="' + size + '"]').click();
    row.generateMs = await wall(async () => { await page.locator('#setupGo').click(); await page.waitForFunction(() => window.__cap && window.__cap.map && document.getElementById('stats').textContent.includes('Городов:')); });
    Object.assign(row, await page.evaluate(() => ({ grid: window.__cap.map.W + 'x' + window.__cap.map.H, statsText: document.getElementById('stats').textContent.replace(/\s+/g, ' ').slice(0, 220) })));
    await page.locator('#viewSeg button[data-v="states"]').click(); await page.fill('#autoN', '3');
    row.statesMs = await wall(async () => { await page.locator('#autoStates').click(); await page.waitForFunction(() => window.__cap.opts.political && window.__cap.opts.political.states.length > 0); });
    await page.locator('#viewSeg button[data-v="cities"]').click();
    row.citiesMs = await wall(async () => { await page.locator('#autoCities').click(); await page.waitForFunction(() => window.__cap.opts.political && window.__cap.opts.political.cities.length > 0); });
    row.roadsMs = await wall(async () => { await page.locator('#autoRoads').click(); await page.waitForFunction(() => window.__cap.opts.political && window.__cap.opts.political.roads.length > 0); });
    await page.locator('#viewSeg button[data-v="map"]').click(); await page.locator('#layersSec .fold-h').click();
    row.themeSwitchAtlasMs = await wall(async () => { await page.locator('#themeSeg button[data-t="atlas"]').click(); await page.waitForFunction(() => FM.WorldAtlas.inspect()?.mode === 'atlas-ui1'); });
    // прямые вызовы рендерера на захваченных map/opts: первый вызов после сброса кэша и повторные (кэш атласа)
    const direct = await page.evaluate((n) => {
      const { map, opts } = window.__cap, o = { ...opts, theme: 'atlas' }, t = () => performance.now(), time = (fn) => { const a = t(); fn(); return t() - a; };
      const first = [], repeat = [], ink = []; for (let i = 0; i < n; i++) { FM.WorldAtlas.clear(map); first.push(time(() => FM.renderMap(map, o))); }
      FM.renderMap(map, o); for (let i = 0; i < n; i++) repeat.push(time(() => FM.renderMap(map, o))); for (let i = 0; i < n; i++) ink.push(time(() => FM.renderMap(map, { ...opts, theme: 'ink' })));
      return { first, repeat, ink };
    }, reps);
    Object.assign(row, { atlasFirstRenderMs: r1(med(direct.first)), atlasRepeatRenderMs: r1(med(direct.repeat)), inkRenderMs: r1(med(direct.ink)) });
    await page.locator('#exLegend').uncheck(); const ex = []; for (let i = 0; i < reps; i++) { const t = Date.now(), ev = page.waitForEvent('download'); await page.locator('#export').click(); const f = await (await ev).path(); ex.push(Date.now() - t); row.exportBytes = (await fs.stat(f)).size; }
    row.exportMs = med(ex); row.peakJsHeapMB = r1(await page.evaluate(() => window.__peak) / 1048576); row.pageErrors = errors.length;
    rows.push(row); console.log(JSON.stringify({ size, seed, grid: row.grid, generateMs: row.generateMs, atlasFirst: row.atlasFirstRenderMs, atlasRepeat: row.atlasRepeatRenderMs, ink: row.inkRenderMs, exportMs: row.exportMs, peakHeapMB: row.peakJsHeapMB, errors: row.pageErrors }));
    await page.close();
  }
  const env = { date: new Date().toISOString(), node: process.version, chromium: browser.version(), os: os.type() + ' ' + os.release(), cpu: os.cpus()[0].model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 1e9), headless: true, note: 'sandbox VM, not a user Mac; JS heap only' };
  await fs.mkdir(outDir, { recursive: true }); const file = path.join(outDir, 'report-' + env.date.replace(/[:.]/g, '-') + '.json'); await fs.writeFile(file, JSON.stringify({ env, params: { sizes, seeds, reps }, rows }, null, 1), { flag: 'wx' });
  console.log('report: ' + file); await browser.close(); server.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
