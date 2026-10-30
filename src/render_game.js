// «Цветной» стиль: гипсометрическая раскраска с рельефной подсветкой, реки и дороги в этом стиле.
(function (FM) {
  'use strict';
  const R = FM.R;
  const { mulberry32, hashString, makeNoise, fbm, smooth, clamp } = FM;
  const { THEMES, PLATE_HUES, BOUNDARY_COLORS, makeCanvas, paperCache, getPaper, grainPattern, getGrain, chaikin, addLoops, rgb, renderMap, renderHeight } = R;

  // ---------- игровой стиль: раскрашенная местность с объёмной отмывкой, синие реки и озёра, грунтовые дороги ----------
  // гипсометрическая шкала: низины зелёные, средние высоты жёлто-охристые, горы коричневые, высочайшие — серо-белые
  const HYPS = [[0, [126, 162, 104]], [0.12, [146, 178, 112]], [0.35, [182, 194, 128]], [0.6, [206, 192, 128]], [0.85, [186, 158, 110]], [1.1, [152, 124, 92]], [1.4, [178, 168, 158]], [1.75, [228, 228, 224]]];
  const hyps = (hv) => {
    if (hv <= HYPS[0][0]) return HYPS[0][1];
    for (let i = 1; i < HYPS.length; i++) if (hv <= HYPS[i][0]) { const a = HYPS[i - 1], b = HYPS[i], t = (hv - a[0]) / (b[0] - a[0]); return [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t]; }
    return HYPS[HYPS.length - 1][1];
  };
  const BIOME_TINT = { 1: [[238, 242, 246], 0.88], 2: [[190, 196, 178], 0.35], 6: [[218, 200, 150], 0.45], 9: [[124, 150, 116], 0.35], 8: [[98, 146, 94], 0.28], 3: [[122, 158, 116], 0.2] };
  function gameTerrain(map, noise) {
    if (map._game) return map._game;
    const { W, H } = map, R = 2, cw = W * R, ch = H * R, N = W * H;
    const hb = Float32Array.from(map.h); FM.blur(hb, W, H, 1);
    const hd = Float32Array.from(map.wd || map.dist); FM.blur(hd, W, H, 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const hv = map.h[i], x = i % W, y = (i / W) | 0;
      const c = hyps(Math.max(0, hv)), tone = 1 + 0.03 * fbm(noise, x * 0.09 + 40, y * 0.09, 3), bt = BIOME_TINT[map.biome[i]];
      let r0 = c[0], g0 = c[1], b0 = c[2];
      if (bt && hv < 1.1) { r0 += (bt[0][0] - r0) * bt[1]; g0 += (bt[0][1] - g0) * bt[1]; b0 += (bt[0][2] - b0) * bt[1]; }
      const lum = 0.3 * r0 + 0.59 * g0 + 0.11 * b0, dsat = 0.2;       // слегка приглушаем насыщенность: заливка не спорит с рельефом и значками
      r0 += (lum - r0) * dsat; g0 += (lum - g0) * dsat; b0 += (lum - b0) * dsat;
      col[i * 3] = r0 * tone; col[i * 3 + 1] = g0 * tone; col[i * 3 + 2] = b0 * tone;
    }
    const cv = makeCanvas(cw, ch), cx = cv.getContext('2d'), img = cx.createImageData(cw, ch), d = img.data;
    const bil = (a, fx, fy, st) => {
      const x0 = clamp(Math.floor(fx), 0, W - 2), y0 = clamp(Math.floor(fy), 0, H - 2), u = clamp(fx - x0, 0, 1), v = clamp(fy - y0, 0, 1), i = y0 * W + x0;
      if (st === 1) return a[i] * (1 - u) * (1 - v) + a[i + 1] * u * (1 - v) + a[i + W] * (1 - u) * v + a[i + W + 1] * u * v;
      const o = [0, 0, 0];
      for (let c = 0; c < 3; c++) o[c] = a[i * 3 + c] * (1 - u) * (1 - v) + a[(i + 1) * 3 + c] * u * (1 - v) + a[(i + W) * 3 + c] * (1 - u) * v + a[(i + W + 1) * 3 + c] * u * v;
      return o;
    };
    for (let py = 0; py < ch; py++) for (let px = 0; px < cw; px++) {
      const fx = (px + 0.5) / R - 0.5, fy = (py + 0.5) / R - 0.5, o = (py * cw + px) * 4;
      const hv = bil(hb, fx, fy, 1);
      const land = clamp(hv / 0.03 + 0.5, 0, 1);
      const nz = 1 + 0.012 * noise(px * 0.35, py * 0.35);
      let rr, gg, bb;
      if (land > 0) {
        const c = bil(col, fx, fy, 3);
        const dx = bil(hb, fx + 0.6, fy, 1) - bil(hb, fx - 0.6, fy, 1), dy = bil(hb, fx, fy + 0.6, 1) - bil(hb, fx, fy - 0.6, 1);
        const sh = clamp(-(dx * 0.75 + dy * 0.75) * 4.4, -1, 1);          // свет с северо-запада
        const m = 1 + (sh > 0 ? sh * 0.2 : sh * 0.5), cool = sh < 0 ? 1 - sh * 0.07 : 1;   // тени чуть холоднее
        rr = c[0] * m * nz / cool; gg = c[1] * m * nz; bb = c[2] * m * nz * cool;
      }
      let wr = 0, wg = 0, wb = 0;
      if (land < 1) {
        const dd = bil(hd, fx, fy, 1), t = smooth(0, 34, dd), s2 = 1 - smooth(0, 3.2, dd);
        wr = 182 + (112 - 182) * t + s2 * 24; wg = 210 + (150 - 210) * t + s2 * 12; wb = 220 + (178 - 220) * t + s2 * 6;
        const wn = 1 + 0.01 * noise(px * 0.12 + 99, py * 0.12);
        wr *= wn; wg *= wn; wb *= wn;
      }
      if (land >= 1) { d[o] = rr; d[o + 1] = gg; d[o + 2] = bb; }
      else if (land <= 0) { d[o] = wr; d[o + 1] = wg; d[o + 2] = wb; }
      else { d[o] = rr * land + wr * (1 - land); d[o + 1] = gg * land + wg * (1 - land); d[o + 2] = bb * land + wb * (1 - land); }
      d[o + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    map._game = cv;
    return cv;
  }

  function gameRivers(ctx, geo, k) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgb(66,114,156)';
    for (const rv of geo.rivers) for (let i = 0; i < rv.length - 1; i++) {
      const a = rv[i], b = rv[i + 1];
      ctx.lineWidth = (0.9 + 2.4 * (a[2] + b[2]) / 2) * k; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }

  function gameRoads(ctx, map, pol, k, S, noise) {
    R.drawRoads(ctx, map, pol, { ink: '#000', paper: [0, 0, 0], game: true }, k, S, noise);
  }

  Object.assign(R, { HYPS, hyps, BIOME_TINT, gameTerrain, gameRivers, gameRoads });
})(window.FM);
