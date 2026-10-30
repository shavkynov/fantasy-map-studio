#!/usr/bin/env node
// Проверка карты дна: физические инварианты модели (seafloor.js, seafloor_life.js), детерминизм, отрисовка в 3 стилях.
// node tools/seabed.js [seed ...]   (по умолчанию zeta omega kappa lambda). Код выхода 1, если есть нарушения или ошибки страницы.
const { open, ready } = require('./lib');
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['zeta', 'omega', 'kappa', 'lambda'];
(async () => {
  let bad = 0;
  for (const seed of seeds) {
    const { b, p, errs } = await open(`?seed=${seed}`); await ready(p, seed); await p.waitForTimeout(800);
    const r = await p.evaluate(() => {
      const m = __state.map, sf = FM.seafloor(m), W = sf.W, sc = sf.sc, idx = (x, y) => Math.round(y) * W + Math.round(x), V = [], N = sf.depth.length;
      const chk = (ok, msg) => { if (!ok) V.push(msg); };
      let nan = 0, landWet = 0, shallowOcean = 0, maxd = 0; for (let i = 0; i < N; i++) { const d = sf.depth[i]; if (!isFinite(d)) nan++; if (sf.water[i]) { if (d < 4.9) shallowOcean++; maxd = Math.max(maxd, d); } else if (d !== 0) landWet++; }
      chk(nan === 0, 'NaN в глубинах: ' + nan); chk(landWet === 0, 'глубина на суше: ' + landWet); chk(maxd > 6000 && maxd < 11600, 'макс. глубина вне 6000–11600 м: ' + Math.round(maxd));
      // хребты: только в открытом океане
      let rNear = 0, rN = 0; for (const r of sf.ridges) for (const q of r.pts) { rN++; if (!sf.water[idx(q[0], q[1])] || sf.dLand[idx(q[0], q[1])] < 6 * sc) rNear++; } chk(rNear / Math.max(1, rN) < 0.02, `хребты у берега: ${rNear}/${rN}`);
      // жёлоба глубокие
      let tm = 0, tn = 0; for (const t of sf.trenches) for (const q of t.pts) { tm += sf.depth[idx(q[0], q[1])]; tn++; } if (tn) chk(tm / tn > 5200, 'средняя глубина жёлобов ' + Math.round(tm / tn));
      // возраст коры растёт от хребта (глубина тоже): корреляция в пределах океана вдали от суши
      let n1 = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0; if (sf.dR) for (let i = 0; i < N; i += 7) { if (!sf.water[i] || sf.dLand[i] < 30 * sc || (sf.dT && sf.dT[i] < 14 * sc) || sf.dR[i] > 80 * sc) continue; const x = sf.dR[i], y = sf.depth[i]; n1++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
      const corr = n1 > 50 ? (n1 * sxy - sx * sy) / Math.sqrt((n1 * sxx - sx * sx) * (n1 * syy - sy * sy)) : 1; if (sf.ridges.length) chk(corr > 0.2, 'глубина не растёт с удалением от хребта, r=' + corr.toFixed(2));
      // атоллы только в тёплой воде, коралловые точки тёплые и мелкие, ламинария — в умеренных
      let cb = 0; for (const a of sf.reefs.atolls) if (m.temp[idx(a.x, a.y)] < 0.8) cb++; chk(cb === 0, 'атоллы в холодной воде: ' + cb);
      cb = 0; for (const q of [...sf.reefs.fringing, ...sf.reefs.patch]) { const i = idx(q.x, q.y); if (m.temp[i] < 0.79 || sf.depth[i] > 140) cb++; } chk(cb === 0, 'кораллы вне тёплого мелководья: ' + cb);
      cb = 0; for (const q of sf.kelp) { const t = m.temp[idx(q.x, q.y)]; if (t < 0.29 || t > 0.67) cb++; } chk(cb === 0, 'ламинария вне умеренных вод: ' + cb);
      // ресурсы по условиям
      for (const r of sf.res) {
        const d = sf.depth[idx(r.x, r.y)];
        if ((r.k === 'oil' || r.k === 'gas') && !(d < 2700)) chk(false, r.k + ' на глубине ' + Math.round(d));
        if (r.k === 'nodules' && !(d > 4100)) chk(false, 'конкреции на глубине ' + Math.round(d));
        if (r.k === 'sulfide' && !(d > 700)) chk(false, 'сульфиды на глубине ' + Math.round(d));
        if (!isFinite(r.amt) || r.acc < 1 || r.acc > 4) chk(false, 'ресурс с неверными amt/acc');
      }
      const have = {}; for (const r of sf.res) have[r.k] = (have[r.k] || 0) + 1;
      // детерминизм: пересчёт даёт то же
      const s1 = JSON.stringify([sf.ridges.length, sf.trenches.length, sf.cones.length, sf.res.map(r => r.k + r.x.toFixed(2)).join()]);
      m._sf = null; const sf2 = FM.seafloor(m), s2 = JSON.stringify([sf2.ridges.length, sf2.trenches.length, sf2.cones.length, sf2.res.map(r => r.k + r.x.toFixed(2)).join()]); chk(s1 === s2, 'пересчёт даёт другой результат');
      // отрисовка во всех стилях
      const t0 = performance.now(); for (const th of ['sepia', 'ink', 'color']) { const cv = FM.renderMap(m, { theme: th, layers: __state.layers, seabed: true }); chk(cv.width > 100, 'пустой рендер ' + th); }
      return { V, info: { ridges: sf.ridges.length, trenches: sf.trenches.length, cones: sf.cones.length, canyons: sf.canyons.length, labels: sf.labels.length, res: have, reefs: sf.stats.fringing + sf.stats.barrier + sf.stats.patch + sf.stats.atolls, corr: +corr.toFixed(2), maxd: Math.round(maxd), renderMs: Math.round(performance.now() - t0) } };
    });
    console.log(seed, JSON.stringify(r.info), r.V.length ? 'НАРУШЕНИЯ: ' + r.V.join(' | ') : 'инварианты соблюдены', errs.length ? 'ОШИБОК СТРАНИЦЫ: ' + errs.length : '');
    bad += r.V.length + errs.length; await b.close();
  }
  process.exit(bad ? 1 : 0);
})();
