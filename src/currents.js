// Океанские течения: векторное поле (пассаты, западные ветры, огибание берегов → круговороты) и линии тока для рисования.
// Тёплые течения идут к полюсу (и в тропиках), холодные — к экватору. Считается лениво и кэшируется в map._flow.
(function (FM) {
  const { mulberry32, hashString, clamp, smooth } = FM;

  // Функция тока ψ = S(широта)·B(расстояние до берега): ψ = 0 на суше, поэтому линии тока огибают берега сами.
  // S: субтропические круговороты (по часовой стрелке на севере, против — на юге), субполярные — в обратную сторону.
  // Это даёт пассатные течения на запад, дрейф западных ветров на восток, тёплые западные пограничные течения (Гольфстрим) и холодные восточные (Калифорнийское).
  function fieldV1(map) {
    const { W, H, h, dist } = map, N = W * H, sc = W / 480, psi = new Float32Array(N), ux = new Float32Array(N), uy = new Float32Array(N);
    const Lg = 15 * sc;
    for (let y = 0; y < H; y++) {
      const lat = (1 - 2 * (y + 0.5) / H) * 75, a = Math.abs(lat), sg = lat >= 0 ? 1 : -1;
      const S = sg * (Math.exp(-(((a - 29) / 11) ** 2)) - 0.75 * Math.exp(-(((a - 58) / 9) ** 2)) + 0.25 * Math.exp(-(((a - 8) / 5) ** 2)) * 0);
      for (let x = 0; x < W; x++) { const i = y * W + x; psi[i] = h[i] > 0 ? 0 : 38 * sc * S * (1 - Math.exp(-dist[i] / Lg)); }
    }
    FM.blur(psi, W, H, 1);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (h[i] > 0) continue;
      ux[i] = (psi[i + W] - psi[i - W]) * 0.5; uy[i] = -(psi[i + 1] - psi[i - 1]) * 0.5;
    }
    return { ux, uy };
  }

  // Новое поле: модель Стоммела (currents_solver.js). Решается на сетке не крупнее 480 по ширине (для worldScale>1 маска уменьшается, скорости растягиваются).
  // Скорость сжимается корнем от p99 — чтобы и интенсивные пограничные течения, и слабые внутренние линии попадали в диапазон отрисовки.
  function field(map) {
    const S = FM.currentSolver; if (!S) return fieldV1(map);
    const { W, H, h } = map, f = Math.max(1, Math.round(W / 480)), Ws = Math.round(W / f), Hs = Math.round(H / f), land = new Uint8Array(Ws * Hs);
    for (let y = 0; y < Hs; y++) for (let x = 0; x < Ws; x++) { let c = 0; for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) if (h[(y * f + b) * W + x * f + a] > 0) c++; land[y * Ws + x] = c * 2 >= f * f ? 1 : 0; }
    const res = S.solve(Object.assign({ W: Ws, H: Hs, land, meander: true, seed: hashString(map.seed + '|meander') & 0x7fffffff }, FM.currentParams || {}));
    if (!res.diag.ok) { console.warn('[течения] решатель не сошёлся, запасное поле:', res.diag.notes); return fieldV1(map); }
    const sps = []; for (let i = 0; i < res.sp.length; i++) if (res.sp[i] > 0) sps.push(res.sp[i]);
    sps.sort((a, b) => a - b); const p99 = sps[Math.floor(sps.length * 0.99)] || 1, ux = new Float32Array(W * H), uy = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xs = Math.min(Ws - 1, (x / f) | 0), ys = Math.min(Hs - 1, (y / f) | 0), j = ys * Ws + xs; if (!res.sp[j]) continue;
      const d = S.pixelDir(res, xs, ys), m = Math.min(1.5, Math.sqrt(res.sp[j] / p99)); ux[y * W + x] = d[0] * m; uy[y * W + x] = d[1] * m;
    }
    const tm = S.temperature(res), an = new Float32Array(W * H), sst = new Float32Array(W * H);      // температура воды и нормированная аномалия — на сетке карты
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = Math.min(Hs - 1, (y / f) | 0) * Ws + Math.min(Ws - 1, (x / f) | 0); an[y * W + x] = tm.anN[j]; sst[y * W + x] = tm.T[j]; }
    res.diag.temp = tm.diag;
    return { ux, uy, an, sst, diag: res.diag, res };
  }

  FM.oceanFlow = function (map) {
    if (map._flow) return map._flow;
    const { W, H, h, dist } = map, sc = W / 480, ice = FM.polarIce ? FM.polarIce(map) : null, f = field(map), rand = mulberry32(hashString(map.seed + '|flow'));
    const free = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 2 || yi < 2 || xi >= W - 2 || yi >= H - 2) return false; const i = yi * W + xi; return h[i] <= 0 && map.ocean[i] && !(ice && ice[i]) && dist[i] > 1.6; };
    const streams = [];
    for (const ln of FM.currentLines.lines({ W, H, ux: f.ux, uy: f.uy, free, rand, sc })) {
      const pts = ln.pts;
      // цвет — по температурной аномалии воды (отдельное поле, f.an) относительно вод той же широты: 1 тёплое, 0 холодное, 2 нейтральное.
      // Запасное поле v1 (без температуры): по направлению — к полюсу/в тропиках тёплое, к экватору холодное.
      const warm = pts.map((p, i) => {
        if (f.an) { const xi = clamp(Math.round(p[0]), 0, W - 1), yi = clamp(Math.round(p[1]), 0, H - 1); return FM.currentSolver.classify(f.an[yi * W + xi]); }
        const q = pts[Math.min(pts.length - 1, i + 3)], r = pts[Math.max(0, i - 3)], dy = q[1] - r[1], phi = Math.abs((p[1] + 0.5) / H * 2 - 1) * 75, pole = p[1] < H / 2 ? -1 : 1; return phi < 20 || dy * pole > 0.6 ? 1 : dy * pole < -0.6 ? 0 : (phi < 33 ? 1 : 0); });
      streams.push({ pts: pts.map(p => [p[0], p[1]]), warm, w: Math.min(1, 0.25 + 0.75 * ln.spd / 1.0), len: pts.length });   // ширина — по скорости (отдельно от цвета)
    }
    return (map._flow = { streams, diag: f.diag });
  };
})(window.FM);
