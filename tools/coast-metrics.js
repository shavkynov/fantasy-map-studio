#!/usr/bin/env node
// Метрики БЕРЕГОВОГО КОНТУРА (этап 4 переработки континентов): то, что видно на карте, а не на сетке.
//   node tools/coast-metrics.js [--n 10] [--k 2,3,4] [--gen 2] [--size 480] [--out файл.json]
// Для каждой карты берутся контуры «как рисуются» (FM.R.coastLoops).
// Метрики на 1000 px длины берега: самопересечения контура, острые изломы (>100° на окне ±8 вершин), прямые участки (окно 40 px, отклонение < 1 px),
// фрактальная размерность D по шагам 8/32/128 px (естественный берег 1.1–1.3), доля петель-«обрывков» (< 12 px), число вершин.
const fs = require('fs');
const { open, ready } = require('./lib');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const N = +arg('n', 10), KS = arg('k', '2,3,4').split(',').map(Number), GEN = +arg('gen', 2), SIZE = +arg('size', 480), OUT = arg('out', '');
const code = `(() => {
  const segX = (p, q, r, s) => { const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (!d) return false; const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return t > 0 && t < 1 && u > 0 && u < 1; };
  const selfX = (loop) => { const n = loop.length, cs = 16, g = new Map(); let c = 0;
    for (let i = 0; i < n; i++) { const p = loop[i], q = loop[(i + 1) % n], x0 = Math.floor(Math.min(p[0], q[0]) / cs), x1 = Math.floor(Math.max(p[0], q[0]) / cs), y0 = Math.floor(Math.min(p[1], q[1]) / cs), y1 = Math.floor(Math.max(p[1], q[1]) / cs);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x * 100003 + y, L = g.get(k); if (L) for (const j of L) { if (Math.abs(j - i) < 3 || Math.abs(j - i) > n - 3) continue; if (segX(p, q, loop[j], loop[(j + 1) % n])) c++; } if (L) L.push(i); else g.set(k, [i]); } }
    return c; };
  const per = (loop) => { let L = 0; for (let i = 0; i < loop.length; i++) { const p = loop[i], q = loop[(i + 1) % loop.length]; L += Math.hypot(q[0] - p[0], q[1] - p[1]); } return L; };
  const lenAtStep = (loop, st) => { // длина ломаной, вершины которой взяты вдоль дуги с шагом st (грубо: по длине)
    const pts = [loop[0]]; let acc = 0; for (let i = 1; i <= loop.length; i++) { const p = loop[i - 1], q = loop[i % loop.length]; acc += Math.hypot(q[0] - p[0], q[1] - p[1]); if (acc >= st) { pts.push(q); acc = 0; } }
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
  const resample = (loop, st) => { const n = loop.length, out = [loop[0]]; let acc = 0; for (let i = 1; i <= n; i++) { const p = loop[i - 1], q = loop[i % n]; let d = Math.hypot(q[0] - p[0], q[1] - p[1]); while (acc + d >= st && d > 0) { const t = (st - acc) / d; const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t; out.push([x, y]); p[0] = x; p[1] = y; d = Math.hypot(q[0] - x, q[1] - y); acc = 0; } acc += d; } return out; };
  const one = (loops0) => { const loops = loops0.map(l => resample(l.map(q => [q[0], q[1]]), 1.5)); let X = 0, sharp = 0, flat = 0, tot = 0, L = 0, v = 0, tiny = 0, L8 = 0, L32 = 0, L128 = 0, nl = 0;
    for (const lp of loops) { const n = lp.length; if (n < 20) continue; const pl = per(lp); if (pl < 12) { tiny++; continue; } nl++; L += pl; v += n; X += selfX(lp);
      for (let i = 0; i < n; i += 4) { const A = lp[(i - 8 + n) % n], B = lp[i], C = lp[(i + 8) % n]; const ux = B[0] - A[0], uy = B[1] - A[1], wx = C[0] - B[0], wy = C[1] - B[1]; const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy); if (lu > 1 && lw > 1) { const cs = (ux * wx + uy * wy) / (lu * lw); if (Math.acos(Math.max(-1, Math.min(1, cs))) > 100 * Math.PI / 180) sharp++; } tot++; }
      for (let i = 0; i < n; i += 6) { const A = lp[i], B = lp[(i + 40) % n]; const ll = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; if (ll < 30) continue; let dv = 0; for (let k = 4; k < 40; k += 6) { const Q = lp[(i + k) % n]; dv = Math.max(dv, Math.abs((B[0] - A[0]) * (A[1] - Q[1]) - (A[0] - Q[0]) * (B[1] - A[1])) / ll); } if (dv < 1) flat++; }
      if (pl > 300) { L8 += lenAtStep(lp, 8); L32 += lenAtStep(lp, 32); L128 += lenAtStep(lp, 128); } }
    const per1000 = (x) => +(x / Math.max(1, L) * 1000).toFixed(3);
    return { x: per1000(X), sharp: +(sharp / Math.max(1, tot) * 1000).toFixed(1), flat: +(flat / Math.max(1, L / 6) * 100).toFixed(2), D: L128 > 0 ? +(1 + Math.log(L8 / L128) / Math.log(16)).toFixed(3) : 0, verts: Math.round(v / Math.max(1, nl)), tiny, len: Math.round(L) }; };
  return (maps) => maps.map(m => { const S = 3.75, B = FM.R.coastLoops(m, S); return { v2: one(B.coast), h2: one(B.halos[1]) }; });
})()`;
(async () => {
  const { b, p, errs } = await open('?seed=zeta'); await ready(p, 'zeta'); await p.waitForTimeout(300);
  const all = {};
  for (const K of KS) {
    const rows = await p.evaluate(`(() => { const f = ${code}; const maps = []; for (let i = 1; i <= ${N}; i++) maps.push(FM.generate({ seed: 'c' + String(i).padStart(2, '0'), genVersion: ${GEN}, plateCount: 9, landRatio: 0.34, epochs: 2, continents: ${K}, islands: 3, W: ${SIZE}, H: ${Math.round(SIZE * 2 / 3)} })); return f(maps); })()`);
    const avg = (key, sub) => +(rows.reduce((s, r) => s + r[key][sub], 0) / rows.length).toFixed(3);
    all[K] = rows;
    console.log(`K=${K} (${N} карт, gen ${GEN}):`);
    for (const key of ['v2', 'h2']) console.log(`  ${key === 'v1' ? 'берег, контур 1 (прежний)' : key === 'v2' ? 'берег, контур 2 (этап 4)  ' : key === 'h1' ? 'ореол 3.6, контур 1       ' : 'ореол 3.6, контур 2       '}  самопересечений/1000px ${avg(key, 'x')} | острых изломов/1000 ${avg(key, 'sharp')} | прямых участков % ${avg(key, 'flat')} | D ${avg(key, 'D')} | вершин/петля ${avg(key, 'verts')}`);
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(all));
  console.log(errs.length ? `ОШИБОК: ${errs.length}` : 'ошибок страницы нет'); await b.close(); process.exit(errs.length ? 1 : 0);
})();
