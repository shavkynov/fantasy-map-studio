#!/usr/bin/env node
// Галерея прототипа силуэтов v3: N seed × K × размер -> контактные листы PNG + metrics.json (диагностика). Playwright не нужен: src/silhouette.js работает в Node.
//   node tools/sil-gallery.js [--out DIR] [--n 40] [--n2 12] [--k 1,2,3,5,8] [--sizes 480,960] [--only K]
// Цвета: основные материки — песочный, крупные острова — светлее, архипелаги — бледно-голубой, обломки (мелкие/неотнесённые) — серый; красная рамка — неудача (failed / слияние / число основных ≠ K).
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const OUT = arg('out', path.join(process.cwd(), 'sil_gallery')), N480 = +arg('n', 40), N960 = +arg('n2', 12), KS = arg('k', '1,2,3,5,8').split(',').map(Number), SIZES = arg('sizes', '480,960').split(',').map(Number);
global.window = {}; const R = path.join(__dirname, '..', 'src');
new Function('window', fs.readFileSync(path.join(R, 'rng.js'), 'utf8'))(window); new Function('window', fs.readFileSync(arg('src', path.join(R, 'silhouette.js')), 'utf8'))(window);
const FM = window.FM, M = require('./sil-metrics-core.js')(FM);
fs.mkdirSync(OUT, { recursive: true });
const { png, text, drawTile: drawTile0 } = require('./sil-png.js'), drawTile = (...a) => drawTile0(M, ...a);
// --byclass N: K=1, N seed, листы по классам каркаса (по 16 плиток на класс, 480) — чтобы видеть каждый класс отдельно
if (arg('byclass', '')) {
  const NN = +arg('byclass', 120), W = 480, H = 320, tw = 240, th = 160, cols = 8, groups = {};
  for (let k = 0; k < NN; k++) { const seed = 'g' + String(k + 1).padStart(3, '0'), s = FM.silhouette({ seed, W, H, continents: 1, islands: 0, archipelagos: 0 }), c = s.massifs[0].cls; (groups[c] = groups[c] || []).push({ seed, s, k }); }
  for (const c in groups) {
    const g = groups[c].slice(0, 32), rows = Math.ceil(g.length / cols), BW = cols * tw, BH = rows * th, buf = Buffer.alloc(BW * BH * 3); for (let i = 0; i < BW * BH; i++) { buf[i * 3] = 12; buf[i * 3 + 1] = 16; buf[i * 3 + 2] = 22; }
    g.forEach((e, i) => { drawTile(buf, BW, (i % cols) * tw, ((i / cols) | 0) * th, tw, th, e.s, false); text(buf, BW, (i % cols) * tw + 6, ((i / cols) | 0) * th + 6, '#' + (e.k + 1), [255, 255, 255], 2); });
    fs.writeFileSync(path.join(OUT, `class_${c}.png`), png(BW, BH, buf)); console.log('класс', c, ':', groups[c].length, 'из', NN, '->', `class_${c}.png`);
  }
  process.exit(0);
}
const all = []; const t00 = Date.now();
for (const W of SIZES) {
  const H = Math.round(W * 2 / 3), n = W === 480 ? N480 : N960, cols = W === 480 ? 8 : 4, tw = W === 480 ? 240 : 480, th = Math.round(tw * 2 / 3);
  for (const K of KS) {
    const rows = Math.ceil(n / cols), BW = cols * tw, BH = rows * th, buf = Buffer.alloc(BW * BH * 3); for (let i = 0; i < BW * BH; i++) { buf[i * 3] = 12; buf[i * 3 + 1] = 16; buf[i * 3 + 2] = 22; }
    const rowsM = [];
    for (let k = 0; k < n; k++) {
      const seed = 'g' + String(k + 1).padStart(2, '0'), s = FM.silhouette({ seed, W, H, continents: K }), m = M.metrics(s), bad = m.failed > 0 || m.merges > 0 || m.nMain !== K || m.mainComps !== K;
      m.seed = seed; m.bad = bad; rowsM.push(m); all.push({ W, K, seed, m });
      drawTile(buf, BW, (k % cols) * tw, ((k / cols) | 0) * th, tw, th, s, bad); text(buf, BW, (k % cols) * tw + 6, ((k / cols) | 0) * th + 6, '#' + (k + 1), [255, 255, 255], 2);
    }
    const file = path.join(OUT, `sheet_W${W}_K${K}.png`); fs.writeFileSync(file, png(BW, BH, buf));
    const ok = rowsM.filter(m => !m.bad).length; console.log(`W${W} K${K}: ${n} seed, без дефектов размещения ${ok}/${n}, среднее ${Math.round(rowsM.reduce((a, m) => a + m.ms, 0) / n)} мс -> ${path.basename(file)}`);
  }
}
// повторы форм: попарное сходство сигнатур основных материков по всей галерее W=480
const sigs = []; for (const r of all) if (r.W === 480) r.m.sigs.forEach((sg, i) => { if (sg) sigs.push({ seed: r.seed, K: r.K, i, sg }); }); let rep = 0, mx = 0, pairs = 0;
for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) { if (sigs[i].seed === sigs[j].seed) continue; if (sigs[i].K === 1 && sigs[j].K !== 1) { } const v = M.sigIoU(sigs[i].sg, sigs[j].sg); pairs++; if (v > mx) mx = v; if (v > 0.85) rep++; }
for (const r of all) delete r.m.sigs;
const agg = (f) => { const v = all.filter(f).map(r => r.m); return v; };
const summary = { total: all.length, bad: all.filter(r => r.m.bad).length, seconds: Math.round((Date.now() - t00) / 1000), repeatedPairs_IoU_gt_085: rep, maxPairIoU: Math.round(mx * 1000) / 1000, pairsCompared: pairs };
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify({ summary, rows: all }, null, 1));
console.log('ИТОГ', JSON.stringify(summary));
