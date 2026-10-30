// Генератор карты города (вид сверху): полуавтоматический — планировка строится из данных мировой карты
// (дороги → ворота, реки, море, тип города), а затем дополняется расставленными вручную объектами.
(function (FM) {
  'use strict';
  const { mulberry32, hashString, makeNoise, fbm, clamp } = FM;
  const CW = 1400, CH = 1000, CX = 700, CY = 500, U = 70;   // холст, центр города, единиц на клетку мира
  const METERS = 2.5;                                       // метров в единице

  const SPEC = {
    capital:  { R: 300, wall: 0,   keep: 1,   temples: 2, dens: 1.0 },
    city:     { R: 250, wall: 1, keep: 0.4, temples: 1, dens: 1.0 },
    town:     { R: 185, wall: 0, keep: 0,   temples: 1, dens: 0.9 },
    port:     { R: 215, wall: 1, keep: 0.15, temples: 1, dens: 0.95, port: 1 },
    village:  { R: 150, wall: 0,   keep: 0,   temples: 0, dens: 0.8 },
    fortress: { R: 125, wall: 1,   keep: 1,   temples: 0, dens: 0.55 },
    mine:     { R: 135, wall: 0,   keep: 0,   temples: 0, dens: 0.6 },
    ruin:     { R: 140, wall: 0, keep: 0.3, temples: 0, dens: 0.6, ruin: 1 }
  };
  FM.CITY_TEMPLATES = {
    house: { label: 'Дом', w: 16, h: 12 }, manor: { label: 'Усадьба', w: 30, h: 20 }, temple: { label: 'Храм', w: 44, h: 28 },
    tower: { label: 'Башня', w: 16, h: 16 }, well: { label: 'Колодец', w: 7, h: 7 }, stall: { label: 'Лавка', w: 10, h: 8 }, tree: { label: 'Дерево', w: 12, h: 12 }
  };

  const bil = (map, fx, fy) => {
    const { W, H, h } = map; fx = clamp(fx, 0, W - 1.001); fy = clamp(fy, 0, H - 1.001);
    const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y, i = y * W + x;
    return h[i] * (1 - u) * (1 - v) + h[i + 1] * u * (1 - v) + h[i + W] * (1 - u) * v + h[i + W + 1] * u * v;
  };
  const chaikin = (pts, it, closed) => {
    for (let k = 0; k < it; k++) {
      const out = [], n = pts.length;
      if (!closed) out.push(pts[0]);
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      if (!closed) out.push(pts[n - 1]);
      pts = out;
    }
    return pts;
  };
  function segDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0; t = clamp(t, 0, 1);
    return { d: Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t), tx: l2 ? dx / Math.sqrt(l2) : 1, ty: l2 ? dy / Math.sqrt(l2) : 0 };
  }
  function obbOverlap(a, b, pad) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const ax = [[a.c, a.s], [-a.s, a.c], [b.c, b.s], [-b.s, b.c]];
    for (const [X, Y] of ax) {
      const ra = a.hw * Math.abs(a.c * X + a.s * Y) + a.hh * Math.abs(-a.s * X + a.c * Y);
      const rb = b.hw * Math.abs(b.c * X + b.s * Y) + b.hh * Math.abs(-b.s * X + b.c * Y);
      if (Math.abs(dx * X + dy * Y) > ra + rb + pad) return false;
    }
    return true;
  }
  const mkObb = (x, y, w, h, ang, kind) => ({ x, y, hw: w / 2, hh: h / 2, a: ang, c: Math.cos(ang), s: Math.sin(ang), kind });

  FM.CM = { CW, CH, CX, CY, U, METERS, SPEC, bil, chaikin, segDist, obbOverlap, mkObb };
})(window.FM);
