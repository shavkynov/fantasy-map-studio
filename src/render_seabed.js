// «Карта дна»: суша затемнена, океанское дно раскрашено по глубине с отмывкой; поверх — геологические структуры
// (срединные хребты, трансформные разломы и зоны разломов, жёлоба, вулканические дуги, горячие точки, подводные горы,
// плато, каньоны), биология (рифы, атоллы, ламинария, морская трава, рыбные банки) и подводные ресурсы.
// Данные — FM.seafloor(map) (seafloor.js, seafloor_life.js); здесь только рисование. Работает во всех трёх стилях.
(function (FM) {
  'use strict';
  const R = FM.R;
  const { mulberry32, hashString, makeNoise, clamp } = FM;
  const { makeCanvas, rgb } = R;

  // ---------- палитры ----------
  const PC = {
    land: [58, 56, 54], lake: [74, 100, 122],
    ridge: [240, 160, 80], rift: [112, 38, 20], trench: [236, 98, 82], teeth: [208, 74, 62], fault: [242, 234, 214],
    cone: [212, 164, 112], coneS: [64, 38, 24], arc: [240, 114, 90], hot: [255, 142, 72], plateau: [226, 204, 134], canyon: [238, 224, 182],
    vent: [255, 210, 92], seep: [120, 228, 212], coral: [255, 143, 156], coralD: [204, 74, 94], kelp: [132, 212, 112], kelpD: [44, 104, 48],
    grass: [172, 228, 142], fish: [234, 245, 250], txt: [247, 241, 226], halo: [8, 16, 34], iso: [226, 240, 255], rim: [216, 228, 238]
  };
  const RAMPS = {
    color: [[0, [180, 218, 222]], [120, [152, 202, 214]], [200, [130, 186, 208]], [1000, [98, 152, 188]], [2000, [74, 124, 170]], [3500, [54, 94, 142]], [5000, [40, 70, 114]], [6500, [30, 52, 90]], [9000, [20, 34, 66]], [11500, [10, 18, 40]]],
    sepia: [[0, [232, 220, 194]], [200, [214, 203, 176]], [1000, [190, 177, 152]], [2000, [166, 152, 130]], [3500, [142, 128, 110]], [5000, [122, 108, 94]], [6500, [104, 92, 80]], [9000, [88, 78, 68]], [11500, [72, 64, 56]]],
    ink: [[0, [238, 238, 238]], [200, [218, 218, 218]], [1000, [194, 194, 194]], [2000, [168, 168, 168]], [3500, [144, 144, 144]], [5000, [124, 124, 124]], [6500, [106, 106, 106]], [9000, [90, 90, 90]], [11500, [74, 74, 74]]]
  };
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const CONV = {
    color: (c) => c,
    sepia: (c) => { const l = lum(c); return [Math.min(255, l * 1.08 + 6), l * 0.96 + 2, l * 0.8]; },
    ink: (c) => { const l = lum(c); return [l, l, l]; }
  };
  const themeKey = (th) => th.game ? 'color' : th.label === 'Сепия' ? 'sepia' : 'ink';
  const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  function palette(th) {
    const tk = themeKey(th), cv = CONV[tk], P = { tk, ramp: RAMPS[tk] };
    for (const k of Object.keys(PC)) P[k] = cv(PC[k]);
    P.res = {}; for (const [k, v] of Object.entries(FM.SEABED_RES || {})) P.res[k] = cv(hex(v.col));
    if (tk === 'sepia') { P.land = [38, 32, 27]; P.lake = [96, 84, 70]; } else if (tk === 'ink') { P.land = [30, 30, 30]; P.lake = [100, 100, 100]; }
    P.chip = RAMPS[tk][5][1];                                   // фон для значков в легенде
    return P;
  }
  const A = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a == null ? 1 : a})`;
  const rampAt = (st, d) => {
    if (d <= st[0][0]) return st[0][1];
    for (let i = 1; i < st.length; i++) if (d <= st[i][0]) { const a = st[i - 1], b = st[i], t = (d - a[0]) / (b[0] - a[0]); return [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t]; }
    return st[st.length - 1][1];
  };

  // ---------- растровая основа: глубины, отмывка, затемнённая суша ----------
  function raster(map, th, P, sf) {
    const key = '_sbR' + P.tk;
    if (map[key] && map[key].sf === sf) return map[key].cv;
    const { W, H } = map, Rr = 3, cw = W * Rr, ch = H * Rr;
    const ds = Float32Array.from(sf.depth); FM.blur(ds, W, H, 1);
    const hb = Float32Array.from(map.h); FM.blur(hb, W, H, 1);
    const lk = new Float32Array(W * H); if (map.lake) for (let i = 0; i < lk.length; i++) lk[i] = map.lake[i] ? 1 : 0;
    const noise = makeNoise(mulberry32(hashString(map.seed + '|sbn')));
    const bil = (a, fx, fy) => {
      const x0 = clamp(Math.floor(fx), 0, W - 2), y0 = clamp(Math.floor(fy), 0, H - 2), u = clamp(fx - x0, 0, 1), v = clamp(fy - y0, 0, 1), i = y0 * W + x0;
      return a[i] * (1 - u) * (1 - v) + a[i + 1] * u * (1 - v) + a[i + W] * (1 - u) * v + a[i + W + 1] * u * v;
    };
    const cv = makeCanvas(cw, ch), cx = cv.getContext('2d'), img = cx.createImageData(cw, ch), d = img.data, st = P.ramp, LC = P.land, KC = P.lake;
    for (let py = 0; py < ch; py++) for (let px = 0; px < cw; px++) {
      const fx = (px + 0.5) / Rr - 0.5, fy = (py + 0.5) / Rr - 0.5, o = (py * cw + px) * 4;
      const hv = bil(hb, fx, fy), land = clamp(hv / 0.03 + 0.5, 0, 1), nz = 1 + 0.012 * noise(px * 0.33, py * 0.33);
      let r = 0, g = 0, b = 0;
      if (land < 1) {
        const dd = bil(ds, fx, fy), c = rampAt(st, dd);
        const sh = clamp((bil(ds, fx + 0.6, fy) - bil(ds, fx - 0.6, fy) + bil(ds, fx, fy + 0.6) - bil(ds, fx, fy - 0.6)) * 0.75 / 260, -1, 1);
        const m = 1 + (sh > 0 ? sh * 0.3 : sh * 0.4);
        r = c[0] * m * nz + sh * 12; g = c[1] * m * nz + sh * 12; b = c[2] * m * nz + sh * 14;
      }
      if (land > 0) {
        const sl = clamp(-(bil(hb, fx + 0.6, fy) - bil(hb, fx - 0.6, fy) + bil(hb, fx, fy + 0.6) - bil(hb, fx, fy - 0.6)) * 2.4, -1, 1), lv = bil(lk, fx, fy);
        const base = [LC[0] + (KC[0] - LC[0]) * lv, LC[1] + (KC[1] - LC[1]) * lv, LC[2] + (KC[2] - LC[2]) * lv], hi = 8 * clamp(hv, 0, 1.2), m2 = 1 + sl * 0.22;
        const lr = base[0] * m2 * nz + hi, lg = base[1] * m2 * nz + hi, lb = base[2] * m2 * nz + hi;
        r = r * (1 - land) + lr * land; g = g * (1 - land) + lg * land; b = b * (1 - land) + lb * land;
      }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    map[key] = { sf, cv };
    return cv;
  }

  // ---------- линейные знаки (общие для карты и легенды; u — масштаб, pts — ломаная в пикселях) ----------
  const trace = (ctx, pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); };
  const dark = (P, a) => A(P.halo, a);
  function ridgeLine(ctx, pts, u, P) {                           // срединный хребет: светлая полоса, ось рифта, рёбра
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(ctx, pts); ctx.strokeStyle = dark(P, 0.4); ctx.lineWidth = 6.4 * u; ctx.stroke();
    ctx.strokeStyle = A(P.ridge, 0.95); ctx.lineWidth = 4 * u; ctx.stroke();
    ctx.strokeStyle = A(P.rift); ctx.lineWidth = 1.1 * u; ctx.stroke();
    ctx.lineWidth = 0.9 * u; ctx.strokeStyle = A(P.ridge, 0.75); ctx.beginPath();
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l;
      acc += l; if (acc < 5.2 * u) continue; acc = 0;
      ctx.moveTo(b[0] - ty * 3.2 * u, b[1] + tx * 3.2 * u); ctx.lineTo(b[0] + ty * 3.2 * u, b[1] - tx * 3.2 * u);
    }
    ctx.stroke(); ctx.restore();
  }
  function faultLine(ctx, pts, u, P, strong) {                  // трансформный разлом / зона разломов
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(ctx, pts); ctx.strokeStyle = dark(P, 0.4); ctx.lineWidth = (strong ? 3.2 : 2.4) * u; ctx.stroke();
    ctx.setLineDash([strong ? 9 * u : 5 * u, strong ? 2 * u : 3 * u]); ctx.strokeStyle = A(P.fault, 0.9); ctx.lineWidth = (strong ? 1.5 : 1) * u; ctx.stroke();
    ctx.restore();
  }
  function trenchLine(ctx, pts, dirs, u, P) {                    // жёлоб: тёмная линия и зубцы в сторону надвигающейся плиты
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(ctx, pts); ctx.strokeStyle = dark(P, 0.5); ctx.lineWidth = 5 * u; ctx.stroke();
    ctx.strokeStyle = A(P.trench); ctx.lineWidth = 2.1 * u; ctx.stroke();
    ctx.fillStyle = A(P.teeth); ctx.strokeStyle = dark(P, 0.6); ctx.lineWidth = 0.7 * u;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l;
      acc += l; if (acc < 9 * u) continue; acc = 0;
      const dr = dirs && dirs[i] ? dirs[i] : [-ty, tx], nx = dr[0], ny = dr[1], cx0 = b[0] + nx * 1.4 * u, cy0 = b[1] + ny * 1.4 * u;
      ctx.beginPath(); ctx.moveTo(cx0 - tx * 2.6 * u, cy0 - ty * 2.6 * u); ctx.lineTo(cx0 + tx * 2.6 * u, cy0 + ty * 2.6 * u); ctx.lineTo(cx0 + nx * 4.4 * u, cy0 + ny * 4.4 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  function canyonLine(ctx, pts, u, P, w) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(ctx, pts); ctx.strokeStyle = dark(P, 0.4); ctx.lineWidth = (w + 1.6) * u; ctx.stroke();
    ctx.strokeStyle = A(P.canyon, 0.92); ctx.lineWidth = w * u; ctx.stroke(); ctx.restore();
  }
  function barrierLine(ctx, pts, u, P) {                         // барьерный риф: ряд бусин
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(ctx, pts); ctx.strokeStyle = A(P.coralD, 0.45); ctx.lineWidth = 3.4 * u; ctx.stroke();
    ctx.setLineDash([0.1, 2.8 * u]); ctx.strokeStyle = A(P.coral); ctx.lineWidth = 2.6 * u; ctx.stroke(); ctx.restore();
  }

  // ---------- точечные значки ----------
  function poly(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); }
  function cone(ctx, x, y, u, P, kind) {
    const s = kind === 'hot' ? 1.45 : kind === 'arc' ? 0.8 : 1;
    ctx.lineJoin = 'round'; ctx.lineWidth = 0.8 * u; ctx.strokeStyle = A(P.coneS, 0.9);
    if (kind === 'guyot') { poly(ctx, [[x - 3.7 * u, y + 2.5 * u], [x + 3.7 * u, y + 2.5 * u], [x + 1.9 * u, y - 2.2 * u], [x - 1.9 * u, y - 2.2 * u]]); ctx.fillStyle = A(P.cone); ctx.fill(); ctx.stroke(); return; }
    poly(ctx, [[x - 3.4 * u * s, y + 2.6 * u * s], [x + 3.4 * u * s, y + 2.6 * u * s], [x, y - 3.8 * u * s]]);
    ctx.fillStyle = A(kind === 'hot' ? P.hot : kind === 'arc' ? P.arc : P.cone); ctx.fill(); ctx.stroke();
  }
  function atoll(ctx, x, y, r, u, P) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fillStyle = A(P.seep, 0.35); ctx.fill();
    ctx.strokeStyle = dark(P, 0.45); ctx.lineWidth = 3.6 * u; ctx.stroke();
    ctx.strokeStyle = A(P.coral); ctx.lineWidth = 2.2 * u; ctx.stroke();
  }
  function vent(ctx, x, y, u, P, hot) {
    ctx.save(); ctx.translate(x, y);
    if (hot) {
      ctx.beginPath(); ctx.arc(0, 0, 4.4 * u, 0, 6.29); ctx.fillStyle = A(P.vent, 0.28); ctx.fill();
      ctx.strokeStyle = A(P.vent); ctx.lineWidth = 0.9 * u; ctx.beginPath();
      for (const dx of [-1.8, 0, 1.8]) { ctx.moveTo(dx * u, -1 * u); ctx.quadraticCurveTo((dx + 1) * u, -3 * u, dx * u * 1.4, -5 * u); }
      ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0.6 * u, 1.7 * u, 0, 6.29); ctx.fillStyle = dark(P, 0.95); ctx.fill(); ctx.strokeStyle = A(P.vent); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, 3 * u, 0, 6.29); ctx.strokeStyle = A(P.seep); ctx.lineWidth = 1.2 * u; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 1 * u, 0, 6.29); ctx.fillStyle = A(P.seep); ctx.fill();
    }
    ctx.restore();
  }
  function kelp(ctx, x, y, s, u, P) {
    ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round';
    ctx.strokeStyle = dark(P, 0.5); ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(0, 2.4 * u * s); ctx.bezierCurveTo(-2.2 * u, 0, 2.2 * u, -1.6 * u * s, 0, -3.6 * u * s); ctx.stroke();
    ctx.strokeStyle = A(P.kelp); ctx.lineWidth = 1.1 * u; ctx.stroke();
    ctx.restore();
  }
  function grass(ctx, x, y, u, P) {
    ctx.save(); ctx.strokeStyle = A(P.grass, 0.9); ctx.lineWidth = 0.9 * u; ctx.lineCap = 'round'; ctx.beginPath();
    for (const dx of [-1.3, 0, 1.3]) { ctx.moveTo(x + dx * u, y + 1.4 * u); ctx.lineTo(x + dx * u * 1.5, y - 1.6 * u); }
    ctx.stroke(); ctx.restore();
  }
  function fish(ctx, x, y, a, u, P) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = A(P.fish, 0.95); ctx.strokeStyle = dark(P, 0.7); ctx.lineWidth = 0.7 * u;
    ctx.beginPath(); ctx.ellipse(0, 0, 3.6 * u, 1.6 * u, 0, 0, 6.29); ctx.fill(); ctx.stroke();
    poly(ctx, [[-3.2 * u, 0], [-5.6 * u, -1.9 * u], [-5.6 * u, 1.9 * u]]); ctx.fill(); ctx.stroke();
    ctx.fillStyle = dark(P, 0.9); ctx.beginPath(); ctx.arc(1.9 * u, -0.3 * u, 0.5 * u, 0, 6.29); ctx.fill();
    ctx.restore();
  }
  function resIcon(ctx, x, y, u, kind, col, deep) {
    ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round';
    if (deep) { ctx.beginPath(); ctx.arc(0, 0, 7 * u, 0, 6.29); ctx.strokeStyle = 'rgba(8,10,20,0.92)'; ctx.lineWidth = 1.9 * u; ctx.stroke(); }
    ctx.fillStyle = A(col); ctx.strokeStyle = 'rgba(255,255,255,0.96)'; ctx.lineWidth = 1.3 * u;
    const ng = (n, r, rot) => { const p = []; for (let i = 0; i < n; i++) { const a = rot + i / n * 6.2832; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; };
    if (kind === 'oil') { ctx.beginPath(); ctx.arc(0, 0.6 * u, 4.4 * u, 0, 6.29); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-3 * u, -1 * u); ctx.lineTo(0, -5.6 * u); ctx.lineTo(3 * u, -1 * u); ctx.fill(); }
    else if (kind === 'gas') { poly(ctx, ng(4, 5.4 * u, 0)); ctx.fill(); ctx.stroke(); }
    else if (kind === 'hydrate') { poly(ctx, ng(6, 4.9 * u, 0)); ctx.fill(); ctx.stroke(); }
    else if (kind === 'nodules') { for (const [dx, dy] of [[-2.6, 1.6], [2.6, 1.6], [0, -2.8]]) { ctx.beginPath(); ctx.arc(dx * u, dy * u, 2.5 * u, 0, 6.29); ctx.fill(); ctx.stroke(); } }
    else if (kind === 'sulfide') { const p = []; for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832 - 1.5708, r = (i % 2 ? 2.2 : 6) * u; p.push([Math.cos(a) * r, Math.sin(a) * r]); } poly(ctx, p); ctx.fill(); ctx.stroke(); }
    else if (kind === 'crust') { poly(ctx, [[-4 * u, -4 * u], [4 * u, -4 * u], [4 * u, 4 * u], [-4 * u, 4 * u]]); ctx.fill(); ctx.stroke(); }
    else if (kind === 'phosph') { poly(ctx, ng(3, 5.4 * u, -1.5708)); ctx.fill(); ctx.stroke(); }
    else { poly(ctx, ng(5, 5 * u, -1.5708)); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }

  // ---------- основной рисунок ----------
  const pickLabelFont = (ctx, text, len, base, k) => { let f = base; ctx.font = `italic ${f}px Georgia, "Times New Roman", serif`; const w0 = [...text].reduce((a, ch) => a + ctx.measureText(ch).width, 0); if (w0 > len * 0.92) { f = Math.max(7 * k, f * len * 0.92 / w0); ctx.font = `italic ${f}px Georgia, "Times New Roman", serif`; } return f; };

  function drawSeabed(ctx, map, th, o) {
    const { S, geo, zoom } = o, u = S / 3.75, sf = FM.seafloor(map), P = palette(th), W = map.W, H = map.H;
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(raster(map, th, P, sf), -S / 2, -S / 2, W * S, H * S);
    const pp = (p) => [p[0] * S, p[1] * S], sm = (pts, it) => FM.smoothOpen(pts.map(pp), it == null ? 2 : it);
    const L = o.layers || {}, on = (k) => L[k] !== false;
    const vr = o.vr, pad = 40;
    const vis = (x, y) => !vr || (x * S > vr.x0 - pad && x * S < vr.x1 + pad && y * S > vr.y0 - pad && y * S < vr.y1 + pad);

    // изобаты
    {
      if (!map._sbIso || map._sbIso.sf !== sf) {
        const ds = Float32Array.from(sf.depth); FM.blur(ds, W, H, 1); const out = [];
        for (const lv of [200, 1000, 2000, 3000, 4000, 5000, 6000, 8000]) { const f = new Float32Array(ds.length); for (let i = 0; i < f.length; i++) f[i] = sf.water[i] ? ds[i] - lv : -1e3; out.push({ lv, lines: FM.contours(f, W, H, 0) }); }
        map._sbIso = { sf, out };
      }
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const labels = [];
      for (const { lv, lines } of map._sbIso.out) for (const l of lines) {
        if (l.length < 6) continue; const q = FM.smoothOpen(l.map(pp), 2), main = lv === 200 || lv % 2000 === 0;
        trace(ctx, q); ctx.strokeStyle = A(P.iso, lv === 200 ? 0.55 : main ? 0.3 : 0.18); ctx.lineWidth = (lv === 200 ? 1.5 : main ? 1 : 0.7) * u; if (lv === 200) ctx.setLineDash([6 * u, 3 * u]); ctx.stroke(); ctx.setLineDash([]);
        if (lv >= 1000 && l.length > 70) { const m = q[Math.floor(q.length * 0.42)]; if (!vis(m[0] / S, m[1] / S)) continue; if (labels.some(b => Math.hypot(b[0] - m[0], b[1] - m[1]) < 130 * u)) continue; labels.push([m[0], m[1], lv]); }
      }
      ctx.font = `${8.5 * u}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 2.4 * u; ctx.strokeStyle = dark(P, 0.6); ctx.fillStyle = A(P.iso, 0.8);
      for (const b of labels) { const t = (FM.uiLang === 'en' ? '' : '') + b[2]; ctx.strokeText(t, b[0], b[1]); ctx.fillText(t, b[0], b[1]); }
    }

    // береговая линия суши
    if (geo && geo.coast) { ctx.strokeStyle = A(P.rim, 0.6); ctx.lineWidth = 1.5 * u; ctx.lineJoin = 'round'; const pth = new Path2D(); R.addLoops(pth, geo.coast); ctx.stroke(pth); }

    // плато, конусы выноса, каньоны
    if (on('sbGeo')) {
      for (const p of sf.plateaus) { ctx.save(); ctx.translate(p.x * S, p.y * S); ctx.rotate(p.a); ctx.beginPath(); ctx.ellipse(0, 0, p.rx * S, p.ry * S, 0, 0, 6.29); ctx.fillStyle = A(P.plateau, 0.2); ctx.fill(); ctx.setLineDash([7 * u, 4 * u]); ctx.strokeStyle = dark(P, 0.45); ctx.lineWidth = 3 * u; ctx.stroke(); ctx.strokeStyle = A(P.plateau, 0.95); ctx.lineWidth = 1.6 * u; ctx.stroke(); ctx.restore(); }
      for (const f of sf.fans) { ctx.save(); ctx.translate(f.x * S, f.y * S); ctx.rotate(f.a); ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, f.r * S, -0.75, 0.75); ctx.closePath(); ctx.fillStyle = A(P.canyon, 0.22); ctx.fill(); ctx.strokeStyle = A(P.canyon, 0.6); ctx.lineWidth = 0.9 * u; ctx.stroke(); ctx.restore(); }
      for (const c of sf.canyons) { for (const t of c.tribs) canyonLine(ctx, sm(t, 2), u, P, 1.1); canyonLine(ctx, sm(c.pts, 2), u, P, 1.8); }
      // разломы и трансформы
      for (const f of sf.fz) faultLine(ctx, sm(f.pts, 2), u, P, false);
      for (const f of sf.faults) faultLine(ctx, f.pts.map(pp), u, P, true);
      for (const t of sf.transforms) faultLine(ctx, sm(t.pts, 2), u, P, true);
      for (const r of sf.ridges) ridgeLine(ctx, sm(r.pts, 1), u, P);
      for (const t of sf.trenches) trenchLine(ctx, sm(t.pts, 3), t.dir, u, P);
      // горячие точки: пунктир цепи и возраст вершин
      for (const hs of sf.hotspots) if (hs.track && hs.track.length > 2) {
        const tr = hs.track.map(pp); ctx.save(); trace(ctx, tr); ctx.setLineDash([2 * u, 4 * u]); ctx.lineCap = 'round'; ctx.strokeStyle = dark(P, 0.5); ctx.lineWidth = 2.6 * u; ctx.stroke(); ctx.strokeStyle = A(P.hot, 0.95); ctx.lineWidth = 1.3 * u; ctx.stroke(); ctx.restore();
      }
      // подводные горы
      const order = sf.cones.slice().sort((a, b) => a.y - b.y);
      for (const c of order) { if (!vis(c.x, c.y)) continue; if (c.kind === 'atoll') continue; cone(ctx, c.x * S, c.y * S, u * (c.kind === 'hot' ? 1 : clamp(0.85 + 0.12 * c.r, 0.85, 1.35)), P, c.kind); }
      ctx.font = `italic ${8 * u}px Georgia, serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineWidth = 2.2 * u; ctx.strokeStyle = dark(P, 0.65); ctx.fillStyle = A(P.txt, 0.95);
      for (const hs of sf.hotspots) if (hs.pts) hs.pts.forEach((p, i) => { if (i % 2 || !p.age || !vis(p.x, p.y)) return; const t = p.age + (FM.uiLang === 'en' ? ' Ma' : ' млн л.'); ctx.strokeText(t, p.x * S + 5 * u, p.y * S - 4 * u); ctx.fillText(t, p.x * S + 5 * u, p.y * S - 4 * u); });
      for (const v of sf.vents) if (vis(v.x, v.y)) vent(ctx, v.x * S, v.y * S, u, P, v.type === 'hot');
    }

    // биология
    if (on('sbBio') && sf.reefs) {
      const rf = sf.reefs;
      for (const p of rf.lagoon || []) if (vis(p.x, p.y)) grass(ctx, p.x * S, p.y * S, u, P);
      for (const p of sf.grass || []) if (vis(p.x, p.y)) grass(ctx, p.x * S, p.y * S, u, P);
      for (const p of sf.kelp || []) if (vis(p.x, p.y)) kelp(ctx, p.x * S, p.y * S, p.s, u, P);
      for (const b of sf.banks || []) {
        const x = b.x * S, y = b.y * S; ctx.save(); ctx.translate(x, y); ctx.rotate(b.a); ctx.beginPath(); ctx.ellipse(0, 0, b.r * S * 1.5, b.r * S * 0.9, 0, 0, 6.29); ctx.fillStyle = A(P.fish, 0.12); ctx.fill(); ctx.setLineDash([3 * u, 4 * u]); ctx.strokeStyle = A(P.fish, 0.7); ctx.lineWidth = 1 * u; ctx.stroke(); ctx.restore();
        for (let q = 0; q < 3; q++) { const a = b.a + q * 2.1, rr = b.r * S * 0.55 * (q ? 1 : 0); fish(ctx, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, (q * 1.7 + b.a) % 6.28, u, P); }
      }
      for (const p of rf.fringing || []) if (vis(p.x, p.y)) { ctx.beginPath(); ctx.arc(p.x * S, p.y * S, 1.25 * u, 0, 6.29); ctx.fillStyle = A(P.coral, 0.92); ctx.fill(); }
      for (const l of rf.barrier || []) barrierLine(ctx, FM.smoothOpen(l.map(pp), 1), u, P);
      for (const p of rf.patch || []) if (vis(p.x, p.y)) for (let q = 0; q < 4; q++) { const a = q * 1.7 + p.x, rr = p.r * S * 0.45 * (q ? 1 : 0); ctx.beginPath(); ctx.arc(p.x * S + Math.cos(a) * rr, p.y * S + Math.sin(a) * rr, 1.5 * u, 0, 6.29); ctx.fillStyle = A(q % 2 ? P.coral : P.coralD, 0.95); ctx.fill(); }
      for (const a of rf.atolls || []) atoll(ctx, a.x * S, a.y * S, Math.max(4.2 * u, a.r * S), u, P);
    }

    // ресурсы дна
    if (on('sbRes') && sf.res) for (const r of sf.res) {
      const col = P.res[r.k] || P.fish, x = r.x * S, y = r.y * S;
      ctx.beginPath(); ctx.arc(x, y, (r.r || 2) * S, 0, 6.29); ctx.fillStyle = A(col, 0.16); ctx.fill(); ctx.setLineDash([2.5 * u, 3 * u]); ctx.strokeStyle = A(col, 0.85); ctx.lineWidth = 1 * u; ctx.stroke(); ctx.setLineDash([]);
    }
    if (on('sbRes') && sf.res) for (const r of sf.res) if (vis(r.x, r.y)) resIcon(ctx, r.x * S, r.y * S, u, r.k, P.res[r.k] || P.fish, r.acc >= 3);

    // названия структур
    if (on('sbNames') && sf.labels) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const base = { ridge: 15, trench: 15, plateau: 13, chain: 13, fault: 11, canyon: 11, plain: 14 };
      for (const lb of sf.labels) {
        // путь подписи — спокойный: ровные шаги и сильное сглаживание, чтобы буквы не вертелись на изгибах границ плит
        let pts = sf.helpers.smoothPoly(sf.helpers.resample(lb.pts, 1.2), 220).map(pp); if (pts.length < 2) continue; if (pts[pts.length - 1][0] < pts[0][0]) pts = pts.slice().reverse();
        let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const f = pickLabelFont(ctx, lb.text, len, (base[lb.kind] || 12) * u, u), n = lb.text.length;
        ctx.fillStyle = A(P.txt, 0.97); ctx.strokeStyle = dark(P, 0.8); ctx.lineWidth = f * 0.22;
        const w0 = [...lb.text].reduce((a, ch) => a + ctx.measureText(ch).width, 0), sp = clamp((Math.min(len * 0.92, f * n * 1.6) - w0) / Math.max(1, n - 1), f * 0.12, f * 0.55);
        R.textOnPath(ctx, pts, lb.text, f, sp, 1, null);
      }
    }
    ctx.restore();
  }

  // ---------- легенда ----------
  function seabedLegendRows(th) {
    const P = palette(th), rows = [], fn = (s, draw) => rows.push({ t: 'fn', s, draw });
    const line2 = (u) => [[2 * u, 0], [28 * u, 0]], R2 = FM.SEABED_RES || {};
    const chip = (ctx, x, cy, u) => { ctx.fillStyle = A(P.chip); ctx.fillRect(x, cy - 8 * u, 30 * u, 16 * u); };
    rows.push({ t: 'head', s: 'Глубина' });
    for (const [d, lab] of [[100, 'Шельф (до 200 м)'], [1000, 'Континентальный склон (≈1000 м)'], [3000, 'Ложе океана (≈3000 м)'], [5000, 'Абиссальная равнина (≈5000 м)'], [8500, 'Жёлоба (глубже 7000 м)']]) rows.push({ t: 'sw', col: rgb(rampAt(P.ramp, d)), s: lab });
    rows.push({ t: 'sw', col: rgb(P.land), s: 'Суша (затемнена)' });
    rows.push({ t: 'head', s: 'Геология дна' });
    fn('Срединный хребет и рифтовая долина', (c, x, y, u) => { chip(c, x, y, u); c.save(); c.translate(x, y); ridgeLine(c, line2(u), u, P); c.restore(); });
    fn('Трансформный разлом, зона разломов', (c, x, y, u) => { chip(c, x, y, u); c.save(); c.translate(x, y); faultLine(c, line2(u), u, P, true); c.restore(); });
    fn('Глубоководный жёлоб (зубцы — к надвигающейся плите)', (c, x, y, u) => { chip(c, x, y, u); c.save(); c.translate(x, y); trenchLine(c, line2(u), [null, [0, 1]], u, P); c.restore(); });
    fn('Вулканическая дуга, подводный вулкан', (c, x, y, u) => { chip(c, x, y, u); cone(c, x + 15 * u, y, u, P, 'arc'); });
    fn('Подводная гора, гайот', (c, x, y, u) => { chip(c, x, y, u); cone(c, x + 9 * u, y, u, P, 'cone'); cone(c, x + 21 * u, y, u, P, 'guyot'); });
    fn('Горячая точка: цепь гор (возраст в млн лет)', (c, x, y, u) => { chip(c, x, y, u); c.save(); c.translate(x, y); c.setLineDash([2 * u, 4 * u]); c.lineCap = 'round'; c.strokeStyle = A(P.hot); c.lineWidth = 1.3 * u; trace(c, line2(u)); c.stroke(); c.restore(); cone(c, x + 6 * u, y, u, P, 'hot'); });
    fn('Океаническое плато', (c, x, y, u) => { chip(c, x, y, u); c.save(); c.translate(x + 15 * u, y); c.beginPath(); c.ellipse(0, 0, 11 * u, 5 * u, 0, 0, 6.29); c.fillStyle = A(P.plateau, 0.25); c.fill(); c.setLineDash([5 * u, 3 * u]); c.strokeStyle = A(P.plateau); c.lineWidth = 1.5 * u; c.stroke(); c.restore(); });
    fn('Подводный каньон и конус выноса', (c, x, y, u) => { chip(c, x, y, u); c.save(); c.translate(x, y); canyonLine(c, line2(u), u, P, 1.8); c.restore(); });
    fn('Гидротермальный источник («чёрный курильщик»)', (c, x, y, u) => { chip(c, x, y, u); vent(c, x + 15 * u, y, u, P, true); });
    fn('Холодный метановый источник', (c, x, y, u) => { chip(c, x, y, u); vent(c, x + 15 * u, y, u, P, false); });
    fn('Изобаты: 200 м (кромка шельфа), 1000, 2000 …', (c, x, y, u) => { chip(c, x, y, u); c.save(); c.translate(x, y); c.strokeStyle = A(P.iso, 0.7); c.lineWidth = 1.4 * u; c.setLineDash([6 * u, 3 * u]); trace(c, [[2 * u, -3 * u], [28 * u, -3 * u]]); c.stroke(); c.setLineDash([]); c.strokeStyle = A(P.iso, 0.4); c.lineWidth = 0.9 * u; trace(c, [[2 * u, 3 * u], [28 * u, 3 * u]]); c.stroke(); c.restore(); });
    rows.push({ t: 'head', s: 'Жизнь' });
    fn('Береговой риф', (c, x, y, u) => { chip(c, x, y, u); for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(x + (4 + i * 4.4) * u, y + Math.sin(i) * 1.5 * u, 1.25 * u, 0, 6.29); c.fillStyle = A(P.coral); c.fill(); } });
    fn('Барьерный риф (за ним лагуна)', (c, x, y, u) => { chip(c, x, y, u); c.save(); c.translate(x, y); barrierLine(c, line2(u), u, P); c.restore(); });
    fn('Атолл на оседающем вулкане', (c, x, y, u) => { chip(c, x, y, u); atoll(c, x + 15 * u, y, 5.5 * u, u, P); });
    fn('Заросли ламинарии (холодные берега)', (c, x, y, u) => { chip(c, x, y, u); for (const d of [7, 15, 23]) kelp(c, x + d * u, y, 1.2, u, P); });
    fn('Морская трава (спокойное мелководье)', (c, x, y, u) => { chip(c, x, y, u); for (const d of [8, 15, 22]) grass(c, x + d * u, y, u, P); });
    fn('Богатая рыбой банка (апвеллинг)', (c, x, y, u) => { chip(c, x, y, u); fish(c, x + 12 * u, y - 2 * u, 0.2, u, P); fish(c, x + 21 * u, y + 3 * u, 3.4, u, P); });
    rows.push({ t: 'head', s: 'Ресурсы дна' });
    for (const k of ['oil', 'gas', 'hydrate', 'nodules', 'sulfide', 'crust', 'phosph', 'placer']) if (R2[k]) fn(R2[k].label, (c, x, y, u) => { chip(c, x, y, u); resIcon(c, x + 15 * u, y, u * 0.9, k, P.res[k], false); });
    fn('Тёмное кольцо — глубокая, трудная добыча', (c, x, y, u) => { chip(c, x, y, u); resIcon(c, x + 15 * u, y, u * 0.9, 'crust', P.fish, true); });
    return rows;
  }

  Object.assign(R, { drawSeabed, seabedLegendRows, seabedPalette: palette });
  FM.seabedLegendRows = seabedLegendRows;
})(window.FM);
