#!/usr/bin/env node
// Листы для оценки ФОРМЫ материка: один материк (K=1) на плитку, без островов и соседей, обрезан по габариту и вписан в квадрат (размер на плитке не сравнивается).
// Пара на seed: слева A (--a, было), справа B (--b, стало), над парой номер seed; пары разделены зазором и рамкой.
//   node tools/sil-shapes.js --a base/silhouette.js --b src/silhouette.js --out DIR [--n 40] [--per 15] [--W 480]
'use strict';
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const { png, text } = require('./sil-png.js'), OUT = arg('out', path.join(process.cwd(), 'sil_shapes')), N = +arg('n', 40), PER = +arg('per', 15), W = +arg('W', 480), H = Math.round(W * 2 / 3), K = +arg('k', 1);
function load(src) { const w = {}; new Function('window', fs.readFileSync(path.join(__dirname, '..', 'src', 'rng.js'), 'utf8'))(w); new Function('window', fs.readFileSync(src, 'utf8'))(w); return w.FM; }
const FA = load(arg('a')), FB = load(arg('b')); fs.mkdirSync(OUT, { recursive: true });
const TS = 300, GAP = 24, HDR = 40, COLS = 3, BW = COLS * (2 * TS + GAP) + GAP, SAND = [214, 190, 140], SEA = [28, 40, 54], BG = [12, 16, 22];
function mainMask(s) { let best = -1, ba = 0; for (const c of s.comps) if (c.cat === 'main' && c.area > ba) { ba = c.area; best = c.c; } const m = new Uint8Array(s.W * s.H); if (best >= 0) for (let i = 0; i < m.length; i++) if (s.lab[i] === best) m[i] = 1; return m; }
function tile(buf, ox, oy, s) {
  const m = mainMask(s); let x0 = s.W, x1 = -1, y0 = s.H, y1 = -1; for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) if (m[y * s.W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const o = ((oy + y) * BW + ox + x) * 3; buf[o] = SEA[0]; buf[o + 1] = SEA[1]; buf[o + 2] = SEA[2]; }
  if (x1 < 0) return;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, sc = (TS - 24) / Math.max(bw, bh), ox0 = (TS - bw * sc) / 2, oy0 = (TS - bh * sc) / 2;
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const sx0 = x0 + (x - ox0) / sc, sy0 = y0 + (y - oy0) / sc, sx1 = sx0 + 1 / sc, sy1 = sy0 + 1 / sc; let n = 0, t = 0;
    for (let yy = Math.floor(sy0); yy <= Math.floor(sy1); yy++) for (let xx = Math.floor(sx0); xx <= Math.floor(sx1); xx++) { if (xx < 0 || yy < 0 || xx >= s.W || yy >= s.H) { n++; continue; } n++; t += m[yy * s.W + xx]; }
    const f = n ? t / n : 0, o = ((oy + y) * BW + ox + x) * 3; for (let c = 0; c < 3; c++) buf[o + c] = SEA[c] + (SAND[c] - SEA[c]) * f;
  }
}
for (let part = 0; part * PER < N; part++) {
  const seeds = []; for (let k = part * PER; k < Math.min(N, (part + 1) * PER); k++) seeds.push(k);
  const rows = Math.ceil(seeds.length / COLS), BH = rows * (TS + HDR + GAP) + GAP, buf = Buffer.alloc(BW * BH * 3); for (let i = 0; i < BW * BH; i++) { buf[i * 3] = BG[0]; buf[i * 3 + 1] = BG[1]; buf[i * 3 + 2] = BG[2]; }
  seeds.forEach((k, idx) => {
    const col = idx % COLS, row = (idx / COLS) | 0, bx = GAP + col * (2 * TS + GAP), by = GAP + row * (TS + HDR + GAP), seed = 'g' + String(k + 1).padStart(2, '0');
    const sa = FA.silhouette({ seed, W, H, continents: K }), sb = FB.silhouette({ seed, W, H, continents: K });
    tile(buf, bx, by + HDR, sa); tile(buf, bx + TS, by + HDR, sb);
    text(buf, BW, bx + 4, by + 8, String(k + 1), [255, 255, 120], 4); text(buf, BW, bx + TS - 18, by + 8, 'A', [200, 200, 200], 4); text(buf, BW, bx + 2 * TS - 18, by + 8, 'B', [120, 255, 160], 4);
    for (let x = 0; x < 2 * TS; x++) for (const y of [by + HDR - 2, by + HDR + TS]) { const o = (y * BW + bx + x) * 3; buf[o] = buf[o + 1] = buf[o + 2] = 90; }
    for (let y = by + HDR - 2; y <= by + HDR + TS; y++) for (const x of [bx, bx + TS, bx + 2 * TS - 1]) { const o = (y * BW + x) * 3; buf[o] = buf[o + 1] = buf[o + 2] = x === bx + TS ? 200 : 90; }
  });
  fs.writeFileSync(path.join(OUT, `shapes_K${K}_${part + 1}.png`), png(BW, BH, buf)); console.log('лист', part + 1, 'seed', seeds[0] + 1, '–', seeds[seeds.length - 1] + 1);
}
