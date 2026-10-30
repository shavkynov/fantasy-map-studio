// Ядро метрик формы суши. Исполняется В СТРАНИЦЕ (через page.evaluate из tools/continents-metrics.js и continents-sheet.js), не в Node.
// Даёт window.__CM = { metricsOf(map), hashOf(map), mask(map, w, h), sheet(maps, opts) }.
// Все длины и площади нормированы к разрешению: 1 «единица» = клетка при ширине 480 (sc = W/480), поэтому метрики сравнимы между 480×320, 720×480, 960×640.
// Метрики — диагностика, а не доказательство реалистичности: решает визуальный лист.
(function () {
  'use strict';
  const FMr = window.FM;

  // ---------- хеш географии (для проверки воспроизводимости и legacy) ----------
  const fnv = (arr, q) => { let h = 0x811c9dc5; for (let i = 0; i < arr.length; i++) { const v = q ? Math.round(arr[i] * q) | 0 : arr[i] | 0; h ^= v & 0xff; h = Math.imul(h, 16777619); h ^= (v >> 8) & 0xff; h = Math.imul(h, 16777619); h ^= (v >> 16) & 0xff; h = Math.imul(h, 16777619); h ^= (v >>> 24) & 0xff; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
  function hashOf(m) { return { h: fnv(m.h, 1e5), biome: fnv(m.biome), rivers: fnv(m.riverMask), plates: fnv(m.plateId) }; }

  // ---------- компоненты связности ----------
  function components(W, H, test, minCells) {
    const N = W * H, lab = new Int32Array(N), st = new Int32Array(N), comps = [];
    for (let s = 0; s < N; s++) {
      if (lab[s] || !test(s)) continue;
      const cells = []; let sp = 0; st[sp++] = s; lab[s] = 1;
      while (sp) {
        const i = st[--sp]; cells.push(i); const x = i % W, y = (i / W) | 0;
        if (x > 0 && !lab[i - 1] && test(i - 1)) { lab[i - 1] = 1; st[sp++] = i - 1; }
        if (x < W - 1 && !lab[i + 1] && test(i + 1)) { lab[i + 1] = 1; st[sp++] = i + 1; }
        if (y > 0 && !lab[i - W] && test(i - W)) { lab[i - W] = 1; st[sp++] = i - W; }
        if (y < H - 1 && !lab[i + W] && test(i + W)) { lab[i + W] = 1; st[sp++] = i + W; }
      }
      if (cells.length >= (minCells || 1)) comps.push(cells);
    }
    return comps;
  }
  function convexHull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const q of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    lo.pop(); up.pop(); return lo.concat(up);
  }
  const polyArea = (h) => { let a = 0; for (let i = 0; i < h.length; i++) { const u = h[i], v = h[(i + 1) % h.length]; a += u[0] * v[1] - v[0] * u[1]; } return Math.abs(a) / 2; };
  function fillPoly(poly, W, H) {   // растр выпуклого многоугольника (чётность по строкам)
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const xs = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5)) xs.push(a[0] + (y + 0.5 - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
      xs.sort((p, q) => p - q); for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); x++) m[y * W + x] = 1;
    }
    return m;
  }
  // контур, пересэмплированный с шагом step (в клетках): ряды точек для оценки прямых участков, изломов и изрезанности
  function resample(loop, step) {
    const q = [loop[0]]; let acc = 0;
    for (let i = 1; i <= loop.length; i++) {
      const a = loop[i - 1], b = loop[i % loop.length], seg = Math.hypot(b[0] - a[0], b[1] - a[1]); let t0 = 0;
      while (acc + seg - t0 >= step) { const tt = (t0 + step - acc) / seg; q.push([a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt]); t0 += step - acc; acc = 0; }
      acc += seg - t0;
    }
    return q;
  }
  const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  const r3 = (v) => +v.toFixed(3);

  function metricsOf(map) {
    const { W, H, h } = map, N = W * H, sc = W / 480, A = sc * sc;
    let landN = 0; for (let i = 0; i < N; i++) if (h[i] > 0) landN++;
    const comps = components(W, H, (i) => h[i] > 0, Math.max(8, Math.round(8 * A)));
    comps.sort((a, b) => b.length - a.length);
    const mass = comps.filter(c => c.length >= 0.03 * landN);           // «массивы»: ≥ 3% суши (континенты); остальное — острова
    const R = { land: r3(landN / N), nMass: mass.length, massAreas: mass.map(c => r3(c.length / landN)), nIslands: comps.length - mass.length };

    // --- форма каждого массива ---
    const iou = [], sol = [], elong = [], rect = [], cen = [], concav = [], concSizes = [], bays = [];
    for (const c of mass) {
      let mx = 0, my = 0; for (const i of c) { mx += i % W; my += (i / W) | 0; } mx /= c.length; my /= c.length; cen.push([mx / W, my / H]);
      let sxx = 0, syy = 0, sxy = 0; for (const i of c) { const dx = (i % W) - mx, dy = ((i / W) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; } sxx /= c.length; syy /= c.length; sxy /= c.length;
      const t = (sxx + syy) / 2, d = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy), l1 = t + d, l2 = Math.max(1e-6, t - d), th = 0.5 * Math.atan2(2 * sxy, sxx - syy), a = 2 * Math.sqrt(l1), b = 2 * Math.sqrt(l2), ct = Math.cos(th), sn = Math.sin(th);
      const set = new Uint8Array(N); for (const i of c) set[i] = 1;
      let inter = 0, E = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = x - mx, dy = y - my, u = (dx * ct + dy * sn) / a, v = (-dx * sn + dy * ct) / b; if (u * u + v * v <= 1) { E++; if (set[y * W + x]) inter++; } }
      iou.push(inter / (c.length + E - inter)); elong.push(a / b);
      const bpts = []; for (const i of c) { const x = i % W, y = (i / W) | 0; if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !(set[i - 1] && set[i + 1] && set[i - W] && set[i + W])) bpts.push([x, y]); }
      const hull = convexHull(bpts), hA = polyArea(hull) + bpts.length / 2; sol.push(c.length / Math.max(c.length, hA));   // +периметр/2: центры граничных клеток лежат на полклетки внутри
      let best = 1e18; for (let ang = 0; ang < 90; ang += 3) { const ca = Math.cos(ang * Math.PI / 180), sa = Math.sin(ang * Math.PI / 180); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const p of hull) { const u = p[0] * ca + p[1] * sa, v = -p[0] * sa + p[1] * ca; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; } best = Math.min(best, (u1 - u0) * (v1 - v0)); }
      rect.push(c.length / Math.max(c.length, best));
      // крупные вогнутости: компоненты (оболочка − суша), выходящие к границе оболочки (заливы, бухты), ≥ 120 ед.²
      const hm = fillPoly(hull, W, H), lab = new Uint8Array(N), st = new Int32Array(N); let n = 0;
      for (let s0 = 0; s0 < N; s0++) {
        if (lab[s0] || !hm[s0] || set[s0]) continue; let sp = 0, cnt = 0, open = false; st[sp++] = s0; lab[s0] = 1;
        let sx = 0, sy = 0; while (sp) { const i = st[--sp]; cnt++; const x = i % W, y = (i / W) | 0; sx += x; sy += y;
          const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
          for (const q of nb) { if (q < 0 || !hm[q]) { open = true; continue; } if (!lab[q] && !set[q]) { lab[q] = 1; st[sp++] = q; } } }
        if (open && cnt >= 120 * A) { n++; concSizes.push(cnt / A); bays.push([sx / cnt, sy / cnt, cnt / A]); }
      }
      concav.push(n);
    }
    R.ovalIoU = r3(mean(iou)); R.solidity = r3(mean(sol)); R.elong = r3(mean(elong)); R.rect = r3(mean(rect));
    R.concavPerMass = r3(mean(concav)); R.concavMax = concSizes.length ? Math.round(Math.max(...concSizes)) : 0; R.noConcavMasses = concav.filter(n => n === 0).length;

    // --- группы островов: кластеры малых компонентов суши (single-linkage ≤ 26 px при 480), форма: линия / дуга / кольцо / скопление ---
    {
      const isl = comps.filter(c => c.length < 0.03 * landN && c.length >= 3 * A).map(c => { let x = 0, y = 0; for (const i of c) { x += i % W; y += (i / W) | 0; } return [x / c.length / sc, y / c.length / sc]; });
      const par = isl.map((_, i) => i), f = (a) => par[a] === a ? a : (par[a] = f(par[a]));
      for (let i = 0; i < isl.length; i++) for (let j = i + 1; j < isl.length; j++) if (Math.hypot(isl[i][0] - isl[j][0], isl[i][1] - isl[j][1]) <= 26) par[f(i)] = f(j);
      const grp = new Map(); isl.forEach((p, i) => { const r = f(i); (grp.get(r) || grp.set(r, []).get(r)).push(p); });
      const kinds = { line: 0, arc: 0, ring: 0, blob: 0 };
      for (const g of grp.values()) {
        if (g.length < 4) continue;
        const mx = mean(g.map(p => p[0])), my = mean(g.map(p => p[1])); let sxx = 0, syy = 0, sxy = 0; for (const p of g) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
        sxx /= g.length; syy /= g.length; sxy /= g.length; const tr = sxx + syy, det = sxx * syy - sxy * sxy, d = Math.sqrt(Math.max(0, tr * tr / 4 - det)), l1 = tr / 2 + d, l2 = Math.max(0, tr / 2 - d), ratio = l2 / (l1 || 1);
        const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ca = Math.cos(th), sa = Math.sin(th);
        let umin = 1e9, umax = -1e9, vdev = 0; for (const p of g) { const u = (p[0] - mx) * ca + (p[1] - my) * sa; umin = Math.min(umin, u); umax = Math.max(umax, u); }
        const len = Math.max(1, umax - umin), vs = g.map(p => -(p[0] - mx) * sa + (p[1] - my) * ca), vm = mean(vs); // изгиб: расстояние концов от середины вдоль нормали
        const sorted = g.map((p, i) => [(p[0] - mx) * ca + (p[1] - my) * sa, vs[i]]).sort((a, b) => a[0] - b[0]), e0 = sorted.slice(0, Math.max(1, Math.floor(g.length / 4))), e1 = sorted.slice(-Math.max(1, Math.floor(g.length / 4))), mid = sorted.slice(Math.floor(g.length * 0.375), Math.ceil(g.length * 0.625));
        vdev = Math.abs(mean(mid.map(q => q[1])) - (mean(e0.map(q => q[1])) + mean(e1.map(q => q[1]))) / 2) / len;
        const rr = g.map(p => Math.hypot(p[0] - mx, p[1] - my)), rm = mean(rr), rcv = Math.sqrt(mean(rr.map(v => (v - rm) ** 2))) / (rm || 1);
        const ang = g.map(p => Math.atan2(p[1] - my, p[0] - mx)).sort((a, b) => a - b); let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1]; for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
        if (rcv < 0.3 && gap < 2.2 && ratio > 0.35) kinds.ring++; else if (ratio < 0.1) (vdev > 0.1 ? kinds.arc++ : kinds.line++); else if (ratio < 0.22) (vdev > 0.1 ? kinds.arc++ : kinds.line++); else kinds.blob++;
      }
      R.islGroups = kinds.line + kinds.arc + kinds.ring + kinds.blob; R.islLine = kinds.line; R.islArc = kinds.arc; R.islRing = kinds.ring; R.islBlob = kinds.blob;
      R.islLineArc = R.islGroups ? r3((kinds.line + kinds.arc) / R.islGroups) : 0; R.islKinds = (kinds.line > 0) + (kinds.arc > 0) + (kinds.ring > 0) + (kinds.blob > 0);
    }
    // --- этап 3: иерархия береговых форм и их связь с типами окраин (только если генератор отдал map.margin) ---
    R.bayBig = r3(bays.filter(b => b[2] >= 600).length / Math.max(1, mass.length)); R.bayMid = r3(bays.filter(b => b[2] >= 250 && b[2] < 600).length / Math.max(1, mass.length)); R.baySmall = r3(bays.filter(b => b[2] < 250).length / Math.max(1, mass.length));
    if (map.margin) {
      const mg = map.margin, rf = (i) => Math.max(mg.rift[i], mg.pass[i]); let ra = 0, ca = 0, cw = 0;
      for (let i = 0; i < N; i++) { if (rf(i) > 0.15) ra++; if (h[i] <= 0) { cw++; if (mg.conv[i] > 0.15) ca++; } }
      R.riftArea = r3(ra / N); R.bayRift = bays.length ? r3(bays.filter(b => rf(Math.round(b[1]) * W + Math.round(b[0])) > 0.15).length / bays.length) : 0;
      const isl = comps.filter(c => c.length < 0.03 * landN); R.convArea = r3(ca / Math.max(1, cw));
      R.islandArc = isl.length ? r3(isl.filter(c => { let mx2 = 0, my2 = 0; for (const i of c) { mx2 += i % W; my2 += (i / W) | 0; } return mg.conv[Math.round(my2 / c.length) * W + Math.round(mx2 / c.length)] > 0.15; }).length / isl.length) : 0;
    }
    // --- контур: прямые участки, изломы, берег у рамки, изрезанность ---
    let tot = 0, flat = 0, axis = 0, corner = 0, arc = 0, near = 0, total2 = 0; const fm = 0.06 * W, rough = [];
    for (const lp of FMr.contours(h, W, H, 0)) {
      if (lp.length < 20 * sc) continue;
      const q = resample(lp, sc), n = q.length; if (n < 90) continue;
      for (let i = 0; i < n; i++) {
        const P = q[i], A6 = q[(i - 6 + n) % n], B6 = q[(i + 6) % n]; tot++;
        let dev = 0; const L = Math.hypot(B6[0] - A6[0], B6[1] - A6[1]) || 1;
        for (let k = -6; k <= 6; k++) { const Q = q[(i + k + n) % n]; dev = Math.max(dev, Math.abs((B6[0] - A6[0]) * (A6[1] - Q[1]) - (A6[0] - Q[0]) * (B6[1] - A6[1])) / L); }
        if (dev < 0.4 * sc && L > 10 * sc) { flat++; const ang = Math.abs(Math.atan2(B6[1] - A6[1], B6[0] - A6[0])) * 180 / Math.PI; if (ang < 6 || ang > 174 || Math.abs(ang - 90) < 6) axis++; }
        const U = q[(i - 3 + n) % n], V = q[(i + 3) % n], a1 = [P[0] - U[0], P[1] - U[1]], a2 = [V[0] - P[0], V[1] - P[1]], cs = (a1[0] * a2[0] + a1[1] * a2[1]) / ((Math.hypot(a1[0], a1[1]) * Math.hypot(a2[0], a2[1])) || 1);
        if (cs < Math.cos(75 * Math.PI / 180)) corner++;
        if (P[0] < fm || P[1] < fm || P[0] > W - fm || P[1] > H - fm) near++;
        const A20 = q[(i - 20 + n) % n], B20 = q[(i + 20) % n], L20 = Math.hypot(B20[0] - A20[0], B20[1] - A20[1]) || 1; let dv = 0;
        for (let k = -20; k <= 20; k += 2) { const Q = q[(i + k + n) % n]; dv = Math.max(dv, Math.abs((B20[0] - A20[0]) * (A20[1] - Q[1]) - (A20[0] - Q[0]) * (B20[1] - A20[1])) / L20); }
        total2++; if (dv < 1.2 * sc && L20 > 34 * sc) arc++;
      }
      for (let i = 0; i + 40 < n; i += 40) rough.push(40 / Math.max(1, Math.hypot(q[i + 40][0] - q[i][0], q[i + 40][1] - q[i][1])));
    }
    R.flat12 = r3(flat / Math.max(1, tot)); R.axis = r3(axis / Math.max(1, tot)); R.arc40 = r3(arc / Math.max(1, total2)); R.corners = +(corner / Math.max(1, tot) * 1000).toFixed(1); R.nearFrame = r3(near / Math.max(1, tot));
    rough.sort((a, b) => a - b); const rm = mean(rough), rsd = Math.sqrt(mean(rough.map(v => (v - rm) ** 2)));
    R.roughMean = r3(rm); R.roughCV = r3(rsd / (rm || 1)); R.roughP10 = rough.length ? r3(rough[Math.floor(rough.length * 0.1)]) : 0; R.roughP90 = rough.length ? r3(rough[Math.floor(rough.length * 0.9)]) : 0;

    // --- замкнутая вода внутри суши (озёра + внутренние моря) ---
    const inner = components(W, H, (i) => h[i] <= 0, 1).filter(c => !c.some(i => { const x = i % W, y = (i / W) | 0; return x === 0 || y === 0 || x === W - 1 || y === H - 1; }) && c.length >= 8 * A);
    { const big = inner.filter(c => c.length >= 300 * A); R.seaBasins = big.length; const rd = big.map(c => { let mx = 0, my = 0; for (const i of c) { mx += i % W; my += (i / W) | 0; } mx /= c.length; my /= c.length; let rmax = 0; for (const i of c) rmax = Math.max(rmax, Math.hypot(i % W - mx, ((i / W) | 0) - my)); return c.length / (Math.PI * rmax * rmax); }); R.basinRound = rd.length ? r3(mean(rd)) : 0; }
    R.innerWater = inner.length; R.innerFrac = +(inner.reduce((s, c) => s + c.length, 0) / Math.max(1, landN)).toFixed(4);

    // --- озёра (map.lake, из гидрологии): по размерам и цепочки (≥3 озера, расстояние между соседями ≤ 18 px при 480) ---
    if (map.lake) {
      const lk = components(W, H, (i) => map.lake[i] > 0, 1), cx = lk.map(c => { let x = 0, y = 0; for (const i of c) { x += i % W; y += (i / W) | 0; } return [x / c.length, y / c.length]; }), rad = lk.map(c => Math.sqrt(c.length / Math.PI));
      R.lakes = lk.length; R.lakesSmall = lk.filter(c => c.length < 50 * A).length; R.lakesMid = lk.filter(c => c.length >= 50 * A && c.length < 200 * A).length; R.lakesBig = lk.filter(c => c.length >= 200 * A).length;
      const par = lk.map((_, i) => i), f = (a) => par[a] === a ? a : (par[a] = f(par[a])); for (let i = 0; i < lk.length; i++) for (let j = i + 1; j < lk.length; j++) if (Math.hypot(cx[i][0] - cx[j][0], cx[i][1] - cx[j][1]) - rad[i] - rad[j] <= 18 * sc) par[f(i)] = f(j);
      const grp = new Map(); for (let i = 0; i < lk.length; i++) { const r = f(i); grp.set(r, (grp.get(r) || 0) + 1); }
      R.lakeChains = [...grp.values()].filter(n => n >= 3).length;
    }
    // --- узкие перемычки: размыкание (эрозия + дилатация радиуса r) ---
    const rr = Math.max(2, Math.round(2 * sc));
    let m1 = new Uint8Array(N); for (let i = 0; i < N; i++) m1[i] = h[i] > 0 ? 1 : 0;
    const er = (a) => { const o = new Uint8Array(N); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; o[i] = a[i] && a[i - 1] && a[i + 1] && a[i - W] && a[i + W] ? 1 : 0; } return o; };
    const di = (a) => { const o = new Uint8Array(N); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; o[i] = a[i] || a[i - 1] || a[i + 1] || a[i - W] || a[i + W] ? 1 : 0; } return o; };
    let o = m1; for (let k = 0; k < rr; k++) o = er(o); for (let k = 0; k < rr; k++) o = di(o);
    let lost = 0; for (let i = 0; i < N; i++) if (m1[i] && !o[i]) lost++;
    const c0 = components(W, H, (i) => m1[i] === 1, Math.round(200 * A)).length, c1 = components(W, H, (i) => o[i] === 1, Math.round(200 * A)).length;
    R.neckSplits = Math.max(0, c1 - c0); R.thinLost = r3(lost / Math.max(1, landN));

    // --- согласованность коры и суши, горообразования ---
    if (map.plates && map.plateId) {
      let cN = 0, cL = 0, lC = 0, yW = 0, yL = 0;
      for (let i = 0; i < N; i++) { const c = map.plates[map.plateId[i]].type === 'continental', l = h[i] > 0; if (c) { cN++; if (l) cL++; } if (l && c) lC++; yW += map.young[i]; if (l) yL += map.young[i]; }
      if (map.crust) { let lc = 0, sc2 = 0, sN = 0, cor = 0; for (let i = 0; i < N; i++) { if (h[i] > 0) { if (map.crust[i] > 0.35) lc++; } else if (h[i] < -0.15) { sN++; if (map.crust[i] > 0.6) sc2++; } } R.landOnCrust = r3(lc / Math.max(1, landN)); R.seaOnCrust = r3(sc2 / Math.max(1, sN)); }
      R.landOnContPlate = r3(cL / Math.max(1, cN)); R.contPlateOnLand = r3(lC / Math.max(1, landN)); R.youngOnLand = r3(yL / Math.max(1e-9, yW));
    }
    // --- раскладка массивов на листе ---
    if (cen.length >= 2) {
      const dx = (cen[1][0] - cen[0][0]) * W, dy = (cen[1][1] - cen[0][1]) * H; R.layoutHoriz = r3(Math.abs(dx) / Math.hypot(dx, dy));   // 1 = два главных массива строго «слева/справа»
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0; for (const c of cen) { sx += c[0]; sy += c[1]; } sx /= cen.length; sy /= cen.length; for (const c of cen) { sxx += (c[0] - sx) ** 2; syy += (c[1] - sy) ** 2; sxy += (c[0] - sx) * (c[1] - sy); }
      R.layoutSpread = r3(Math.sqrt((sxx + syy) / cen.length));
    }
    return R;
  }

  // бинарная маска суши в уменьшенном виде (для различия силуэтов между seed)
  function mask(map, w, hh) {
    const o = new Uint8Array(w * hh); for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; const x0 = Math.floor(x * map.W / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * map.W / w)), y0 = Math.floor(y * map.H / hh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * map.H / hh)); for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { n++; if (map.h[yy * map.W + xx] > 0) s++; } o[y * w + x] = s * 2 >= n ? 1 : 0; } return o;
  }

  // лист силуэтов: сетка cols×rows карт, подписи seed; возвращает canvas
  function tiles(ctx, maps, labels, x0, y0, tw, th, cols) {
    maps.forEach((m, k) => {
      const tc = document.createElement('canvas'); tc.width = m.W; tc.height = m.H; const t = tc.getContext('2d'), im = t.createImageData(m.W, m.H);
      for (let i = 0; i < m.W * m.H; i++) { const v = m.h[i], p = i * 4; if (v > 0) { const g = Math.min(1, 0.55 + v * 0.5); im.data[p] = 150 * g + 70; im.data[p + 1] = 140 * g + 70; im.data[p + 2] = 100 * g + 50; } else { const d = Math.max(0, 1 - (m.wd ? m.wd[i] : 12) / 30); im.data[p] = 24 + 10 * d; im.data[p + 1] = 40 + 16 * d; im.data[p + 2] = 58 + 20 * d; } im.data[p + 3] = 255; }
      t.putImageData(im, 0, 0); const x = x0 + (k % cols) * tw, y = y0 + ((k / cols) | 0) * th;
      ctx.drawImage(tc, x, y, tw - 3, th - 3); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px sans-serif'; ctx.fillText(labels[k], x + 5, y + 13);
    });
  }
  function sheet(blocks, opts) {   // blocks: [{title, maps, labels}], два блока рядом
    const cols = opts.cols || 4, rows = Math.ceil(blocks[0].maps.length / cols), tw = opts.tw || 240, th = opts.th || 160, gap = 36, hd = 34;
    const cv = document.createElement('canvas'); cv.width = blocks.length * cols * tw + (blocks.length - 1) * gap; cv.height = hd + rows * th; const c = cv.getContext('2d');
    c.fillStyle = '#10161e'; c.fillRect(0, 0, cv.width, cv.height);
    blocks.forEach((b, k) => { const x0 = k * (cols * tw + gap); c.fillStyle = '#e8e0cc'; c.font = 'bold 16px sans-serif'; c.fillText(b.title, x0 + 6, 22); tiles(c, b.maps, b.labels, x0, hd, tw, th, cols); });
    return cv.toDataURL('image/png');
  }
  window.__CM = { metricsOf, hashOf, mask, sheet };
})();
