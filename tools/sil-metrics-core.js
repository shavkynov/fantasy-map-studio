// Диагностические метрики масок суши прототипа v3 (tools/sil-gallery.js). Это диагностика поиска повторяющихся дефектов, а не критерий «хорошо/плохо»: решает визуальная оценка листов.
'use strict';
module.exports = function (FM) {
  const { label, distToMask } = FM.__sil;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  // компоненты суши и их категории (по владельцам пикселей)
  function comps(s) {
    const W = s.W, H = s.H, N = W * H, lb = s.lab, own = {}, sizes = {};
    for (let i = 0; i < N; i++) { const c = lb[i]; if (c < 0) continue; sizes[c] = (sizes[c] || 0) + 1; const o = s.owner[i]; if (o >= 0) { (own[c] = own[c] || {})[o] = ((own[c] || {})[o] || 0) + 1; } }
    return Object.keys(sizes).map(c => { const o = own[c] || {}; let best = -1, bn = 0; for (const k in o) if (o[k] > bn) { bn = o[k]; best = +k; } const m = best >= 0 ? s.massifs[best] : null; return { c: +c, n: sizes[c], area: sizes[c] / (W * W), cat: m ? m.cat : 'frag', cls: m ? m.cls : null, id: best }; });
  }
  // моменты и эллипс, выпуклая оболочка для компоненты (по списку пикселей)
  function shapeOf(s, c) {
    const W = s.W, H = s.H, N = W * H, px = []; for (let i = 0; i < N; i++) if (s.lab[i] === c) px.push(i);
    const n = px.length; let mx = 0, my = 0; for (const i of px) { mx += i % W; my += (i / W) | 0; } mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0; for (const i of px) { const dx = (i % W) - mx, dy = ((i / W) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; } sxx /= n; syy /= n; sxy /= n;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, d = Math.sqrt(Math.max(0, tr * tr / 4 - det)), l1 = tr / 2 + d, l2 = Math.max(1e-9, tr / 2 - d), th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // эллипс той же площади и моментов
    const a = 2 * Math.sqrt(l1), b = 2 * Math.sqrt(l2), sc = Math.sqrt(n / (Math.PI * a * b)), A = a * sc, B = b * sc, ct = Math.cos(th), st = Math.sin(th);
    let inter = 0; for (const i of px) { const dx = (i % W) - mx, dy = ((i / W) | 0) - my, u = (dx * ct + dy * st) / A, v = (-dx * st + dy * ct) / B; if (u * u + v * v <= 1) inter++; }
    const ellArea = Math.PI * A * B, iou = inter / (n + ellArea - inter);
    // выпуклая оболочка по граничным пикселям
    const pts = []; for (const i of px) { const x = i % W, y = (i / W) | 0; if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || s.lab[i - 1] !== c || s.lab[i + 1] !== c || s.lab[i - W] !== c || s.lab[i + W] !== c) pts.push([x, y]); }
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]); const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]); const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let k = pts.length - 1; k >= 0; k--) { const p = pts[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    const hull = lo.slice(0, -1).concat(up.slice(0, -1)); let ha = 0; for (let k = 0; k < hull.length; k++) { const p = hull[k], q = hull[(k + 1) % hull.length]; ha += p[0] * q[1] - q[0] * p[1]; } ha = Math.abs(ha) / 2;
    return { n, px, mx, my, th, iou, solidity: n / Math.max(n, ha), elong: Math.sqrt(l1 / l2), perim: pts.length };
  }
  // доля площади, исчезающая при морфологическом раскрытии радиуса r (тонкие части суши)
  function thinFrac(s, mask, r) {
    const W = s.W, H = s.H, N = W * H, er = new Uint8Array(N); let tot = 0, cnt = 0;
    for (let i = 0; i < N; i++) if (mask[i]) { tot++; if (s.D[i] >= r) er[i] = 1; }
    const d = distToMask(er, W, H); for (let i = 0; i < N; i++) if (mask[i] && d[i] <= r) cnt++;
    return tot ? 1 - cnt / tot : 0;
  }
  // число крупных «лопастей»: непересекающиеся вписанные круги крупнее 0,35 максимального
  function lobes(s, c) {
    const W = s.W, H = s.H, step = Math.max(2, Math.round(W / 160)), pk = []; let mx = 0;
    for (let y = step; y < H - step; y += step) for (let x = step; x < W - step; x += step) { const i = y * W + x; if (s.lab[i] === c) { const v = s.D[i]; pk.push([v, x, y]); if (v > mx) mx = v; } }
    pk.sort((a, b) => b[0] - a[0]); const acc = [];
    for (const p of pk) { if (p[0] < 0.35 * mx) break; if (acc.every(q => Math.hypot(p[1] - q[1], p[2] - q[2]) > (p[0] + q[0]) * 0.85)) acc.push(p); }
    return acc.length;
  }
  // сигнатура формы для поиска повторов: выравнивание по главной оси, нормировка по площади, 32×32; сравнение с 4 отражениями
  function signature(s, sh) {
    const W = s.W, n = sh.n, ct = Math.cos(-sh.th), st = Math.sin(-sh.th), sc = 1 / Math.sqrt(n), G = 32, g = new Uint8Array(G * G);
    for (const i of sh.px) { const dx = (i % W) - sh.mx, dy = ((i / W) | 0) - sh.my, u = (dx * ct - dy * st) * sc, v = (dx * st + dy * ct) * sc, gx = Math.floor(u * 11 + G / 2), gy = Math.floor(v * 11 + G / 2); if (gx >= 0 && gx < G && gy >= 0 && gy < G) g[gy * G + gx] = 1; }
    return g;
  }
  function sigIoU(a, b) { const G = 32; let best = 0; for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { let I = 0, U = 0; for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const A = a[y * G + x], B = b[(fy ? G - 1 - y : y) * G + (fx ? G - 1 - x : x)]; if (A && B) I++; if (A || B) U++; } best = Math.max(best, U ? I / U : 0); } return best; }
  const share_ok = (v) => v >= 0.04;
  function metrics(s) {
    const W = s.W, cs = comps(s), land = cs.reduce((a, c) => a + c.n, 0), mains = cs.filter(c => c.cat === 'main' && c.n >= 0.012 * land).sort((a, b) => b.n - a.n), isl = cs.filter(c => c.cat === 'island'), arch = cs.filter(c => c.cat === 'arch');
    const ok = s.massifs.filter(m => !m.failed), placedMain = ok.filter(m => m.cat === 'main').length, mainComps = new Set(ok.filter(m => m.cat === 'main').map(m => m.comp)).size;
    const mainSum = mains.reduce((a, c) => a + c.n, 0), ms = mains.map(c => { const sh = shapeOf(s, c.c); return { share: c.n / (mainSum || 1), cls: c.cls, ovalIoU: r3(sh.iou), solidity: r3(sh.solidity), elong: r3(sh.elong), iso: r3(sh.perim / (2 * Math.sqrt(Math.PI * sh.n))), lobes: lobes(s, c.c), sig: share_ok(c.n / (mainSum || 1)) ? signature(s, sh) : null }; });
    const frag = cs.filter(c => c.cat === 'frag' || c.area < 0.0004), nMain = mains.length;
    return {
      K: s.K, W, ms: Math.round(s.ms), land: r3(s.landFraction), landErr: r3(s.landFraction / s.targetLand - 1), nComp: cs.length, nMain: mains.length, placedMain, mainComps, failed: s.massifs.filter(m => m.failed && m.cat === 'main').length, failedOpt: s.massifs.filter(m => m.failed && m.cat !== 'main').length, cleaned: s.report.cleaned, filled: s.report.filled, merges: s.report.merges.length,
      nIsl: isl.length, nArch: arch.length, tiny: frag.length, tinyArea: r3(frag.reduce((a, c) => a + c.n, 0) / land),
      topShare: r3(ms.length ? ms[0].share : 0), shares: ms.map(m => r3(m.share)), ovalIoU: ms.map(m => m.ovalIoU), solidity: ms.map(m => m.solidity), elong: ms.map(m => m.elong), iso: ms.map(m => m.iso), lobes: ms.map(m => m.lobes), classes: s.massifs.filter(m => m.cat === 'main').map(m => m.cls),
      thin1: r3(thinFrac(s, s.mask, 0.012 * W)), thin2: r3(thinFrac(s, s.mask, 0.03 * W)), sigs: ms.map(m => m.sig), retries: s.report.retries, reseeds: s.report.reseeds, shrinks: s.report.shrinks
    };
  }
  return { metrics, sigIoU, comps };
};
