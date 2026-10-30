#!/usr/bin/env node
// Метрики формы суши (модель одна; регрессия — tools/golden.js). Метрики считает tools/continents-metrics-core.js (в странице).
//   node tools/continents-metrics.js                     метрики: 20 seed × K=2,3,4, 480×320 (≈3 мин)
//   node tools/continents-metrics.js --gen 2 --out /tmp/v2.json    то же для новой модели, результат в файл
//   node tools/continents-metrics.js --compare tools/continents-baseline.json   таблица «базовая линия → текущее»
// Опции: --gen N, --k 2,3,4, --n 20, --size 480, --res 6 (проверка разрешения ×1,5 и ×2; 0 — пропустить), --v2same (в --check: genVersion 2 должен совпадать с 1 — верно только на этапе 0).
// Коды выхода: 0 — всё хорошо, 1 — расхождение/ошибка страницы.
const fs = require('fs'), path = require('path');
const { open, ready } = require('./lib');
const a = process.argv.slice(2), has = (k) => a.includes('--' + k), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 && a[i + 1] && a[i + 1][0] !== '-' ? a[i + 1] : d; };
const GEN = +arg('gen', 2), KS = arg('k', '2,3,4').split(',').map(Number), SIZE = +arg('size', 480), NS = +arg('n', 20), NRES = +arg('res', 6);
const seedsAll = Array.from({ length: 20 }, (_, i) => 'c' + String(i + 1).padStart(2, '0')), SEEDS = seedsAll.slice(0, Math.min(NS, 20));
const KEYS = ['nMass', 'ovalIoU', 'solidity', 'elong', 'rect', 'concavPerMass', 'noConcavMasses', 'innerWater', 'innerFrac', 'flat12', 'axis', 'arc40', 'corners', 'nearFrame', 'roughMean', 'roughCV', 'neckSplits', 'thinLost', 'islGroups', 'islLine', 'islArc', 'islRing', 'islBlob', 'islLineArc', 'islKinds', 'bayBig', 'bayMid', 'baySmall', 'riftArea', 'bayRift', 'convArea', 'islandArc', 'seaBasins', 'basinRound', 'lakes', 'lakesSmall', 'lakesMid', 'lakesBig', 'lakeChains', 'landOnCrust', 'seaOnCrust', 'landOnContPlate', 'contPlateOnLand', 'youngOnLand', 'layoutHoriz', 'land'];

async function session() {
  const { b, p, errs } = await open('?seed=zeta'); await ready(p, 'zeta'); await p.waitForTimeout(300);
  await p.evaluate(fs.readFileSync(path.join(__dirname, 'continents-metrics-core.js'), 'utf8'));
  return { b, p, errs };
}
const gen = (p, seeds, K, genVersion, size, withMetrics) => p.evaluate(({ seeds, K, genVersion, size, withMetrics }) => seeds.map(seed => {
  const t0 = performance.now(), m = FM.generate({ seed, genVersion, plateCount: 9, landRatio: 0.34, epochs: 2, continents: K, islands: 3, W: size, H: Math.round(size * 2 / 3) }), ms = performance.now() - t0;
  return { seed, K, hash: __CM.hashOf(m), ms: Math.round(ms), metrics: withMetrics ? __CM.metricsOf(m) : null, mask: withMetrics ? Array.from(__CM.mask(m, 48, 32)).join('') : null, gv: m.genVersion };
}), { seeds, K, genVersion, size, withMetrics });

const agg = (rows) => { const o = {}; for (const k of KEYS) { const v = rows.map(r => r.metrics[k]).filter(x => x != null && isFinite(x)); if (!v.length) continue; const mu = v.reduce((s, x) => s + x, 0) / v.length; o[k] = { mean: +mu.toFixed(4), min: Math.min(...v), max: Math.max(...v), sd: +Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length).toFixed(4) }; } return o; };
const diversity = (rows) => { let s = 0, n = 0; for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) { const A = rows[i].mask, B = rows[j].mask; let I = 0, U = 0; for (let k = 0; k < A.length; k++) { const x = A[k] === '1', y = B[k] === '1'; if (x && y) I++; if (x || y) U++; } s += 1 - I / Math.max(1, U); n++; } return +(s / Math.max(1, n)).toFixed(3); };
const sameHash = (x, y) => x.h === y.h && x.biome === y.biome && x.rivers === y.rivers && x.plates === y.plates;
const fmtH = (h) => `h:${h.h} b:${h.biome} r:${h.rivers}`;

(async () => {
  let { b, p, errs } = await session(), bad = 0; const t00 = Date.now();

  // ---------- метрики ----------
  const out = { meta: { appVersion: await p.evaluate(() => FM.VERSION), genVersion: GEN, size: SIZE, k: KS, seeds: SEEDS, date: new Date().toISOString().slice(0, 10) }, golden: {}, agg: {}, diversity: {}, perSeed: {}, resolution: [], repro: {} };
  for (const K of KS) {
    const rows = await gen(p, SEEDS, K, GEN, SIZE, true); out.perSeed[K] = rows.map(r => ({ seed: r.seed, ms: r.ms, ...r.metrics }));
    for (const r of rows) out.golden[K + ':' + r.seed] = r.hash;
    out.agg[K] = agg(rows); out.diversity[K] = diversity(rows);
    const again = await gen(p, SEEDS.slice(0, 3), K, GEN, SIZE, false); out.repro[K] = again.every((r, i) => sameHash(r.hash, rows[i].hash)); if (!out.repro[K]) bad++;
    const m = out.agg[K], g = (k) => m[k] ? m[k].mean : '—';
    console.log(`K=${K} (${SEEDS.length} seed, genVersion ${GEN}): массивов ${g('nMass')} (=K у ${rows.filter(r => r.metrics.nMass === K).length}/${rows.length}), IoU эллипса ${g('ovalIoU')}, solidity ${g('solidity')}, вогнутостей/массив ${g('concavPerMass')}, замкн. вода ${g('innerWater')}, прямые12 ${g('flat12')}, дуги40 ${g('arc40')}, изломы/1000 ${g('corners')}, у рамки ${g('nearFrame')}, горизонт.раскладка ${g('layoutHoriz')}, различие силуэтов ${out.diversity[K]}, повтор ${out.repro[K] ? 'ок' : 'НЕТ'}`);
  }
  // разрешение: тот же seed на ×1,5 и ×2 — совпадение суши и дрейф метрик
  if (NRES > 0) {
    out.resolution = await p.evaluate(({ seeds, size, gv }) => seeds.map(seed => {
      const P = (W) => FM.generate({ seed, genVersion: gv, plateCount: 9, landRatio: 0.34, epochs: 2, continents: 2, islands: 3, W, H: Math.round(W * 2 / 3) }), base = P(size), mb = __CM.metricsOf(base), r = { seed };
      for (const f of [1.5, 2]) { const m = P(Math.round(size * f)), mm = __CM.metricsOf(m); let I = 0, U = 0; for (let y = 0; y < base.H; y++) for (let x = 0; x < base.W; x++) { const la = base.h[y * base.W + x] > 0, lb = m.h[Math.min(m.H - 1, Math.round(y * f)) * m.W + Math.min(m.W - 1, Math.round(x * f))] > 0; if (la && lb) I++; if (la || lb) U++; } r['iou' + f] = +(I / U).toFixed(3); r['dLand' + f] = +(mm.land - mb.land).toFixed(3); r['dSolidity' + f] = +(mm.solidity - mb.solidity).toFixed(3); r['dCorners' + f] = +(mm.corners - mb.corners).toFixed(1); r['dFlat12_' + f] = +(mm.flat12 - mb.flat12).toFixed(3); }
      return r; }), { seeds: SEEDS.slice(0, NRES), size: SIZE, gv: GEN });
    const rs = out.resolution, mn = (k) => Math.min(...rs.map(r => r[k]));
    console.log(`разрешение ${SIZE}→${Math.round(SIZE * 1.5)}/${SIZE * 2}: IoU суши мин ${mn('iou1.5')} / ${mn('iou2')}; |Δ доли суши| макс ${Math.max(...rs.map(r => Math.abs(r['dLand2']))).toFixed(3)}; |Δ solidity| макс ${Math.max(...rs.map(r => Math.abs(r['dSolidity2']))).toFixed(3)}; |Δ изломов/1000| макс ${Math.max(...rs.map(r => Math.abs(r['dCorners2']))).toFixed(1)}`);
  }
  if (arg('out')) { fs.writeFileSync(arg('out'), JSON.stringify(out)); console.log('результат:', arg('out')); }
  if (arg('compare')) {
    const bl = JSON.parse(fs.readFileSync(arg('compare'), 'utf8'));
    for (const K of KS) { if (!bl.agg[K]) continue; console.log(`\nK=${K}: базовая линия (genVersion ${bl.meta.genVersion}) → текущее (genVersion ${GEN})`); for (const k of KEYS) { const x = bl.agg[K][k], y = out.agg[K][k]; if (!x || !y) continue; const d = y.mean - x.mean; console.log(`  ${k.padEnd(16)} ${String(x.mean).padStart(8)} → ${String(y.mean).padStart(8)}   Δ ${(d >= 0 ? '+' : '') + d.toFixed(3)}`); } console.log(`  ${'diversity'.padEnd(16)} ${String(bl.diversity[K]).padStart(8)} → ${String(out.diversity[K]).padStart(8)}`); }
  }
  console.log(`время ${Math.round((Date.now() - t00) / 1000)} с; ошибок страницы: ${errs.length}`);
  await b.close(); process.exit(bad || errs.length ? 1 : 0);
})();
