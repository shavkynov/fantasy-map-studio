#!/usr/bin/env node
// Проверка генерации суши: число крупных материков для K=2..5 и доля суши на нескольких seed. node tools/continents.js
const { open, ready } = require('./lib');
(async () => {
  const { b, p } = await open('?seed=a'); await ready(p);
  const res = await p.evaluate(() => { const out = []; for (const K of [2, 3, 4, 5]) for (const seed of ['a1', 'b2', 'c3', 'd4']) {
    const m = FM.generate({ seed, plateCount: 9, landRatio: 0.34, epochs: 2, continents: K, W: 480, H: 320 }), W = 480, H = 320, lab = new Int32Array(W * H); let n = 0, land = 0; const sz = [];
    for (let i = 0; i < W * H; i++) { if (m.h[i] <= 0 || lab[i]) continue; n++; let c = 0; const st = [i]; lab[i] = n; while (st.length) { const j = st.pop(); c++; const x = j % W, y = (j / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const k = yy * W + xx; if (m.h[k] > 0 && !lab[k]) { lab[k] = n; st.push(k); } } } sz.push(c); land += c; }
    sz.sort((a, b) => b - a); out.push(`K=${K} ${seed}: крупных=${sz.filter(s => s > land * 0.08).length} доли=${sz.slice(0, 4).map(s => Math.round(s / land * 100)).join('/')}% суша=${(land / (W * H) * 100).toFixed(0)}%`); } return out; });
  console.log(res.join('\n')); await b.close();
})();
