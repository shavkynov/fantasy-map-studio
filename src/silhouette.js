// Силуэты суши v3 (ПРОТОТИП, этап 2). Не подключён к generator.js и index.html; зависит только от rng.js (FM.mulberry32, FM.hashString, FM.makeNoise, FM.fbm).
// Строит маску суши и знаковое поле расстояний D (в клетках, + суша, − море) БЕЗ тектоники, климата и оформления.
//   FM.silhouette({ seed, W, H, continents: K, landRatio, islands, archipelagos }) -> { L, D, mask, owner, massifs, report, ms, ... }
// Принципы (docs: «План генератора континентов v3 (уточнённый)»):
//  1. композиция: K основных материков + крупные острова + архипелаги, размеры по закону, положение — лучшая из кандидатов;
//  2. класс — каркас (ось с профилем ширины / ячейки Вороного / ответвления / внутреннее море), силуэт даёт пространственно неоднородная деформация;
//  3. зазоры между массивами зависят от их размеров; при пересечении — перенос и повторное размещение, автоматических разрезов нет;
//  4. береговая деталь — ограниченное смещение контура (поле L ≈ расстояние), внутренняя неровность рельефа отдельно (см. reliefPreview);
//  5. D считается от L с субпиксельной поправкой, знак D всегда совпадает со знаком L (связность не меняется).
// Все размеры задаются в долях ширины карты (u = x/W, v = y/W), поэтому форма одинакова при любом разрешении.
(function (FM) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const sub = (seed, tag) => FM.mulberry32(FM.hashString(seed + '|' + tag));
  const TAU = Math.PI * 2, INF = 1e12;
  const G = 288, E = 2.4;               // локальная сетка класса: G×G клеток на квадрат q ∈ [−E, E]² (q — безразмерные координаты массива, единица = радиус массива)
  const GS = 2 * E / G;

  // ---------- расстояния ----------
  // квадрат евклидова расстояния по начальным значениям f (Felzenszwalb); f = 0 у источников, INF вне; границы карты источниками НЕ являются
  function edtInit(fin, W, H) {
    const N = W * H, g = new Float64Array(N), n = Math.max(W, H);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    function pass(len) {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    }
    for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = fin[y * W + x]; pass(H); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
    const out = new Float32Array(N);
    for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; pass(W); for (let x = 0; x < W; x++) out[y * W + x] = Math.min(1e5, Math.sqrt(d[x])); }
    return out;
  }
  // расстояние до маски (клетки), 0 внутри маски
  function distToMask(mask, W, H) { const f = new Float64Array(W * H); for (let i = 0; i < f.length; i++) f[i] = mask[i] ? 0 : INF; return edtInit(f, W, H); }
  // Знаковое расстояние с субпиксельной поправкой. L — любое поле со знаком (L > 0 — суша).
  //  • вдали от берега: D = (расстояние между центрами клеток до ближайшей клетки противоположного знака) − 0,5 (контур лежит посередине между ними);
  //  • у самого контура (клетка с соседом другого знака): D = расстояние до контура L = 0 по линейной интерполяции вдоль ребра, t = |La| / (|La| + |Lb|).
  // Знак D всегда берётся из L, поэтому маска (D > 0) ≡ маска (L > 0): связность и топология не меняются. Рамка карты источником не является.
  function sdf(L, W, H) {
    const N = W * H, land = new Uint8Array(N), sea = new Uint8Array(N); let nl = 0;
    for (let i = 0; i < N; i++) { if (L[i] > 0) { land[i] = 1; nl++; } else sea[i] = 1; }
    const D = new Float32Array(N);
    if (nl === 0) { D.fill(-1e5); return D; } if (nl === N) { D.fill(1e5); return D; }
    const toSea = distToMask(sea, W, H), toLand = distToMask(land, W, H);
    for (let i = 0; i < N; i++) D[i] = land[i] ? Math.max(0.05, toSea[i] - 0.5) : -Math.max(0.05, toLand[i] - 0.5);
    const near = new Float32Array(N).fill(9);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = land[i] === 1;
      if (x < W - 1) { const j = i + 1; if ((land[j] === 1) !== a) { const s = Math.abs(L[i]) + Math.abs(L[j]), t = s > 0 ? Math.abs(L[i]) / s : 0.5; if (t < near[i]) near[i] = t; if (1 - t < near[j]) near[j] = 1 - t; } }
      if (y < H - 1) { const j = i + W; if ((land[j] === 1) !== a) { const s = Math.abs(L[i]) + Math.abs(L[j]), t = s > 0 ? Math.abs(L[i]) / s : 0.5; if (t < near[i]) near[i] = t; if (1 - t < near[j]) near[j] = 1 - t; } }
    }
    for (let i = 0; i < N; i++) if (near[i] < 9) { const d = Math.max(0.02, near[i]); D[i] = land[i] ? d : -d; }
    return D;
  }

  // ---------- локальные сетки классов ----------
  const smax = (a, b, k) => { if (k <= 0) return Math.max(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
  const smin = (a, b, k) => -smax(-a, -b, k);
  const qAt = (i) => -E + (i + 0.5) * GS;
  // F0 из каркаса-ломаной: F = полуширина − расстояние до оси; ширина слева и справа разная
  function rasterSkeleton(F0, pts, wl, wr, k) {
    const n = pts.length, T = [], cap = [];
    for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; T.push([(b[0] - a[0]) / l, (b[1] - a[1]) / l]); }
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, wm = 0;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, pts[i][0]); x1 = Math.max(x1, pts[i][0]); y0 = Math.min(y0, pts[i][1]); y1 = Math.max(y1, pts[i][1]); wm = Math.max(wm, wl[i], wr[i]); }
    const ix0 = clamp(Math.floor((x0 - wm + E) / GS) - 1, 0, G - 1), ix1 = clamp(Math.ceil((x1 + wm + E) / GS) + 1, 0, G - 1), iy0 = clamp(Math.floor((y0 - wm + E) / GS) - 1, 0, G - 1), iy1 = clamp(Math.ceil((y1 + wm + E) / GS) + 1, 0, G - 1);
    for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const qx = qAt(ix), qy = qAt(iy);
      let bd = 1e9, bi = 0;
      for (let i = 0; i < n; i++) { const d = (pts[i][0] - qx) ** 2 + (pts[i][1] - qy) ** 2; if (d < bd) { bd = d; bi = i; } }
      // уточнение: проекция на соседние отрезки
      let best = Math.sqrt(bd), side = (qx - pts[bi][0]) * T[bi][1] * -1 + (qy - pts[bi][1]) * T[bi][0], hw = 0, wi = bi;
      for (const j of [bi - 1, bi]) {
        if (j < 0 || j >= n - 1) continue;
        const ax = pts[j][0], ay = pts[j][1], dx = pts[j + 1][0] - ax, dy = pts[j + 1][1] - ay, l2 = dx * dx + dy * dy || 1e-9, t = clamp(((qx - ax) * dx + (qy - ay) * dy) / l2, 0, 1);
        const px = ax + dx * t, py = ay + dy * t, dd = Math.hypot(qx - px, qy - py);
        if (dd <= best + 1e-9) { best = dd; side = dx * (qy - py) - dy * (qx - px); wi = j + t; }
      }
      const j0 = Math.min(n - 2, Math.floor(wi)), tt = wi - j0;
      const L = wl[j0] + (wl[j0 + 1] - wl[j0]) * tt, Rw = wr[j0] + (wr[j0 + 1] - wr[j0]) * tt;
      hw = side >= 0 ? L : Rw;
      const v = hw - best, idx = iy * G + ix;
      F0[idx] = k > 0 ? smax(F0[idx], v, k) : Math.max(F0[idx], v);
    }
  }
  // Catmull-Rom по контрольным точкам -> n точек
  function spline(cp, n) {
    const out = [], m = cp.length - 1;
    for (let s = 0; s < n; s++) {
      const u = s / (n - 1) * m, i = Math.min(m - 1, Math.floor(u)), t = u - i;
      const p0 = cp[Math.max(0, i - 1)], p1 = cp[i], p2 = cp[i + 1], p3 = cp[Math.min(m, i + 2)];
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
    return out;
  }
  // 1D гладкая случайная функция на [0, 1]
  function wave1(r, nk) { const v = []; for (let i = 0; i <= nk; i++) v.push(r() * 2 - 1); return (t) => { const u = clamp(t, 0, 1) * nk, i = Math.min(nk - 1, Math.floor(u)), f = u - i, s = f * f * (3 - 2 * f); return v[i] * (1 - s) + v[i + 1] * s; }; }

  // крупные доли вытянутого каркаса: 1–3 боковые ветви соизмеримой ширины (не тонкие отростки), от разных мест оси и в разные стороны; между ветвями остаются заливы масштаба материка
  function addLobes(F0, pts, r, base) {
    const R = (a, b) => a + (b - a) * r(), n = pts.length, nl = ELONG.lobes.n0 + Math.floor(r() * (ELONG.lobes.n1 - ELONG.lobes.n0 + 1)), used = []; let side = r() < 0.5 ? 1 : -1;
    for (let l = 0; l < nl; l++) {
      let t = 0.5, ok = false; for (let k = 0; k < 30 && !ok; k++) { t = R(0.15, 0.85); ok = used.every(u => Math.abs(u - t) > ELONG.lobes.sep); } if (!ok) break; used.push(t);
      const i0 = Math.round(t * (n - 1)), a = pts[Math.max(0, i0 - 1)], b = pts[Math.min(n - 1, i0 + 1)], tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / tl, ty = (b[1] - a[1]) / tl;
      const ang = Math.atan2(ty, tx) + side * R(0.9, 1.45), len = R(ELONG.lobes.l0, ELONG.lobes.l1), bw = Math.max(ELONG.lobes.wmin || 0.2, base * R(0.7, 1.15)), bend = R(-0.5, 0.5), m = 40, bp = [], wl = [], wr = [], wv = wave1(r, 3);
      let px = pts[i0][0], py = pts[i0][1], ca = ang;
      for (let i = 0; i < m; i++) { const u = i / (m - 1); bp.push([px, py]); ca += bend * len / m * (0.4 + 0.6 * wv(u) + 0.6); px += Math.cos(ca) * len / m; py += Math.sin(ca) * len / m; const w = Math.max(0.07, bw * (0.55 + 0.45 * Math.pow(Math.sin(Math.PI * clamp(0.3 + 0.7 * u, 0.02, 0.98)), 0.7)) * (1 - (ELONG.lobes.tail == null ? 0.55 : ELONG.lobes.tail) * Math.pow(u, 3))), aa = 0.25 * wv(u); wl.push(w * (1 + aa)); wr.push(w * (1 - aa)); }
      const lobe = new Float32Array(G * G).fill(-9); rasterSkeleton(lobe, bp, wl, wr, 0.05);
      for (let i = 0; i < G * G; i++) F0[i] = smax(F0[i], lobe[i], ELONG.lobes.blend);
      side = -side;
    }
  }
  // вытянутый каркас: изогнутая ось, профиль ширины с несколькими неравными расширениями и сужениями, разная ширина сторон
  function buildElongated(F0, r, o) {
    o = o || {};
    const R = (a, b) => a + (b - a) * r(), len = (o.len || R(1.5, 2.2)), bend = R(0.06, 0.3), nc = 4 + Math.floor(r() * 2);
    const cp = []; const ph = r() * TAU; const wv = wave1(r, 3);
    for (let i = 0; i < nc; i++) { const t = i / (nc - 1); cp.push([(t - 0.5) * len, bend * len * 0.5 * (wv(t) * 0.8 + Math.sin(ph + t * 2.2) * 0.4)]); }
    const n = 72, pts = spline(cp, n), wl = [], wr = [];
    const nb = ELONG.rich ? 3 + Math.floor(r() * 4) : 2 + Math.floor(r() * 3), bumps = []; for (let i = 0; i < nb; i++) bumps.push([r(), R(0.08, 0.22), R(-0.5, 0.95)]);
    const base = (o.width || (ELONG.rich ? R(0.22, 0.44) : R(0.26, 0.42))), as = wave1(r, 4), as2 = wave1(r, 9), a2 = R(0.12, 0.3);   // as2/a2: боковые заливы и мысы вдоль оси (деформация без складок крупных заливов дать не может)
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), tap = 0.18 + 0.82 * Math.pow(Math.sin(Math.PI * clamp(t, 0.02, 0.98)), 0.6);
      let m = 1; for (const b of bumps) m += b[2] * Math.exp(-(((t - b[0]) / b[1]) ** 2));
      const w = Math.max(0.07, base * tap * clamp(m, 0.45, 1.9)), a = 0.33 * as(t) + (ELONG.rich ? a2 * as2(t) : 0);
      wl.push(w * (1 + a)); wr.push(w * (1 - a));
    }
    rasterSkeleton(F0, pts, wl, wr, 0.05);
    if (ELONG.lobes && !o.noLobes) addLobes(F0, pts, r, base);
    return { pts, kind: 'elong' };
  }
  // ячейки Вороного → связный набор ячеек, нарастающий от центра («клеточная аккреция»). Возвращает бинарную маску на локальной сетке
  function cellMask(r, nSeeds, rho, frac, off) {
    const R = (a, b) => a + (b - a) * r(), seeds = [], mind = rho * 0.55 / Math.sqrt(nSeeds / 6);
    for (let t = 0; t < 400 && seeds.length < nSeeds; t++) { const a = r() * TAU, d = rho * Math.sqrt(r()); const p = [Math.cos(a) * d + (off ? off[0] : 0), Math.sin(a) * d + (off ? off[1] : 0)]; if (seeds.every(s => Math.hypot(s[0] - p[0], s[1] - p[1]) > mind)) seeds.push(p); }
    const noise = FM.makeNoise(r), lab = new Int16Array(G * G), n = seeds.length;
    for (let iy = 0; iy < G; iy++) for (let ix = 0; ix < G; ix++) {
      const qx = qAt(ix), qy = qAt(iy), wx = qx + 0.16 * FM.fbm(noise, qx * 1.7, qy * 1.7, 2), wy = qy + 0.16 * FM.fbm(noise, qx * 1.7 + 31, qy * 1.7 + 17, 2);
      let bd = 1e9, bi = 0; for (let k = 0; k < n; k++) { const d = (seeds[k][0] - wx) ** 2 + (seeds[k][1] - wy) ** 2; if (d < bd) { bd = d; bi = k; } }
      lab[iy * G + ix] = bd > (mind * 1.7) ** 2 ? -1 : bi;   // ячейка ограничена по размеру: внешние ячейки Вороного бесконечны и дали бы прямоугольники у края сетки
    }
    const adj = Array.from({ length: n }, () => new Set());
    for (let iy = 0; iy < G - 1; iy++) for (let ix = 0; ix < G - 1; ix++) { const a = lab[iy * G + ix], b = lab[iy * G + ix + 1], c = lab[(iy + 1) * G + ix]; if (a >= 0 && b >= 0 && a !== b) { adj[a].add(b); adj[b].add(a); } if (a >= 0 && c >= 0 && a !== c) { adj[a].add(c); adj[c].add(a); } }
    let start = 0, sb = 1e9; for (let k = 0; k < n; k++) { const d = Math.hypot(seeds[k][0] - (off ? off[0] : 0), seeds[k][1] - (off ? off[1] : 0)); if (d < sb) { sb = d; start = k; } }
    const inS = new Set([start]), target = Math.max(3, Math.round(n * frac));
    while (inS.size < target) {
      const fr = []; for (const k of inS) for (const m of adj[k]) if (!inS.has(m)) fr.push(m);
      if (!fr.length) break;
      let tot = 0; const w = fr.map(m => { const d = Math.hypot(seeds[m][0] - (off ? off[0] : 0), seeds[m][1] - (off ? off[1] : 0)), q = Math.exp(-d * d / (0.55 * rho * rho) * 0.9) + 0.03; tot += q; return q; });
      let u = r() * tot, pick = fr[0]; for (let i = 0; i < fr.length; i++) { u -= w[i]; if (u <= 0) { pick = fr[i]; break; } }
      inS.add(pick);
    }
    const mask = new Uint8Array(G * G); for (let i = 0; i < G * G; i++) if (inS.has(lab[i])) mask[i] = 1;
    return mask;
  }
  function maskToF(mask) { const L = new Float32Array(G * G); for (let i = 0; i < G * G; i++) L[i] = mask[i] ? 1 : -1; const D = sdf(L, G, G); for (let i = 0; i < D.length; i++) D[i] *= GS; return D; }
  function buildCompact(F0, r, o) {
    o = o || {};
    const n = 12 + Math.floor(r() * 12), rho = (o.rho || 1.05), frac = 0.42 + 0.3 * r(), m = cellMask(r, n, rho, frac), D = maskToF(m);
    for (let i = 0; i < G * G; i++) F0[i] = Math.max(F0[i], D[i]);
    return { kind: 'compact' };
  }
  // тело + 1–3 ответвления, растущие из берега под углом к нормали и входящие в тело сглаженным объединением
  function buildPeninsular(F0, r, o) {
    const R = (a, b) => a + (b - a) * r(), body = new Float32Array(G * G).fill(-9);
    if (r() < 0.5) buildCompact(body, r, { rho: R(0.85, 1.05) }); else buildElongated(body, r, { len: R(1.3, 1.8), width: R(0.34, 0.5) });
    // центроид и точки берега
    let sx = 0, sy = 0, sn = 0; for (let iy = 0; iy < G; iy++) for (let ix = 0; ix < G; ix++) if (body[iy * G + ix] > 0) { sx += qAt(ix); sy += qAt(iy); sn++; }
    sx /= sn || 1; sy /= sn || 1;
    const edge = []; for (let iy = 2; iy < G - 2; iy++) for (let ix = 2; ix < G - 2; ix++) { const v = body[iy * G + ix]; if (v > 0 && v < GS * 1.2) { const gx = body[iy * G + ix + 2] - body[iy * G + ix - 2], gy = body[(iy + 2) * G + ix] - body[(iy - 2) * G + ix], gl = Math.hypot(gx, gy); if (gl > 1e-6) edge.push([qAt(ix), qAt(iy), -gx / gl, -gy / gl]); } }
    for (let i = 0; i < G * G; i++) F0[i] = body[i];
    const nl = 1 + Math.floor(r() * 3), used = [];
    for (let l = 0; l < nl && edge.length; l++) {
      let pick = null;
      for (let t = 0; t < 60; t++) { const e = edge[Math.floor(r() * edge.length)], a = Math.atan2(e[1] - sy, e[0] - sx); if (used.every(u => Math.abs(Math.atan2(Math.sin(a - u), Math.cos(a - u))) > 1.25)) { pick = e; used.push(a); break; } }
      if (!pick) break;
      const ang = Math.atan2(pick[3], pick[2]) + R(-0.55, 0.55), len = R(0.6, 1.15), bw = R(0.22, 0.34), bendA = R(-0.7, 0.7), n = 40, pts = [], wl = [], wr = [], wv = wave1(r, 3), bp = r();
      let px = pick[0] - pick[2] * 0.25, py = pick[1] - pick[3] * 0.25, a = ang;
      for (let i = 0; i < n; i++) { const t = i / (n - 1); pts.push([px, py]); a += bendA * len / n * (0.6 + 0.8 * wv(t) * 0.5 + 0.4); px += Math.cos(a) * len / n; py += Math.sin(a) * len / n; const w = Math.max(0.05, bw * (1 - 0.82 * Math.pow(t, 0.8)) * (1 + 0.35 * Math.exp(-(((t - bp) / 0.18) ** 2)) + 0.25 * wv(t))); wl.push(w * (1 + 0.2 * wv(t))); wr.push(w * (1 - 0.2 * wv(t))); }
      const limb = new Float32Array(G * G).fill(-9); rasterSkeleton(limb, pts, wl, wr, 0);
      for (let i = 0; i < G * G; i++) F0[i] = smax(F0[i], limb[i], bw * 0.9);
    }
    return { kind: 'peninsular' };
  }
  // тело с внутренним морем: вырез из ячеек внутри (с горлом-заливом или закрытый). Автоматических проливов между массивами нет
  function buildFragmented(F0, r, o) {
    const R = (a, b) => a + (b - a) * r();
    buildCompact(F0, r, { rho: R(1.1, 1.3) });
    const a = r() * TAU, d = R(0.18, 0.4), off = [Math.cos(a) * d, Math.sin(a) * d], m = cellMask(r, 7 + Math.floor(r() * 5), R(0.4, 0.55), R(0.45, 0.7), off), S = maskToF(m);
    for (let i = 0; i < G * G; i++) F0[i] = smin(F0[i], -S[i] - 0.03, 0.06);
    if (r() < 0.55) {   // горло: изогнутый коридор от внутреннего моря наружу
      const ang = r() * TAU, n = 36, pts = [], wl = [], wr = []; let px = off[0], py = off[1], aa = ang; const bend = R(-0.5, 0.5), wv = wave1(r, 3);
      for (let i = 0; i < n; i++) { pts.push([px, py]); aa += bend / n * 3 * (0.5 + 0.5 * wv(i / n)); px += Math.cos(aa) * 2.2 / n; py += Math.sin(aa) * 2.2 / n; const w = R(0.05, 0.08) * (1 + 0.4 * wv(i / n)) * (0.7 + 0.5 * i / n); wl.push(w); wr.push(w); }
      const cor = new Float32Array(G * G).fill(-9); rasterSkeleton(cor, pts, wl, wr, 0);
      for (let i = 0; i < G * G; i++) F0[i] = smin(F0[i], -cor[i], 0.04);
    }
    return { kind: 'fragmented' };
  }
  // архипелаг: острова по дуге, размеры по степенному закону, вытянуты вдоль дуги
  function buildArchipelago(F0, r) {
    const R = (a, b) => a + (b - a) * r(), n = 7 + Math.floor(r() * 9), arcR = R(0.9, 1.5), a0 = r() * TAU, sweep = R(0.7, 1.7) * (r() < 0.5 ? 1 : -1), pw = R(0.8, 1.15), rmax = R(0.2, 0.3), placed = [];
    for (let i = 0; i < n; i++) {
      const sr = rmax * Math.pow(i + 1, -pw); let best = null;
      for (let t = 0; t < 40; t++) {
        const u = r(), a = a0 + sweep * u, rad = arcR * (1 + R(-0.25, 0.25)), cx = Math.cos(a) * rad - Math.cos(a0 + sweep * 0.5) * arcR * 0.55, cy = Math.sin(a) * rad - Math.sin(a0 + sweep * 0.5) * arcR * 0.55;
        if (Math.abs(cx) > 1.7 || Math.abs(cy) > 1.7) continue;
        if (placed.every(p => Math.hypot(p.x - cx, p.y - cy) > (p.r + sr) * 1.15)) { best = [cx, cy, a]; break; }
      }
      if (!best) continue; placed.push({ x: best[0], y: best[1], r: sr });
      const tg = best[2] + Math.PI / 2 + R(-0.5, 0.5), L = sr * R(1.0, 1.9), hw = sr * R(0.45, 0.8), nn = 14, pts = [], wl = [], wr = [], wv = wave1(r, 3);
      for (let k = 0; k < nn; k++) { const t = k / (nn - 1) - 0.5; pts.push([best[0] + Math.cos(tg) * L * t + Math.cos(tg + 1.57) * L * 0.18 * Math.sin(t * 3), best[1] + Math.sin(tg) * L * t + Math.sin(tg + 1.57) * L * 0.18 * Math.sin(t * 3)]); const w = Math.max(0.025, hw * (0.25 + 0.75 * Math.pow(Math.cos(t * Math.PI * 0.95), 0.7)) * (1 + 0.3 * wv(k / nn))); wl.push(w); wr.push(w * 0.9); }
      rasterSkeleton(F0, pts, wl, wr, 0);
    }
    return { kind: 'archipelago' };
  }
  const BUILD = { elong: buildElongated, compact: buildCompact, peninsular: buildPeninsular, fragmented: buildFragmented, arch: buildArchipelago };

  // ---------- связные компоненты (4-соседство) ----------
  function label(mask, W, H) {
    const N = W * H, lab = new Int32Array(N).fill(-1), st = new Int32Array(N), sizes = []; let nc = 0;
    for (let s0 = 0; s0 < N; s0++) {
      if (!mask[s0] || lab[s0] >= 0) continue;
      let sp = 0, cnt = 0; st[sp++] = s0; lab[s0] = nc;
      while (sp) { const i = st[--sp]; cnt++; const x = i % W;
        if (x > 0 && mask[i - 1] && lab[i - 1] < 0) { lab[i - 1] = nc; st[sp++] = i - 1; }
        if (x < W - 1 && mask[i + 1] && lab[i + 1] < 0) { lab[i + 1] = nc; st[sp++] = i + 1; }
        if (i >= W && mask[i - W] && lab[i - W] < 0) { lab[i - W] = nc; st[sp++] = i - W; }
        if (i < N - W && mask[i + W] && lab[i + W] < 0) { lab[i + W] = nc; st[sp++] = i + W; } }
      sizes.push(cnt); nc++;
    }
    return { lab, sizes, n: nc };
  }

  // ---------- спецификация массива: каркас (F0) + деформация ----------
  // Минимальная ширина каркаса (в клетках G): раскрытие радиусом RHO убирает перемычки и нити тоньше 2·RHO+1 клетки. Это условие в единицах q, а не пикселей,
  // поэтому оно не зависит от разрешения карты (раньше перемычка в 1–2 клетки G рвалась при 480 пикселях и держалась при 960).
  // Убираются только куски площадью ≥ RMIN клеток (скругление углов раскрытием в расчёт не идёт).
  const RHO = 2, RMIN = 10, FILT = { thin: true, holes: true };
  function thinParts(m, g) {
    g = g || G; const rho = Math.max(1, Math.round(RHO * g / G)), rmin = Math.round(RMIN * (g / G) * (g / G)), n2 = g * g;
    const inv = new Uint8Array(n2); for (let i = 0; i < n2; i++) inv[i] = m[i] ? 0 : 1;
    const ds = distToMask(inv, g, g), er = new Uint8Array(n2); for (let i = 0; i < n2; i++) if (m[i] && ds[i] >= rho + 0.5) er[i] = 1;
    const de = distToMask(er, g, g), rem = new Uint8Array(n2); for (let i = 0; i < n2; i++) if (m[i] && de[i] > rho + 0.5) rem[i] = 1;
    const lr = label(rem, g, g), out = new Uint8Array(n2); let n = 0; for (let i = 0; i < n2; i++) if (lr.lab[i] >= 0 && lr.sizes[lr.lab[i]] >= rmin) { out[i] = 1; n++; }
    return { out, n };
  }
  // замкнутые морские карманы каркаса (не касаются границы сетки) площадью ≥ 0,4% суши: намеренны только у класса fragmented (внутреннее море), у остальных — случайное замыкание залива
  function bigHoles(m, tot) {
    const inv = new Uint8Array(G * G); for (let i = 0; i < G * G; i++) inv[i] = m[i] ? 0 : 1;
    const ls = label(inv, G, G), touch = new Uint8Array(ls.n); for (let x = 0; x < G; x++) { touch[ls.lab[x]] = 1; touch[ls.lab[(G - 1) * G + x]] = 1; touch[ls.lab[x * G]] = 1; touch[ls.lab[x * G + G - 1]] = 1; }
    let n = 0; for (let k = 0; k < ls.n; k++) if (!touch[k] && ls.sizes[k] >= 0.004 * tot) n++; return n;
  }
  // Крупные заливы как явная деталь каркаса. Складки деформации, которые раньше давали заливы, запрещены (иначе рвётся форма), а без них массив выпуклый
  // (замер: периметр/площадь 1,54 против 1,80, компактность 0,73 против 0,68). Залив — отрезок внутрь от берега по нормали; глубина — доля толщины массива вдоль этого отрезка
  // (0,25–0,5), поэтому массив не разрезается; профиль ширины: «бухта» (широкое устье сужается) или «бассейн» (узкое устье, широкая внутренность, С-образная форма).
  const GULF = { pBasin: 0.6, d0: 0.2, d1: 0.4, w0: 0.15, w1: 0.3, nmax: 0, nmin: 0 };
  function carveGulfs(F0, r, nG) {
    const R = (a, b) => a + (b - a) * r(), pts = [], grad = (i, j) => { const k = j * G + i; return [(F0[k + 1] - F0[k - 1]) / (2 * GS), (F0[k + G] - F0[k - G]) / (2 * GS)]; };
    const cand = []; for (let j = 2; j < G - 2; j++) for (let i = 2; i < G - 2; i++) { const v = F0[j * G + i]; if (v > 0 && v < GS * 0.8) cand.push([i, j]); }
    if (cand.length < 50) return 0;
    let made = 0;
    for (let t = 0; t < 40 && made < nG; t++) {
      const [ci, cj] = cand[Math.floor(r() * cand.length)], x0 = qAt(ci), y0 = qAt(cj);
      if (pts.some(p => Math.hypot(p[0] - x0, p[1] - y0) < 0.9)) continue;
      const g = grad(ci, cj), gl = Math.hypot(g[0], g[1]); if (gl < 0.3) continue;
      const nx = g[0] / gl, ny = g[1] / gl;                         // внутрь суши
      let T = 0; for (let s = 0; s < 220; s++) { const x = x0 + nx * s * GS, y = y0 + ny * s * GS, i = Math.round((x + E) / GS - 0.5), j = Math.round((y + E) / GS - 0.5); if (i < 1 || j < 1 || i >= G - 1 || j >= G - 1 || F0[j * G + i] <= 0) break; T = s * GS; }
      if (T < 0.5) continue;
      const depth = Math.min(0.95, T * R(GULF.d0, GULF.d1)), basin = r() < GULF.pBasin, wm = Math.max(0.13, depth * R(GULF.w0, GULF.w1)), ox = x0 - nx * 0.12, oy = y0 - ny * 0.12, ex = x0 + nx * depth, ey = y0 + ny * depth, dx = ex - ox, dy = ey - oy, l2 = dx * dx + dy * dy;
      const wid = (u) => basin ? wm * (0.55 + 0.9 * Math.sin(Math.PI * (0.1 + 0.8 * u))) : wm * (1 - 0.72 * Math.pow(u, 1.3));
      const rr = depth + 2 * wm + 0.3, i0 = Math.max(1, Math.floor((x0 - rr + E) / GS)), i1 = Math.min(G - 2, Math.ceil((x0 + rr + E) / GS)), j0 = Math.max(1, Math.floor((y0 - rr + E) / GS)), j1 = Math.min(G - 2, Math.ceil((y0 + rr + E) / GS));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const qx = qAt(i), qy = qAt(j), u = clamp(((qx - ox) * dx + (qy - oy) * dy) / l2, 0, 1), d = Math.hypot(qx - (ox + dx * u), qy - (oy + dy * u)), B = wid(u) - d;
        F0[j * G + i] = smin(F0[j * G + i], -B, 0.05);
      }
      pts.push([x0, y0]); made++;
    }
    return made;
  }
  // Составной континент: 3–6 частей (каркасы тех же классов, у каждой своя деформация), прикреплённых друг к другу по дереву с перекрытием 20–50% и слитых гладким максимумом.
  // Причина: одиночный каркас — это «часть континента» одного масштаба (замер владельца: формы нравятся, но масштаба континента нет); у реальных континентов крупные полуострова и области
  // сами имеют полуострова и заливы, т.е. иерархия размеров. Поле запекается один раз на сетку GC (деформация частей внутри), дальше массив работает как обычный (noWarp).
  const GC = 384;
  function makeComposite(seed, tag, cat, area, np) {
    const r = sub(seed, tag + '|cc'), R = (a, b) => a + (b - a) * r(), parts = [], tmp = [0, 0];
    const clsW = { elong: 0.18, peninsular: 0.34, compact: 0.28, fragmented: 0.2 };
    const pick = () => { let t = 0; for (const k in clsW) t += clsW[k]; let u = r() * t; for (const k in clsW) { u -= clsW[k]; if (u <= 0) return k; } return 'compact'; };
    let head = r() * TAU, res = null;
    for (let att = 0; att < 6 && !res; att++) {
      parts.length = 0;
      for (let j = 0; j < np; j++) {
        const k = j === 0 ? 1 : R(0.5, 0.85) * Math.pow(0.9, j - 1), ps = makeSpec(seed, tag + 'p' + j + '_' + att, 'main', pick(), 1);
        let x = 0, y = 0;
        if (j) { const a = parts[r() < 0.55 ? j - 1 : Math.floor(r() * j)]; head += R(-1, 1); const d = (a.k + k) * R(0.5, 0.8) * 0.95; x = a.x + Math.cos(head) * d; y = a.y + Math.sin(head) * d; }
        parts.push({ sp: ps, k, x, y, rot: r() * TAU });
      }
      let sw = 0, cx = 0, cy = 0; for (const p of parts) { const w = p.k * p.k; sw += w; cx += w * p.x; cy += w * p.y; } cx /= sw; cy /= sw;
      let Rb = 0; for (const p of parts) { p.x -= cx; p.y -= cy; Rb = Math.max(Rb, Math.hypot(p.x, p.y) + 1.15 * p.k); }
      const fit = Math.min(1, 2.05 / Rb); for (const p of parts) { p.x *= fit; p.y *= fit; p.k *= fit; p.c = Math.cos(p.rot); p.s = Math.sin(p.rot); }
      const g = GC, gs = 2 * E / g, F = new Float32Array(g * g).fill(-9); F.g = g;
      for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
        const qx = -E + (i + 0.5) * gs, qy = -E + (j + 0.5) * gs; let v = null;
        for (const p of parts) {
          const dx = qx - p.x, dy = qy - p.y, rr = 1.7 * p.k; if (dx * dx + dy * dy > rr * rr) continue;
          warp(p.sp, (p.c * dx + p.s * dy) / p.k, (-p.s * dx + p.c * dy) / p.k, tmp); const f = sampleF0(p.sp.F0, tmp[0], tmp[1]) * p.k;
          v = v === null ? f : smax(v, f, 0.1);
        }
        if (v !== null) F[j * g + i] = v;
      }
      const m = new Uint8Array(g * g); let tot = 0; for (let i = 0; i < g * g; i++) if (F[i] > 0) { m[i] = 1; tot++; }
      const th = thinParts(m, g), keep = new Uint8Array(g * g); let t1 = 0; for (let i = 0; i < g * g; i++) if (m[i] && !th.out[i]) { keep[i] = 1; t1++; }
      const lb = label(keep, g, g), big = lb.sizes.length ? Math.max.apply(null, lb.sizes) : 0;
      if (tot > 4000 && t1 >= 0.9 * tot && big >= 0.95 * t1) { const bi = lb.sizes.indexOf(big); for (let i = 0; i < g * g; i++) if (m[i] && (!keep[i] || lb.lab[i] !== bi)) F[i] = -gs; res = F; }
    }
    if (!res) return null;
    const rr = sub(seed, tag + '|aux');
    return { tag, cat, cls: 'continent', area, F0: res, rot: rr() * TAU, noWarp: true, nParts: np, buildTries: 1, ok: true, fell: false, cut: 0, warpVar: 0 };
  }
  function makeSpec(seed, tag, cat, cls, area) {
    let r, F0, ok = false, tries = 0, used = cls, fell = false, cut = 0;
    for (; tries < 11 && !ok; tries++) {
      if (tries === 8 && used !== 'compact') { used = 'compact'; fell = true; }     // запасной каркас: клеточное тело без внутренних морей и ответвлений, связен по построению
      r = sub(seed, tag + '#' + tries); F0 = new Float32Array(G * G).fill(-9);
      BUILD[used](F0, r);
      if (used === 'arch') { ok = true; break; }
      if (cat !== 'island' || area > 0.012) carveGulfs(F0, r, used === 'fragmented' ? (r() < 0.4 ? 1 : 0) : GULF.nmin + Math.floor(r() * GULF.nmax));   // острова малой площади без заливов
      const m = new Uint8Array(G * G); let tot = 0; for (let i = 0; i < G * G; i++) if (F0[i] > 0) { m[i] = 1; tot++; }
      const th = FILT.thin ? thinParts(m) : { out: new Uint8Array(G * G) }, keep = new Uint8Array(G * G); let t1 = 0; for (let i = 0; i < G * G; i++) if (m[i] && !th.out[i]) { keep[i] = 1; t1++; }
      const lb = label(keep, G, G), big = lb.sizes.length ? Math.max.apply(null, lb.sizes) : 0;
      ok = tot > 400 && t1 >= 0.9 * tot && big >= 0.93 * t1 && (used === 'fragmented' || !FILT.holes || !bigHoles(keep, t1));     // нити/перемычки забирают ≤10% площади, каркас после этого связен (обломки ≤7%)
      if (ok) { const bi = lb.sizes.indexOf(big); for (let i = 0; i < G * G; i++) if (m[i] && (!keep[i] || lb.lab[i] !== bi)) F0[i] = -GS; cut = tot - big; }   // удалённое — только нити/обломки, острова там, где они задуманы
    }
    if (!ok) { // даже запасной каркас не прошёл (практически не бывает): оставляем только крупнейшую связную часть, но это отмечается в spec.ok
      const m = new Uint8Array(G * G); for (let i = 0; i < G * G; i++) if (F0[i] > 0) m[i] = 1; const lb = label(m, G, G), big = lb.sizes.length ? Math.max.apply(null, lb.sizes) : 0, bi = lb.sizes.indexOf(big);
      for (let i = 0; i < G * G; i++) if (m[i] && lb.lab[i] !== bi) F0[i] = -GS;
    }
    cls = used;
    const rr = sub(seed, tag + '|aux');
    return { tag, cat, cls, area, F0, rot: rr() * TAU, nm: FM.makeNoise(sub(seed, tag + '|nm')), nt: FM.makeNoise(sub(seed, tag + '|nt')), ns: FM.makeNoise(sub(seed, tag + '|ns')), n1: FM.makeNoise(sub(seed, tag + '|n1')), n2: FM.makeNoise(sub(seed, tag + '|n2')), buildTries: tries, ok, fell, cut, warpVar: 0 };
  }
  // пространственно неоднородная деформация (в q): амплитуда и анизотропия сами меняются по полю
  const WAMP = { v: 1 }, WARP = { free: true }, ELONG = { rich: false, lobes: null }, COMP = { on: true };   // режим «характер этапа 2»: свободная деформация (складки допускает), связность — проверками размещения
  const COAST = { mode: 'old', A0: 0.09, lam: 0.07, oct: 3, gain: 0.6, pmin: 0.4, old: { A0: 0.0055, la: 0.05, lb: 0.016, wb: 0.45, p0: 0.12, p1: 1.6 } };   // береговая деталь: самоподобный шум (амплитуда доля W, основная длина волны доля W, число октав, спад амплитуды по октавам), pmin — минимум пятнистости
  const WSC = [[1.7, 0.26, 0], [0.7, 0.12, 11.3], [0.26, 0.05, 23.7]];
  function warpRaw(sp, qx, qy, out) {
    const ov = sp.warpVar * 5.17;
    const m = 0.25 + 1.5 * smooth(-0.35, 0.45, sp.nm(qx * 0.55 + 3.1 + ov, qy * 0.55 + 7.7)), th = Math.PI * sp.nt(qx * 0.45 + 9.2 + ov, qy * 0.45 + 1.3), s = 0.3 + 0.7 * smooth(-0.4, 0.4, sp.ns(qx * 0.6 + 5.5, qy * 0.6 + 2.2 + ov));
    let dx = 0, dy = 0;
    for (const [lam, A, o] of WSC) { dx += A * sp.n1(qx / lam + o + ov, qy / lam + o * 0.7); dy += A * sp.n2(qx / lam + o * 0.6, qy / lam + o + ov); }
    dx *= m * WAMP.v; dy *= m * WAMP.v;
    const ex = Math.cos(th), ey = Math.sin(th), pr = dx * ex + dy * ey;   // вдоль e — полностью, поперёк — масштаб s
    const ws = sp.warpScale == null ? 1 : sp.warpScale;
    out[0] = qx + ws * (pr * ex + (dx - pr * ex) * s); out[1] = qy + ws * (pr * ey + (dy - pr * ey) * s);
  }
  // Деформация как сеточное отображение T(q) = q + d(q). «Сырое» смещение (warpRaw) на 16% плоскости складывает карту сама на себя (проверено: det J < 0 у каждого массива),
  // что давало отщеплённые куски, дырки и нити. Поэтому смещение ослабляется локально, пока отображение не станет взаимно однозначным:
  // наименьшее сингулярное значение J ≥ WSMIN на всех узлах. Тогда топология каркаса сохраняется (связность, число дырок), а сжатие ограничено.
  const WH = 0.04, WN = Math.round(2 * E / WH) + 1, WSMIN = 0.3, WGC = 0.6;
  function buildWarp(sp) {
    const n = WN, dx = new Float32Array(n * n), dy = new Float32Array(n * n), a = new Float32Array(n * n).fill(1), out = [0, 0];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const qx = -E + i * WH, qy = -E + j * WH; warpRaw(sp, qx, qy, out); dx[j * n + i] = out[0] - qx; dy[j * n + i] = out[1] - qy; }
    if (WARP.free) { sp.wgrid = { dx, dy, n, key: sp.warpVar, iters: 0, nv: 0, att: 1 }; return; }   // свободная деформация (допускает складки; связность гарантируют проверки размещения, а не ограничение деформации)
    const d0x = Float32Array.from(dx), d0y = Float32Array.from(dy), viol = new Uint8Array(n * n); let iters = 0, nv = 0;
    // локальное ослабление: a = min(1, c / |∇d0|), поле a сглаживается (его градиент входит в градиент d = a·d0), затем общий множитель, пока есть складки
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const k = j * n + i, gx = (d0x[k + 1] - d0x[k - 1]) / (2 * WH), gy = (d0x[k + n] - d0x[k - n]) / (2 * WH), hx = (d0y[k + 1] - d0y[k - 1]) / (2 * WH), hy = (d0y[k + n] - d0y[k - n]) / (2 * WH); a[k] = Math.min(1, WGC / Math.max(1e-6, Math.sqrt(gx * gx + gy * gy + hx * hx + hy * hy))); }
    for (let pass = 0; pass < 4; pass++) { const b = Float32Array.from(a); for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const k = j * n + i; b[k] = (4 * a[k] + 2 * (a[k - 1] + a[k + 1] + a[k - n] + a[k + n]) + a[k - n - 1] + a[k - n + 1] + a[k + n - 1] + a[k + n + 1]) / 16; } a.set(b); }
    for (let it = 0; it < 80; it++) {
      for (let k = 0; k < n * n; k++) { dx[k] = d0x[k] * a[k]; dy[k] = d0y[k] * a[k]; }
      nv = 0;
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const k = j * n + i, A = 1 + (dx[k + 1] - dx[k - 1]) / (2 * WH), B = (dx[k + n] - dx[k - n]) / (2 * WH), C = (dy[k + 1] - dy[k - 1]) / (2 * WH), D = 1 + (dy[k + n] - dy[k - n]) / (2 * WH);
        const sm = (Math.sqrt((A + D) * (A + D) + (B - C) * (B - C)) - Math.sqrt((A - D) * (A - D) + (B + C) * (B + C))) / 2;
        if (sm < WSMIN) nv++;
      }
      if (!nv) break; iters++; for (let k = 0; k < n * n; k++) a[k] *= 0.93;
    }
    sp.wgrid = { dx, dy, n, key: sp.warpVar, iters, nv, att: 0 };
    let sa = 0, sc = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const qx = -E + i * WH, qy = -E + j * WH; if (qx * qx + qy * qy < 2.25) { sa += a[j * n + i]; sc++; } } sp.wgrid.att = sa / sc;
  }
  function warp(sp, qx, qy, out) {
    if (sp.noWarp) { out[0] = qx; out[1] = qy; return; }   // составной континент: деформация частей уже запечена в поле
    if (!sp.wgrid || sp.wgrid.key !== sp.warpVar) buildWarp(sp);
    const g = sp.wgrid, n = g.n; let u = (qx + E) / WH, v = (qy + E) / WH; u = u < 0 ? 0 : u > n - 1.001 ? n - 1.001 : u; v = v < 0 ? 0 : v > n - 1.001 ? n - 1.001 : v;
    const i = u | 0, j = v | 0, fx = u - i, fy = v - j, k = j * n + i, w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    const ws = sp.warpScale == null ? 1 : sp.warpScale;
    out[0] = qx + ws * (g.dx[k] * w00 + g.dx[k + 1] * w10 + g.dx[k + n] * w01 + g.dx[k + n + 1] * w11);
    out[1] = qy + ws * (g.dy[k] * w00 + g.dy[k + 1] * w10 + g.dy[k + n] * w01 + g.dy[k + n + 1] * w11);
  }
  function sampleF0(F0, qx, qy) {
    const g = F0.g || G, gs = 2 * E / g;
    let gx = (qx + E) / gs - 0.5, gy = (qy + E) / gs - 0.5, pen = 0;
    if (gx < 0) { pen += -gx * gs; gx = 0; } else if (gx > g - 1) { pen += (gx - (g - 1)) * gs; gx = g - 1; }
    if (gy < 0) { pen += -gy * gs; gy = 0; } else if (gy > g - 1) { pen += (gy - (g - 1)) * gs; gy = g - 1; }
    const x0 = Math.min(g - 2, Math.floor(gx)), y0 = Math.min(g - 2, Math.floor(gy)), fx = gx - x0, fy = gy - y0, i = y0 * g + x0;
    return (F0[i] * (1 - fx) + F0[i + 1] * fx) * (1 - fy) + (F0[i + g] * (1 - fx) + F0[i + g + 1] * fx) * fy - pen;
  }
  // поле массива в клетках: F > 0 — суша. Центр (cx, cy) и радиус Rn заданы в долях W. stride > 1 — грубая сетка (проверки размещения)
  function evalMassif(sp, Rn, cx, cy, W, H, stride) {
    const Rc = Rn * W, CX = cx * W, CY = cy * W, half = E * Rc, c = Math.cos(sp.rot), s = Math.sin(sp.rot), tmp = [0, 0];
    const x0 = Math.max(0, Math.floor((CX - half) / stride)), x1 = Math.min(Math.ceil((W - 1) / stride), Math.ceil((CX + half) / stride)), y0 = Math.max(0, Math.floor((CY - half) / stride)), y1 = Math.min(Math.ceil((H - 1) / stride), Math.ceil((CY + half) / stride));
    const gw = Math.max(0, x1 - x0 + 1), gh = Math.max(0, y1 - y0 + 1), data = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const px = ((x0 + gx) * stride - CX) / Rc, py = ((y0 + gy) * stride - CY) / Rc, qx = c * px + s * py, qy = -s * px + c * py;
      warp(sp, qx, qy, tmp); data[gy * gw + gx] = sampleF0(sp.F0, tmp[0], tmp[1]) * Rc;
    }
    return { x0, y0, gw, gh, data, stride };
  }
  // связность массива на полном разрешении (stride 1, центр в целой клетке): положение центра на связность не влияет, она зависит от поворота, размера и деформации.
  // Rc — радиус в пикселях. Раскол ≥0,5% площади = отказ кандидата (поворот/деформация/размер заменяются, разрезов нет).
  function connectedAt(sp, Rc) {
    const half = Math.ceil(E * Rc), n = 2 * half + 1, c = Math.cos(sp.rot), s = Math.sin(sp.rot), tmp = [0, 0], m = new Uint8Array(n * n); let tot = 0;
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) { const px = (gx - half) / Rc, py = (gy - half) / Rc; warp(sp, c * px + s * py, -s * px + c * py, tmp); if (sampleF0(sp.F0, tmp[0], tmp[1]) * Rc > 0) { m[gy * n + gx] = 1; tot++; } }
    const lb = label(m, n, n), big = lb.sizes.length ? Math.max.apply(null, lb.sizes) : 0;
    return { ok: tot > 0 && big >= 0.995 * tot, parts: lb.sizes.length, tot, big };
  }
  // описание массива на сетке: площадь, габарит, центр масс (в клетках)
  function evInfo(ev) {
    let n = 0, sx = 0, sy = 0, mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (let gy = 0; gy < ev.gh; gy++) for (let gx = 0; gx < ev.gw; gx++) if (ev.data[gy * ev.gw + gx] > 0) { const x = (ev.x0 + gx) * ev.stride, y = (ev.y0 + gy) * ev.stride; n++; sx += x; sy += y; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
    return { n, areaCells: n * ev.stride * ev.stride, cx: n ? sx / n : 0, cy: n ? sy / n : 0, mnx, mxx, mny, mxy };
  }
  function evMask(ev, W, H) { const gw = Math.ceil(W / ev.stride) + 1, gh = Math.ceil(H / ev.stride) + 1, m = new Uint8Array(gw * gh); for (let y = 0; y < ev.gh; y++) for (let x = 0; x < ev.gw; x++) if (ev.data[y * ev.gw + x] > 0) m[(ev.y0 + y) * gw + ev.x0 + x] = 1; return { m, gw, gh }; }

  // ---------- композиция ----------
  const gapReq = (a, Ra, b, Rb) => (a === 'main' && b === 'main') ? Math.max(0.006, 0.22 * Math.min(Ra, Rb)) : Math.max(0.005, 0.45 * Math.min(Ra, Rb));
  FM.silhouette = function (params) {
    const t0 = performance.now(), seed = String(params.seed || 'sil'), W = params.W || 480, H = params.H || Math.round(W * 2 / 3), hN = H / W;
    const K = Math.max(1, params.continents | 0 || 2), landRatio = params.landRatio != null ? params.landRatio : 0.32, rs = sub(seed, 'comp'), Rr = (a, b) => a + (b - a) * rs();
    const nIsl = params.islands != null ? params.islands : Math.floor(rs() * 4), nArch = params.archipelagos != null ? params.archipelagos : Math.floor(rs() * 3);
    const Atot = landRatio * hN, islA = [], archA = [];
    for (let i = 0; i < nIsl; i++) islA.push(Atot * Rr(0.015, 0.045));
    for (let i = 0; i < nArch; i++) archA.push(Atot * Rr(0.02, 0.045));
    const mainSum = Atot - islA.reduce((a, b) => a + b, 0) - archA.reduce((a, b) => a + b, 0);
    // доли основных материков: иерархия (самый крупный 30–46% при K ≥ 3, 55–72% при K = 2), остальные — логнормально, не меньше 5% суммы
    let sh = [];
    if (K === 1) sh = [1];
    else if (K >= 5) {   // иерархия по закону ранг–размер: доля i-го ∝ i^(−α), α 0,8…1,15, шум ±25%; самый малый не меньше 4% суши материков (так K=8 даёт главный + 2–3 крупных + мелкие, а не равные)
      const al = Rr(0.8, 1.15); let w = []; for (let i = 0; i < K; i++) w.push(Math.pow(i + 1, -al) * (1 + 0.25 * (rs() * 2 - 1)));
      w.sort((a, b) => b - a); let t = w.reduce((a, b) => a + b, 0); sh = w.map(v => v / t);
      for (let it = 0; it < 4; it++) { sh = sh.map(v => Math.max(0.04, v)); t = sh.reduce((a, b) => a + b, 0); sh = sh.map(v => v / t); }
    } else {
      const top = K === 2 ? Rr(0.55, 0.72) : Rr(0.30, 0.46); sh = [top];
      const rest = []; let tot = 0; for (let i = 1; i < K; i++) { const z = (rs() + rs() + rs() - 1.5) * 2, w = Math.exp(0.45 * z); rest.push(w); tot += w; }
      let r0 = rest.map(w => Math.max(0.05, w / tot * (1 - top))); const t2 = r0.reduce((a, b) => a + b, 0); r0 = r0.map(w => w / t2 * (1 - top)); r0.sort((a, b) => b - a); sh = sh.concat(r0);
    }
    const specs = [], used = {};
    const pickCls = (w) => { let tot = 0; for (const k in w) tot += w[k]; let u = rs() * tot; for (const k in w) { u -= w[k]; if (u <= 0) return k; } return Object.keys(w)[0]; };
    for (let i = 0; i < K; i++) {
      const A = mainSum * sh[i], w = i === 0 ? { elong: 0.3, peninsular: 0.3, fragmented: 0.25, compact: K <= 2 ? 0.05 : 0.15 } : { elong: 0.28, peninsular: 0.28, fragmented: 0.2, compact: 0.24 };
      if (A < 0.1 * Atot) delete w.fragmented;
      if (COMP.on) w.continent = i === 0 ? (K <= 2 ? 1.6 : 0.7) : (A >= 0.12 * Atot ? 0.5 : 0);
      for (const k in w) w[k] *= Math.pow(0.5, used[k] || 0);
      const cls = pickCls(w); used[cls] = (used[cls] || 0) + 1;
      let spc = null;
      if (cls === 'continent') { const np = Math.max(3, Math.min(6, Math.round(2.6 + 3.4 * Math.sqrt(A / mainSum) + (rs() * 2 - 1) * 0.7))); spc = makeComposite(seed, 'm' + i, 'main', A, np); if (spc) { const tg = 'm' + i, ar = A; spc.regen = (v) => { const ns = makeComposite(seed, tg + 'v' + v, 'main', ar, np); if (ns) Object.assign(spc, ns, { regen: spc.regen, tag: tg, warpVar: v }); }; } }
      specs.push(spc || makeSpec(seed, 'm' + i, 'main', cls === 'continent' ? 'peninsular' : cls, A));
    }
    for (let i = 0; i < nIsl; i++) specs.push(makeSpec(seed, 'i' + i, 'island', rs() < 0.35 ? 'elong' : 'compact', islA[i]));
    for (let i = 0; i < nArch; i++) specs.push(makeSpec(seed, 'a' + i, 'arch', 'arch', archA[i]));
    // --- размещение ---
    // Поле массива не зависит от положения центра (деформация задана в q), поэтому грубый «прототип» (список клеток суши относительно центра) считается один раз,
    // а кандидаты проверяются переносом: рамка и зазоры (зависят от размеров обоих массивов). Нарушение → следующий кандидат, затем новая деформация, затем меньший размер.
    // Автоматических разрезов нет. Итог: либо размещён без нарушений, либо помечен failed.
    const S4 = Math.max(2, Math.round(W / 120)), cw = Math.ceil(W / S4) + 1, ch = Math.ceil(H / S4) + 1, placed = [], report = { splitRejects: 0, retries: 0, shifts: 0, reseeds: 0, shrinks: 0, failed: [], merges: [], notes: [] };
    const fm = (params.frameMargin != null ? params.frameMargin : 0.045) * W, rp = sub(seed, 'place'), Rp = (a, b) => a + (b - a) * rp();
    const proto = (sp, Rc) => {
      const half = E * Rc, gh = Math.floor(half / S4), n = 2 * gh + 1, px = [], c = Math.cos(sp.rot), s = Math.sin(sp.rot), tmp = [0, 0];
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
        const ox = (gx - gh) * S4, oy = (gy - gh) * S4, qx0 = ox / Rc, qy0 = oy / Rc, qx = c * qx0 + s * qy0, qy = -s * qx0 + c * qy0;
        warp(sp, qx, qy, tmp);
        if (sampleF0(sp.F0, tmp[0], tmp[1]) * Rc > 0) { px.push(ox, oy); if (ox < mnx) mnx = ox; if (ox > mxx) mxx = ox; if (oy < mny) mny = oy; if (oy > mxy) mxy = oy; }
      }
      let sx = 0, sy = 0; for (let i = 0; i < px.length; i += 2) { sx += px[i]; sy += px[i + 1]; }
      return { px, n: px.length / 2, mnx, mxx, mny, mxy, area: px.length / 2 * S4 * S4 / (W * W), icx: sx / (px.length / 2 || 1), icy: sy / (px.length / 2 || 1) };
    };
    // стоимость положения: сумма нарушений рамки и зазоров в клетках (0 — допустимо)
    const costAt = (pr, sp, Rc, CX, CY) => {
      let over = Math.max(0, fm - (CX + pr.mnx)) + Math.max(0, (CX + pr.mxx) - (W - 1 - fm)) + Math.max(0, fm - (CY + pr.mny)) + Math.max(0, (CY + pr.mxy) - (H - 1 - fm));
      if (over > 0) return over + 1000;
      for (const p of placed) {
        const req = gapReq(sp.cat, Rc, p.cat, p.Rn) * W + S4;
        if (CX + pr.mxx < p.bx0 - req || CX + pr.mnx > p.bx1 + req || CY + pr.mxy < p.by0 - req || CY + pr.mny > p.by1 + req) continue;
        let dmin = 1e9;
        for (let i = 0; i < pr.px.length; i += 2) { const d = p.dist[((CY + pr.px[i + 1]) / S4) * p.gw + (CX + pr.px[i]) / S4]; if (d < dmin) { dmin = d; if (d < 0.5) break; } }
        if (dmin < req) over += req - dmin + (dmin < 0.5 ? 0.3 * Rc * W : 0);
      }
      return over;
    };
    // Размещение: для каждого размера и варианта деформации перебираются повороты (поворот массива — точный поворот всей формы, так как деформация и каркас заданы в q),
    // для первого поворота с допустимыми положениями просматривается вся сетка положений (шаг 2·S4); выбирается положение по назначению:
    // основной материк — наиболее удалённое от уже размещённых, остров/архипелаг — на заданном расстоянии от основного материка. Случайность — только в весе выбора.
    const placeOne = (sp, mass) => {
      let Rn = Math.sqrt(sp.area / Math.PI);                 // нормировка: площадь F > 0 равна заданной
      for (let it = 0; it < 3; it++) { const a = proto(sp, Rn * W).area; if (a < 1e-6) break; Rn *= clamp(Math.sqrt(sp.area / a), 0.5, 2); }
      const step = 2 * S4, rot0 = sp.rot, nRot = 9;
      for (let sk = 0; sk < 9; sk++) {
        const Rc = Rn * Math.pow(0.95, sk); if (sk) { mass.shrinks = sk; report.shrinks++; }
        for (let rv = 0; rv < 4; rv++) {
          if (rv) { sp.warpVar++; report.reseeds++; if (sp.regen) sp.regen(sp.warpVar); }
          for (let ri = 0; ri < nRot; ri++) {
            sp.rot = rot0 + ri * TAU / nRot;
            const pr = proto(sp, Rc * W); if (pr.n < 4) continue;
            if (sp.cat !== 'arch' && !connectedAt(sp, Rc * W).ok) { mass.splitRejects = (mass.splitRejects || 0) + 1; report.splitRejects++; continue; }
            mass.attempts++;
            const ms = placed.filter(p => p.cat === 'main'), tgt = Rp(1.0, 1.9), cand = [];
            for (let y = 0; y <= H - 1; y += step) for (let x = 0; x <= W - 1; x += step) {
              const X = Math.round(x / S4) * S4, Y = Math.round(y / S4) * S4; report.retries++;
              if (costAt(pr, sp, Rc, X, Y) > 0) continue;
              let sc;
              if (sp.cat === 'main') { let m = 1e9; for (const p of ms) m = Math.min(m, Math.hypot(p.cx * W - X, p.cy * W - Y) / ((Rc + p.Rn) * W)); sc = (ms.length ? -m : 0) + 0.35 * rp(); }
              else if (ms.length) { let m = 1e9; for (const p of ms) m = Math.min(m, Math.hypot(p.cx * W - X, p.cy * W - Y) / ((Rc + p.Rn) * W)); sc = Math.abs(m - tgt) + 0.25 * rp(); }
              else sc = rp();
              cand.push([sc, X, Y]);
            }
            if (!cand.length) continue;
            let best = cand[0]; for (const c of cand) if (c[0] < best[0]) best = c;
            const [, x, y] = best, msk = new Uint8Array(cw * ch); for (let i = 0; i < pr.px.length; i += 2) msk[((y + pr.px[i + 1]) / S4) * cw + (x + pr.px[i]) / S4] = 1;
            const f = new Float64Array(msk.length); for (let i = 0; i < f.length; i++) f[i] = msk[i] ? 0 : INF; const d = edtInit(f, cw, ch); for (let i = 0; i < d.length; i++) d[i] *= S4;
            placed.push({ sp, id: sp.mass.id, cat: sp.cat, Rn: Rc, cx: x / W, cy: y / W, dist: d, gw: cw, bx0: x + pr.mnx, bx1: x + pr.mxx, by0: y + pr.mny, by1: y + pr.mxy });
            placed[placed.length - 1].pr = pr; mass.cx = x / W; mass.cy = y / W; mass.Rn = Rc; mass.rotTry = ri; return true;
          }
          sp.rot = rot0;
        }
      }
      return false;
    };
    for (let si = 0; si < specs.length; si++) {
      const sp = specs[si], mass = { id: si, cat: sp.cat, cls: sp.cls, tag: sp.tag, targetArea: sp.area, attempts: 0, shifts: 0, shrinks: 0, failed: false, respec: 0 };
      sp.mass = mass;
      let done = placeOne(sp, mass);
      // основной массив не удалось разместить: переопределяем каркас (другой класс и вариант), а не режем и не теряем материк
      for (let v = 1; v <= 3 && !done && sp.cat === 'main'; v++) {
        const alt = ['peninsular', 'elong', 'compact'][(v + si) % 3], ns = makeSpec(seed, sp.tag + 'v' + v, 'main', alt, sp.area);
        Object.assign(sp, ns, { mass, tag: sp.tag, noWarp: false, regen: null }); mass.cls = sp.cls; mass.respec = v; report.notes.push('respec ' + sp.tag + ' -> ' + alt);
        done = placeOne(sp, mass);
      }
      if (!done) { mass.failed = true; report.failed.push(sp.tag); }
    }
    // --- дорост: массивы, уменьшенные при размещении, увеличиваются на месте, пока есть место (недобор суши — следствие тесноты, а не заданной формы) ---
    { const mkDist = (pr, x, y) => { const msk = new Uint8Array(cw * ch); for (let i = 0; i < pr.px.length; i += 2) msk[((y + pr.px[i + 1]) / S4) * cw + (x + pr.px[i]) / S4] = 1; const f = new Float64Array(msk.length); for (let i = 0; i < f.length; i++) f[i] = msk[i] ? 0 : INF; const d = edtInit(f, cw, ch); for (let i = 0; i < d.length; i++) d[i] *= S4; return d; };
      // Фаза 1: массивы, уменьшенные при размещении, растут до заданной площади. Фаза 2 (только если суммарный недобор > 1,5% бюджета): основные материки могут
      // превысить заданную долю до +15%, пока недобор не закроется или есть место. Причина недобора по замеру: сжатие при размещении (тесные K=3) и неполная реализация архипелагов.
      const placedTot = () => placed.reduce((a, p) => a + p.pr.area, 0);
      let prog = true, rounds = 0, cap = 1;
      while (rounds++ < 26) {
        if (cap > 1 && placedTot() >= 0.995 * Atot) break;
        prog = false;
        for (const pl of placed.slice().sort((a, b) => (a.pr.area / a.sp.area) - (b.pr.area / b.sp.area))) {
          if (pl.sp.cat === 'arch' || pl.pr.area >= pl.sp.area * (pl.sp.cat === 'main' ? cap : 1) * 0.995) continue;
          const sp = pl.sp, X = Math.round(pl.cx * W), Y = Math.round(pl.cy * W), Rc = pl.Rn * 1.03, idx = placed.indexOf(pl), pr = proto(sp, Rc * W);
          placed.splice(idx, 1); const c = costAt(pr, sp, Rc, X, Y); placed.splice(idx, 0, pl);
          if (c > 0) continue;
          if (!connectedAt(sp, Rc * W).ok) continue;
          pl.pr = pr; pl.Rn = Rc; pl.dist = mkDist(pr, X, Y); pl.bx0 = X + pr.mnx; pl.bx1 = X + pr.mxx; pl.by0 = Y + pr.mny; pl.by1 = Y + pr.mxy; pl.sp.mass.Rn = Rc; pl.sp.mass.grown = (pl.sp.mass.grown || 0) + 1; report.grown = (report.grown || 0) + 1; prog = true;
        }
        if (!prog) { if (cap === 1 && placedTot() < 0.985 * Atot) { cap = 1.15; report.growPhase2 = true; continue; } break; }
      }
      report.placedLand = placedTot() / Atot;
    }
    // --- сборка поля на полном разрешении ---
    const N = W * H, L = new Float32Array(N).fill(-1e4), owner = new Int16Array(N).fill(-1), asz = new Float32Array(N).fill(1);
    for (const sp of specs) {
      if (sp.mass.failed) continue;
      const ev = evalMassif(sp, sp.mass.Rn, sp.mass.cx, sp.mass.cy, W, H, 1);
      for (let gy = 0; gy < ev.gh; gy++) for (let gx = 0; gx < ev.gw; gx++) { const v = ev.data[gy * ev.gw + gx], i = (ev.y0 + gy) * W + ev.x0 + gx; if (v > L[i]) { L[i] = v; owner[i] = v > 0 ? sp.mass.id : -1; asz[i] = clamp(sp.mass.Rn / 0.11, 0.25, 1); } }
    }
    const TR = params.trace; if (TR) { TR.specs = specs; TR.owner = owner; TR.assembled = new Uint8Array(N); for (let i = 0; i < N; i++) TR.assembled[i] = L[i] > 0 ? 1 : 0; }
    // --- береговая деталь: ограниченное смещение контура (L ≈ расстояние в клетках, поэтому добавка к L сдвигает берег не более чем на амплитуду) ---
    // Если деталь разорвала основной массив (узкая перемычка уже амплитуды), деталь применяется с меньшей амплитудой (1 → 0,6 → 0,3 → 0).
    const cn = FM.makeNoise(sub(seed, 'coast')), OLD = COAST.mode === 'old', A0 = (OLD ? COAST.old.A0 : COAST.A0) * W, fa = 1 / ((OLD ? COAST.old.la : COAST.lam) * W), fb = 1 / (COAST.old.lb * W), fp = 1 / (0.14 * W), band = 0.03 * W, L0 = Float32Array.from(L);
    const nMainWanted = specs.filter(sp => !sp.mass.failed && sp.cat === 'main').length;
    const pockets = (sea) => { const ls = label(sea, W, H), touch = new Uint8Array(ls.n); for (let x = 0; x < W; x++) { touch[ls.lab[x]] = 1; touch[ls.lab[(H - 1) * W + x]] = 1; } for (let y = 0; y < H; y++) { touch[ls.lab[y * W]] = 1; touch[ls.lab[y * W + W - 1]] = 1; } let n = 0; for (let k = 0; k < ls.n; k++) if (!touch[k] && ls.sizes[k] >= 0.0005 * W * W) n++; return n; };
    const pockets0 = (() => { const ms = new Uint8Array(N); for (let i = 0; i < N; i++) ms[i] = L0[i] > 0 ? 0 : 1; return pockets(ms); })();
    let coastK = 1;
    for (const af of [1, 0.6, 0.3, 0]) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, v = L0[i]; if (v > 3 * band || v < -3 * band) { L[i] = v; continue; }
        const patch = smooth(-0.3, 0.35, FM.fbm(cn, x * fp + 41.7, y * fp + 17.3, 2)), amp = A0 * af * (OLD ? COAST.old.p0 + COAST.old.p1 * patch : COAST.pmin + 1.3 * patch) * asz[i], wgt = Math.exp(-(v * v) / (band * band));
        L[i] = v + wgt * amp * (OLD ? 0.65 * FM.fbm(cn, x * fa + 13.1, y * fa + 5.7, 3) + COAST.old.wb * FM.fbm(cn, x * fb + 71.3, y * fb + 29.9, 2) : FM.fbm(cn, x * fa + 13.1, y * fa + 5.7, COAST.oct, 2, COAST.gain));
      }
      coastK = af; if (af === 0) break;
      // проверка: каждый основной массив остаётся одним крупным куском
      const mk = new Uint8Array(N); for (let i = 0; i < N; i++) mk[i] = L[i] > 0 ? 1 : 0; const lc = label(mk, W, H), cnt = new Map();
      for (let i = 0; i < N; i++) if (lc.lab[i] >= 0 && owner[i] >= 0 && specs[owner[i]].cat === 'main') { const k = owner[i] * 1e6 + lc.lab[i]; cnt.set(k, (cnt.get(k) || 0) + 1); }
      const tot = {}, big = {}; for (const [k, n] of cnt) { const o = Math.floor(k / 1e6); tot[o] = (tot[o] || 0) + n; big[o] = Math.max(big[o] || 0, n); }
      let okc = true; for (const o in tot) if (big[o] < 0.985 * tot[o]) okc = false;
      // береговая деталь не должна замыкать заливы в новые озёра-карманы (≥ 0,0005·W²): число замкнутых морских карманов не растёт относительно поля до детали
      if (okc) { const ms = new Uint8Array(N); for (let i = 0; i < N; i++) ms[i] = L[i] > 0 ? 0 : 1; if (pockets(ms) > pockets0) okc = false; }
      if (okc) break;
    }
    report.coastAmp = coastK;
    if (TR) { TR.afterCoast = new Uint8Array(N); for (let i = 0; i < N; i++) TR.afterCoast[i] = L[i] > 0 ? 1 : 0; }
    // очистка: мелкие обломки суши (не архипелаг) убираются, мелкие морские карманы внутри суши заполняются; их число идёт в report.cleaned
    { const m0 = new Uint8Array(N); for (let i = 0; i < N; i++) m0[i] = L[i] > 0 ? 1 : 0;
      const l0 = label(m0, W, H), minA = 0.00012 * W * W; let cl = 0;
      const arch = new Set(specs.filter(sp => sp.cat === 'arch').map(sp => sp.mass.id)), isleMin = 0.00005 * W * W;
      const ownCnt = l0.sizes.map(() => ({})); for (let i = 0; i < N; i++) if (l0.lab[i] >= 0 && owner[i] >= 0) { const o = ownCnt[l0.lab[i]]; o[owner[i]] = (o[owner[i]] || 0) + 1; }
      const kill = l0.sizes.map((n, c) => { let bo = -1, bn = 0; for (const k in ownCnt[c]) if (ownCnt[c][k] > bn) { bn = ownCnt[c][k]; bo = +k; } return arch.has(bo) ? n < isleMin : n < minA; });
      for (let i = 0; i < N; i++) if (l0.lab[i] >= 0 && kill[l0.lab[i]]) { L[i] = -0.5; cl++; }
      const m1 = new Uint8Array(N); for (let i = 0; i < N; i++) m1[i] = L[i] > 0 ? 0 : 1; const l1 = label(m1, W, H);   // морские компоненты; океан — та, что касается рамки
      const touch = new Uint8Array(l1.n); for (let x = 0; x < W; x++) { for (const i of [x, (H - 1) * W + x]) if (l1.lab[i] >= 0) touch[l1.lab[i]] = 1; } for (let y = 0; y < H; y++) { for (const i of [y * W, y * W + W - 1]) if (l1.lab[i] >= 0) touch[l1.lab[i]] = 1; }
      // замкнутые карманы < 0,0005·W² — случайные (замер: намеренные внутренние моря ≥ 0,0035·W²)
      let fl = 0; for (let i = 0; i < N; i++) { const c = l1.lab[i]; if (c >= 0 && !touch[c] && l1.sizes[c] < 0.0005 * W * W) { L[i] = 0.5; fl++; } }
      report.cleaned = cl; report.filled = fl; }
    const mask = new Uint8Array(N); let landN = 0; for (let i = 0; i < N; i++) if (L[i] > 0) { mask[i] = 1; landN++; }
    const D = sdf(L, W, H);
    // --- проверка компонент и слияний ---
    const lb = label(mask, W, H), own = []; for (let c = 0; c < lb.n; c++) own.push({});
    for (let i = 0; i < N; i++) if (mask[i]) { const c = lb.lab[i], o = owner[i]; if (o >= 0) own[c][o] = (own[c][o] || 0) + 1; }
    const compOf = {}; // массив -> компонента с максимумом его пикселей
    for (const sp of specs) { if (sp.mass.failed) continue; let bc = -1, bn = 0; for (let c = 0; c < lb.n; c++) { const n = own[c][sp.mass.id] || 0; if (n > bn) { bn = n; bc = c; } } compOf[sp.mass.id] = bc; sp.mass.comp = bc; sp.mass.area = bn / (W * W); }
    for (let c = 0; c < lb.n; c++) { const mains = Object.keys(own[c]).filter(k => specs[k].cat === 'main'); if (mains.length > 1) report.merges.push(mains.map(k => specs[k].tag)); }
    const comps = lb.sizes.map((n, c) => ({ c, n, area: n / (W * W), cat: null })); // категория по владельцу
    for (const m of specs) { if (m.mass.failed) continue; const k = comps[compOf[m.mass.id]]; if (k && (k.cat === null || m.cat === 'main')) k.cat = m.cat; }
    return { W, H, seed, K, params, L, D, mask, owner, lab: lb.lab, comps, massifs: specs.map(s => s.mass), report, landFraction: landN / N, targetLand: landRatio, ms: performance.now() - t0 };
  };
  // Проверка формулы профиля высоты: coast detail отдельно (в L), внутренний рельеф отдельно. Возвращает числа для отчёта.
  //  старая формула  noise·|∇D|·P'(D): при P' → 0 вдали от берега шум исчезает; новая — амплитуда внутреннего рельефа не зависит от P'.
  FM.silhouetteRelief = function (sil, o) {
    o = o || {}; const W = sil.W, H = sil.H, N = W * H, D = sil.D, rn = FM.makeNoise(sub(sil.seed, 'relief'));
    const lamL = 0.03 * W, lamS = 0.05 * W, P = (d) => d > 0 ? 0.7 * (1 - Math.exp(-d / lamL)) : -(0.1 + 0.9 * (1 - Math.exp(d / lamS)));
    const dP = (d) => d > 0 ? 0.7 / lamL * Math.exp(-d / lamL) : 0.9 / lamS * Math.exp(d / lamS);
    const Ar = o.Ar || 0.12, h = new Float32Array(N), bins = [0.01, 0.03, 0.06, 0.1, 0.15].map(v => ({ d: v, so: 0, sn: 0, n: 0 }));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = D[i], nz = FM.fbm(rn, x / (0.07 * W) + 5.3, y / (0.07 * W) + 8.1, 4), g = smooth(0.012 * W, 0.06 * W, Math.abs(d)) * (d > 0 ? 1 : 0.6);
      const nNew = Ar * nz * g, nOld = Ar * nz * Math.min(1, Math.abs(dP(d)) * lamL);   // старая: шум ∝ |∇D|·P' (|∇D| = 1)
      h[i] = P(d) + nNew;
      if (d > 0) for (let k = bins.length - 1; k >= 0; k--) if (d >= bins[k].d * W) { bins[k].so += nOld * nOld; bins[k].sn += nNew * nNew; bins[k].n++; break; }
    }
    let flip = 0, tot = 0; for (let i = 0; i < N; i++) { const a = h[i] > 0, b = D[i] > 0; if (a !== b) flip++; if (b) tot++; }
    const m2 = new Uint8Array(N); for (let i = 0; i < N; i++) m2[i] = h[i] > 0 ? 1 : 0;
    return { flipFrac: flip / Math.max(1, tot), compsMask: label(sil.mask, W, H).n, compsRelief: label(m2, W, H).n, byD: bins.map(b => ({ D_over_W: b.d, n: b.n, stdOld: b.n ? Math.sqrt(b.so / b.n) : null, stdNew: b.n ? Math.sqrt(b.sn / b.n) : null })), h };
  };
  FM.__sil = { FILT, WAMP, WARP, ELONG, COMP, COAST, GULF, WGP: null, sdf, edtInit, distToMask, label, G, E, evalMassif, sampleF0 };
})(window.FM = window.FM || {});
