// Планировка карты города: дороги, ворота, стены, кварталы, здания, поля (FM.cityPlan).
(function (FM) {
  'use strict';
  const { CW, CH, CX, CY, U, METERS, SPEC, bil, chaikin, segDist, obbOverlap, mkObb } = FM.CM;
  const { mulberry32, hashString, makeNoise, fbm, clamp } = FM;

  // ---------- планировка ----------
  FM.cityPlan = function (map, pol, city, opts) {
    opts = opts || {};
    const variant = opts.variant || 0, custom = opts.custom || [];
    const spec = SPEC[city.type] || SPEC.town, rand = mulberry32(hashString(map.seed + '|cityplan|' + city.key + '|' + variant));
    const noise = makeNoise(mulberry32(hashString(map.seed + '|citynoise|' + city.key)));
    let cx = city.x, cy = city.y; const R = spec.R * (0.92 + 0.16 * rand());
    // река редко течёт ровно через центр: города стоят на берегу, а не посреди русла (≈75% городов сдвигаются от реки)
    if (['capital', 'city', 'town', 'village'].includes(city.type) && !opts.noRiverShift && (hashString('rv|' + map.seed + city.key) % 100) < 75) {
      const W0 = map.W, H0 = map.H, ix = Math.round(cx), iy = Math.round(cy); let nd = 1e9, nx0 = 0, ny0 = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = ix + dx, y = iy + dy; if (x < 0 || y < 0 || x >= W0 || y >= H0 || !map.riverMask[y * W0 + x]) continue;
        const d = Math.hypot(x - cx, y - cy); if (d < nd) { nd = d; nx0 = x; ny0 = y; }
      }
      const dmin = Math.max(1.2, 0.5 * spec.R / U + 0.4);
      if (nd < dmin) {
        let vx = cx - nx0, vy = cy - ny0, l = Math.hypot(vx, vy);
        if (l < 0.05) { const a = (hashString('rva' + city.key) % 628) / 100; vx = Math.cos(a); vy = Math.sin(a); l = 1; }
        const k = (dmin - nd) / l, tx = cx + vx * k, ty = cy + vy * k;
        if (bil(map, tx, ty) > 0.03 && bil(map, tx + vx * 0.8, ty + vy * 0.8) > 0.0) { cx = tx; cy = ty; }
      }
    }
    const plan = { W: CW, H: CH, name: city.name, type: city.type, key: city.key, spec, R, variant, custom, ruin: !!spec.ruin };

    // --- вода: поле высоты в локальных координатах (шаг 5) ---
    const GS = 5, GW = CW / GS + 1, GH = CH / GS + 1, f = new Float32Array(GW * GH), hf = new Float32Array(GW * GH);
    let wetCount = 0;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const px = i * GS, py = j * GS;
      const v0 = bil(map, cx + (px - CX) / U, cy + (py - CY) / U), v = v0 + 0.03 * fbm(noise, px * 0.011, py * 0.011, 3);
      hf[j * GW + i] = v0; f[j * GW + i] = v; if (v <= 0) wetCount++;
    }
    plan.field = { f, hf, GW, GH, GS }; plan.waterFrac = wetCount / f.length;
    plan.biome = map.biome ? map.biome[clamp(Math.round(cy), 0, map.H - 1) * map.W + clamp(Math.round(cx), 0, map.W - 1)] : 5;   // биом места — для цвета земли в цветном стиле
    const waterAt = (x, y) => { const i = clamp(Math.round(x / GS), 0, GW - 1), j = clamp(Math.round(y / GS), 0, GH - 1); return f[j * GW + i] <= 0.008; };

    // --- реки ---
    const rivers = [];
    for (const rv of map.rivers || []) {
      let run = [];
      for (const p of rv) {
        const px = CX + (p[0] - cx) * U, py = CY + (p[1] - cy) * U;
        if (px > -120 && px < CW + 120 && py > -120 && py < CH + 120) run.push([px, py, p[2]]);
        else { if (run.length > 1) rivers.push(run); run = []; }
      }
      if (run.length > 1) rivers.push(run);
    }
    const chaikin3 = (pts, it) => {                      // сглаживание точек вида [x, y, ширина]
      for (let k = 0; k < it; k++) {
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]); }
        out.push(pts[pts.length - 1]); pts = out;
      }
      return pts;
    };
    const mean = (r) => r.reduce((a, p) => a + p[2], 0) / r.length;
    const smoothPts = (pts, passes, win) => {           // скользящее среднее: убирает «клеточные» изломы мирового русла, концы остаются на месте
      for (let k = 0; k < passes; k++) {
        const out = pts.map(p => p.slice());
        for (let i = 1; i < pts.length - 1; i++) {
          const m = Math.min(win, i, pts.length - 1 - i); let sx = 0, sy = 0, sw = 0;
          for (let j = i - m; j <= i + m; j++) { sx += pts[j][0]; sy += pts[j][1]; sw += pts[j][2]; }
          const c = 2 * m + 1; out[i] = [sx / c, sy / c, sw / c];
        }
        pts = out;
      }
      return pts;
    };
    let sm0 = rivers.map(r => {
      let q = chaikin3(r.map(p => [p[0], p[1], 5 + 13 * p[2]]), 2);
      q = smoothPts(q, 3, 5); q = smoothPts(q.map(p => [p[0], p[1], p[2]]), 2, 8);
      return q.map(p => {                                // лёгкая плавная извилистость (зависит только от места, чтобы притоки сходились с руслом)
        const dx = fbm(noise, p[0] * 0.008 + 11, p[1] * 0.008, 2) * 7, dy = fbm(noise, p[0] * 0.008, p[1] * 0.008 + 37, 2) * 7;
        return [p[0] + dx, p[1] + dy, p[2]];
      });
    });
    sm0.forEach((r) => {                                 // истоки рек не бывают в пределах карты города: русло продолжается вверх по течению за край листа
      const a = r[0], b = r[Math.min(5, r.length - 1)];
      if (a[0] < 30 || a[0] > CW - 30 || a[1] < 30 || a[1] > CH - 30) return;
      let dx = a[0] - b[0], dy = a[1] - b[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const head = []; let x = a[0], y = a[1], ph = rand() * 6.28;
      for (let k = 0; k < 300; k++) {
        ph += 0.15; const wob = Math.sin(ph) * 0.18; const c = Math.cos(wob), sn = Math.sin(wob), ndx = dx * c - dy * sn, ndy = dx * sn + dy * c; dx = ndx; dy = ndy;
        x += dx * 6; y += dy * 6; head.push([x, y, a[2]]);
        if (x < -30 || x > CW + 30 || y < -30 || y > CH + 30) break;
      }
      head.reverse(); r.unshift(...head);
    });
    const snapTo = (pt, skip) => {                       // конец притока — ровно на русло, в которое он впадает
      let best = null;
      sm0.forEach((o, j) => { if (j === skip) return; for (let i = 0; i < o.length - 1; i++) { const q = segDist(pt[0], pt[1], o[i], o[i + 1]); if (!best || q.d < best.d) { const t = Math.max(0, Math.min(1, ((pt[0] - o[i][0]) * (o[i + 1][0] - o[i][0]) + (pt[1] - o[i][1]) * (o[i + 1][1] - o[i][1])) / (((o[i + 1][0] - o[i][0]) ** 2 + (o[i + 1][1] - o[i][1]) ** 2) || 1))); best = { d: q.d, x: o[i][0] + (o[i + 1][0] - o[i][0]) * t, y: o[i][1] + (o[i + 1][1] - o[i][1]) * t }; } } });
      return best && best.d < 34 ? best : null;
    };
    sm0.forEach((r, idx) => { const sn = snapTo(r[r.length - 1], idx); if (sn) { r[r.length - 1] = [sn.x, sn.y, r[r.length - 1][2]]; } });
    plan.rivers = sm0.map(sm => {
      const n0 = sm.length;
      for (let i = 0; i < n0; i++) sm[i][2] = Math.max(4.2, sm[i][2]);
      {                                                  // устье: если русло кончается у водоёма — продолжаем его в воду
        const last = sm[sm.length - 1], prev = sm[Math.max(0, sm.length - 5)];
        let dx = last[0] - prev[0], dy = last[1] - prev[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        if (!waterAt(last[0], last[1]) && last[0] > 0 && last[0] < CW && last[1] > 0 && last[1] < CH && !snapTo(last, -1)) {
          let hit = false; for (let t = 6; t <= 110; t += 6) if (waterAt(last[0] + dx * t, last[1] + dy * t)) { hit = true; break; }
          if (hit) { let inW = 0; for (let t = 6; t <= 170 && inW < 5; t += 6) { const q = [last[0] + dx * t, last[1] + dy * t, last[2] * (1 + Math.min(0.5, t / 120))]; sm.push(q); if (waterAt(q[0], q[1])) inW++; } }
        } else if (waterAt(last[0], last[1])) { for (let t = 6; t <= 30; t += 6) sm.push([last[0] + dx * t, last[1] + dy * t, last[2] * 1.2]); }
      }
      return { pts: sm.map(p => [p[0], p[1]]), ws: sm.map(p => p[2]), w: Math.max(...sm.map(p => p[2])) * 0.9 };
    });
    const riverD = (x, y) => {
      let best = 1e9;
      for (const r of plan.rivers) for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        if (x < Math.min(a[0], b[0]) - 40 || x > Math.max(a[0], b[0]) + 40 || y < Math.min(a[1], b[1]) - 40 || y > Math.max(a[1], b[1]) + 40) continue;
        best = Math.min(best, segDist(x, y, a, b).d - (r.ws[i] + r.ws[i + 1]) / 4);
      }
      return best;
    };

    // --- стена: замкнутый многоугольник, башни в вершинах, прямые куртины между ними ---
    plan.walled = rand() < spec.wall;
    const NW = 96, wallR = [], quay = [];
    for (let i = 0; i < NW; i++) {
      const th = i / NW * Math.PI * 2, st = 1 + 0.08 * Math.cos(th * 2 + 1.3 + rand() * 0.01);
      let r = R * st * (0.95 + 0.08 * fbm(noise, Math.cos(th) * 1.3 + 9, Math.sin(th) * 1.3 + 9, 2)), q = 0;
      while (r > R * 0.32 && (waterAt(CX + Math.cos(th) * r, CY + Math.sin(th) * r) || (!plan.walled && riverD(CX + Math.cos(th) * r, CY + Math.sin(th) * r) < 3))) { r -= 5; q = 1; }
      wallR.push(r); quay.push(q);
    }
    for (let k = 0; k < 3; k++) for (let i = 0; i < NW; i++) wallR[i] = (wallR[(i + NW - 1) % NW] + 2 * wallR[i] + wallR[(i + 1) % NW]) / 4;
    let rwImpl = (th) => { const t = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * NW, i = Math.floor(t) % NW, u = t - Math.floor(t); return wallR[i] * (1 - u) + wallR[(i + 1) % NW] * u; };
    const rw = (th) => rwImpl(th);
    plan.wallPoly = null;
    if (plan.walled) {
      const N = Math.max(10, Math.round(2 * Math.PI * R / 58)), V = [];
      for (let i = 0; i < N; i++) {
        const th = (i + (rand() - 0.5) * 0.16) / N * 2 * Math.PI, r = rwImpl(th), qi = Math.round(th / (2 * Math.PI) * NW) % NW;
        V.push({ x: CX + Math.cos(th) * r, y: CY + Math.sin(th) * r, th, q: quay[qi] });
      }
      const curtains = V.map((a, i) => {
        const b = V[(i + 1) % N], L = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
        let t0 = null, t1 = null;                                     // куртина пересекает реку — делаем водные ворота
        for (let t = 0; t <= L; t += 3) { const x = a.x + ux * t, y = a.y + uy * t; if (riverD(x, y) < 2) { if (t0 == null) t0 = t; t1 = t; } }
        return { a, b, L, skip: a.q && b.q, gate: null, cross: t0 != null ? { t0: Math.max(4, t0 - 7), t1: Math.min(L - 4, t1 + 7) } : null };
      });
      plan.wallPoly = { V, curtains };
      rwImpl = (th) => {                                              // радиус города = расстояние до стены вдоль луча
        th = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        let i = N - 1; for (let k = 0; k < N; k++) if (V[k].th > th) { i = (k + N - 1) % N; break; }
        const P = V[i], Q = V[(i + 1) % N], dx = Math.cos(th), dy = Math.sin(th), ex = Q.x - P.x, ey = Q.y - P.y, den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-6) return Math.hypot(P.x - CX, P.y - CY);
        const sv = ((P.x - CX) * ey - (P.y - CY) * ex) / den; return sv > 0 ? sv : Math.hypot(P.x - CX, P.y - CY);
      };
    }
    plan.wall = [];

    // --- подъезды дорог → ворота ---
    const approaches = [];
    for (const road of pol.roads || []) {
      const path = road.path; if (!path || path.length < 2) continue;
      let bi = -1, bd = 1e9;
      path.forEach((c, i) => { const d = Math.hypot(c % map.W - cx, ((c / map.W) | 0) - cy); if (d < bd) { bd = d; bi = i; } });
      if (bd > 2.2) continue;
      for (const dir of [-1, 1]) {
        const pts = [];
        for (let i = bi; i >= 0 && i < path.length; i += dir) {
          const c = path[i]; pts.push([CX + ((c % map.W) - cx) * U, CY + (((c / map.W) | 0) - cy) * U]);
          if (Math.hypot(pts[pts.length - 1][0] - CX, pts[pts.length - 1][1] - CY) > 780) break;
        }
        for (let i = 1; i < pts.length; i++) {                       // дорога не уходит в воду
          const m = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2];
          if (waterAt(pts[i][0], pts[i][1]) || waterAt(m[0], m[1])) { pts.length = i; break; }
        }
        if (pts.length < 3) continue;
        const far = pts[Math.min(pts.length - 1, 3)], ang = Math.atan2(far[1] - CY, far[0] - CX);
        const ex = approaches.find(a => Math.abs(Math.atan2(Math.sin(a.ang - ang), Math.cos(a.ang - ang))) < 0.45);
        if (ex) { ex.cls = Math.max(ex.cls, road.cls || 1); continue; }
        approaches.push({ ang, cls: road.cls || 1, pts });
      }
    }
    const rayLand = (ang) => { let l = 0, n = 0; for (let t = R * 0.6; t < 560; t += 25) { n++; if (!waterAt(CX + Math.cos(ang) * t, CY + Math.sin(ang) * t) && riverD(CX + Math.cos(ang) * t, CY + Math.sin(ang) * t) > 2) l++; } return l / n; };
    if (!approaches.length && city.type !== 'mine') {                // дорог нет: ворота только туда, где суша
      const want = spec.R > 150 ? 3 : 2, a0 = rand() * 6.28, cand = [];
      for (let k = 0; k < 24; k++) { const ang = a0 + k * Math.PI / 12; cand.push({ ang, q: rayLand(ang) + rand() * 0.05 }); }
      cand.sort((a, b) => b.q - a.q);
      for (const c of cand) {
        if (approaches.length >= want || c.q < 0.85) break;
        if (approaches.some(a => Math.abs(Math.atan2(Math.sin(a.ang - c.ang), Math.cos(a.ang - c.ang))) < 1.2)) continue;
        approaches.push({ ang: c.ang, cls: 2, pts: [[CX, CY], [CX + Math.cos(c.ang) * 800, CY + Math.sin(c.ang) * 800]] });
      }
      if (!approaches.length && cand[0].q > 0.5) approaches.push({ ang: cand[0].ang, cls: 2, pts: [[CX, CY], [CX + Math.cos(cand[0].ang) * 800, CY + Math.sin(cand[0].ang) * 800]] });
    }
    approaches.sort((a, b) => b.cls - a.cls);
    const usedC = new Set();
    plan.gates = approaches.slice(0, 6).map(a => {
      if (plan.walled && plan.wallPoly) {                              // ворота всегда в середине куртины, между двумя башнями
        const cs = plan.wallPoly.curtains; let bi = -1, bd = 1e9;
        cs.forEach((c, i) => {
          if (c.skip || c.cross || usedC.has(i)) return;
          const mx = (c.a.x + c.b.x) / 2, my = (c.a.y + c.b.y) / 2, ang = Math.atan2(my - CY, mx - CX), d = Math.abs(Math.atan2(Math.sin(ang - a.ang), Math.cos(ang - a.ang)));
          if (d < bd) { bd = d; bi = i; }
        });
        if (bi < 0 || bd > 0.6) return null;
        usedC.add(bi); const c = cs[bi], mx = (c.a.x + c.b.x) / 2, my = (c.a.y + c.b.y) / 2;
        return { x: mx, y: my, ang: Math.atan2(my - CY, mx - CX), cls: a.cls, pts: a.pts, curtain: bi };
      }
      const r = rw(a.ang);
      return { x: CX + Math.cos(a.ang) * r, y: CY + Math.sin(a.ang) * r, ang: a.ang, cls: a.cls, pts: a.pts };
    }).filter(g => {
      if (!g) return false;                         // ворота только на суше, и за ними тоже суша
      if (waterAt(g.x, g.y) || riverD(g.x, g.y) < 4) return false;
      let l = 0, n = 0; for (let t = 25; t <= 125; t += 20) { n++; if (!waterAt(g.x + Math.cos(g.ang) * t, g.y + Math.sin(g.ang) * t)) l++; }
      return l / n >= 0.8;
    });

    if (plan.wallPoly) for (const g of plan.gates) if (g.curtain != null) plan.wallPoly.curtains[g.curtain].gate = g;

    // --- улицы: каркас по типу города (радиально-кольцевой / сетка), кварталы — полигоны между улицами ---
    const streets = [];
    const cw = (cls) => 8 + cls * 3, pR0 = ({ village: 17, mine: 15, fortress: 18, ruin: 20, town: 34, port: 36, city: 38, capital: 48 })[city.type] || 30;
    const wetAt = (x, y) => { const i = clamp(Math.round(x / GS), 0, GW - 1), j = clamp(Math.round(y / GS), 0, GH - 1); return f[j * GW + i] < 0.014; };
    const dS = (x, y) => Math.hypot(x - CX, y - CY) / rw(Math.atan2(y - CY, x - CX));
    for (const g of plan.gates) {                      // дороги за стеной
      const outer = [[g.x, g.y]]; const rr = rw(g.ang);
      for (const p of g.pts) { if (waterAt(p[0], p[1])) break; if (Math.hypot(p[0] - CX, p[1] - CY) > rr + 25) outer.push(p); }
      if (outer.length >= 2) streets.push({ pts: chaikin(outer, 2), w: cw(g.cls) - 3, outer: 1 });
    }
    plan.center = [CX, CY];
    const RING = 0.93, rIn = pR0 * 0.9, TAU = Math.PI * 2, blocks = [], xnodes = [];
    let Rm = 0; for (let i = 0; i < 48; i++) Rm += rw(i / 48 * TAU) / 48;
    const okPt = (x, y) => dS(x, y) <= RING + 1e-6 && Math.hypot(x - CX, y - CY) >= rIn - 1e-6;
    const resample = (A, B, step) => { const L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.ceil(L / step)); return Array.from({ length: n + 1 }, (_, i) => [A[0] + (B[0] - A[0]) * i / n, A[1] + (B[1] - A[1]) * i / n]); };
    const pushRuns = (pts, w, extra, cut) => {        // улица обрезается водой, длинные участки вдоль реки убираются, короткие пересечения реки — мосты
      const n = pts.length, bad = pts.map(p => wetAt(p[0], p[1]) || (cut && cut(p)));
      const rv = pts.map(p => riverD(p[0], p[1]) < 2.5);
      for (let i = 0; i < n;) { if (!rv[i]) { i++; continue; } let j = i; while (j < n && rv[j]) j++; if (j - i > 5) for (let k = i; k < j; k++) bad[k] = true; i = j; }
      let run = []; const flush = () => { if (run.length >= 2) streets.push(Object.assign({ pts: run, w }, extra)); run = []; };
      for (let i = 0; i < n; i++) { if (bad[i]) flush(); else run.push(pts[i]); } flush();
    };
    const inPoly = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const polyD = (poly, x, y) => { let m = 1e9; for (let i = 0; i < poly.length; i++) { const d = segDist(x, y, poly[i], poly[(i + 1) % poly.length]).d; if (d < m) m = d; } return m; };
    const radial = ['capital', 'city', 'town'].includes(city.type);
    const ringLine = (q) => { const pts = []; for (let i = 0; i <= 96; i++) { const th = (i % 96) / 96 * TAU, r = rw(th) * q; pts.push([CX + Math.cos(th) * r, CY + Math.sin(th) * r]); } return pts; };
    if (radial) {
      const bandsN = Math.max(1, Math.round((RING * Rm - rIn) / 68)), q = (k) => rIn / Rm + (RING - rIn / Rm) * Math.pow(k / bandsN, 1.18);   // кольца гуще к центру
      const wph = rand() * 100, warp = (p) => {                  // плавный изгиб улиц: смещение по шуму, нулевое у площади и у стены (ворота остаются на месте)
        const d = dS(p[0], p[1]), am = 12 * clamp(d / 0.3, 0, 1) * clamp((0.88 - d) / 0.15, 0, 1); if (am <= 0.01) return p;
        return [p[0] + fbm(noise, p[0] * 0.011 + wph, p[1] * 0.011, 2) * am, p[1] + fbm(noise, p[0] * 0.011, p[1] * 0.011 + wph + 50, 2) * am];
      };
      const A = plan.gates.map(g => ({ a: ((g.ang % TAU) + TAU) % TAU, prim: 1, g })).sort((p, r) => p.a - r.a);
      if (!A.length) A.push({ a: 0, prim: 1, g: null });
      const Kp = Math.max(A.length, Math.round(TAU * (rIn + (RING * Rm - rIn) * 0.55) / 80));
      while (A.length < Kp) { let bi = 0, bg = -1; A.forEach((p, i) => { const nx = A[(i + 1) % A.length], g = ((nx.a - p.a) % TAU + TAU) % TAU || TAU; if (g > bg) { bg = g; bi = i; } }); A.splice(bi + 1, 0, { a: (A[bi].a + bg * (0.5 + (rand() - 0.5) * 0.36)) % TAU, prim: 0, g: null }); }
      A.sort((p, r) => p.a - r.a);
      const pol = (th, k) => { const r = rw(th) * q(k); return warp([CX + Math.cos(th) * r, CY + Math.sin(th) * r]); };
      for (let k = 1; k <= bandsN; k++) pushRuns(ringLine(q(k)).map(warp), 7, { ring: 1 });
      const rad = (a, k0, k1, w, extra) => pushRuns(resample(pol(a, k0), pol(a, k1), 8).map(warp), w, extra);
      for (const p of A) {
        if (p.prim && p.g) {
          const g = p.g; pushRuns(resample([CX + Math.cos(p.a) * pR0 * 0.35, CY + Math.sin(p.a) * pR0 * 0.35], [g.x, g.y], 8).map(warp), cw(g.cls), { main: 1 });
        } else rad(p.a, p.prim ? 0 : Math.min(1, bandsN - 1), bandsN, 6, {});
        for (let k = 1; k < bandsN; k++) xnodes.push(pol(p.a, k));
      }
      for (let b = 1; b <= bandsN; b++) {              // кварталы кольцевого пояса b между соседними радиальными улицами; широкие делятся переулком
        const act = A.filter(p => p.prim || b > 1 || bandsN === 1), Q1 = q(b - 1), Q2 = q(b);
        act.forEach((p, i) => {
          const nx = act[(i + 1) % act.length]; let a0 = p.a, a1 = nx.a; if (a1 <= a0) a1 += TAU;
          const span = (a1 - a0) * rw(a0) * Q2, cuts = span > 98 ? Math.floor(span / 70) : 0, parts = [];
          for (let c = 0; c <= cuts; c++) parts.push(a0 + (a1 - a0) * c / (cuts + 1));
          parts.push(a1);
          for (let c = 1; c <= cuts; c++) pushRuns(resample(pol(parts[c], b - 1), pol(parts[c], b), 8).map(warp), 4, { lane: 1 });
          for (let c = 0; c <= cuts; c++) {
            const t0 = parts[c], t1 = parts[c + 1], n = Math.max(2, Math.ceil((t1 - t0) * rw(t0) * Q2 / 14)), poly = [];
            for (let s = 0; s <= n; s++) poly.push(pol(t0 + (t1 - t0) * s / n, b)); for (let s = n; s >= 0; s--) poly.push(pol(t0 + (t1 - t0) * s / n, b - 1));   // pol уже с изгибом
            blocks.push(poly);
          }
        });
      }
    } else {
      let phi = plan.gates[0] ? plan.gates[0].ang : 0;
      if (['village', 'mine', 'ruin'].includes(city.type)) {      // ось посёлка — по воротам или перпендикулярно, где меньше реки и воды
        const cand = [...plan.gates.map(g => g.ang), ...plan.gates.map(g => g.ang + Math.PI / 2)]; let bs = 1e9;
        for (const a of cand) { let sc = 0; for (let t = -Rm; t <= Rm; t += 10) { const x = CX + Math.cos(a) * t, y = CY + Math.sin(a) * t; if (riverD(x, y) < 8 || wetAt(x, y)) sc++; if (riverD(x + Math.cos(a + 1.57) * 22, y + Math.sin(a + 1.57) * 22) < 6) sc += 0.5; if (riverD(x - Math.cos(a + 1.57) * 22, y - Math.sin(a + 1.57) * 22) < 6) sc += 0.5; } if (sc < bs - 0.01) { bs = sc; phi = a; } }
      }
      if (spec.port) { let vx = 0, vy = 0; for (let k = 0; k < 36; k++) { const th = k / 36 * TAU; for (const r of [60, 110, 170, 240]) if (waterAt(CX + Math.cos(th) * r, CY + Math.sin(th) * r)) { vx += Math.cos(th); vy += Math.sin(th); } } if (Math.hypot(vx, vy) > 0.5) phi = Math.atan2(vy, vx); }
      const ux = Math.cos(phi), uy = Math.sin(phi), vx2 = -uy, vy2 = ux, sx = spec.R < 150 ? 56 : 64, sy = spec.R < 150 ? 50 : 56, ext = Rm * 1.1;
      const P = (u, v) => [CX + ux * u + vx2 * v, CY + uy * u + vy2 * v];
      const cut = (p) => !okPt(p[0], p[1]);
      const nI = Math.ceil(ext / sy), nJ = Math.ceil(ext / sx), mainW = cw(1), linear = ['village', 'mine', 'ruin'].includes(city.type);
      if (linear) {                                   // линейный посёлок: главная улица вдоль оси, поперечные проулки, ряды участков по обе стороны
        const D = 44, st = 70;
        pushRuns(resample(P(-ext, 0), P(ext, 0), 8), mainW - 2, { main: 1 }, cut);
        for (let j = -Math.floor(ext / st); j <= Math.floor(ext / st); j++) {
          if (j !== 0) for (const sg of [-1, 1]) pushRuns(resample(P(j * st, 0), P(j * st, sg * D), 8), 4, { lane: 1 }, cut);
          for (const sg of [-1, 1]) { const c = P((j + 0.5) * st, sg * D / 2); if (dS(c[0], c[1]) < 0.95) { const bk = [P(j * st, 0), P((j + 1) * st, 0), P((j + 1) * st, sg * D), P(j * st, sg * D)]; bk.skipEdges = sg > 0 ? [2] : [2]; bk.noRows = true; blocks.push(bk); } }
        }
        for (const g of plan.gates) {
          let bp = null, bd = 1e9; for (const s of streets) { if (s.outer) continue; for (const p of s.pts) { const d = Math.hypot(p[0] - g.x, p[1] - g.y); if (d < bd) { bd = d; bp = p; } } }
          if (bp && bd > 3) streets.push({ pts: resample([g.x, g.y], bp, 8), w: cw(g.cls), main: 1 });
        }
        plan.nodes = []; plan.blocks = blocks;
      } else {
      for (let i = -nI; i <= nI; i++) pushRuns(resample(P(-ext, i * sy), P(ext, i * sy), 8), i === 0 ? mainW : 6, i === 0 ? { main: 1 } : {}, cut);
      for (let j = -nJ; j <= nJ; j++) pushRuns(resample(P(j * sx, -ext), P(j * sx, ext), 8), j === 0 ? mainW : 6, j === 0 ? { main: 1 } : {}, cut);
      pushRuns(ringLine(RING), 7, { ring: 1 });
      for (let i = -nI; i <= nI; i++) for (let j = -nJ; j <= nJ; j++) { const c = P(j * sx, i * sy); if (dS(c[0], c[1]) < 0.85 && Math.hypot(c[0] - CX, c[1] - CY) > rIn + 6) xnodes.push(c); }
      for (let i = -nI - 1; i <= nI; i++) for (let j = -nJ - 1; j <= nJ; j++) { const c = P((j + 0.5) * sx, (i + 0.5) * sy); if (dS(c[0], c[1]) < 1.02) blocks.push([P(j * sx, i * sy), P((j + 1) * sx, i * sy), P((j + 1) * sx, (i + 1) * sy), P(j * sx, (i + 1) * sy)]); }
      for (const g of plan.gates) {                    // въезд: ворота соединяются с ближайшей улицей
        let bp = null, bd = 1e9; for (const s of streets) { if (s.outer) continue; for (const p of s.pts) { const d = Math.hypot(p[0] - g.x, p[1] - g.y); if (d < bd) { bd = d; bp = p; } } }
        if (bp && bd > 3) streets.push({ pts: resample([g.x, g.y], bp, 8), w: cw(g.cls), main: 1 });
      }
      plan.nodes = xnodes; plan.blocks = blocks;
      }
    }
    if (radial) { plan.nodes = xnodes; plan.blocks = blocks; }
    const estuary = (x, y) => { const d = riverD(x, y); if (d > 40) return d; for (const [dx, dy] of [[26, 0], [-26, 0], [0, 26], [0, -26]]) if (wetAt(x + dx, y + dy)) return d - 12; return d; };   // у устья русло шире и берег размыт — запас для построек
    const riverAt = (x, y) => {
      let best = { d: 1e9, tx: 1, ty: 0, w: 10 };
      for (const r of plan.rivers) for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1], q = segDist(x, y, a, b), w = (r.ws[i] + r.ws[i + 1]) / 2;
        if (q.d - w / 2 < best.d) best = { d: q.d - w / 2, tx: q.tx, ty: q.ty, w };
      }
      return best;
    };
    // убрать куски улиц в воде/реке
    plan.streets = streets;
    plan.bridges = [];
    for (const s of streets) {
      let run = null;
      for (let i = 0; i < s.pts.length; i++) {
        const p = s.pts[i], bad = riverD(p[0], p[1]) < 2;
        if (bad) { (run = run || []).push(i); }
        else if (run) {
          const a = s.pts[run[0]], b = s.pts[run[run.length - 1]], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, rv = riverAt(mx, my);
          if (!plan.bridges.some(q => Math.hypot(q.x - mx, q.y - my) < 85)) { const i0 = Math.max(0, run[0] - 2), i1 = Math.min(s.pts.length - 1, run[run.length - 1] + 2), dx = s.pts[i1][0] - s.pts[i0][0], dy = s.pts[i1][1] - s.pts[i0][1], dl = Math.hypot(dx, dy) || 1, sn = Math.abs((dx * rv.ty - dy * rv.tx) / dl);
              plan.bridges.push({ x: mx, y: my, a: Math.atan2(dy, dx), len: (rv.w + 9) / Math.max(0.55, sn), w: s.w }); }
          run = null;
        }
      }
    }
    // набережные: улицы вдоль берегов рек в городе (с обеих сторон), прерываются у воды и на краю города
    if (plan.rivers.length && ['capital', 'city', 'town', 'port'].includes(city.type) && !plan.ruin) {
      for (const r of plan.rivers) {
        if (r.w < 8) continue;
        for (const side of [-1, 1]) {
          let run = []; const flush = () => { if (run.length >= 5) streets.push({ pts: run, w: 7, quay: 1 }); run = []; };
          for (let i = 0; i < r.pts.length; i++) {
            const a = r.pts[Math.max(0, i - 2)], b = r.pts[Math.min(r.pts.length - 1, i + 2)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, d = r.ws[i] / 2 + 7;
            const x = r.pts[i][0] - (b[1] - a[1]) / l * side * d, y = r.pts[i][1] + (b[0] - a[0]) / l * side * d;
            if (dS(x, y) < 0.88 && riverD(x, y) > 2.5 && !wetAt(x, y)) run.push([x, y]); else flush();
          }
          flush();
        }
      }
    }
    const nearest = (x, y) => {
      let best = { d: 1e9, tx: 1, ty: 0, w: 8 };
      for (const s of streets) for (let i = 0; i < s.pts.length - 1; i++) {
        const a = s.pts[i], b = s.pts[i + 1];
        if (x < Math.min(a[0], b[0]) - 60 || x > Math.max(a[0], b[0]) + 60 || y < Math.min(a[1], b[1]) - 60 || y > Math.max(a[1], b[1]) + 60) continue;
        const r = segDist(x, y, a, b), d = r.d - s.w / 2;
        if (d < best.d) best = { d, tx: r.tx, ty: r.ty, w: s.w };
      }
      return best;
    };

    // --- площадь, замок, храмы ---
    const typ = city.type, plazaR = ({ village: 17, mine: 15, fortress: 18, ruin: 20, town: 34, port: 36, city: 38, capital: 48 })[typ] || 30;
    const plazaShape = (x, y, r, ang, rect) => {          // чёткая форма: правильный восьмиугольник или прямоугольник со срезанными углами вдоль улицы
      const c = Math.cos(ang), sn = Math.sin(ang), T = (u, v) => [x + c * u - sn * v, y + sn * u + c * v];
      if (!rect) return Array.from({ length: 8 }, (_, i) => { const t = (i + 0.5) / 8 * 6.2832; return T(Math.cos(t) * r * 1.04, Math.sin(t) * r * 1.04); });
      const w = r * 1.25, h = r * 0.85, k = Math.min(w, h) * 0.28;
      return [T(-w + k, -h), T(w - k, -h), T(w, -h + k), T(w, h - k), T(w - k, h), T(-w + k, h), T(-w, h - k), T(-w, -h + k)];
    };
    plan.plaza = { x: CX, y: CY, r: plazaR, pts: plazaShape(CX, CY, plazaR, Math.PI / 8, false) };
    plan.plaza.pts = plan.plaza.pts;
    plan.plazas = [plan.plaza];
    const blds = [], hash = new Map(), HS = 64;
    const hkey = (x, y) => Math.floor(x / HS) * 4096 + Math.floor(y / HS);
    const insert = (b) => { blds.push(b); const k = hkey(b.x, b.y); (hash.get(k) || hash.set(k, []).get(k)).push(b); };
    const free = (b, pad) => {
      const gx = Math.floor(b.x / HS), gy = Math.floor(b.y / HS);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = hash.get((gx + i) * 4096 + gy + j); if (l) for (const o of l) if (obbOverlap(b, o, pad)) return false; }
      return true;
    };
    plan.keep = null;
    if (rand() < spec.keep) {
      const th = rand() * 6.28, d = rw(th) * 0.52, kx = CX + Math.cos(th) * d, ky = CY + Math.sin(th) * d, kr = spec.R > 200 ? 62 : 48;
      if (!waterAt(kx, ky) && riverD(kx, ky) > kr) plan.keep = { x: kx, y: ky, r: kr, a: th };
    }
    const inKeep = (x, y, pad) => plan.keep && Math.hypot(x - plan.keep.x, y - plan.keep.y) < plan.keep.r + pad;
    const dOf0 = (x, y) => Math.hypot(x - CX, y - CY) / rw(Math.atan2(y - CY, x - CX));
    {                                                  // дополнительные площади: у средних от двух, у больших пропорционально размеру, разного размера
      const extra = ({ port: 1, city: 2, capital: 4 })[typ] || 0, more = typ === 'capital' ? Math.round(R / 150) - 1 : 0;
      const want = extra + (typ === 'capital' ? Math.max(0, more) : 0), sizes = typ === 'capital' ? [34, 28, 22, 40, 18, 26] : typ === 'city' ? [26, 20] : [24];
      const cand = plan.nodes.length ? plan.nodes.map(q => [q[0], q[1]]) : []; if (!cand.length) for (const st of streets) if (!st.outer && !st.ring) for (let i = 2; i < st.pts.length - 2; i++) cand.push(st.pts[i]);
      for (let k = 0, n = 0; k < 400 && n < want && cand.length; k++) {
        const p = cand[Math.floor(rand() * cand.length)], r = sizes[n % sizes.length] * (0.9 + 0.2 * rand());
        if (Math.hypot(p[0] - CX, p[1] - CY) < plazaR + r + 40 || dOf0(p[0], p[1]) > 0.85) continue;
        if (waterAt(p[0], p[1]) || riverD(p[0], p[1]) < r + 6 || inKeep(p[0], p[1], r + 6)) continue;
        if (plan.plazas.some(q => Math.hypot(q.x - p[0], q.y - p[1]) < q.r + r + 30)) continue;
        { const ns = nearest(p[0], p[1]); plan.plazas.push({ x: p[0], y: p[1], r, pts: plazaShape(p[0], p[1], r, Math.atan2(ns.ty, ns.tx), true) }); n++; }
      }
    }
    for (const c of custom) { const t = FM.CITY_TEMPLATES[c.t]; if (t && c.t !== 'tree') insert(mkObb(c.x, c.y, t.w * (c.k || 1), t.h * (c.k || 1), c.a || 0, 'custom')); }

    const valid = (b, ang, wallPass) => {
      const r = Math.hypot(b.hw, b.hh);
      if (b.x < 24 || b.x > CW - 24 || b.y < 24 || b.y > CH - 24) return false;
      for (const [ox, oy] of [[0, 0], [b.hw + 4, b.hh + 4], [-b.hw - 4, b.hh + 4], [b.hw + 4, -b.hh - 4], [-b.hw - 4, -b.hh - 4], [b.hw + 4, 0], [-b.hw - 4, 0], [0, b.hh + 4], [0, -b.hh - 4]]) {
        const px = b.x + b.c * ox - b.s * oy, py = b.y + b.s * ox + b.c * oy;
        if (wetAt(px, py) || estuary(px, py) < 3) return false;
      }
      for (const g of plan.gates) if (Math.hypot(b.x - g.x, b.y - g.y) < 44 + r) return false;     // у ворот — свободное пространство
      if (plan.plazas.some(q => Math.hypot(b.x - q.x, b.y - q.y) < q.r + r * 0.7)) return false;
      if (inKeep(b.x, b.y, r)) return false;
      if (dOf(b.x, b.y) > 0.97) return false;
      const n = nearest(b.x, b.y);
      if (n.d < Math.min(b.hw, b.hh) * 0.9 + 1) return false;
      if (plan.walled) {                      // здания не стоят на самой стене
        const th = Math.atan2(b.y - CY, b.x - CX), dd = Math.hypot(b.x - CX, b.y - CY), wr = rw(th);
        if (dd > wr - r - 9 && dd < wr + 90) return false;   // у стены внутри — проезд, снаружи — свободная полоса
      }
      return free(b, 0.7);
    };
    const density = (x, y) => {
      const th = Math.atan2(y - CY, x - CX), d = Math.hypot(x - CX, y - CY) / rw(th);
      if (d < 1) return d < 0.85 ? 1 : 1 - 1.5 * (d - 0.85) ** 2 * 6;
      return clamp((1.3 - d) / 0.3, 0, 1) * 0.55;
    };
    const dOf = (x, y) => Math.hypot(x - CX, y - CY) / rw(Math.atan2(y - CY, x - CX));
    const nearWater = (x, y) => { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]]) for (const t of [18, 32, 46]) if (waterAt(x + dx * t, y + dy * t)) return true; return false; };

    // храмы
    for (let t = 0; t < spec.temples; t++) {
      for (let tries = 0; tries < 80; tries++) {
        const th = rand() * 6.28, d = plazaR + 30 + rand() * 40;
        const b = mkObb(CX + Math.cos(th) * d, CY + Math.sin(th) * d, 44 + rand() * 10, 26 + rand() * 6, th + Math.PI / 2 + (rand() < 0.5 ? 0 : Math.PI / 2), 'temple');
        if (valid(b)) { insert(b); break; }
      }
    }
    // кварталы: участки по периметру лицом к улице + ряды внутри (в осях квартала), без пустот
    const slopeAt = (x, y) => {                          // уклон по высотам мира: s (0..~0.8, как в отмывке), направление спуска (gx, gy)
      const i = clamp(Math.round(x / GS), 1, GW - 2), j = clamp(Math.round(y / GS), 1, GH - 2), hf = plan.field.hf;
      const dx = (hf[j * GW + i + 1] - hf[j * GW + i - 1]) / (2 * GS) * 520, dy = (hf[(j + 1) * GW + i] - hf[(j - 1) * GW + i]) / (2 * GS) * 520;
      return { s: Math.hypot(dx, dy), gx: dx, gy: dy };
    };
    const fillBlock = (poly) => {
      if (poly.park) return;
      let cx0 = 0, cy0 = 0; for (const p of poly) { cx0 += p[0] / poly.length; cy0 += p[1] / poly.length; }
      const dC = dOf(cx0, cy0); if (dC > 1.02) return;
      const hsh = Math.abs(Math.sin(cx0 * 12.9898 + cy0 * 78.233) * 43758.5453) % 1;
      const big = ['capital', 'city', 'port'].includes(city.type);          // районы: рынок в центре, знать у цитадели/храма, ремесленники, бедные окраины
      let dist = 'house';
      if (dC < 0.36 && big) dist = 'market';
      else if (big && ((plan.keep && Math.hypot(cx0 - plan.keep.x, cy0 - plan.keep.y) < plan.keep.r * 1.5 + 25) || (!plan.keep && dC > 0.4 && dC < 0.72 && hsh < 0.2))) dist = 'noble';
      else if (dC > 0.8) dist = 'poor';
      else if (big && hsh > 0.72) dist = 'craft';
      const sl = slopeAt(cx0, cy0), steep = clamp((sl.s - 0.42) / 0.3, 0, 1);       // крутой склон: меньше застройки, дома террасами вдоль горизонталей
      const zone = (dist === 'noble' ? 1 : 1.15 - 0.4 * Math.min(1, dC)) * (dist === 'poor' ? 0.82 : 1), keepP = () => rand() < (dist === 'noble' ? 0.78 : 0.98 - 0.35 * Math.max(0, dC - 0.62)) * (1 - 0.75 * steep);
      const wid = () => dist === 'noble' ? (rand() < 0.5 ? 20 : 24) : dist === 'market' ? (rand() < 0.5 ? 14 : 18) : (rand() < 0.6 ? 12 : 15), dep = () => dist === 'noble' ? 16 : dist === 'market' ? 13 : 12;
      const kindFor = (x, y, bw, bd) => (spec.port && nearWater(x, y) && rand() < 0.5) ? ['warehouse', 26, 12] : dist === 'noble' ? ['manor', bw, bd] : dist === 'craft' ? ['workshop', bw, bd] : (dist === 'market' && rand() < 0.3 ? ['hall', bw * 1.2, bd * 1.1] : ['house', bw, bd]);
      for (let i = 0; i < poly.length; i++) {
        if (poly.skipEdges && poly.skipEdges.includes(i)) continue;
        const a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 14) continue;
        const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L; let nx = -ty, ny = tx;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; if (!inPoly(poly, mx + nx * 4, my + ny * 4)) { nx = -nx; ny = -ny; }
        const sw = nearest(mx, my).w, ang = Math.atan2(ty, tx); let t = 1.5;
        while (t < L - 6) {
          const bw = wid() * zone, bd = dep() * zone;
          if (t + bw > L - 1) break;
          const off = sw / 2 + 1.1 + bd / 2, px = a[0] + tx * (t + bw / 2) + nx * off, py = a[1] + ty * (t + bw / 2) + ny * off;
          if (keepP()) { const [k, w2, d2] = kindFor(px, py, bw, bd), o2 = k === 'house' ? off : sw / 2 + 1.1 + d2 / 2, b2 = mkObb(a[0] + tx * (t + w2 / 2) + nx * o2, a[1] + ty * (t + w2 / 2) + ny * o2, w2, d2, ang, k); if (valid(b2)) insert(b2); }
          t += bw + (dist === 'noble' ? 4 : 0.9);
        }
      }
      if (poly.noRows) return;
      let bi = 0, bl = 0; poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl) { bl = l; bi = i; } });
      const a0 = poly[bi], b0 = poly[(bi + 1) % poly.length];
      let ux = (b0[0] - a0[0]) / bl, uy = (b0[1] - a0[1]) / bl;
      if (sl.s > 0.3) { const gl = Math.hypot(sl.gx, sl.gy) || 1, cx = -sl.gy / gl, cy = sl.gx / gl; if (Math.abs(cx * ux + cy * uy) < 0.9) { const sg = (cx * ux + cy * uy) < 0 ? -1 : 1; ux = cx * sg; uy = cy * sg; } }   // ряды вдоль горизонталей
      const vx = -uy, vy = ux, ua = ux * cx0 + uy * cy0, va = vx * cx0 + vy * cy0;
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const p of poly) { const u = ux * p[0] + uy * p[1], v = vx * p[0] + vy * p[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const ang = Math.atan2(uy, ux); let row = 0;
      for (let v = v0 + 12 * zone + 2; v < v1 - 8; v += dep() * zone + (row++ % 2 ? 3.5 : 0.4) + (dist === 'noble' ? 6 : 0)) {
        let u = u0 + 8;
        while (u < u1 - 8) {
          const bw = wid() * zone, uc = u + bw / 2, x = ux * uc + vx * v, y = uy * uc + vy * v;
          if (inPoly(poly, x, y) && polyD(poly, x, y) > 12 && keepP()) { const b2 = mkObb(x, y, bw, dep() * zone, ang, dist === 'noble' ? 'manor' : dist === 'craft' ? 'workshop' : 'house'); if (valid(b2)) insert(b2); }
          u += bw + (dist === 'noble' ? 5 : 0.9);
        }
      }
    };
    // парки и сады: в столицах и крупных городах несколько кварталов отдаются под зелень (не у центра и не у окраин)
    plan.parks = [];
    {
      const want = ({ capital: 3, city: 2, port: 1, town: 1 })[city.type] || 0;
      const area = p => { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(s) / 2; };
      const cands = [];
      for (const poly of blocks) {
        let mx = 0, my = 0; for (const p of poly) { mx += p[0] / poly.length; my += p[1] / poly.length; }
        const dC = dOf(mx, my), A = area(poly);
        if (dC < 0.3 || dC > 0.78 || A < 2200 || riverD(mx, my) < 25 || wetAt(mx, my) || plan.plazas.some(pz => Math.hypot(pz.x - mx, pz.y - my) < pz.r + 25)) continue;
        if (plan.keep && Math.hypot(plan.keep.x - mx, plan.keep.y - my) < plan.keep.r * 1.4 + 30) continue;
        cands.push({ poly, mx, my, A, h: Math.abs(Math.sin(mx * 12.9898 + my * 78.233) * 43758.5453) % 1 });
      }
      cands.sort((a, b) => (b.A * (0.6 + b.h)) - (a.A * (0.6 + a.h)));
      for (const cd of cands) {
        if (plan.parks.length >= want) break;
        if (plan.parks.some(q => Math.hypot(q.x - cd.mx, q.y - cd.my) < 150)) continue;
        cd.poly.park = true; plan.parks.push({ pts: cd.poly, x: cd.mx, y: cd.my, A: cd.A, pond: cd.h < 0.45 });
      }
    }
    for (const poly of blocks) fillBlock(poly);
    plan.buildings = blds.filter(b => b.kind !== 'custom');
    if (plan.ruin) plan.buildings.forEach(b => { b.ruin = rand() < 0.75; });
    for (const g of plan.gates) g.tower = true;

    // --- причалы ---
    plan.piers = []; plan.boats = [];
    if (spec.port || (waterAt(CX, CY - 60) || plan.waterFrac > 0.08) && rand() < 0.5) {
      for (let k = 0; k < 90 && plan.piers.length < (spec.port ? 7 : 3); k++) {
        const th = rand() * 6.28, r = rw(th) * (0.55 + 0.55 * rand()), x = CX + Math.cos(th) * r, y = CY + Math.sin(th) * r;
        if (waterAt(x, y)) continue;
        for (let a = 0; a < 6.28; a += 0.4) {
          const dx = Math.cos(a), dy = Math.sin(a);
          if (waterAt(x + dx * 14, y + dy * 14) && !waterAt(x - dx * 3, y - dy * 3)) {
            let L = 14; while (L < 70 && waterAt(x + dx * L, y + dy * L)) L += 4;
            if (L > 40 && plan.piers.every(p => Math.hypot(p.x - x, p.y - y) > 55)) {
              plan.piers.push({ x: x + dx * 6, y: y + dy * 6, a, len: 42 + rand() * 26 });
              if (rand() < 0.8) plan.boats.push({ x: x + dx * 36 - dy * 14, y: y + dy * 36 + dx * 14, a: a + 1.57 + (rand() - 0.5) * 0.3, l: 14 + rand() * 8 });
              break;
            }
          }
        }
      }
    }

    // причалы вдоль рек (речные города и порты)
    if (plan.rivers.length && ['port', 'town', 'city', 'capital'].includes(city.type)) {
      let cnt = 0; const maxP = spec.port ? 6 : 3;
      for (const r of plan.rivers) {
        if (r.w < 9) continue;
        for (let tries = 0; tries < 80 && cnt < maxP; tries++) {
          const i = 1 + Math.floor(rand() * (r.pts.length - 2)), p = r.pts[i], q = r.pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
          const nx = -dy / l, ny = dx / l, side = rand() < 0.5 ? -1 : 1, bx = p[0] + nx * side * (r.w / 2 + 1.5), by = p[1] + ny * side * (r.w / 2 + 1.5);
          if (Math.hypot(bx - CX, by - CY) > rw(Math.atan2(by - CY, bx - CX)) * 1.1 || waterAt(bx, by) || riverD(bx, by) < -1) continue;
          if (plan.piers.some(o => Math.hypot(o.x - bx, o.y - by) < 48)) continue;
          const a = Math.atan2(-ny * side, -nx * side);
          plan.piers.push({ x: bx - nx * side * 2, y: by - ny * side * 2, a, len: r.w * 0.55 + 8 });
          if (rand() < 0.7) plan.boats.push({ x: p[0] + dx / l * 14, y: p[1] + dy / l * 14, a: Math.atan2(dy, dx), l: 13 + rand() * 6 });
          cnt++;
        }
      }
    }

    // --- высоты зданий и ориентация коньков ---
    for (const b of plan.buildings) {
      if (b.hh > b.hw) { const t = b.hw; b.hw = b.hh; b.hh = t; b.a += Math.PI / 2; b.c = Math.cos(b.a); b.s = Math.sin(b.a); }
      const base = b.kind === 'hall' ? 9 : b.kind === 'manor' ? 10 : b.kind === 'warehouse' ? 7 : b.kind === 'temple' ? 13 : b.kind === 'workshop' ? 6 : 5 + 3 * rand();
      if (b.kind === 'workshop' && rand() < 0.55) b.chimney = true;
      b.hz = base * (0.9 + 0.2 * rand()); b.rh = b.kind === 'warehouse' ? 3 : Math.min(b.hh * 0.9, 4 + b.hh * 0.45);
    }

    // --- окрестности: зависят от статуса города и местности ---
    plan.fields = []; plan.trees = []; plan.deco = []; plan.stand = []; plan.hills = [];
    for (const pk of plan.parks) {                      // деревья парка: решётка с дрожью, пруд и дорожки свободны
      let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9; for (const p of pk.pts) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); }
      pk.pr = pk.pond ? Math.min(26, Math.sqrt(pk.A) * 0.22) : 0;
      for (let y = by0; y < by1; y += 12) for (let x = bx0; x < bx1; x += 12) {
        const tx = x + (rand() - 0.5) * 8, ty = y + (rand() - 0.5) * 8;
        if (!inPoly(pk.pts, tx, ty) || polyD(pk.pts, tx, ty) < 6 || (pk.pr && Math.hypot(tx - pk.x, (ty - pk.y) * 1.4) < pk.pr + 6)) continue;
        if (Math.abs((tx - pk.x) * 0.7 + (ty - pk.y) * 0.7) < 5 || Math.abs((tx - pk.x) * 0.7 - (ty - pk.y) * 0.7) < 5) continue;   // дорожки по диагоналям
        if (rand() < 0.8) plan.trees.push({ x: tx, y: ty, r: 4.5 + rand() * 3.5 });
      }
    }
    for (const p of plan.plazas) if (p.r >= 24) plan.stand.push({ k: 'fountain', x: p.x, y: p.y, r: Math.min(9, p.r * 0.2) });
    const ctype = city.type;
    const hAt = (x, y) => bil(map, cx + (x - CX) / U, cy + (y - CY) / U);
    const moistAt = (x, y) => { const i = Math.round(clamp(cy + (y - CY) / U, 0, map.H - 1)) * map.W + Math.round(clamp(cx + (x - CX) / U, 0, map.W - 1)); return map.moist ? map.moist[i] : 0.5; };
    const fert = clamp(moistAt(CX, CY) * 1.3, 0.3, 1.15);
    const forestP = clamp((moistAt(CX, CY) - 0.3) * 1.5, 0.05, 0.85) * (plan.ruin ? 1.4 : 1);
    let deposits = [];
    try { if (opts.resCfg) deposits = FM.getResources(map, opts.seed || map.seed, opts.resCfg).deposits; } catch (e) { deposits = []; }
    const local = deposits.map(d => ({ t: d.t, x: CX + (d.x - cx) * U, y: CY + (d.y - cy) * U })).filter(d => d.x > 80 && d.x < CW - 80 && d.y > 80 && d.y < CH - 80);
    const taken = [];
    const claim = (x, y, r) => taken.push({ x, y, r });
    const okSpot = (x, y, r, o) => {
      o = o || {};
      if (x < 40 + r * 0.5 || x > CW - 40 - r * 0.5 || y < 40 + r * 0.5 || y > CH - 40 - r * 0.5) return false;
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { if (waterAt(x + dx, y + dy)) return false; if (!o.river && estuary(x + dx, y + dy) < 4) return false; }
      if (!o.road && nearest(x, y).d < r * 0.5 + 6) return false;
      if (dOf(x, y) < (o.minD || 1.12)) return false;
      if (inKeep(x, y, r)) return false;
      for (const t of taken) if (Math.hypot(t.x - x, t.y - y) < t.r + r) return false;
      for (const b of blds) if (Math.hypot(b.x - x, b.y - y) < r + Math.hypot(b.hw, b.hh) + 4) return false;
      return true;
    };
    const ringPt = (lo, hi) => { const th = rand() * 6.28, r = rw(th) * (lo + rand() * (hi - lo)); return [CX + Math.cos(th) * r, CY + Math.sin(th) * r, th]; };
    const alongRoad = (x, y) => { const n = nearest(x, y); return Math.atan2(n.ty, n.tx); };
    const sizeOf = (kind, rr) => ({ house: [14, 10], barn: [20, 12], manor: [30, 19], hut: [11, 8], shed: [10, 7], smelter: [24, 15], chapel: [16, 10] })[kind];
    const addBld = (kind, x, y, a, extra) => {
      const [w, h] = sizeOf(kind), b = mkObb(x, y, w * (extra && extra.k || 1), h * (extra && extra.k || 1), a, kind);
      b.hz = ({ house: 6, barn: 8, manor: 9, hut: 4.5, shed: 4, smelter: 9, chapel: 9 })[kind] || 6; b.rh = Math.min(b.hh * 0.9, 3 + b.hh * 0.4);
      if (kind === 'smelter') b.chimney = true;
      plan.buildings.push(b); insert(b); return b;
    };
    const farmstead = (x, y, a) => {
      claim(x, y, 40);
      plan.deco.push({ k: 'fence', x, y, a, w: 54, h: 40 });
      const c = Math.cos(a), s = Math.sin(a), P = (u, v) => [x + c * u - s * v, y + s * u + c * v];
      const h1 = P(-12, -7), b1 = P(12, 8);
      addBld('house', h1[0], h1[1], a); addBld('barn', b1[0], b1[1], a);
      if (rand() < 0.6) { const w = P(2, -12); plan.stand.push({ k: 'haystack', x: w[0], y: w[1] }); }
    };

    // усадьбы с садами (столица, города)
    if (ctype === 'capital' || ctype === 'city') for (let k = 0, n = 0; k < 200 && n < (ctype === 'capital' ? 3 : 1); k++) {
      const [x, y] = ringPt(1.25, 1.9); if (!okSpot(x, y, 44, { road: true })) continue;
      const a = alongRoad(x, y); claim(x, y, 46); n++;
      plan.deco.push({ k: 'garden', x, y, a, w: 78, h: 58 }); addBld('manor', x, y, a);
    }
    // ветряки
    if (['capital', 'city', 'town', 'village'].includes(ctype)) for (let k = 0, n = 0; k < 150 && n < (ctype === 'village' ? 1 : 2); k++) {
      const [x, y] = ringPt(1.3, 2.3); if (!okSpot(x, y, 22, { road: true })) continue;
      claim(x, y, 24); n++; plan.stand.push({ k: 'windmill', x, y, a: rand() * 0.8 - 0.4 });
    }
    // водяная мельница: одна из структур, которым место на реке
    if (plan.rivers.length && ['capital', 'city', 'town', 'village'].includes(ctype)) {
      for (let tries = 0; tries < 120; tries++) {
        const r = plan.rivers[Math.floor(rand() * plan.rivers.length)]; if (r.w < 9) continue;
        const i = 2 + Math.floor(rand() * Math.max(1, r.pts.length - 4)), p = r.pts[i], q = r.pts[i + 1]; if (!q) continue;
        const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, sd = rand() < 0.5 ? -1 : 1, wd = r.ws[i];
        const x = p[0] + nx * sd * (wd / 2 + 11), y = p[1] + ny * sd * (wd / 2 + 11);
        if (dOf(x, y) < 1.15 || dOf(x, y) > 2.6 || !okSpot(x, y, 16, { river: true, road: true })) continue;
        claim(x, y, 24); const a = Math.atan2(dy, dx); addBld('shed', x, y, a, { k: 1.5 });
        plan.deco.push({ k: 'wheel', x: x - nx * sd * 8, y: y - ny * sd * 8, a }); break;
      }
    }
    // шахты и карьеры по месторождениям поблизости
    const isMine = ctype === 'mine';
    const wanted = local.filter(d => d.t === 'metal' || d.t === 'stone').sort((a, b) => Math.hypot(a.x - CX, a.y - CY) - Math.hypot(b.x - CX, b.y - CY));
    let nm = 0; const maxM = isMine ? 4 : ['capital', 'city', 'town'].includes(ctype) ? 2 : ctype === 'fortress' ? 1 : 0;
    const mineAt = (x, y, kind) => {
      claim(x, y, 40); const a = rand() * 6.28; plan.hills.push({ x, y: y - 6, r: 34, peak: true });
      plan.deco.push({ k: kind === 'stone' ? 'quarry' : 'adit', x, y: y + 6, a: kind === 'stone' ? a : 0 });
      const hs = addBld('hut', x + 36, y + 20, rand() * 0.6); addBld('shed', x - 34, y + 22, rand() * 0.4);
      plan.stand.push({ k: 'cart', x: x + 14, y: y + 24 });
      if (kind === 'stone') plan.stand.push({ k: 'crane', x: x + 18, y: y - 4 });
      nm++;
    };
    for (const d of wanted) { if (nm >= maxM) break; if (okSpot(d.x, d.y, 30, { minD: 1.0, road: true })) mineAt(d.x, d.y, d.t); }
    if (isMine) {                                                // рудник: если месторождений нет — берём холмистые места, добавляем плавильню
      for (let k = 0; k < 300 && nm < 3; k++) { const x = 120 + rand() * (CW - 240), y = 120 + rand() * (CH - 240); if (hAt(x, y) > 0.2 && okSpot(x, y, 30, { minD: 0.9, road: true })) mineAt(x, y, 'metal'); }
      for (let k = 0; k < 120; k++) { const [x, y] = ringPt(0.9, 1.5); if (okSpot(x, y, 22, { minD: 0.8, road: true })) { claim(x, y, 24); addBld('smelter', x, y, alongRoad(x, y)); plan.stand.push({ k: 'smoke', x, y: y - 14 }); break; } }
      for (let k = 0; k < 12; k++) { const [x, y] = ringPt(0.7, 1.6); if (okSpot(x, y, 14, { minD: 0.6, road: true })) { claim(x, y, 14); plan.deco.push({ k: 'spoil', x, y, r: 12 + rand() * 12 }); } }
    }
    // лесозаготовки
    if (forestP > 0.4 && ['village', 'town', 'mine', 'fortress'].includes(ctype) || city.res === 'timber') {
      for (let k = 0, n = 0; k < 200 && n < 2; k++) {
        const [x, y] = ringPt(1.3, 2.4); if (!okSpot(x, y, 26, { road: true })) continue;
        claim(x, y, 28); n++; addBld('hut', x, y, rand() * 3); plan.stand.push({ k: 'logs', x: x + 18, y: y + 6 });
        for (let j = 0; j < 7; j++) plan.trees.push({ x: x + (rand() - 0.5) * 80, y: y + (rand() - 0.5) * 60, r: 5 + rand() * 4 });
      }
    }
    // рыбаки на побережье
    if (plan.waterFrac > 0.04 && ['port', 'village', 'town', 'capital'].includes(ctype)) {
      const want = ctype === 'port' ? 3 : 1;
      for (let k = 0, n = 0; k < 400 && n < want; k++) {
        const [x, y] = ringPt(0.9, 2.2); if (waterAt(x, y)) continue;
        let dir = null; for (let a = 0; a < 6.28 && !dir; a += 0.5) if (waterAt(x + Math.cos(a) * 24, y + Math.sin(a) * 24)) dir = a;
        if (dir == null || !okSpot(x, y, 18, { road: true, minD: 0.95 })) continue;
        claim(x, y, 30); n++;
        addBld('hut', x, y, dir + 1.57); addBld('hut', x + Math.cos(dir + 1.57) * 18, y + Math.sin(dir + 1.57) * 18, dir + 1.57);
        plan.deco.push({ k: 'net', x: x + Math.cos(dir) * 22, y: y + Math.sin(dir) * 22, a: dir });
        plan.boats.push({ x: x + Math.cos(dir) * 46, y: y + Math.sin(dir) * 46, a: dir + 1.57, l: 14 });
      }
    }
    // крепость и столица: сторожевые башни, лагерь, плац
    if (ctype === 'fortress' || ctype === 'capital') {
      const nT = ctype === 'fortress' ? 4 : 2;
      for (let k = 0, n = 0; k < 200 && n < nT; k++) { const [x, y] = ringPt(1.35, 2.0); if (!okSpot(x, y, 14, { road: true })) continue; claim(x, y, 40); n++; plan.stand.push({ k: 'watch', x, y }); }
    }
    if (ctype === 'fortress') {
      for (let k = 0, n = 0; k < 200 && n < 2; k++) {
        const [x, y] = ringPt(1.3, 1.9); if (!okSpot(x, y, 38, { road: true })) continue;
        claim(x, y, 40); n++; plan.deco.push({ k: 'parade', x, y, a: alongRoad(x, y), w: 76, h: 50 });
        for (let j = 0; j < 4; j++) plan.stand.push({ k: 'tent', x: x - 30 + j * 20, y: y + 36 + (j % 2) * 8 });
      }
    }
    // кладбище
    if (['village', 'town', 'city', 'capital'].includes(ctype)) for (let k = 0; k < 150; k++) {
      const [x, y] = ringPt(1.15, 1.7); if (!okSpot(x, y, 24, { road: true })) continue;
      claim(x, y, 26); const a = alongRoad(x, y); plan.deco.push({ k: 'graveyard', x, y, a, w: 40, h: 30 }); addBld('chapel', x + 30, y - 20, a);
      for (let j = 0; j < 7; j++) plan.stand.push({ k: 'cross', x: x - 14 + (j % 4) * 9, y: y - 6 + Math.floor(j / 4) * 12 }); break;
    }
    // руины: обломки стен вокруг
    if (plan.ruin) for (let k = 0; k < 14; k++) { const [x, y] = ringPt(0.4, 1.8); if (!waterAt(x, y) && riverD(x, y) > 6) plan.deco.push({ k: 'rubble', x, y, a: rand() * 3.14, w: 14 + rand() * 20 }); }
    // --- упорядоченное землепользование перед городом ---
    const SCALE = { capital: 1.2, city: 1.1, town: 1, port: 0.55, village: 0.8, fortress: 0.3, mine: 0.2, ruin: 0 };
    const sc = SCALE[ctype] != null ? SCALE[ctype] : 1;
    // хутора вдоль внешних дорог: цепочкой, фасадом к дороге, через равные промежутки
    if (!plan.ruin && ctype !== 'mine' && sc > 0) {
      let placed = 0; const nFarm = Math.round(2 + 6 * sc);
      for (const st of streets.filter(q => q.outer)) {
        let acc = 0, next = 60 + rand() * 40;
        for (let i = 0; i < st.pts.length - 1 && placed < nFarm; i++) {
          const a = st.pts[i], b = st.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
          const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L; let t = 0;
          while (acc + (L - t) >= next && placed < nFarm) {
            t += next - acc; acc = 0; next = 105 + rand() * 45;
            const side = placed % 2 ? 1 : -1, off = st.w / 2 + 31, x = a[0] + tx * t - ty * side * off, y = a[1] + ty * t + tx * side * off;
            if (okSpot(x, y, 34, { road: true, minD: 1.3 })) { farmstead(x, y, Math.atan2(ty, tx)); placed++; }
          }
          acc += L - t;
        }
      }
    }
    // пояса полей: концентрические кольца вокруг стены, радиальные границы сходятся в одних и тех же секторах
    plan.fields = [];
    if (sc > 0) {
      const NS = spec.R > 200 ? 56 : 48, rings = Math.max(1, Math.round(sc * 4.4 * fert)), depth = 60, hs = (x, y) => nearest(x, y).d;
      const nzK = (x, y) => fbm(noise, x * 0.0045 + 200, y * 0.0045, 2), nzD = (x, y) => fbm(noise, x * 0.006 + 500, y * 0.006, 2);
      for (let k = 0; k < rings; k++) {
        const step = k >= 2 ? 2 : 1;
        for (let j = 0; j < NS; j += step) {
          const t0 = j / NS * 6.283185, t1 = (j + step) / NS * 6.283185, rin = (t) => rw(t) * 1.2 + k * depth, rout = (t) => rin(t) + depth;
          const A = [CX + Math.cos(t0) * rin(t0), CY + Math.sin(t0) * rin(t0)], B = [CX + Math.cos(t1) * rin(t1), CY + Math.sin(t1) * rin(t1)];
          const C = [CX + Math.cos(t1) * rout(t1), CY + Math.sin(t1) * rout(t1)], D = [CX + Math.cos(t0) * rout(t0), CY + Math.sin(t0) * rout(t0)];
          const cxp = (A[0] + B[0] + C[0] + D[0]) / 4, cyp = (A[1] + B[1] + C[1] + D[1]) / 4, rad = Math.max(Math.hypot(A[0] - C[0], A[1] - C[1]), Math.hypot(B[0] - D[0], B[1] - D[1])) / 2;
          if (cxp < 40 || cxp > CW - 40 || cyp < 40 || cyp > CH - 40) continue;
          const samples = [[cxp, cyp], A, B, C, D, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], [(C[0] + D[0]) / 2, (C[1] + D[1]) / 2], [(A[0] + D[0]) / 2, (A[1] + D[1]) / 2], [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2]];
          if (samples.some(p => waterAt(p[0], p[1]) || riverD(p[0], p[1]) < 8 || hs(p[0], p[1]) < 5 || inKeep(p[0], p[1], 4))) continue;
          if (hAt(cxp, cyp) > 0.5) continue;
          if (taken.some(q => Math.hypot(q.x - cxp, q.y - cyp) < q.r + rad * 0.55)) continue;
          if (blds.some(o => Math.hypot(o.x - cxp, o.y - cyp) < rad * 0.8 + 6 && o.kind !== 'custom' && dOf(o.x, o.y) > 1.1)) continue;
          const n = nzK(cxp, cyp); let kind;
          if (k === 0 && (ctype === 'capital' || ctype === 'city' || ctype === 'town')) kind = n > 0.12 ? 'orchard' : (n < -0.15 && ctype !== 'town' ? 'vineyard' : 'plow');
          else if (k >= rings - 1 && rings > 2 && n < 0.25) kind = 'pasture';
          else kind = n < -0.18 ? 'pasture' : n < 0.14 ? 'plow' : 'wheat';
          if (ctype === 'village' && n < 0.05 && k > 0) kind = 'pasture';
          plan.fields.push({ pts: [A, B, C, D], kind, dir: nzD(cxp, cyp) > 0 ? 'rad' : 'tan', cx: cxp, cy: cyp, rad: rad * 0.9 });
        }
      }
    }
    // деревья: лес по влажности, больше на руинах
    for (let k = 0; k < 900; k++) {
      const x = 20 + rand() * (CW - 40), y = 20 + rand() * (CH - 40);
      if (dOf(x, y) < 1.12) continue;
      const g = fbm(noise, x * 0.006 + 80, y * 0.006, 3);
      if (g < 0.3 - forestP * 0.5 || rand() > forestP + 0.1) continue;
      if (waterAt(x, y) || riverD(x, y) < 6 || nearest(x, y).d < 8) continue;
      if (taken.some(t => Math.hypot(t.x - x, t.y - y) < t.r * 0.9) || plan.fields.some(f => Math.hypot(f.cx - x, f.cy - y) < f.rad)) continue;
      if (blds.some(o => Math.hypot(o.x - x, o.y - y) < 16) || plan.hills.some(o => Math.hypot(o.x - x, o.y - y) < o.r + 6)) continue;
      plan.trees.push({ x, y, r: 5 + rand() * 4 });
    }
    // деревья внутри города
    for (let k = 0; k < 40; k++) {
      const x = CX + (rand() - 0.5) * R * 2, y = CY + (rand() - 0.5) * R * 2;
      if (dOf(x, y) > 0.95 || waterAt(x, y) || riverD(x, y) < 8 || nearest(x, y).d < 8 || plan.plazas.some(q => Math.hypot(x - q.x, y - q.y) < q.r + 8)) continue;
      if (blds.some(o => Math.hypot(o.x - x, o.y - y) < Math.hypot(o.hw, o.hh) + 8) || inKeep(x, y, 8)) continue;
      plan.trees.push({ x, y, r: 4 + rand() * 3 });
    }
    // рынок: лавки на каждой площади, число пропорционально площади
    plan.stalls = [];
    for (const p of plan.plazas) {
      const n = Math.round(p.r * p.r / 95);
      for (let k = 0; k < n * 3 && k < 80; k++) {
        const th = rand() * 6.28, r = Math.sqrt(rand()) * (p.r - 8), x = p.x + Math.cos(th) * r, y = p.y + Math.sin(th) * r;
        if (plan.stalls.filter(q => Math.hypot(q.x - p.x, q.y - p.y) < p.r).length >= n) break;
        if (riverD(x, y) > 6 && Math.hypot(x - p.x, y - p.y) > (p.r >= 24 ? 9 : 0) && plan.stalls.every(q => Math.hypot(q.x - x, q.y - y) > 11)) plan.stalls.push({ x, y, a: rand() * 3.14 });
      }
    }
    return plan;
  };
})(window.FM);
