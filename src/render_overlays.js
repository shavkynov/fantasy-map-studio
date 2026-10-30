// Слои поверх карты: течения, полярные льды, названия морей, морские пути; легенда для экспорта PNG.
(function (FM) {
  'use strict';
  const R = FM.R;
  const { mulberry32, hashString, makeNoise, fbm, smooth, clamp } = FM;
  const { THEMES, PLATE_HUES, BOUNDARY_COLORS, makeCanvas, paperCache, getPaper, grainPattern, getGrain, chaikin, addLoops, rgb, renderMap, renderHeight } = R;

  // ---------- морские течения: линии тока в стиле карты (цвет — аномалия температуры воды относительно той же широты: тёплые / холодные / нейтральные; ширина — скорость), со стрелками ----------
  function drawCurrents(ctx, map, th, k, S) {
    if (!FM.oceanFlow) return;
    const flow = FM.oceanFlow(map), game = th.game, ink = th.label === 'Сепия';
    const WARM = game ? [200, 70, 50] : ink ? [150, 62, 40] : [60, 60, 60], COLD = game ? [40, 100, 190] : ink ? [52, 88, 120] : [20, 20, 20], NEUT = game ? [110, 120, 130] : ink ? [96, 84, 70] : [110, 110, 110], pick = (kd) => kd === 1 ? WARM : kd === 0 ? COLD : NEUT;
    const rgbA = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of flow.streams) {
      const pts = FM.smoothOpen(s.pts.map(p => [p[0] * S, p[1] * S]), 3), n = pts.length, per = s.warm.length;
      let runStart = 0, arrowAt = 0;
      const seg = (i0, i1, warm) => {
        const col = pick(warm), wob = (j) => Math.sin(j * 0.45 + s.pts[0][0]) * 0.5 * k;
        ctx.setLineDash(!game && !ink && warm === 0 ? [9 * k, 6 * k] : []);                           // в ч/б холодные — штрихом, тёплые — сплошной
        for (const [lw, al] of [[2.6, 0.22], [1.5, 0.85]]) {                                         // мягкое подкрашивание + линия
          ctx.strokeStyle = rgbA(col, al * (0.6 + 0.4 * s.w)); ctx.lineWidth = lw * k * (0.8 + 0.4 * s.w);
          ctx.beginPath(); ctx.moveTo(pts[i0][0], pts[i0][1] + wob(i0));
          for (let j = i0 + 1; j <= i1; j++) ctx.lineTo(pts[j][0], pts[j][1] + wob(j));
          ctx.stroke();
        }
      };
      const kind = (i) => s.warm[Math.min(per - 1, Math.round(i / (n - 1) * (per - 1)))];
      for (let i = 1; i < n; i++) {
        if (kind(i) !== kind(i - 1) || i === n - 1) { seg(runStart, i, kind(runStart)); runStart = i; }
      }
      // стрелки: каждые ~60 пикселей вдоль линии
      ctx.setLineDash([]); let acc = 0;
      for (let i = 1; i < n; i++) {
        acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (acc < 70 * k) continue; acc = 0;
        const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), x = pts[i][0], y = pts[i][1], col = pick(kind(i)), L = 8.5 * k;
        ctx.fillStyle = rgbA(col, 0.95); ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * L * 0.6, y + Math.sin(a) * L * 0.6);
        ctx.lineTo(x + Math.cos(a + 2.5) * L, y + Math.sin(a + 2.5) * L); ctx.lineTo(x + Math.cos(a - 2.5) * L, y + Math.sin(a - 2.5) * L); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------- приливы: осушка при отливе (точки у берега) и стрелки прилив/отлив на участках с сильным приливом ----------
  function drawTides(ctx, map, th, k, S, f) {
    if (!FM.tideBase) return; f = f == null ? 1 : f;
    const { W, H, h, dist, ocean } = map, T = FM.tideBase(map), s = W / 480, game = th.game, ink = th.label === 'Сепия';
    const col = game ? [30, 128, 160] : ink ? [52, 100, 122] : [30, 30, 30], sand = game ? [190, 160, 100] : ink ? [96, 84, 70] : [90, 90, 90];
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // 1. осушка: точки в полосе вдоль берега, где отлив обнажает дно
    ctx.fillStyle = `rgba(${sand[0]},${sand[1]},${sand[2]},${game ? 0.75 : 0.6})`;
    const rad = Math.max(1.1 * k, 0.34 * S);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, r = T.r[i] * f; if (r < 1.8 || h[i] > 0 || dist[i] < 0.6) continue;
      if (dist[i] > FM.tideFlat(r, T.shelf[i], s)) continue;
      const hh = FM.hashString(x + ':' + y); if ((hh & 255) > 175) continue;
      ctx.beginPath(); ctx.arc((x + ((hh >> 8) & 255) / 255) * S, (y + ((hh >> 16) & 255) / 255) * S, rad, 0, 6.3); ctx.fill();
    }
    // 2. сильные приливы: по одной отметке на крупную ячейку — самая сильная точка у берега
    const G = Math.max(8, Math.round(26 * s)), best = new Map();
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x, r = T.r[i] * f; if (r < FM.TIDE_STRONG || h[i] > 0 || !ocean[i] || dist[i] < 2 || dist[i] > 3.6) continue;
      const key = ((x / G) | 0) + ',' + ((y / G) | 0), b = best.get(key); if (!b || r > b.r) best.set(key, { x, y, r, i });
    }
    const arrow = (x, y, a, L) => {
      const x2 = x + Math.cos(a) * L, y2 = y + Math.sin(a) * L;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2 + Math.cos(a + 2.6) * 7 * k, y2 + Math.sin(a + 2.6) * 7 * k); ctx.lineTo(x2, y2); ctx.lineTo(x2 + Math.cos(a - 2.6) * 7 * k, y2 + Math.sin(a - 2.6) * 7 * k); ctx.stroke();
    };
    for (const b of best.values()) {
      const { x, y } = b, gx = dist[b.i + 1] - dist[b.i - 1], gy = dist[b.i + W] - dist[b.i - W]; if (Math.hypot(gx, gy) < 1e-3) continue;
      const toLand = Math.atan2(-gy, -gx), huge = b.r >= FM.TIDE_HUGE, L = (huge ? 32 : 24) * k, px = x * S, py = y * S, nx = -Math.sin(toLand) * 4.6 * k, ny = Math.cos(toLand) * 4.6 * k;
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.92)`; ctx.lineWidth = (huge ? 2.8 : 2.2) * k;
      arrow(px + nx - Math.cos(toLand) * L / 2, py + ny - Math.sin(toLand) * L / 2, toLand, L);              // прилив — к берегу
      arrow(px - nx + Math.cos(toLand) * L / 2, py - ny + Math.sin(toLand) * L / 2, toLand + Math.PI, L);    // отлив — от берега
      if (huge) {
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.95)`; ctx.font = `italic ${15 * k}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(FM.T('{0} м', Math.round(b.r)), px - Math.cos(toLand) * 32 * k, py - Math.sin(toLand) * 32 * k);
      }
    }
    ctx.restore();
  }

  // ---------- полярные льды, названия морей, морские пути ----------
  function drawPolarIce(ctx, map, th, k, S) {
    const ice = FM.polarIce(map); if (!ice) return;
    const { W, H } = map;
    if (!map._iceCv || map._iceCv.th !== th.label) {
      const cv = makeCanvas(W, H), cx = cv.getContext('2d'), im = cx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) if (ice[i]) { const o = i * 4; im.data[o] = 240; im.data[o + 1] = 246; im.data[o + 2] = 250; im.data[o + 3] = 235; }
      cx.putImageData(im, 0, 0); map._iceCv = { cv, th: th.label };
    }
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.shadowColor = 'rgba(60,90,120,0.55)'; ctx.shadowBlur = 5 * k;
    ctx.drawImage(map._iceCv.cv, -S / 2, -S / 2, W * S, H * S);
    ctx.shadowBlur = 0;
    // трещины и торосы: короткие штрихи по льду
    ctx.strokeStyle = 'rgba(120,150,175,0.55)'; ctx.lineWidth = 0.9 * k; ctx.beginPath();
    for (let y = 2; y < H - 2; y += 4) for (let x = 2 + (y % 8 ? 2 : 0); x < W - 2; x += 5) {
      const i = y * W + x; if (!ice[i] || !ice[i + 2] || !ice[i - 2]) continue; const h1 = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (h1 % 3) continue; const a = (h1 % 628) / 100 * 0.3, l = (2 + h1 % 3) * S * 0.5;
      ctx.moveTo(x * S - Math.cos(a) * l, y * S - Math.sin(a) * l); ctx.lineTo(x * S + Math.cos(a) * l, y * S + Math.sin(a) * l);
    }
    ctx.stroke(); ctx.restore();
  }
  function drawSeaNames(ctx, map, th, k, S) {
    const list = FM.seaBasins(map); if (!list.length) return;
    ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const col = th.game ? 'rgba(20,50,110,0.9)' : (th.label === 'Сепия' ? 'rgba(55,75,100,0.88)' : th.ink);
    for (const b of list) {
      const target = Math.min(b.half * 2 * S * 0.85, b.kind === 'ocean' ? 520 * k : 330 * k), n = b.name.length;
      let f = clamp(target / (n * 0.95), 12 * k, b.kind === 'ocean' ? 40 * k : b.kind === 'sea' ? 30 * k : 22 * k);
      ctx.font = `italic ${f}px Georgia, "Times New Roman", serif`;
      let w0 = [...b.name].reduce((a, ch) => a + ctx.measureText(ch).width, 0);
      if (w0 > target) { f *= target / w0; ctx.font = `italic ${f}px Georgia, "Times New Roman", serif`; w0 = target; }
      const spacing = clamp((target - w0) / Math.max(1, n - 1), f * 0.1, f * (b.kind === 'ocean' ? 0.6 : 0.35));
      const c = Math.cos(b.ang), s = Math.sin(b.ang), L = target * 0.6, x = b.x * S, y = b.y * S;
      ctx.fillStyle = col; ctx.strokeStyle = th.game ? 'rgba(255,255,255,0.25)' : rgb(th.paper, 0.35); ctx.lineWidth = f * 0.2;
      R.textOnPath(ctx, [[x - c * L, y - s * L], [x + c * L, y + s * L]], b.name, f, spacing, k, null);
    }
    ctx.restore();
  }
  function drawSeaRoutes(ctx, map, pol, th, k, S) {
    const routes = FM.seaRoutes(map, pol); if (!routes.length) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([2 * k, 6 * k]);
    ctx.strokeStyle = th.game ? 'rgba(20,40,90,0.85)' : th.ink; ctx.lineWidth = 2.2 * k; ctx.globalAlpha = 0.9;
    for (const r of routes) {
      const p = FM.smoothOpen(r.pts.map(q => [q[0] * S, q[1] * S]), 3);
      ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- легенда для экспорта PNG ----------
  function drawLegend(ctx, map, opts) {
    const th = THEMES[opts.theme] || THEMES.sepia, pol = opts.political, L = opts.layers || {}, cw = ctx.canvas.width, ch = ctx.canvas.height;
    const sc = opts.sc || cw / (map.W * 3.75), k = 1, fs = 13 * sc, row = 21 * sc, pad = 12 * sc;
    const rows = [];   // {type:'head'|'marker'|'line'|'swatch', ...}
    if (opts.seabed && FM.seabedLegendRows) rows.push(...FM.seabedLegendRows(th, map));
    else {
    const hasC = pol && pol.cities && pol.cities.length || (pol && pol.states && pol.states.length);
    if (pol && pol.states && pol.states.length) { rows.push({ t: 'head', s: 'Государства' }); for (const s of pol.states.slice(0, 14)) rows.push({ t: 'sw', col: R.stateColor(s.id, 0.75), s: s.name + (s.type && FM.STATE_TYPES && FM.STATE_TYPES[s.type] ? ' — ' + FM.STATE_TYPES[s.type].label.toLowerCase() : '') }); }
    if (hasC) {
      rows.push({ t: 'head', s: 'Поселения' });
      const names = { capital: 'Столица', city: 'Город', town: 'Городок', village: 'Деревня', port: 'Порт', fortress: 'Крепость', mine: 'Рудник', ruin: 'Руины' };
      const have = new Set(FM.allCities(pol).map(c => c.type)); for (const t of Object.keys(names)) if (have.has(t)) rows.push({ t: 'mk', ty: t, s: names[t] });
    }
    rows.push({ t: 'head', s: 'Обозначения' });
    if (pol && pol.states && pol.states.length) rows.push({ t: 'ln', dash: [11, 4, 2.5, 4], w: 2.3, s: 'Граница государства' });
    if (pol && pol.roads && pol.roads.length && L.roads !== false) rows.push({ t: 'ln', dash: [], w: 1.8, s: 'Дорога' });
    if (L.rivers !== false) rows.push({ t: 'ln', dash: [], w: 1.4, col: '#2f6fb3', s: 'Река' });
    if (pol && L.routes !== false && pol.cities && pol.cities.length && FM.seaRoutes && FM.seaRoutes(map, pol).length) rows.push({ t: 'ln', dash: [2, 6], w: 2.2, s: 'Морской путь' });
    if (L.currents) { rows.push({ t: 'ln', dash: [], w: 1.6, col: th.game ? '#c84632' : '#963e28', s: 'Тёплое течение' }); rows.push({ t: 'ln', dash: [], w: 1.6, col: th.game ? '#2864be' : '#345878', s: 'Холодное течение' }); }
    if (L.tides) {
      const tc = th.game ? '#1e80a0' : th.label === 'Сепия' ? '#34647a' : '#1e1e1e', sd = th.game ? '#bea064' : th.label === 'Сепия' ? '#605446' : '#5a5a5a';
      rows.push({ t: 'fn', s: 'Сильный прилив и отлив', draw: (c, x, y, sc) => { c.strokeStyle = tc; c.lineWidth = 1.3 * sc; c.lineCap = 'round'; for (const d of [-1, 1]) { const y0 = y + d * 2.4 * sc, x0 = x + 13 * sc - d * 8 * sc, x1 = x + 13 * sc + d * 8 * sc; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y0); c.moveTo(x1 - d * 3.4 * sc, y0 - 2.4 * sc); c.lineTo(x1, y0); c.lineTo(x1 - d * 3.4 * sc, y0 + 2.4 * sc); c.stroke(); } } });
      rows.push({ t: 'fn', s: 'Осушка при отливе', draw: (c, x, y, sc) => { c.fillStyle = sd; for (let q = 0; q < 9; q++) { c.beginPath(); c.arc(x + (4 + (q * 7) % 19) * sc, y + (((q * 5) % 7) - 3) * sc, 0.9 * sc, 0, 6.3); c.fill(); } } });
    }
    if (L.ice !== false) rows.push({ t: 'sw', col: 'rgba(235,243,249,1)', s: 'Полярный лёд' });
    if (L.cat !== false && map.catastrophes && map.catastrophes.length) {
      const has = (...ks) => map.catastrophes.some(e => ks.includes(e.kind));
      if (has('meteor', 'caldera')) rows.push({ t: 'fn', s: 'Кратер, кальдера', draw: (c, x, y, sc) => { c.strokeStyle = th.ink; c.lineWidth = 1.3 * sc; c.beginPath(); c.arc(x + 13 * sc, y, 7 * sc, 0, 7); c.stroke(); } });
      if (has('rift', 'canyon')) rows.push({ t: 'fn', s: 'Раскол, каньон', draw: (c, x, y, sc) => { c.strokeStyle = th.ink; c.lineWidth = 1.3 * sc; c.beginPath(); c.moveTo(x, y + 3 * sc); c.lineTo(x + 10 * sc, y - 3 * sc); c.lineTo(x + 20 * sc, y + 3 * sc); c.lineTo(x + 28 * sc, y - 2 * sc); c.stroke(); } });
      if (has('subsidence')) rows.push({ t: 'fn', s: 'Провал суши', draw: (c, x, y, sc) => { c.strokeStyle = th.ink; c.lineWidth = 1.2 * sc; c.setLineDash([3 * sc, 2 * sc]); c.beginPath(); c.ellipse(x + 13 * sc, y, 10 * sc, 6 * sc, 0, 0, 7); c.stroke(); c.setLineDash([]); } });
    }
    if (pol && pol.zones && pol.zones.some(z => z.kind === 1)) rows.push({ t: 'sw', col: 'rgba(90,70,50,0.45)', s: 'Ничьи земли' });
    if (pol && pol.zones && pol.zones.some(z => z.kind === 2)) rows.push({ t: 'sw', col: 'rgba(170,50,40,0.5)', s: 'Спорные земли' });
    }
    for (const r of rows) r.s = FM.T(r.s);
    ctx.save(); ctx.font = `${fs}px Georgia, serif`;
    let w = 0; for (const r of rows) w = Math.max(w, ctx.measureText(r.s).width + (r.t === 'head' ? 0 : 44 * sc));
    w += pad * 2; const h = rows.length * row + pad * 2, m = 26 * sc;
    if (opts.measure) { ctx.restore(); return { w, h }; }
    // угол с наименьшим перекрытием сушей
    const sx = map.W / cw, sy = map.H / ch, landUnder = (x, y) => { let n = 0; for (let yy = y; yy < y + h; yy += 12) for (let xx = x; xx < x + w; xx += 12) { const i = Math.min(map.H - 1, Math.round(yy * sy)) * map.W + Math.min(map.W - 1, Math.round(xx * sx)); if (map.h[i] > 0) n++; } return n; };
    const cands = [[m, ch - h - m], [cw - w - m, ch - h - m], [m, m], [cw - w - m, m]];
    let best = cands[0], bn = 1e9; for (const c of cands) { const n = landUnder(c[0], c[1]); if (n < bn) { bn = n; best = c; } }
    const x0 = opts.at ? opts.at[0] : best[0], y0 = opts.at ? opts.at[1] : best[1];
    ctx.fillStyle = rgb(th.paper, 0.92); ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5 * sc;
    ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.fill(); ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    rows.forEach((r, i) => {
      const y = y0 + pad + i * row + row / 2, xt = x0 + pad + 34 * sc;
      if (r.t === 'head') { ctx.font = `bold ${fs}px Georgia, serif`; ctx.fillStyle = th.ink; ctx.fillText(r.s, x0 + pad, y); ctx.font = `${fs}px Georgia, serif`; return; }
      ctx.fillStyle = th.ink;
      if (r.t === 'sw') { ctx.fillStyle = r.col; ctx.fillRect(x0 + pad, y - 6 * sc, 26 * sc, 12 * sc); ctx.strokeStyle = th.ink; ctx.lineWidth = 0.8 * sc; ctx.strokeRect(x0 + pad, y - 6 * sc, 26 * sc, 12 * sc); }
      else if (r.t === 'ln') { ctx.strokeStyle = r.col || th.ink; ctx.lineWidth = r.w * sc; ctx.setLineDash(r.dash.map(d => d * sc)); ctx.beginPath(); ctx.moveTo(x0 + pad, y); ctx.lineTo(x0 + pad + 28 * sc, y); ctx.stroke(); ctx.setLineDash([]); }
      else if (r.t === 'fn') { r.draw(ctx, x0 + pad, y, sc); }
      else if (r.t === 'mk') { ctx.save(); ctx.translate(x0 + pad + 13 * sc, y); ctx.scale(sc, sc); R.drawMarker(ctx, { x: 0, y: 0, type: r.ty }, th, 1, 1); ctx.restore(); }
      ctx.fillStyle = th.ink; ctx.fillText(r.s, xt, y);
    });
    ctx.restore();
  }

  // окно легенды: отдельный холст по размеру содержимого (для интерфейса)
  function legendCanvas(map, opts) {
    const sc = 1.15, t = makeCanvas(8, 8), tc = t.getContext('2d'), m = drawLegend(tc, map, Object.assign({}, opts, { measure: true, sc }));
    const c = makeCanvas(Math.ceil(m.w + 4), Math.ceil(m.h + 4)); drawLegend(c.getContext('2d'), map, Object.assign({}, opts, { at: [2, 2], sc }));
    return c;
  }
  Object.assign(R, { legendCanvas, drawCurrents, drawTides, drawPolarIce, drawSeaNames, drawSeaRoutes, drawLegend });
})(window.FM);
