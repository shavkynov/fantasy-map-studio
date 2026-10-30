#!/usr/bin/env node
// Диагностика: на какой стадии построения силуэта возникает каждый тип дефекта (этап 4). Только измерения, ничего не исправляет.
//   node tools/sil-diag.js [--n 40] [--k 1,2,3,5,8] [--W 480] [--json out.json] [--src path/to/silhouette.js]
// Стадии на массив: warp (поле массива после деформации, один, до вставки) -> paste (после вставки в общее поле) -> coast (после береговой детали) -> final (после очистки).
// Показатели на массив: частей ≥3% площади (расколы), дырок (замкнутых морских карманов) и их доля, тонкая доля (раскрытие r=0.012W и 0.03W), шероховатость (доля площади, меняющаяся при открытии+закрытии r=0.006W).
'use strict';
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const N = +arg('n', 40), KS = arg('k', '1,2,3,5,8').split(',').map(Number), W = +arg('W', 480), H = Math.round(W * 2 / 3), SRC = arg('src', path.join(__dirname, '..', 'src', 'silhouette.js'));
global.window = {}; new Function('window', fs.readFileSync(path.join(__dirname, '..', 'src', 'rng.js'), 'utf8'))(window); new Function('window', fs.readFileSync(SRC, 'utf8'))(window);
const FM = window.FM, { label, distToMask, evalMassif } = FM.__sil;
function crop(mask, W, H, pad) { let x0 = W, x1 = -1, y0 = H, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } if (x1 < 0) return null; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad); const w = x1 - x0 + 1, h = y1 - y0 + 1, m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = mask[(y0 + y) * W + x0 + x]; return { m, w, h }; }
const inv = (m) => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; };
function open(m, w, h, r) { const dsea = distToMask(inv(m), w, h), er = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) if (m[i] && dsea[i] >= r + 0.5) er[i] = 1; const de = distToMask(er, w, h), o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) if (m[i] && de[i] <= r + 0.5) o[i] = 1; return o; }
function close(m, w, h, r) { const dl = distToMask(m, w, h), dil = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) if (dl[i] <= r + 0.5) dil[i] = 1; const dsea = distToMask(inv(dil), w, h), o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) if (dil[i] && dsea[i] >= r + 0.5 || m[i]) o[i] = 1; return o; }
function stat(mask, W0, H0) {
  const c = crop(mask, W0, H0, 4); if (!c) return null; const { m, w, h } = c; let A = 0; for (let i = 0; i < m.length; i++) A += m[i];
  const lb = label(m, w, h), big = lb.sizes.filter(n => n >= 0.03 * A).length, small = lb.sizes.filter(n => n >= 0.005 * A).length, main = Math.max.apply(null, lb.sizes) / A;
  // дырки: морские компоненты, не касающиеся края кадра
  const ls = label(inv(m), w, h), touch = new Uint8Array(ls.n); for (let x = 0; x < w; x++) { for (const i of [x, (h - 1) * w + x]) touch[ls.lab[i]] = 1; } for (let y = 0; y < h; y++) { for (const i of [y * w, y * w + w - 1]) touch[ls.lab[i]] = 1; }
  let holes = 0, holeA = 0, holesBig = 0; for (let k = 0; k < ls.n; k++) if (!touch[k]) { holes++; holeA += ls.sizes[k]; if (ls.sizes[k] >= 0.004 * A) holesBig++; }
  const r1 = 0.012 * W0, r2 = 0.03 * W0, r3 = 0.006 * W0, o1 = open(m, w, h, r1), o2 = open(m, w, h, r2); let c1 = 0, c2 = 0; for (let i = 0; i < m.length; i++) { c1 += o1[i]; c2 += o2[i]; }
  const op = open(m, w, h, r3), cl = close(op, w, h, r3); let ch = 0; for (let i = 0; i < m.length; i++) if ((m[i] ? 1 : 0) !== cl[i]) ch++;
  // нити относительно размера массива: раскрытие радиусом f·R_экв (R_экв = sqrt(A/π)); threads — куски, вырезанные раскрытием r=0.07·R_экв, площадью ≥0.4% A и вытянутостью (длина/ширина) > 2
  const Req = Math.sqrt(A / Math.PI), oa = open(m, w, h, Math.max(1, 0.06 * Req)), ob = open(m, w, h, Math.max(1, 0.12 * Req)); let ca = 0, cb = 0; for (let i = 0; i < m.length; i++) { ca += oa[i]; cb += ob[i]; }
  const rem = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) if (m[i] && !ob[i]) rem[i] = 1; const lr = label(rem, w, h); let threads = 0; for (let k = 0; k < lr.n; k++) if (lr.sizes[k] >= 0.004 * A) threads++;
  return { thinN1: 1 - ca / A, thinN2: 1 - cb / A, threads, area: A / (W0 * W0), parts: big, parts05: small, mainFrac: main, holes, holesBig, holeFrac: holeA / A, thin1: 1 - c1 / A, thin2: 1 - c2 / A, rough: ch / A };
}
const STG = ['frame', 'warp', 'paste', 'coast', 'final'], agg = {};
const push = (k, v) => { (agg[k] = agg[k] || []).push(v); };
const rows = [], t0 = Date.now();
for (const K of KS) for (let k = 0; k < N; k++) {
  const seed = 'g' + String(k + 1).padStart(2, '0'), tr = {}, s = FM.silhouette({ seed, W, H, continents: K, trace: tr }), Nn = W * H;
  // атрибуция пикселей массивам: владелец расширяется на 0.025W (береговая деталь двигает контур)
  const own = Int16Array.from(tr.owner); for (let it = 0; it < Math.round(0.025 * W); it++) { const nx = Int16Array.from(own); for (let i = 0; i < Nn; i++) if (own[i] < 0) { const x = i % W; let o = -1; if (x > 0 && own[i - 1] >= 0) o = own[i - 1]; else if (x < W - 1 && own[i + 1] >= 0) o = own[i + 1]; else if (i >= W && own[i - W] >= 0) o = own[i - W]; else if (i < Nn - W && own[i + W] >= 0) o = own[i + W]; nx[i] = o; } own.set(nx); }
  for (const sp of tr.specs) {
    if (sp.mass.failed || sp.cat !== 'main') continue;
    const id = sp.mass.id, ev = evalMassif(sp, sp.mass.Rn, sp.mass.cx, sp.mass.cy, W, H, 1), solo = new Uint8Array(Nn); for (let gy = 0; gy < ev.gh; gy++) for (let gx = 0; gx < ev.gw; gx++) if (ev.data[gy * ev.gw + gx] > 0) solo[(ev.y0 + gy) * W + ev.x0 + gx] = 1;
    const mk = (src) => { const m = new Uint8Array(Nn); for (let i = 0; i < Nn; i++) if (src[i] && own[i] === id) m[i] = 1; return m; };
    const ws0 = sp.warpScale; sp.warpScale = 0; const e0 = evalMassif(sp, sp.mass.Rn, sp.mass.cx, sp.mass.cy, W, H, 1), fr = new Uint8Array(Nn); for (let gy = 0; gy < e0.gh; gy++) for (let gx = 0; gx < e0.gw; gx++) if (e0.data[gy * e0.gw + gx] > 0) fr[(e0.y0 + gy) * W + e0.x0 + gx] = 1; sp.warpScale = ws0;
    const masks = { frame: fr, warp: solo, paste: mk(tr.assembled), coast: mk(tr.afterCoast), final: mk(s.mask) }, st = {};
    for (const g of STG) st[g] = stat(masks[g], W, H);
    rows.push({ K, seed, tag: sp.tag, cls: sp.mass.cls, share: sp.area, st });
    for (const g of STG) if (st[g]) for (const q in st[g]) { push(`${g}|${q}|all`, st[g][q]); push(`${g}|${q}|${sp.mass.cls}`, st[g][q]); }
  }
}
const med = (v) => { v = v.slice().sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; }, mean = (v) => v.reduce((a, b) => a + b, 0) / v.length, p90 = (v) => { v = v.slice().sort((a, b) => a - b); return v[Math.floor(v.length * 0.9)]; };
const f = (x) => (Math.round(x * 1000) / 1000).toString().padStart(6);
console.log(`массивов main: ${rows.length}, ${Math.round((Date.now() - t0) / 1000)} с\n`);
for (const cls of ['all', 'elong', 'compact', 'peninsular', 'fragmented']) {
  const n = (agg[`warp|area|${cls}`] || []).length; if (!n) continue; console.log(`== класс ${cls} (n=${n}); среднее [p90] по стадиям warp / paste / coast / final`);
  for (const q of ['parts', 'parts05', 'mainFrac', 'holes', 'holesBig', 'holeFrac', 'thin1', 'thin2', 'thinN1', 'thinN2', 'threads', 'rough']) console.log(q.padEnd(9), STG.map(g => { const v = agg[`${g}|${q}|${cls}`]; return v ? `${f(mean(v))} [${f(p90(v))}]` : '   -'; }).join('  '));
  console.log('');
}
// где впервые появляется раскол: массивы, у которых parts=1 на стадии warp и >1 позже
const trans = { split: {}, splitNever: 0 }; for (const r of rows) { const s = r.st; if (!s.warp || !s.final) continue; let first = null; for (const g of STG) if (s[g] && s[g].parts05 > 1 && !first) first = g; if (first) trans.split[first] = (trans.split[first] || 0) + 1; }
console.log('первая стадия с частями ≥0.5% (parts05>1):', JSON.stringify(trans.split), ' из ', rows.length);
const hs = {}; for (const r of rows) { let first = null; for (const g of STG) if (r.st[g] && r.st[g].holesBig > 0 && !first) first = g; if (first) hs[first] = (hs[first] || 0) + 1; } console.log('первая стадия с крупной дыркой (≥0.4% площади):', JSON.stringify(hs));
const hsc = {}; for (const r of rows) if (r.cls !== 'fragmented') { let first = null; for (const g of STG) if (r.st[g] && r.st[g].holesBig > 0 && !first) first = g; if (first) hsc[first] = (hsc[first] || 0) + 1; } console.log('то же, без класса fragmented:', JSON.stringify(hsc));
if (arg('json', '')) fs.writeFileSync(arg('json'), JSON.stringify(rows));
