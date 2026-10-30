// Изрезанные берега: фьорды (узкие глубокие заливы в горных берегах высоких широт) и рии (затопленные речные долины, ветвящиеся, расширяются к устью).
// Работает с полем высот h после островов и до катастроф, климата и гидрологии: реки сами впадают в новые заливы.
// Свой поток ГСЧ: остальная география не зависит от этого шага при отсутствии подходящих берегов. Мир получает «характер» берега:
// часть миров почти без фьордов, часть — с богатыми фьордами; рии независимы от фьордов.
(function (FM) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // young, old — поля горообразования (молодые хребты / древние), crust не нужен. Возвращает {events, mask}: mask (Uint8, 0..255) — где контур берега нельзя «сглаживать»
  FM.carveInlets = function (h, W, H, young, old, rand) {
    const N = W * H, s = W / 480, events = [], mask = new Float32Array(N);
    const R = (a, b) => a + (b - a) * rand();
    const u1 = rand(), u2 = rand();
    const Ff = u1 < 0.3 ? 0 : 0.35 + 0.65 * rand(), Fr = u2 < 0.35 ? 0 : 0.3 + 0.7 * rand();    // «характер» мира: ~30% без фьордов, ~35% без рий
    if (Ff === 0 && Fr === 0) return { events, mask: null };
    const wm = new Uint8Array(N); for (let i = 0; i < N; i++) wm[i] = h[i] <= 0 ? 1 : 0;
    const dsea = FM.edt(wm, W, H);
    const rel = new Float32Array(N); for (let i = 0; i < N; i++) rel[i] = young[i] + 0.8 * old[i] + 0.35 * clamp(h[i], 0, 1.2);
    FM.blur(rel, W, H, Math.max(2, Math.round(4 * s)));
    const dsm = Float32Array.from(dsea); FM.blur(dsm, W, H, Math.max(2, Math.round(2 * s)));
    const landAt = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 2 && yi >= 2 && xi < W - 2 && yi < H - 2 && h[yi * W + xi] > 0; };
    // «открытый океан»: вода, связанная с рамкой карты через проход шире 2·Rw клеток. Внутренние моря, замкнутые заливы и озёра за узкими проливами фьордов и рий не получают
    // (раньше любой берег с h ≤ 0 годился, и узкие рукава появлялись вокруг внутренних морей и озёр).
    const Rw = Math.max(2, Math.round(3 * s)), lm = new Uint8Array(N); for (let i = 0; i < N; i++) lm[i] = h[i] > 0 ? 1 : 0;
    const dland = FM.edt(lm, W, H), core = new Uint8Array(N), stk = [];
    for (let i = 0; i < N; i++) if (h[i] <= 0 && dland[i] >= Rw) core[i] = 1;
    const seen = new Uint8Array(N), fr = Math.max(3, Math.round(3 * s));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x < fr || y < fr || x >= W - fr || y >= H - fr) && core[y * W + x] && !seen[y * W + x]) { seen[y * W + x] = 1; stk.push(y * W + x); }
    while (stk.length) { const i = stk.pop(), x = i % W, y = (i / W) | 0; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && core[j] && !seen[j]) { seen[j] = 1; stk.push(j); } }
    const dcore = FM.edt(seen, W, H), openSea = (j) => h[j] <= 0 && dcore[j] <= Rw + 1.5;
    // кандидаты: береговые клетки суши у открытого океана
    const cand = [];
    for (let y = Math.round(H * 0.07); y < H * 0.93; y++) for (let x = Math.round(W * 0.06); x < W * 0.94; x++) {
      const i = y * W + x; if (h[i] <= 0) continue;
      if (openSea(i - 1) || openSea(i + 1) || openSea(i - W) || openSea(i + W)) cand.push(i);
    }
    for (let k = cand.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)), t = cand[k]; cand[k] = cand[j]; cand[j] = t; }   // случайный порядок
    const starts = [];
    const near = (x, y, d) => starts.some(q => (q.x - x) ** 2 + (q.y - y) ** 2 < d * d);
    let nF = 0, nR = 0; const capF = Math.round((3 + 6 * Ff) * Math.max(1, s)), capR = Math.round((4 + 8 * Fr) * Math.max(1, s));
    // дно залива: глубже у моря, мельче к вершине; стенки фьорда круче (небольшой подъём по краям)
    const carve = (pts, rs, depth, wall) => {
      for (let k = 0; k < pts.length; k++) {
        const [px, py] = pts[k], r = rs[k], reach = Math.ceil(r * 2.6);
        for (let yy = Math.max(0, Math.floor(py) - reach); yy <= Math.min(H - 1, Math.floor(py) + reach); yy++) for (let xx = Math.max(0, Math.floor(px) - reach); xx <= Math.min(W - 1, Math.floor(px) + reach); xx++) {
          const d = Math.hypot(xx - px, yy - py), i = yy * W + xx; if (d > reach) continue;
          if (d < r) { const t = smooth(0.55, 1, d / r), tg = depth + (h[i] - depth) * t * t; if (h[i] > 0 && tg < h[i]) h[i] = tg; mask[i] = Math.max(mask[i], 1); }
          else if (h[i] > 0) { h[i] += wall * Math.exp(-Math.pow((d - 1.5 * r) / (0.7 * r), 2)); mask[i] = Math.max(mask[i], 0.7 * Math.exp(-Math.pow((d - r) / r, 2))); }
        }
      }
    };
    // ломаная от берега вглубь по градиенту расстояния до моря с лёгкими изгибами; возвращает точки или null
    const trace = (x, y, L, wander, ang0) => {
      let ang = ang0; const pts = [];
      for (let st = 0; st < L; st++) {
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 3 || yi < 3 || xi > W - 4 || yi > H - 4) break;
        if (st > 2 && h[yi * W + xi] <= 0) break;
        pts.push([x, y]);
        const gx = dsm[yi * W + xi + 1] - dsm[yi * W + xi - 1], gy = dsm[(yi + 1) * W + xi] - dsm[(yi - 1) * W + xi];
        if (Math.hypot(gx, gy) > 1e-3) { const da = Math.atan2(gy, gx); let df = da - ang; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; ang += clamp(df, -0.2, 0.2) * 0.35; }
        ang += (rand() - 0.5) * wander;
        x += Math.cos(ang); y += Math.sin(ang);
      }
      return pts;
    };
    for (const i of cand) {
      if (nF >= capF && nR >= capR) break;
      const x = i % W, y = (i / W) | 0, lat = Math.abs(y / H - 0.5) * 2, m = rel[i];
      const pf = Ff * smooth(0.38, 0.65, lat) * smooth(0.1, 0.4, m), pr = Fr * smooth(0.06, 0.25, m) * (1 - smooth(0.55, 0.85, lat)) * (1 - 0.7 * smooth(0.5, 0.9, m));
      const kind = rand() < pf / Math.max(1e-6, pf + pr) ? 'fjord' : 'ria';
      const p = kind === 'fjord' ? pf : pr;
      if (rand() > p * 0.13) continue;
      if (kind === 'fjord' ? nF >= capF : nR >= capR) continue;
      if (near(x, y, (kind === 'fjord' ? 9 : 6) * s)) continue;
      // начальное направление — от воды (градиент расстояния)
      const gx = dsm[i + 1] - dsm[i - 1], gy = dsm[i + W] - dsm[i - W]; if (Math.hypot(gx, gy) < 1e-3) continue;
      const ang0 = Math.atan2(gy, gx);
      if (kind === 'fjord') {
        const L = Math.round(R(16, 34) * s), pts = trace(x, y, L, 0.55, ang0); if (pts.length < 10 * s) continue;
        const r0 = R(1.9, 2.7) * s, ph = rand() * 6.3, rs = pts.map((_, k) => r0 * (1.25 - 0.8 * k / pts.length) * (1 + 0.22 * Math.sin(k * 0.55 + ph)));
        carve(pts, rs, -0.32, 0.10); nF++;
        const nbF = rand() < 0.65 ? 1 + (rand() < 0.4 ? 1 : 0) : 0;
        for (let b = 0; b < nbF; b++) {   // короткие боковые рукава (как Хардангер-фьорд)
          const k0 = Math.floor(pts.length * R(0.35, 0.75)), side = rand() < 0.5 ? -1 : 1, bp = trace(pts[k0][0], pts[k0][1], Math.round(pts.length * R(0.3, 0.5)), 0.5, Math.atan2(pts[Math.min(pts.length - 1, k0 + 1)][1] - pts[k0][1], pts[Math.min(pts.length - 1, k0 + 1)][0] - pts[k0][0]) + side * R(0.9, 1.3));
          if (bp.length > 4 * s) carve(bp, bp.map((_, k) => r0 * 0.6 * (1 - 0.6 * k / bp.length)), -0.28, 0.08);
        } starts.push({ x, y }); events.push({ kind: 'fjord', x, y, pts: pts.filter((_, k) => k % 3 === 0) });
      } else {
        const L = Math.round(R(9, 20) * s), pts = trace(x, y, L, 0.5, ang0); if (pts.length < 5 * s) continue;
        const r0 = R(2.4, 3.4) * s, rs = pts.map((_, k) => r0 * (1 - 0.6 * k / pts.length));
        carve(pts, rs, -0.2, 0.03);
        const nb = rand() < 0.6 ? 1 + (rand() < 0.4 ? 1 : 0) : 0;
        for (let b = 0; b < nb; b++) {   // боковые рукава: дендритный рисунок затопленной речной сети
          const k0 = Math.floor(pts.length * R(0.3, 0.65)), side = rand() < 0.5 ? -1 : 1, bp = trace(pts[k0][0], pts[k0][1], Math.round(pts.length * 0.55), 0.5, ang0 + side * R(0.7, 1.1));
          if (bp.length > 4 * s) carve(bp, bp.map((_, k) => r0 * 0.55 * (1 - 0.6 * k / bp.length)), -0.15, 0.02);
        }
        nR++; starts.push({ x, y }); events.push({ kind: 'ria', x, y, pts: pts.filter((_, k) => k % 3 === 0) });
      }
    }
    if (!events.length) return { events, mask: null };
    FM.blur(mask, W, H, 1);
    const m8 = new Uint8Array(N); for (let i = 0; i < N; i++) m8[i] = Math.round(clamp(mask[i] * 1.6, 0, 1) * 255);
    return { events, mask: m8 };
  };
})(window.FM = window.FM || {});
