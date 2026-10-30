#!/usr/bin/env node
// Листы «только форма»: один материк на плитку (K=1, без островов и архипелагов), версии A и B рядом, каждая плитка подписана «номер + буква».
//   node tools/sil-forms.js --a old/silhouette.js --b src/silhouette.js --out DIR [--n 40] [--per 10] [--k 1]
// A — слева (исходная), B — справа (новая). Плитка в натуральном размере 480×320. Между парами — широкий зазор, между A и B — тонкая линия. Оценка: форма очертания, не расположение.
'use strict';
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const { png, text, drawTile } = require('./sil-png.js'), OUT = arg('out', path.join(process.cwd(), 'sil_forms')), N = +arg('n', 40), PER = +arg('per', 10), K = +arg('k', 1);
function load(src) { const w = {}; new Function('window', fs.readFileSync(path.join(__dirname, '..', 'src', 'rng.js'), 'utf8'))(w); new Function('window', fs.readFileSync(src, 'utf8'))(w); return { FM: w.FM, M: require('./sil-metrics-core.js')(w.FM) }; }
const V = [load(arg('a')), load(arg('b'))];
// --bmode old: вернуть B свободную деформацию, старый берег, без явных заливов (режимы silhouette.js)
if (arg('bmode', '') === 'old') { const S = V[1].FM.__sil; S.WARP.free = true; S.WAMP.v = 1; S.COAST.mode = 'old'; S.GULF.nmax = 0; S.ELONG.rich = false; } for (const [side, mode] of [[0, arg('amode', '')], [1, arg('bmode', '')]]) if (mode === 'base' || mode === 'baserich' || mode === 'baselobes' || mode === 'baselobes2') { const S = V[side].FM.__sil; S.ELONG.rich = (mode !== 'base'); if (mode === 'baselobes') S.ELONG.lobes = { n0: 1, n1: 2, sep: 0.3, l0: 0.7, l1: 1.3, blend: 0.2 }; if (mode === 'baselobes2') S.ELONG.lobes = { n0: 1, n1: 2, sep: 0.35, l0: 0.6, l1: 1.0, blend: 0.25, wmin: 0.3, tail: 0.3 }; S.WARP.free = true; S.WAMP.v = 1; S.COAST.mode = 'old'; S.GULF.nmax = 0; S.COMP.on = false; S.FILT.thin = false; S.FILT.holes = false; }
fs.mkdirSync(OUT, { recursive: true });
const W = 480, H = 320, tw = 480, th = 320, GAP = 24, MID = 3, PCOL = 2, PW = 2 * tw + MID, BW = PCOL * PW + (PCOL - 1) * GAP;
for (let sh = 0; sh * PER < N; sh++) {
  const cnt = Math.min(PER, N - sh * PER), rows = Math.ceil(cnt / PCOL), BH = rows * th + (rows - 1) * GAP, buf = Buffer.alloc(BW * BH * 3); for (let i = 0; i < BW * BH; i++) { buf[i * 3] = 70; buf[i * 3 + 1] = 74; buf[i * 3 + 2] = 82; }   // зазоры серые
  for (let q = 0; q < cnt; q++) {
    const k = sh * PER + q, seed = 'g' + String(k + 1).padStart(2, '0'), ox = (q % PCOL) * (PW + GAP), oy = ((q / PCOL) | 0) * (th + GAP);
    for (let side = 0; side < 2; side++) {
      const s = V[side].FM.silhouette({ seed, W, H, continents: K, islands: 0, archipelagos: 0 }), x0 = ox + side * (tw + MID);
      drawTile(V[side].M, buf, BW, x0, oy, tw, th, s, false);
      text(buf, BW, x0 + 8, oy + 8, (k + 1) + (side ? 'B' : 'A'), [255, 255, 255], 4);
    }
    for (let y = 0; y < th; y++) for (let x = 0; x < MID; x++) { const o = ((oy + y) * BW + ox + tw + x) * 3; buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; }
  }
  const f = path.join(OUT, `forms_${arg('tag','x')}_K${K}_${String(sh * PER + 1).padStart(2, '0')}-${String(sh * PER + cnt).padStart(2, '0')}.png`); fs.writeFileSync(f, png(BW, BH, buf)); console.log(f);
}
