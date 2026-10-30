// Катастрофы: события, меняющие рельеф уже после тектоники — падения метеоритов, расколы земли, каньоны, кальдеры, провалы суши.
// Работает с полем высот h ДО климата и гидрологии: реки и озёра сами находят новые впадины и русла.
// Отдельный поток случайных чисел (seed|catastrophes): остальная география не зависит от настроек катастроф.
(function (FM) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  FM.CATASTROPHES = [
    { id: 'meteor', label: 'Метеориты', max: 8, def: 1, hint: 'Кратеры с валом; часть — с озером, у больших — центральная горка' },
    { id: 'rift', label: 'Расколы земли', max: 5, def: 1, hint: 'Узкие разломы: длинные заливы от берега, рифтовые долины с цепью озёр, редко — сквозной пролив' },
    { id: 'canyon', label: 'Каньоны', max: 8, def: 2, hint: 'Извилистые ущелья вниз по склону к морю; реки идут по дну' },
    { id: 'caldera', label: 'Кальдеры', max: 4, def: 1, hint: 'Вулкан взорвался: на его месте круглая котловина, часто с озером' },
    { id: 'subsidence', label: 'Провалы суши', max: 5, def: 0, hint: 'Овальные просадки у берега: круглые заливы и внутренние моря' }
  ];
  FM.defaultCatCfg = () => { const c = {}; for (const k of FM.CATASTROPHES) c[k.id] = k.def; return c; };
  FM.normCatCfg = (c) => { const o = FM.defaultCatCfg(); if (c && typeof c === 'object') for (const k of FM.CATASTROPHES) if (c[k.id] != null) o[k.id] = clamp(Math.round(+c[k.id]) || 0, 0, k.max); return o; };

  // cfg: {meteor, rift, ...} — число событий каждого вида; rand — ГСЧ; ctx: {volcanoes}.
  // Возвращает {events, force}: force — клетки, которые гидрология обязана превратить в озеро (кратерные озёра, бусины рифта).
  FM.applyCatastrophes = function (h, W, H, cfg, rand, ctx) {
    const N = W * H, s = W / 480, events = [], force = new Uint8Array(N);
    cfg = cfg || {}; ctx = ctx || {}; let rnd = rand;
    const R = (a, b) => a + (b - a) * rnd();
    const inMap = (x, y, m) => x >= m * W && x <= (1 - m) * W && y >= m * H && y <= (1 - m) * H;
    const landAt = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && h[yi * W + xi] > 0; };
    const hAt = (x, y) => h[clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)];
    const hb = Float32Array.from(h); FM.blur(hb, W, H, Math.max(2, Math.round(3 * s)));
    const farFrom = (x, y, d) => events.every(e => (e.x - x) ** 2 + (e.y - y) ** 2 > d * d);
    // расстояние до ближайшей воды вдоль 8 направлений (дёшево, достаточно для выбора места)
    const waterNear = (x, y, lim) => { let m = lim; for (let a = 0; a < 8; a++) { const dx = Math.cos(a * Math.PI / 4), dy = Math.sin(a * Math.PI / 4); for (let d = 1; d < m; d++) if (!landAt(x + dx * d, y + dy * d)) { m = d; break; } } return m; };

    // ---- метеориты ----
    const meteorAt = (x, y, r, lake) => {
      const D = 0.2 + 0.025 * r / s, rim = 0.35 * D, peak = r / s > 8 ? 0.45 * D : 0;
      const R2 = Math.ceil(r * 1.9);
      for (let yy = Math.max(0, Math.floor(y) - R2); yy <= Math.min(H - 1, Math.floor(y) + R2); yy++) for (let xx = Math.max(0, Math.floor(x) - R2); xx <= Math.min(W - 1, Math.floor(x) + R2); xx++) {
        const i = yy * W + xx; if (h[i] <= 0) continue;
        const u = Math.hypot(xx - x, yy - y) / r; if (u > 1.9) continue;
        const bowl = u < 1 ? (1 - u * u) : 0, ring = rim * Math.exp(-Math.pow((u - 1.08) / 0.2, 2)), pk = peak * Math.exp(-Math.pow(u / 0.17, 2));
        const hn = h[i] - D * bowl * smooth(0, 0.18, 1 - u + 0.12) + ring + pk;
        h[i] = u < 1 ? Math.max(0.02, hn) : Math.max(0.005, hn);
        if (lake && u < 0.8 && pk < 0.02) force[i] = 1;
      }
      events.push({ kind: 'meteor', x, y, r, lake });
    };
    for (let n = 0; n < cfg.meteor; n++) for (let t = 0; t < 60; t++) {
      const x = R(0.1, 0.9) * W, y = R(0.14, 0.86) * H; if (!landAt(x, y)) continue;
      const r = (3 + Math.pow(rnd(), 1.6) * 10) * s; if (!farFrom(x, y, r * 4 + 25 * s) || waterNear(x, y, r * 1.6) < r * 1.6) continue;
      meteorAt(x, y, r, rnd() < 0.55); break;
    }

    // ---- кальдеры ----
    const calderaAt = (x, y, r, lake, v) => {
      const R2 = Math.ceil(r * 2);
      for (let yy = Math.max(0, Math.floor(y) - R2); yy <= Math.min(H - 1, Math.floor(y) + R2); yy++) for (let xx = Math.max(0, Math.floor(x) - R2); xx <= Math.min(W - 1, Math.floor(x) + R2); xx++) {
        const i = yy * W + xx; if (h[i] <= 0) continue; const u = Math.hypot(xx - x, yy - y) / r; if (u > 2) continue;
        const bowl = u < 1 ? 1 - u * u * u : 0, ring = 0.1 * Math.exp(-Math.pow((u - 1.05) / 0.3, 2));
        h[i] = Math.max(u < 1 ? 0.03 : 0.005, h[i] - 0.5 * bowl * smooth(0, 0.25, 1.15 - u) + ring);
        if (lake && u < 0.7) force[i] = 1;
      }
      if (v) { v.caldera = true; v.active = false; }
      events.push({ kind: 'caldera', x, y, r, lake });
    };
    {
      const vs = (ctx.volcanoes || []).filter(v => !v.caldera && inMap(v.x, v.y, 0.04) && landAt(v.x, v.y));
      for (let n = 0; n < cfg.caldera && vs.length; n++) {
        const v = vs.splice(Math.floor(rnd() * vs.length), 1)[0], r = R(2.6, 5.2) * s, lake = rnd() < 0.6;
        calderaAt(v.x, v.y, r, lake, v);
      }
    }

    // ---- провалы суши: овальная просадка у берега ----
    const subAt = (x, y, a, b, rot) => {
      const c = Math.cos(rot), sn = Math.sin(rot), R2 = Math.ceil(a * 1.4);
      for (let yy = Math.max(0, Math.floor(y) - R2); yy <= Math.min(H - 1, Math.floor(y) + R2); yy++) for (let xx = Math.max(0, Math.floor(x) - R2); xx <= Math.min(W - 1, Math.floor(x) + R2); xx++) {
        const i = yy * W + xx; if (h[i] <= 0) continue; const dx = xx - x, dy = yy - y, u = Math.hypot((dx * c + dy * sn) / a, (-dx * sn + dy * c) / b);
        if (u > 1.3) continue; const k = 1 - smooth(0.7, 1.05, u);
        if (k > 0) h[i] = h[i] * (1 - k) + (-0.12) * k;
        else if (u < 1.3) h[i] += 0.05 * Math.exp(-Math.pow((u - 1.12) / 0.1, 2));   // уступ по краю просадки
      }
      events.push({ kind: 'subsidence', x, y, r: a, b, rot });
    };
    for (let n = 0; n < cfg.subsidence; n++) for (let t = 0; t < 80; t++) {
      const x = R(0.1, 0.9) * W, y = R(0.14, 0.86) * H; if (!landAt(x, y)) continue;
      const wn = waterNear(x, y, 30 * s); if (wn < 3 * s || wn > 18 * s) continue;
      const a = R(9, 20) * s, b = a * R(0.5, 0.9), rot = R(0, Math.PI); if (!farFrom(x, y, a * 2.5)) continue;
      subAt(x, y, a, b, rot); break;
    }

    // общий растеризатор линейных форм: ближайшая точка пути для каждой клетки возле него
    const dmin = new Float32Array(N).fill(1e9), kAt = new Int32Array(N), touched = [];
    const stamp = (pts, reach) => {
      const r2 = Math.ceil(reach);
      for (let k = 0; k < pts.length; k++) {
        const [px, py] = pts[k];
        for (let yy = Math.max(0, Math.floor(py) - r2); yy <= Math.min(H - 1, Math.floor(py) + r2); yy++) for (let xx = Math.max(0, Math.floor(px) - r2); xx <= Math.min(W - 1, Math.floor(px) + r2); xx++) {
          const d = Math.hypot(xx - px, yy - py); if (d > reach) continue; const i = yy * W + xx;
          if (dmin[i] > 1e8) touched.push(i); if (d < dmin[i]) { dmin[i] = d; kAt[i] = k; }
        }
      }
    };
    const release = () => { for (const i of touched) dmin[i] = 1e9; touched.length = 0; };

    // ---- расколы земли ----
    // гладкий 1D-шум по числу шагов (косинусная интерполяция между случайными узлами): [-1..1], длина волны step клеток
    const wave1d = (step) => { const nodes = []; for (let k = 0; k < 4000 / Math.max(2, step) + 4; k++) nodes.push(R(-1, 1)); return (t) => { const u = t / step, k = Math.floor(u), f = (1 - Math.cos((u - k) * Math.PI)) / 2; return nodes[k] * (1 - f) + nodes[k + 1] * f; }; };
    // раскол — не случайное блуждание курса (оно даёт дуги «?» и «S»): курс = исходное направление + ограниченное медленное отклонение + мелкая рябь;
    // длинные расколы идут ступенями (кулисы): через 25–60 клеток боковой сдвиг, как у реальных рифтов
    // долина и залив извиваются сильнее раскола: при длине меньше одной волны они шли почти прямой линией
    const riftPts = [];                                                       // точки уже проложенных расколов
    const riftTrace = (type, x, y, ang, want) => {
      const pts = [], beads = []; let len = 0, reached = false;
      const a0 = ang, wl1 = wave1d(type === 'split' ? R(70, 120) * s : R(26, 46) * s), wl2 = wave1d(type === 'split' ? R(30, 52) * s : R(10, 18) * s), wl3 = wave1d(R(6, 11) * s), A1 = type === 'split' ? R(0.6, 1.0) : R(0.5, 0.9), arc = R(-1, 1) * (type === 'split' ? 1.1 : 1.8), A2 = R(0.12, 0.22), A3 = R(0.05, 0.1);
      const arcRate = (rnd() < 0.5 ? -1 : 1) / (R(type === 'gulf' ? 70 : 35, type === 'gulf' ? 140 : 70) * s);   // долина и залив идут дугой постоянной кривизны (радиус 55–170 клеток·s), а не отрезком: кривизна не зависит от того, насколько раскол успел вырасти до берега
      let kink = 0, kinkT = 0, kinkNext = R(22, 48) * s;   // излом: курс ступенчато меняется на 5–13°, но возвращается к общему направлению
      let jog = R(28, 60) * s, sinceJog = 0, side = rnd() < 0.5 ? 1 : -1;
      for (let st = 0; st < want && st < W; st++) {
        pts.push([x, y]); if (type === 'valley' && st % Math.round(R(16, 26) * s) === 0) beads.push(pts.length - 1);
        if (st >= kinkNext) { kinkNext = st + R(22, 48) * s; kinkT = R(-0.22, 0.22) - 0.45 * kinkT; }
        kink += (kinkT - kink) * 0.12;
        ang = a0 + (type === 'split' ? arc * (st / Math.max(1, want)) : arcRate * st) + A1 * wl1(st) + A2 * wl2(st) + A3 * wl3(st) + kink;      // arc — общий изгиб дугой: раскол не бывает прямым отрезком
        sinceJog++; if (type === 'split' && sinceJog > jog) { sinceJog = 0; jog = R(28, 60) * s; const sh = side * R(2.0, 5.0) * s, na = a0 + Math.PI / 2; side = rnd() < 0.7 ? -side : side; x += Math.cos(na) * sh; y += Math.sin(na) * sh; }
        x += Math.cos(ang); y += Math.sin(ang); len++;
        if (st > 6 * s && riftPts.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 < (3.4 * s) ** 2)) { reached = true; break; }   // упёрся в уже существующий раскол: Т-образное сочленение, а не крест
        if (x < 3 || y < 3 || x > W - 4 || y > H - 4) { reached = true; break; }
        if (type === 'split' && st > 12 * s && !landAt(x, y)) { reached = true; break; }
        if (type !== 'split' && st > 8 * s && !landAt(x, y)) break;                  // залив/долина не уходят за противоположный берег
        if (type !== 'split' && type !== 'valley' && st > want * 0.9) break;
      }
      return { pts, beads, len, reached };
    };
    // Раскол не бывает ровным порезом: у каждого своя «степень искажения» D (0.35–1): ось дополнительно смещена второй волной, ширина меняется в трёх масштабах
    // (длинные сужения/расширения, мелкая рябь, 1–3 «плёса» вдвое шире), края неровные (шум сдвигает границу — берега разные с двух сторон), концы тупые, а не иглы.
    const riftCarve = (type, pts0, beads, rad0) => {
      const D = R(0.35, 1.0), n0 = pts0.length, wc = wave1d(R(14, 28) * s), nz = FM.makeNoise(rnd), fq = 1 / (R(5, 9) * s);
      const pts = pts0.map((p, k) => { const a = pts0[Math.max(0, k - 1)], b = pts0[Math.min(n0 - 1, k + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, off = D * 1.8 * s * wc(k); return [p[0] - dy / l * off, p[1] + dx / l * off]; });
      const floors = [], fl = type === 'valley' ? 0.012 : -0.09;
      for (let k = 0; k < pts.length; k++) floors.push(fl);
      for (const b of beads) for (let k = Math.max(0, b - 3 * s | 0); k <= Math.min(pts.length - 1, b + 3 * s); k++) floors[k] = Math.min(floors[k], -0.03 + 0.012 * Math.abs(k - b));
      const h0 = Float32Array.from(h), np = pts.length, wA = wave1d(R(30, 60) * s), wB = wave1d(R(8, 16) * s), pools = [];
      for (let q = 0, nq = 1 + Math.floor(rnd() * 3); q < nq; q++) pools.push([R(0.15, 0.85) * np, R(5, 12) * s, R(0.6, 1.3)]);
      const wk = pts.map((_, k) => {
        const e = Math.min(1, Math.min(k, np - 1 - k) / Math.max(1, Math.min(np * 0.3, 24 * s)));
        let w = (0.4 + 0.6 * (0.5 + 0.5 * wA(k))) * (1 + 0.3 * D * wB(k)); for (const q of pools) w *= 1 + q[2] * Math.exp(-Math.pow((k - q[0]) / q[1], 2));
        return Math.max(0.3, w) * (0.3 + 0.7 * Math.pow(e, 0.7));
      });
      stamp(pts, rad0 * 3.2);
      for (const i of touched) {
        const rad = rad0 * wk[kAt[i]], fk = floors[kAt[i]], xx = i % W, yy = (i / W) | 0;
        const d = dmin[i] + rad * D * 1.1 * FM.fbm(nz, xx * fq, yy * fq, 3);   // неровный край: расстояние до оси искажено шумом
        if (d < rad) { const tt = smooth(0.35, 1, Math.max(0, d) / rad), tg = fk + (h0[i] - fk) * tt * tt; if (h0[i] > 0 && tg < h[i]) h[i] = tg; if (type === 'valley' && fk < 0 && d < rad * 1.1 && h0[i] > 0) { force[i] = 1; h[i] = Math.max(h[i], 0.012); } }
        else if (h0[i] > 0 && h[i] > 0) h[i] += 0.07 * Math.exp(-Math.pow((d - 1.5 * rad) / (0.6 * rad), 2)) * smooth(0, 1, h0[i] * 4);
      }
      for (let k = 0; k < pts.length; k += 2) riftPts.push(pts[k]);
      release(); events.push({ kind: 'rift', sub: type, x: pts[0][0], y: pts[0][1], pts: pts.filter((_, k) => k % 3 === 0).map(p => [p[0], p[1]]), w: pts.map((_, k) => rad0 * wk[k]).filter((_, k) => k % 3 === 0).map(v => Math.round(v * 100) / 100) });   // w — полуширина в клетках для знака на карте
    };
    for (let n = 0; n < cfg.rift; n++) for (let t = 0; t < 80; t++) {
      const roll = rnd(), type = roll < 0.4 ? 'gulf' : roll < 0.8 ? 'valley' : 'split';
      let x, y, ang;
      if (type === 'valley') { x = R(0.15, 0.85) * W; y = R(0.2, 0.8) * H; if (!landAt(x, y) || hb[Math.round(y) * W + Math.round(x)] > 0.6) continue; ang = R(0, Math.PI * 2); }
      else {
        x = R(0.08, 0.92) * W; y = R(0.15, 0.85) * H; if (!landAt(x, y) || waterNear(x, y, 5 * s) > 3 * s) continue;
        let best = -1, bl = 0; for (let a = 0; a < 16; a++) { const an = a * Math.PI / 8 + R(-0.1, 0.1); let l = 0; while (l < 80 * s && landAt(x + Math.cos(an) * l, y + Math.sin(an) * l)) l++; if (l > bl) { bl = l; best = an; } }
        if (bl < 28 * s) continue; ang = best + R(-0.2, 0.2);
      }
      const want = (type === 'gulf' ? R(0.12, 0.24) : type === 'valley' ? R(0.15, 0.3) : R(0.5, 0.9)) * W;
      const tr = riftTrace(type, x, y, ang, want);
      if (tr.len < 14 * s) continue; if (type === 'split' && !tr.reached) continue;
      riftCarve(type, tr.pts, tr.beads, (type === 'valley' ? R(2.2, 3.4) : R(2.8, 4.2)) * s); break;
    }

    // ---- каньоны: вниз по склону, дно монотонно понижается — реки пойдут по нему ----
    const hs = Float32Array.from(h); FM.blur(hs, W, H, Math.max(2, Math.round(2.5 * s)));
    const hs2 = Float32Array.from(h); FM.blur(hs2, W, H, Math.max(4, Math.round(7 * s)));   // грубый рельеф: куда течь с плоского места (ручной режим)
    const descent = (hf, xi, yi, d) => { const gx = hf[yi * W + Math.min(W - 1, xi + d)] - hf[yi * W + Math.max(0, xi - d)], gy = hf[Math.min(H - 1, yi + d) * W + xi] - hf[Math.max(0, yi - d) * W + xi]; return { g: Math.hypot(gx, gy), a: Math.atan2(-gy, -gx) }; };
    const canyonTrace = (x, y, ang, strong) => {
      const pts = [], floors = []; let prev = 9, reached = false; const gd = Math.max(2, Math.round(2 * s));   // шаг градиента растёт с размером карты
      if (strong) { const d0 = descent(hs2, Math.round(x), Math.round(y), Math.max(3, Math.round(5 * s))); if (d0.g > 1e-6) ang = d0.a + R(-0.35, 0.35); }
      for (let st = 0; st < 0.45 * W; st++) {
        const xi = Math.round(x), yi = Math.round(y); if (xi < gd + 1 || yi < gd + 1 || xi > W - gd - 2 || yi > H - gd - 2) break; const hv = h[yi * W + xi]; if (hv <= 0) { reached = true; break; }
        const gx = hs[yi * W + xi + gd] - hs[yi * W + xi - gd], gy = hs[(yi + gd) * W + xi] - hs[(yi - gd) * W + xi];
        if (strong && Math.hypot(gx, gy) <= 2e-4 * gd / 2) { const d1 = descent(hs2, xi, yi, Math.max(3, Math.round(5 * s))); if (d1.g > 1e-6) { let df = d1.a - ang; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; ang += clamp(df, -0.3, 0.3) * 0.5; } }
        else if (Math.hypot(gx, gy) > 1e-5) { const da = Math.atan2(-gy, -gx); let df = da - ang; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; ang += clamp(df, -0.25, 0.25) * 0.4; }
        ang += R(-0.15, 0.15);
        const base = hs[yi * W + xi], fl = Math.max(0.012, Math.min(prev - 0.002, base - (0.12 + 0.2 * Math.min(1, base))));
        prev = fl; pts.push([x, y]); floors.push(fl); x += Math.cos(ang); y += Math.sin(ang);
        if (pts.length > 12 * s) { let loop = false; for (let q = 0; q < pts.length - 10 * s; q += 2) if ((pts[q][0] - x) ** 2 + (pts[q][1] - y) ** 2 < (4 * s) ** 2) { loop = true; break; } if (loop) break; }   // не петлять
      }
      return { pts, floors, reached };
    };
    const canyonCarve = (pts, floors, rad0) => {
      const h0 = Float32Array.from(h); stamp(pts, rad0 * 1.8);
      for (const i of touched) { const d = dmin[i]; if (h0[i] <= 0 || d >= rad0 * 1.8) continue; const k = kAt[i], rr = rad0 * (0.85 + 0.5 * k / pts.length), tt = smooth(0.2, 1, d / rr), tg = floors[k] + (h0[i] - floors[k]) * Math.pow(tt, 1.6); if (tg < h[i]) h[i] = Math.max(0.005, tg); }
      release(); events.push({ kind: 'canyon', x: pts[0][0], y: pts[0][1], pts: pts.filter((_, k) => k % 3 === 0).map(p => [p[0], p[1]]) });
    };
    for (let n = 0; n < cfg.canyon; n++) for (let t = 0; t < 120; t++) {
      let x = R(0.08, 0.92) * W, y = R(0.14, 0.86) * H; if (!landAt(x, y) || hb[Math.round(y) * W + Math.round(x)] < 0.4) continue;
      const ang = R(0, Math.PI * 2), rad0 = R(1.3, 2.0) * s, tr = canyonTrace(x, y, ang);
      if (tr.pts.length < 22 * s) continue; if (!farFrom(tr.pts[0][0], tr.pts[0][1], 20 * s)) continue;
      canyonCarve(tr.pts, tr.floors, rad0); break;
    }

    // ---- ручные события (меню «Катастрофы» после генерации): m = {kind, x, y, size 0..1, x2, y2}; координаты в клетках.
    // Каждое событие — со своим ГСЧ (индекс в списке), поэтому добавление нового не меняет остальные. Событие, которое не удалось, не записывается (в events нет m).
    (ctx.manual || []).forEach((m, idx) => {
      rnd = ctx.manualRand ? ctx.manualRand(idx) : rand; const sz = clamp(m.size == null ? 0.5 : m.size, 0, 1), x = m.x, y = m.y, ne = events.length;
      if (!(x >= 0 && y >= 0 && x < W && y < H)) return;
      if (m.kind === 'meteor') { if (landAt(x, y)) meteorAt(x, y, (3 + sz * 10) * s, rnd() < 0.55); }
      else if (m.kind === 'caldera') {
        let v = null, bd = (9 * s) ** 2; for (const q of (ctx.volcanoes || [])) { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (!q.caldera && d < bd) { bd = d; v = q; } }
        if (landAt(x, y)) calderaAt(v ? v.x : x, v ? v.y : y, (2.6 + sz * 3) * s, rnd() < 0.6, v);
      } else if (m.kind === 'subsidence') { if (landAt(x, y)) { const a = (8 + sz * 14) * s; subAt(x, y, a, a * R(0.5, 0.9), R(0, Math.PI)); } }
      else if (m.kind === 'rift') {
        if (!landAt(x, y)) return;
        const dx = (m.x2 == null ? x + 1 : m.x2) - x, dy = (m.y2 == null ? y : m.y2) - y, dl = Math.hypot(dx, dy), ang = dl > 1 ? Math.atan2(dy, dx) : R(0, Math.PI * 2), coast = waterNear(x, y, 5 * s) <= 3 * s;
        const type = coast ? (dl > 0.4 * W ? 'split' : 'gulf') : 'valley', want = type === 'split' ? Math.max(dl, 0.3 * W) : Math.max(dl, 0.1 * W);
        const tr = riftTrace(type, x, y, ang, want); if (tr.len < 8 * s || (type === 'split' && !tr.reached)) return;
        riftCarve(type, tr.pts, tr.beads, (type === 'valley' ? R(2.2, 3.4) : R(2.8, 4.2)) * s);
      } else if (m.kind === 'canyon') {
        if (!landAt(x, y)) return;
        let tr = null; for (let a = 0; a < 6; a++) { const q = canyonTrace(x, y, R(0, Math.PI * 2), true); if (!tr || q.pts.length > tr.pts.length) tr = q; if (tr.reached && tr.pts.length >= 8 * s) break; }   // несколько попыток: берём самый длинный путь вниз
        if (tr.pts.length < (tr.reached ? 3 : 8) * s) return;
        canyonCarve(tr.pts, tr.floors, R(1.3, 2.0) * s);
      }
      if (events.length > ne) events[events.length - 1].m = idx;
    });
    return { events, force };
  };
})(window.FM = window.FM || {});
