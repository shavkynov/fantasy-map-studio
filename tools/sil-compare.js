#!/usr/bin/env node
// Сравнение двух версий silhouette.js на одних и тех же seed и параметрах: плитки парами «A | B» (слева исходная, справа исправленная), красная рамка — плохой seed своей версии.
//   node tools/sil-compare.js --a base/silhouette.js --b src/silhouette.js --out DIR [--n 40] [--n2 12] [--k 1,2,3,5,8] [--sizes 480,960]
// Плохой seed: не размещён основной массив, слияние основных, число основных ≠ K, основные в разном числе компонент.
'use strict';
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const { png, text, drawTile } = require('./sil-png.js'), OUT = arg('out', path.join(process.cwd(), 'sil_compare')), N480 = +arg('n', 40), N960 = +arg('n2', 12), KS = arg('k', '1,2,3,5,8').split(',').map(Number), SIZES = arg('sizes', '480,960').split(',').map(Number);
function load(src) { const w = {}; new Function('window', fs.readFileSync(path.join(__dirname, '..', 'src', 'rng.js'), 'utf8'))(w); new Function('window', fs.readFileSync(src, 'utf8'))(w); return { FM: w.FM, M: require('./sil-metrics-core.js')(w.FM) }; }
const A = load(arg('a')), B = load(arg('b')); fs.mkdirSync(OUT, { recursive: true });
const summary = [];
for (const W of SIZES) {
  const H = Math.round(W * 2 / 3), n = W === 480 ? N480 : N960, pairs = W === 480 ? 4 : 2, tw = W === 480 ? 240 : 480, th = Math.round(tw * 2 / 3);
  for (const K of KS) {
    const rows = Math.ceil(n / pairs), BW = pairs * 2 * tw, BH = rows * th, buf = Buffer.alloc(BW * BH * 3); for (let i = 0; i < BW * BH; i++) { buf[i * 3] = 12; buf[i * 3 + 1] = 16; buf[i * 3 + 2] = 22; }
    let badA = 0, badB = 0; const listA = [], listB = [];
    for (let k = 0; k < n; k++) {
      const seed = 'g' + String(k + 1).padStart(2, '0'), col = (k % pairs) * 2 * tw, row = ((k / pairs) | 0) * th;
      for (const [side, V] of [[0, A], [1, B]]) {
        const s = V.FM.silhouette({ seed, W, H, continents: K }), m = V.M.metrics(s), bad = m.failed > 0 || m.merges > 0 || m.nMain !== K || m.mainComps !== K;
        drawTile(V.M, buf, BW, col + side * tw, row, tw, th, s, bad);
        if (bad) { (side ? listB : listA).push(seed); if (side) badB++; else badA++; }
      }
      text(buf, BW, col + 6, row + 6, '#' + (k + 1), [255, 255, 255], 2);
      for (let y = 0; y < th; y++) for (const x of [col + tw - 1, col + tw]) { const o = (((row + y) * BW) + x) * 3; buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; }   // белая линия между A и B
    }
    fs.writeFileSync(path.join(OUT, `cmp_W${W}_K${K}.png`), png(BW, BH, buf)); summary.push({ W, K, n, badA, badB, listA, listB }); console.log(`W${W} K${K}: плохих A=${badA} B=${badB} | A: ${listA.join(',')} | B: ${listB.join(',')}`);
  }
}
fs.writeFileSync(path.join(OUT, 'compare.json'), JSON.stringify(summary, null, 1));
