#!/usr/bin/env node
// Сравнительные листы силуэтов суши: слева «до» (по умолчанию genVersion 1 = legacy), справа «после» (genVersion 2) — одни и те же seed.
//   node tools/continents-sheet.js [--k 2,3,4] [--n 12] [--gen 1,2] [--size 480] [--out docs/continents_baseline]
// На этапе 0 обе половины идентичны (новой модели ещё нет) — это и проверяется (печатается число совпавших карт).
// Файлы: <out>/K<K>_gen<A>_vs_gen<B>.png. Сетка 4×3 при n=12. Лист — для глаз; числа — в continents-metrics.js.
const fs = require('fs'), path = require('path');
const { open, ready } = require('./lib');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const KS = arg('k', '2,3,4').split(',').map(Number), N = +arg('n', 12), [GA, GB] = arg('gen', '1,2').split(',').map(Number), SIZE = +arg('size', 480), OUT = path.resolve(arg('out', path.join(__dirname, '..', 'docs', 'continents_baseline')));
const seeds = Array.from({ length: N }, (_, i) => 'c' + String(i + 1).padStart(2, '0'));
(async () => {
  const { b, p, errs } = await open('?seed=zeta'); await ready(p, 'zeta'); await p.waitForTimeout(300);
  await p.evaluate(fs.readFileSync(path.join(__dirname, 'continents-metrics-core.js'), 'utf8')); fs.mkdirSync(OUT, { recursive: true });
  for (const K of KS) {
    const r = await p.evaluate(({ seeds, K, GA, GB, SIZE }) => {
      const make = (gv) => seeds.map(seed => FM.generate({ seed, genVersion: gv, plateCount: 9, landRatio: 0.34, epochs: 2, continents: K, islands: 3, W: SIZE, H: Math.round(SIZE * 2 / 3) }));
      const A = make(GA), B = make(GB), same = A.filter((m, i) => __CM.hashOf(m).h === __CM.hashOf(B[i]).h).length;
      const lab = (ms) => ms.map((m, i) => `${seeds[i]}  земля ${(m.landFraction * 100).toFixed(0)}%`);
      return { same, png: __CM.sheet([{ title: `до: genVersion ${GA}${GA === 1 ? ' (legacy)' : ''} — K=${K}`, maps: A, labels: lab(A) }, { title: `после: genVersion ${GB} — K=${K}`, maps: B, labels: lab(B) }], { cols: 4 }) };
    }, { seeds, K, GA, GB, SIZE });
    const f = path.join(OUT, `K${K}_gen${GA}_vs_gen${GB}.png`); fs.writeFileSync(f, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(`K=${K}: ${f}  (идентичных карт «до/после»: ${r.same}/${N})`);
  }
  console.log(errs.length ? `ОШИБОК: ${errs.length}` : 'ошибок страницы нет'); await b.close(); process.exit(errs.length ? 1 : 0);
})();
