// Правка суши вручную: мазок «добавить сушу» / «убрать сушу». Применяется к высотам до фьордов и катастроф (generator.js) и повторяется при каждом пересчёте
// из списка правок (state.landEdits) — как ручные катастрофы. Береговая линия — не след кисти, а изолиния фрактального шума вокруг пути мазка (три масштаба
// + сдвиг координат), поэтому берег рваный, с заливами, полуостровами и шхерами; у новой суши — мелководный шельф и пологий пляж, у вырезанной — спуск суши к воде.
(function (FM) {
  'use strict';
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // правка: { mode: 'add'|'del', pts: [[x, y], ...] (клетки), r: радиус кисти (клетки), rough: изрезанность 0..1 }
  function applyLandEdits(h, W, H, edits, mkRand) {
    edits.forEach((e, idx) => {
      if (!e || !e.pts || !e.pts.length) return;
      const nz = FM.makeNoise(mkRand(idx)), fbm = FM.fbm, r = Math.max(2, +e.r || 12), rough = clamp(e.rough == null ? 0.55 : +e.rough, 0, 1), add = e.mode !== 'del';
      // путь с равномерным шагом
      const P = [[e.pts[0][0], e.pts[0][1]]], step = Math.max(1, r * 0.3);
      for (let k = 1; k < e.pts.length; k++) {
        const a = e.pts[k - 1], b = e.pts[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / step);
        for (let q = 1; q <= n; q++) P.push([a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n]);
      }
      const M = Math.ceil(r * 1.9 + 4);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      x0 = Math.max(0, Math.floor(x0 - M)); y0 = Math.max(0, Math.floor(y0 - M)); x1 = Math.min(W - 1, Math.ceil(x1 + M)); y1 = Math.min(H - 1, Math.ceil(y1 + M));
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1; if (bw < 2 || bh < 2) return;
      const dmin = new Float32Array(bw * bh).fill(1e9);
      for (const p of P) {
        const ya = Math.max(y0, Math.floor(p[1] - M)), yb = Math.min(y1, Math.ceil(p[1] + M)), xa = Math.max(x0, Math.floor(p[0] - M)), xb = Math.min(x1, Math.ceil(p[0] + M));
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const d = Math.hypot(x - p[0], y - p[1]), j = (y - y0) * bw + (x - x0); if (d < dmin[j]) dmin[j] = d; }
      }
      const f1 = 1 / (r * 1.4), f2 = 1 / (r * 0.5), f3 = 1 / Math.max(2.5, r * 0.12), fw = 1 / (r * 2.2), fh = 1 / (r * 0.9);
      const s0 = new Float32Array(bw * bh);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const j = (y - y0) * bw + (x - x0), d = dmin[j]; if (d > r * 1.9) { s0[j] = -9; continue; }
        const wx = x + 0.55 * r * nz(x * fw + 91.3, y * fw + 7.1) * rough, wy = y + 0.55 * r * nz(x * fw + 13.7, y * fw + 55.9) * rough;   // сдвиг координат: убирает «круглость» мазка
        const N = 0.58 * fbm(nz, wx * f1 + 3.1, wy * f1 + 8.7, 2) + 0.38 * fbm(nz, wx * f2 + 41.3, wy * f2 + 17.9, 3) + 0.3 * fbm(nz, wx * f3 + 77.7, wy * f3 + 29.3, 3);
        s0[j] = 1 - d / r + rough * 1.5 * N;   // >0 — внутри; ноль — береговая линия
      }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const j = (y - y0) * bw + (x - x0), s = s0[j]; if (s <= -0.5) continue;
        const i = y * W + x;
        if (add) {
          if (s > 0) {
            const hill = 0.5 + 0.5 * fbm(nz, x * fh + 50.2, y * fh + 17.4, 3);
            const tgt = 0.02 + smooth(0, 0.6, s) * (0.1 + 0.4 * hill) + 0.35 * smooth(0.8, 1.5, s) * hill * hill;
            if (tgt > h[i]) h[i] = tgt;
          }
          const sh = s > 0 ? -1 : -0.02 - 0.5 * Math.pow(smooth(0, 0.45, -s), 1.3);   // мелководный шельф вокруг новой суши
          if (s <= 0 && sh > h[i]) h[i] = sh;
        } else if (s > 0) {
          const sea = -0.02 - 0.55 * smooth(0, 0.6, s); if (sea < h[i]) h[i] = sea;
        } else if (h[i] > 0) h[i] *= 0.1 + 0.9 * smooth(0, 0.4, -s);   // пологий спуск суши к новой воде
      }
    });
  }
  FM.applyLandEdits = applyLandEdits;
})(window.FM = window.FM || {});
