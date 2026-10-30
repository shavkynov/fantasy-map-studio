#!/usr/bin/env node
// Метрика «прямых сторон у рамки»: для каждой из 4 сторон берём профиль расстояния от рамки до ближайшей суши вдоль перпендикуляров;
// в окнах 120 клеток (при 480; четверть стороны) окно «прямое», если профиль — почти прямая (СКО от линии < 4 клеток, наклон < 0.3). Выводит долю прямых окон (0 — нет прямых краёв),
// среднюю глубину зазора между рамкой и сушей и долю суши в 25 клетках от рамки.   node tools/edge-metrics.js [--n 30] [--k 2,3,4]
const { open, ready } = require('./lib');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const N = +arg('n', 30), KS = arg('k', '2,3,4').split(',').map(Number);
(async () => {
  const { b, p, errs } = await open('?seed=zeta'); await ready(p, 'zeta');
  for (const K of KS) {
    const r = await p.evaluate(([K, N]) => {
      const W = 480, H = 320, rows = [];
      for (let i = 1; i <= N; i++) {
        const m = FM.generate({ seed: 'q' + i + 'e', plateCount: 9, landRatio: 0.34, epochs: 2, continents: K, islands: 3, W, H });
        const prof = (len, depth, at) => { const o = []; for (let s = 0; s < len; s++) { let d = depth; for (let t = 0; t < depth; t++) if (m.h[at(s, t)] > 0) { d = t; break; } o.push(d); } return o; };
        const sides = [prof(H, 140, (s, t) => s * W + t), prof(H, 140, (s, t) => s * W + W - 1 - t), prof(W, 140, (s, t) => t * W + s), prof(W, 140, (s, t) => (H - 1 - t) * W + s)];
        let win = 0, straight = 0, gap = 0, gn = 0, longest = 0;
        for (const pr of sides) { let run = 0; for (let s = 0; s + 120 <= pr.length; s += 30) { const w = pr.slice(s, s + 120); if (Math.max(...w) >= 140) { run = 0; continue; }
          const n = w.length, mx = (n - 1) / 2, my = w.reduce((q, v) => q + v, 0) / n; let sxy = 0, sxx = 0; w.forEach((v, j) => { sxy += (j - mx) * (v - my); sxx += (j - mx) ** 2; }); const k = sxy / sxx; let ss = 0; w.forEach((v, j) => { ss += (v - (my + k * (j - mx))) ** 2; });
          win++; gap += Math.min(...w); gn++; if (Math.sqrt(ss / n) < 4 && Math.abs(k) < 0.3) { straight++; run += 30; longest = Math.max(longest, run + 90); } else run = 0; } }
        let land = 0, near = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m.h[y * W + x] > 0) { land++; if (Math.min(x, W - 1 - x, y, H - 1 - y) < 25) near++; }
        rows.push({ f: win ? straight / win : 0, g: gn ? gap / gn : 0, n: near / land, w: win, L: longest });
      }
      const av = k => rows.reduce((s, r) => s + r[k], 0) / rows.length;
      return { 'доля прямых окон': +av('f').toFixed(3), 'мин. зазор до суши (клеток)': +av('g').toFixed(1), 'суша в 25 клетках от рамки': +av('n').toFixed(3), 'окон с сушей на мир': +av('w').toFixed(1), 'самый длинный прямой край, клеток': +av('L').toFixed(0) };
    }, [K, N]);
    console.log('K=' + K, JSON.stringify(r));
  }
  console.log(errs.length ? 'ошибок: ' + errs.length : 'ошибок страницы нет'); await b.close();
})();
