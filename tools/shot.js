#!/usr/bin/env node
// Скриншот приложения. node tools/shot.js [--seed s] [--theme sepia|ink|color] [--view map|states|cities|height|plates] [--full] [--out /tmp/shot.png] [--layers]
// --full: авто-государства, города, дороги. Печатает JS-ошибки страницы; код выхода 1, если они были.
const { open, ready, populate } = require('./lib');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
(async () => {
  const seed = arg('seed', 'zeta'), { b, p, errs } = await open(`?seed=${seed}&theme=${arg('theme', 'sepia')}`);
  await ready(p, seed); await p.waitForTimeout(1500);
  if (a.includes('--full')) await populate(p);
  const v = arg('view'); if (v) { await p.click(`[data-v="${v}"]`); await p.waitForTimeout(800); }
  const out = arg('out', '/tmp/shot.png'); await p.screenshot({ path: out });
  console.log('снимок:', out, errs.length ? `ОШИБОК: ${errs.length}` : 'ошибок нет'); await b.close(); process.exit(errs.length ? 1 : 0);
})();
