#!/usr/bin/env node
// Проверка сохранения/загрузки мира: создаёт мир, наполняет, сохраняет, загружает в новой странице, сравнивает.
const { open, ready, populate, INDEX } = require('./lib'), fs = require('fs');
const sig = () => { const s = __state; return JSON.stringify([s.pol.states.map(q => q.name), s.pol.cities.length, s.pol.roads.length, Array.from(s.pol.owner.slice(0, 20000)).reduce((x, y) => x + y, 0)]); };
(async () => {
  const { b, p, errs } = await open('', { acceptDownloads: true });
  await p.fill('#seed', 'rt-test'); await p.click('#setupGo'); await ready(p, 'rt-test'); await p.waitForTimeout(800); await populate(p);
  const before = await p.evaluate(sig), [dl] = await Promise.all([p.waitForEvent('download'), p.click('#saveWorld')]); await dl.saveAs('/tmp/rt.fmworld');
  const load = async (file) => { const q = await b.newPage(); q.on('pageerror', e => errs.push(e.message)); await q.goto(INDEX); await q.waitForTimeout(800); const [fc] = await Promise.all([q.waitForEvent('filechooser'), q.click('#setupLoad')]); await fc.setFiles(file); await ready(q, 'rt-test'); await q.waitForTimeout(3000); return q; };
  const q = await load('/tmp/rt.fmworld'), after = await q.evaluate(sig);
  const ok1 = before === after;
  console.log(ok1 ? 'СОВПАДАЕТ' : 'РАЗЛИЧИЯ\n' + before + '\n' + after, 'файл', fs.statSync('/tmp/rt.fmworld').size, 'байт');
  console.log(errs.length ? 'ОШИБКИ СТРАНИЦЫ: ' + errs.length : 'ошибок страницы нет'); await b.close(); process.exit(ok1 && !errs.length ? 0 : 1);
})();
