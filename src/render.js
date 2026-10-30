// Рендер карты "от руки": бумага, вода со штриховкой, береговая линия, горы-штампы, слой плит
(function (FM) {
  'use strict';
  const { mulberry32, hashString, makeNoise, fbm, smooth, clamp } = FM;

  const THEMES = {
    sepia: {
      label: 'Сепия',
      paper: [221, 213, 199], paperVar: 16, grain: 0.10,
      ink: '#3b3229', inkRGB: [59, 50, 41],
      waterFar: [170, 161, 147], waterNear: [200, 192, 178],
      hatch: true, halos: 0, vignette: 0.42, frame: true,
      shade: 'rgba(59,50,41,0.20)'
    },
    ink: {
      label: 'Чернила (ч/б)',
      paper: [247, 247, 245], paperVar: 3, grain: 0.04,
      ink: '#151515', inkRGB: [21, 21, 21],
      waterFar: [226, 226, 224], waterNear: [236, 236, 234],
      hatch: false, halos: 3, vignette: 0, frame: false,
      shade: 'rgba(21,21,21,0.10)'
    }
  };

  THEMES.color = {
    label: 'Цветной', game: true,                         // game: растровая подложка (гипсометрическая окраска) вместо бумаги и штрихов
    paper: [250, 247, 238], paperVar: 3, grain: 0.03,
    ink: '#2d2a26', inkRGB: [45, 42, 38],
    waterFar: [112, 160, 205], waterNear: [190, 222, 240],
    hatch: false, halos: 0, vignette: 0.1, frame: true,
    shade: 'rgba(45,42,38,0.2)'
  };

  const PLATE_HUES = [8, 205, 42, 140, 275, 22, 175, 330, 60, 240, 100, 0, 190, 300];
  const BOUNDARY_COLORS = { 1: [192, 57, 43], 2: [43, 108, 176], 3: [47, 133, 90] };

  function makeCanvas(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  // ---------- бумага ----------
  const paperCache = new Map();
  function getPaper(w, h, th, key) {
    const k = key + '|' + w + 'x' + h;
    if (paperCache.has(k)) return paperCache.get(k);
    const c = makeCanvas(w, h), ctx = c.getContext('2d');
    const lw = Math.ceil(w / 5), lh = Math.ceil(h / 5);
    const tc = makeCanvas(lw, lh), tctx = tc.getContext('2d');
    const img = tctx.createImageData(lw, lh);
    const noise = makeNoise(mulberry32(hashString(key + '|paper')));
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const n = 0.6 * fbm(noise, x * 0.018, y * 0.018, 4) + 0.4 * fbm(noise, x * 0.08 + 7, y * 0.08 + 3, 3);
      const d = n * th.paperVar;
      const i = (y * lw + x) * 4;
      img.data[i] = th.paper[0] + d; img.data[i + 1] = th.paper[1] + d; img.data[i + 2] = th.paper[2] + d * 1.1; img.data[i + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tc, 0, 0, w, h);
    paperCache.set(k, c);
    return c;
  }

  let grainPattern = null, grainKey = '';
  function getGrain(ctx, th) {
    const key = String(th.grain);
    if (grainKey !== key) {
      const g = makeCanvas(256, 256), gctx = g.getContext('2d');
      const img = gctx.createImageData(256, 256);
      const r = mulberry32(12345);
      for (let i = 0; i < 256 * 256; i++) {
        const v = 255 - r() * th.grain * 255;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
      }
      gctx.putImageData(img, 0, 0);
      grainPattern = ctx.createPattern(g, 'repeat'); grainKey = key;
    }
    return grainPattern;
  }

  // ---------- линии ----------
  function chaikin(pts, iter) {
    for (let it = 0; it < iter; it++) {
      const out = [], n = pts.length;
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
        out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
      }
      pts = out;
    }
    return pts;
  }

  // v2 (этап 4): береговой контур отдельно от генерации. Основа глаже (Chaikin ×3), смещение по нормали — степенной спектр (крупные + мелкие неровности, как у реальных берегов),
  // амплитуда зависит от типа окраины: у активных (сближение) берег ровнее, у рифтовых — изрезаннее; смещение ограничено радиусом кривизны, чтобы контур не пересекал сам себя.
  function handLoop2(grid, S, noise, amp, map) {
    let pts = chaikin(grid.map(p => [p[0] * S, p[1] * S]), 3);
    if (pts.length > 160) for (let pass = 0; pass < 2; pass++) {   // сглаживание ступеней сетки (малые острова не трогаем, чтобы не «таяли»)
      const m = pts.length, R = 14, sm = new Array(m);
      for (let i = 0; i < m; i++) { let x = 0, y = 0, ws = 0; for (let d = -R; d <= R; d++) { const wgt = R + 1 - Math.abs(d), q = pts[(i + d + m) % m]; x += q[0] * wgt; y += q[1] * wgt; ws += wgt; } sm[i] = [x / ws, y / ws]; }
      const im = map && map.inletMask;   // у фьордов и рий сглаживание ослаблено, иначе узкие заливы «зарастают»
      if (im) for (let i = 0; i < m; i++) { const gx = Math.min(map.W - 1, Math.max(0, Math.round(pts[i][0] / S))), gy = Math.min(map.H - 1, Math.max(0, Math.round(pts[i][1] / S))), wt = im[gy * map.W + gx] / 255 * 0.85; if (wt > 0) sm[i] = [sm[i][0] + (pts[i][0] - sm[i][0]) * wt, sm[i][1] + (pts[i][1] - sm[i][1]) * wt]; }
      pts = sm;
    }
    const n = pts.length, out = new Array(n), mg = map && map.margin, W = map.W, H = map.H;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 2 + n) % n], b = pts[(i + 2) % n], p = pts[i];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1, nx = -ty / l, ny = tx / l;
      let mod = 1;
      if (mg) { const gx = Math.min(W - 1, Math.max(0, Math.round(p[0] / S))), gy = Math.min(H - 1, Math.max(0, Math.round(p[1] / S))), j = gy * W + gx; mod = Math.min(1.6, Math.max(0.5, 1 + 0.5 * mg.rift[j] + 0.2 * mg.pass[j] - 0.45 * mg.conv[j])); }
      const w = (0.9 * noise(p[0] * 0.03, p[1] * 0.03) + 0.6 * noise(p[0] * 0.09 + 40, p[1] * 0.09) + 0.4 * noise(p[0] * 0.22 + 80, p[1] * 0.22 + 5)) * amp * 1.0 * mod;
      out[i] = [p[0] + nx * w, p[1] + ny * w];
    }
    return out;
  }

  // береговые контуры и «ореолы» мелководья карты
  function coastLoops(map, S) {
    const noise = makeNoise(mulberry32(hashString(map.seed + '|wobble'))), hl = (g, s, nz, am) => handLoop2(g, s, nz, am, map);
    const coast = FM.contours(map.h, map.W, map.H, 0).map(l => hl(l, S, noise, 1.5));
    const hd = Float32Array.from(map.dist); FM.blur(hd, map.W, map.H, 1);
    const halos = [1.7, 3.6, 5.9].map(lv => {
      const f = new Float32Array(hd.length);
      for (let i = 0; i < f.length; i++) f[i] = lv - hd[i];
      return FM.contours(f, map.W, map.H, 0).map(l => hl(l, S, noise, 1.1));
    });
    return { coast, halos };
  }

  function addLoops(path, loops) {
    for (const l of loops) {
      path.moveTo(l[0][0], l[0][1]);
      for (let i = 1; i < l.length; i++) path.lineTo(l[i][0], l[i][1]);
      path.closePath();
    }
  }

  function rgb(c, a) { return a == null ? `rgb(${c[0]|0},${c[1]|0},${c[2]|0})` : `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`; }

  // ---------- основная отрисовка ----------
  function renderMap(map, opts) {
    // Геометрия всегда строится в «опорных» пикселях (S = 3.75) и кэшируется один раз; масштаб (zoom) и видимая
    // область (view, экранные px) задаются отдельно, поэтому приближение не требует пересчёта карты.
    const S = 3.75, th = THEMES[opts.theme] || THEMES.sepia, k = 1;
    const zoom = opts.zoom || 1;
    const w = map.W * S, h = map.H * S;
    const view = opts.view || { x: 0, y: 0, w: Math.round(w * zoom), h: Math.round(h * zoom) };
    const vr = { x0: view.x / zoom, y0: view.y / zoom, x1: (view.x + view.w) / zoom, y1: (view.y + view.h) / zoom };
    const canvas = makeCanvas(view.w, view.h), ctx = canvas.getContext('2d');
    ctx.setTransform(zoom, 0, 0, zoom, -view.x, -view.y);
    const rand = mulberry32(hashString(map.seed + '|draw'));
    const noise = makeNoise(mulberry32(hashString(map.seed + '|wobble')));

    // геометрия (кэш на карте)
    const ck = '_geo' + S;
    if (!map[ck]) {
      const { coast, halos } = coastLoops(map, S);
      const rivers = map.rivers.map(rv => rv.map(p => [p[0] * S + noise(p[0] * 0.3, p[1] * 0.3) * 0.8 * k, p[1] * S + noise(p[0] * 0.3 + 9, p[1] * 0.3) * 0.8 * k, p[2]]));
      map[ck] = { coast, halos, rivers, features: R.placeFeatures(map, S, map.seed) };
    }
    const geo = map[ck];

    if (opts.seabed && R.drawSeabed) {                 // «Карта дна»: суша затемнена, дно с геологией, жизнью и ресурсами
      R.drawSeabed(ctx, map, th, { S, zoom, vr, geo, layers: opts.layers });
      if (th.frame) { ctx.strokeStyle = th.ink; ctx.lineWidth = 3.2 * k; ctx.strokeRect(16 * k, 16 * k, w - 32 * k, h - 32 * k); ctx.lineWidth = 1 * k; ctx.strokeRect(24 * k, 24 * k, w - 48 * k, h - 48 * k); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = getGrain(ctx, th); ctx.fillRect(0, 0, view.w, view.h); ctx.globalCompositeOperation = 'source-over';
      return canvas;
    }

    if (th.game) {
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(R.gameTerrain(map, noise), 0, 0, w, h);
    } else {
    // 1. бумага
    ctx.drawImage(getPaper(w, h, th, map.seed + th.label), 0, 0);

    // 2. вода: заливка по расстоянию до берега
    const gw = map.W, gh = map.H;
    const wk = '_wash' + th.label;
    if (!map[wk]) {
      const wc = makeCanvas(gw, gh), wctx = wc.getContext('2d'), wimg = wctx.createImageData(gw, gh);
      for (let i = 0; i < gw * gh; i++) {
        const t = smooth(2, 28, map.wd ? map.wd[i] : map.dist[i]);
        const n = fbm(noise, (i % gw) * 0.05, ((i / gw) | 0) * 0.05, 3) * 3;
        wimg.data[i * 4] = th.waterNear[0] + (th.waterFar[0] - th.waterNear[0]) * t + n;
        wimg.data[i * 4 + 1] = th.waterNear[1] + (th.waterFar[1] - th.waterNear[1]) * t + n;
        wimg.data[i * 4 + 2] = th.waterNear[2] + (th.waterFar[2] - th.waterNear[2]) * t + n;
        wimg.data[i * 4 + 3] = 255;
      }
      wctx.putImageData(wimg, 0, 0);
      map[wk] = wc;
    }
    const wc = map[wk];

    const waterPath = new Path2D(); waterPath.rect(0, 0, w, h); addLoops(waterPath, geo.coast);
    ctx.save();
    ctx.clip(waterPath, 'evenodd');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(wc, 0, 0, w, h);

    // 3. штриховка воды (сепия) или ореолы (ч/б)
    ctx.strokeStyle = th.ink; ctx.lineCap = 'round';
    if (th.hatch) {
      const gap = 5.2 * k;
      for (let y = gap, line = 0; y < h; y += gap, line++) {
        const reach = 5 + 24 * Math.pow(rand(), 1.1);
        if (y < vr.y0 - gap || y > vr.y1 + gap) continue;
        let run = null;
        const flush = () => {
          if (run && run.x1 - run.x0 > 4 * k) {
            ctx.globalAlpha = clamp(0.8 - 0.5 * (run.dmax / reach), 0.18, 0.8);
            ctx.lineWidth = 0.95 * k;
            ctx.beginPath(); ctx.moveTo(run.x0, run.y); ctx.lineTo(run.x1, run.y + (noise(run.x0 * 0.02, line) * 0.8)); ctx.stroke();
          }
          run = null;
        };
        for (let x = Math.max(0, Math.floor(vr.x0 / 3) * 3); x < Math.min(w, vr.x1 + 3); x += 3 * k) {
          const gx = clamp(Math.round(x / S), 0, gw - 1), gy = clamp(Math.round(y / S), 0, gh - 1);
          const d = map.dist[gy * gw + gx];
          const gap2 = noise(x * 0.025, line * 3.1) > 0.5;
          const ok = d > 0.9 && d < reach * (0.8 + 0.4 * noise(x * 0.01, line * 1.7)) && !gap2;
          if (ok) { if (!run) run = { x0: x, x1: x, y, dmax: d }; run.x1 = x + 3 * k; run.dmax = Math.max(run.dmax, d); }
          else flush();
        }
        flush();
      }
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < th.halos; i++) {
      ctx.lineWidth = (1.5 - i * 0.4) * k; ctx.globalAlpha = 0.9 - i * 0.2;
      const p = new Path2D(); addLoops(p, geo.halos[i]); ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    }

    // реки
    if (th.game && (!opts.layers || opts.layers.rivers !== false)) R.gameRivers(ctx, geo, k);
    else if (!opts.layers || opts.layers.rivers !== false) {
      ctx.strokeStyle = th.ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const rv of geo.rivers) {
        for (let i = 0; i < rv.length - 1; i++) {
          const a = rv[i], b = rv[i + 1];
          ctx.lineWidth = (0.7 + 2.3 * (a[2] + b[2]) / 2) * k;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
      }
    }

    if (opts.political && opts.political.roads && opts.political.roads.length && (!opts.layers || opts.layers.roads !== false)) R.drawRoads(ctx, map, opts.political, th, k, S, noise);

    // 4. береговая линия
    const coastPath = new Path2D(); addLoops(coastPath, geo.coast);
    if (th.game) {
      ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(52,80,104,0.75)'; ctx.lineWidth = 1.2 * k; ctx.stroke(coastPath);
    } else { ctx.strokeStyle = th.ink; ctx.lineWidth = 2.3 * k; ctx.lineJoin = 'round'; ctx.stroke(coastPath); }

    // 5. горы, холмы, вулканы
    const ths = th.game ? Object.assign({}, th, { paper: [236, 230, 212], ink: '#3a3228', inkRGB: [58, 50, 40] }) : th, thv = th.game ? Object.assign({}, ths, { paper: [142, 168, 112] }) : th;   // деревья — зелёные, горы — светлые   // «Цветной»: значки рельефа и лесов тёмной тушью по светлой заливке
    if (th.game) { ctx.save(); ctx.globalAlpha = 0.86; }
    for (const it of geo.features) {
      if (it.x < vr.x0 - 90 || it.x > vr.x1 + 90 || it.y < vr.y0 - 90 || it.y > vr.y1 + 160) continue;
      ctx.strokeStyle = ths.ink;
      if (it.t === 'm') R.drawMountain(ctx, it, ths, k);
      else if (it.t === 'h') R.drawHill(ctx, it, ths, k);
      else if (it.t === 'v') R.drawVolcano(ctx, it, ths, k);
      else if (R.VEG[it.t]) { if (!opts.layers || opts.layers.forests !== false) R.VEG[it.t](ctx, it, thv, k); }
      else R.drawVolcano(ctx, it, ths, k);
    }
    if (th.game) ctx.restore();

    if (R.drawCatastrophes && (!opts.layers || opts.layers.cat !== false)) R.drawCatastrophes(ctx, map, th, k, S);
    if (!opts.layers || opts.layers.ice !== false) R.drawPolarIce(ctx, map, th, k, S);
    if (opts.layers && opts.layers.currents) R.drawCurrents(ctx, map, th, k, S);
    if (opts.layers && opts.layers.tides && R.drawTides) R.drawTides(ctx, map, th, k, S, opts.tideF);
    if (!opts.layers || opts.layers.seas !== false) R.drawSeaNames(ctx, map, th, k, S);
    if (opts.political && opts.layers && opts.layers.routes !== false && opts.political.cities.length) R.drawSeaRoutes(ctx, map, opts.political, th, k, S);

    // государства
    if (opts.political && (opts.political.states.length || opts.political.cities.length)) R.drawPolitical(ctx, map, opts.political, th, k, S, noise);

    // 6. виньетка, рамка, зерно
    if (th.vignette > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      g.addColorStop(0, 'rgba(60,45,30,0)'); g.addColorStop(1, `rgba(60,45,30,${th.vignette})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    if (th.frame) {
      ctx.strokeStyle = th.ink; ctx.lineWidth = 3.2 * k; ctx.strokeRect(16 * k, 16 * k, w - 32 * k, h - 32 * k);
      ctx.lineWidth = 1 * k; ctx.strokeRect(24 * k, 24 * k, w - 48 * k, h - 48 * k);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);            // зерно бумаги не масштабируется вместе с картой
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = getGrain(ctx, th); ctx.fillRect(0, 0, view.w, view.h);
    ctx.globalCompositeOperation = 'source-over';
    return canvas;
  }

  // ---------- карта высот (отладочный вид) ----------
  function renderHeight(map, S) {
    const { W, H } = map, c = makeCanvas(W, H), ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
    const stops = [[0.0, [96, 140, 70]], [0.25, [170, 170, 90]], [0.5, [150, 110, 70]], [0.8, [120, 100, 90]], [1.1, [245, 245, 245]]];
    for (let i = 0; i < W * H; i++) {
      const v = map.h[i]; let col;
      if (v <= 0) { const t = clamp(-v / 1.2, 0, 1); col = [70 - 40 * t, 130 - 70 * t, 190 - 70 * t]; }
      else {
        col = stops[stops.length - 1][1];
        for (let s = 0; s < stops.length - 1; s++) if (v <= stops[s + 1][0]) {
          const t = (v - stops[s][0]) / (stops[s + 1][0] - stops[s][0]);
          col = stops[s][1].map((a, j) => a + (stops[s + 1][1][j] - a) * clamp(t, 0, 1)); break;
        }
      }
      img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const out = makeCanvas(W * S, H * S), octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true; octx.drawImage(c, 0, 0, W * S, H * S);
    return out;
  }

  const R = FM.R = FM.R || {};
  Object.assign(R, { THEMES, PLATE_HUES, BOUNDARY_COLORS, makeCanvas, paperCache, getPaper, grainPattern, getGrain, chaikin, handLoop2, coastLoops, addLoops, rgb, renderMap, renderHeight });
  FM.THEMES = THEMES; FM.getPaper = getPaper; FM.getGrain = getGrain; FM.makeCanvas = makeCanvas;
  FM.renderMap = renderMap; FM.renderHeight = renderHeight;
})(window.FM);
