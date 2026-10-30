// Общие помощники для проверок: запуск страницы в Chromium (playwright), сбор ошибок, сценарии «страны → города → дороги».
// Playwright ищется локально, затем в /opt/npm-tools (облачная среда).
const path = require('path');
let pw; for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (e) {} }
if (!pw) { console.error('playwright не найден'); process.exit(2); }
const INDEX = 'file://' + path.join(__dirname, '..', 'src', 'index.html');
async function open(query, opts) {
  const b = await pw.chromium.launch(), p = await b.newPage(Object.assign({ viewport: { width: 1500, height: 960 } }, opts || {})), errs = [];
  p.on('pageerror', e => { errs.push(e.stack || e.message); console.log('ERR', e.message); });
  p.on('console', m => { if (m.type() === 'error') { errs.push(m.text()); console.log('console.error:', m.text()); } });
  await p.goto(INDEX + (query || ''));
  return { b, p, errs };
}
const ready = (p, seed) => p.waitForFunction(s => window.__state && window.__state.map && (!s || window.__state.map.seed === s), seed || null, { timeout: 90000 });
// полный сценарий: страны → города → дороги
async function populate(p) {
  await p.click('[data-v="states"]'); await p.click('#autoStates'); await p.waitForTimeout(2500);
  await p.click('[data-v="cities"]'); await p.click('#autoCities'); await p.waitForTimeout(4000);
  await p.click('#autoRoads'); await p.waitForTimeout(2500);
}
module.exports = { open, ready, populate, INDEX };
