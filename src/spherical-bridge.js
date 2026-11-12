// Мост «сферический генератор → основной мир» (genVersion 4). Не заменяет v2/v3.
// Террейн (материки, плиты, тектонический рельеф) берётся из SphericalTerrainBase.generate на сетке 720x360 (равнопромежуточная
// развёртка сферы), пересэмплируется на сетку основного мира (полоса широт ±75°, как у климата основного мира), дальше работает
// существующий финализатор основного мира (климат, озёра, реки, биомы, города/дороги/государства, атлас).
// Требует: node scripts/enable-natural-v3.cjs (даёт FM.finishNaturalWorld, FM.naturalWorld.erode), terrain-edit-spherical-base.js.
// Ограничения (честно): число материков задаётся точно (1..7), но острова отдельно не создаются; подводный рельеф — по расстоянию до
// берега и тектонике; водный цикл прототипов (coupled-basin-water) сюда НЕ подключён — реки и озёра считает финализатор основного мира.
(function (FM) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rng = (s, t) => FM.mulberry32(FM.hashString(s + '|sphere-bridge|' + t));
  const noise = (s, t) => FM.makeNoise(rng(s, t));
  const VERSION = 'sphere-bridge-v1';
  const LAT_SPAN = 75;   // как в климате основного мира: |y/H*2-1|*75

  // расстояние (в клетках, фаска 1/√2) до ближайшей клетки mask===1; по x с замыканием на сфере не нужно: используется на плоской сетке
  function chamfer(mask, w, h, wrapX) {
    const N = w * h, d = new Float32Array(N), INF = 1e9, S = Math.SQRT2;
    for (let i = 0; i < N; i++) d[i] = mask[i] ? 0 : INF;
    const at = (x, y) => wrapX ? (x < 0 ? x + w : x >= w ? x - w : x) + y * w : x + y * w;
    for (let pass = 0; pass < (wrapX ? 2 : 1); pass++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let v = d[i];
        if ((wrapX || x > 0)) v = Math.min(v, d[at(x - 1, y)] + 1);
        if (y > 0) { v = Math.min(v, d[at(x, y - 1)] + 1); if (wrapX || x > 0) v = Math.min(v, d[at(x - 1, y - 1)] + S); if (wrapX || x < w - 1) v = Math.min(v, d[at(x + 1, y - 1)] + S); }
        d[i] = v; }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; let v = d[i];
        if ((wrapX || x < w - 1)) v = Math.min(v, d[at(x + 1, y)] + 1);
        if (y < h - 1) { v = Math.min(v, d[at(x, y + 1)] + 1); if (wrapX || x < w - 1) v = Math.min(v, d[at(x + 1, y + 1)] + S); if (wrapX || x > 0) v = Math.min(v, d[at(x - 1, y + 1)] + S); }
        d[i] = v; }
    }
    return d;
  }

  // ориентация сферы: на сфере материк может лежать на полюсе, а на плоской карте полоса ±75° прижмёт его к верхнему/нижнему краю.
  // Выбираем ось (из ~90 кандидатов, тождественная предпочтительна), при которой у полюсов (шире 45° широты) меньше всего суши, и пересэмплируем
  // все поля сферы в повёрнутую систему координат (сохраняя векторы плит). Поворот чистый и детерминированный от сферы.
  function orient(sph) {
    const { w, h } = sph, N = w * h, vx = new Float64Array(N), vy = new Float64Array(N), vz = new Float64Array(N), wg = new Float64Array(N);
    for (let y = 0; y < h; y++) { const lat = Math.PI * (0.5 - (y + 0.5) / h), cl = Math.cos(lat), sl = Math.sin(lat); for (let x = 0; x < w; x++) { const lon = ((x + 0.5) / w - 0.5) * 2 * Math.PI, i = y * w + x; vx[i] = cl * Math.cos(lon); vy[i] = cl * Math.sin(lon); vz[i] = sl; wg[i] = cl; } }
    let tot = 0; for (let i = 0; i < N; i++) if (sph.land[i]) tot += wg[i];
    const S0 = Math.SQRT1_2, cost = (px, py, pz) => { let c = 0; for (let i = 0; i < N; i++) if (sph.land[i]) { const d = Math.abs(vx[i] * px + vy[i] * py + vz[i] * pz); if (d > S0) c += wg[i] * (d - S0) / (1 - S0); } return c / tot; };
    const cand = [[0, 0, 1]], M = 90, ga = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < M; k++) { const z = 1 - (k + 0.5) / M, r = Math.sqrt(1 - z * z); cand.push([r * Math.cos(k * ga), r * Math.sin(k * ga), z]); }
    const c0 = cost(0, 0, 1); let best = cand[0], bc = c0;
    for (let k = 1; k < cand.length; k++) { const c = cost(cand[k][0], cand[k][1], cand[k][2]); if (c < bc - 0.02) { bc = c; best = cand[k]; } }
    const meta = { poleCapLandBefore: c0, poleCapLandAfter: bc, pole: best.slice() };
    if (best === cand[0]) return Object.assign({}, sph, { orientation: Object.assign({ rotated: false }, meta) });
    // R: best -> z (Родрига)
    const px = best[0], py = best[1], pz = best[2];
    let ax = py, ay = -px, az = 0; const an = Math.hypot(ax, ay), ang = Math.acos(clamp(pz, -1, 1)); ax /= an; ay /= an;
    const co = Math.cos(ang), si = Math.sin(ang);
    const rot = (x, y, z) => { const kx = ay * z - az * y, ky = az * x - ax * z, kz = ax * y - ay * x, kd = ax * x + ay * y + az * z; return [x * co + kx * si + ax * kd * (1 - co), y * co + ky * si + ay * kd * (1 - co), z * co + kz * si + az * kd * (1 - co)]; };
    const inv = (x, y, z) => { const kx = ay * z - az * y, ky = az * x - ax * z, kz = ax * y - ay * x, kd = ax * x + ay * y + az * z; return [x * co - kx * si + ax * kd * (1 - co), y * co - ky * si + ay * kd * (1 - co), z * co - kz * si + az * kd * (1 - co)]; };
    const smp = sampler(w, h), tmp = { i: new Int32Array(4), w: new Float64Array(4) }, tec = sph.tectonics;
    const landF = new Float64Array(N), hgt = new Float64Array(N); for (let i = 0; i < N; i++) { landF[i] = sph.land[i] ? 1 : 0; hgt[i] = sph.land[i] ? sph.height[i] : 0; }
    const land = new Uint8Array(N), height = new Float64Array(N), up = new Float64Array(N), rift = new Float64Array(N), shear = new Float64Array(N), pid = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = inv(vx[i], vy[i], vz[i]), u = (Math.atan2(o[1], o[0]) / (2 * Math.PI) + 0.5) * w, v = (0.5 - Math.asin(clamp(o[2], -1, 1)) / Math.PI) * h;
      const wl = smp(landF, u, v, tmp); land[i] = wl >= 0.5 ? 1 : 0;
      let hh = 0, ws = 0, bi = 0, bw = -1; for (let k = 0; k < 4; k++) { if (landF[tmp.i[k]]) { hh += hgt[tmp.i[k]] * tmp.w[k]; ws += tmp.w[k]; } if (tmp.w[k] > bw) { bw = tmp.w[k]; bi = tmp.i[k]; } }
      height[i] = ws > 1e-9 ? hh / ws : 0; pid[i] = tec.plateId[bi];
      up[i] = smp(tec.uplift, u, v, tmp); rift[i] = smp(tec.rift, u, v, tmp); shear[i] = smp(tec.shear, u, v, tmp);
    }
    const plates = tec.plates.map(pl => Object.assign({}, pl, { center: rot(pl.center[0], pl.center[1], pl.center[2]), omega: rot(pl.omega[0], pl.omega[1], pl.omega[2]) }));
    let lc = 0; for (let i = 0; i < N; i++) if (land[i]) lc++;
    return Object.assign({}, sph, { land, height, tectonics: Object.assign({}, tec, { uplift: up, rift: rift, shear, plateId: pid, plates }), orientation: Object.assign({ rotated: true, landCellsAfter: lc }, meta) });
  }

  // знаковая функция берега на сетке сферы: >0 суша, <0 море (в клетках сферы)
  function signedField(sphere) {
    const { w, h, land } = sphere, N = w * h, sea = new Uint8Array(N), lnd = new Uint8Array(N), sd = new Float32Array(N);
    for (let i = 0; i < N; i++) { lnd[i] = land[i] ? 1 : 0; sea[i] = land[i] ? 0 : 1; }
    const dl = chamfer(lnd, w, h, true), ds = chamfer(sea, w, h, true);
    for (let i = 0; i < N; i++) sd[i] = land[i] ? ds[i] - 0.5 : -(dl[i] - 0.5);
    return sd;
  }

  // долгота шва: колонка сферы с наименьшей долей суши (шов основной карты не должен резать материк)
  function seamShiftColumns(sphere) {
    const { w, h, land } = sphere, col = new Float64Array(w);
    for (let y = 0; y < h; y++) { const wgt = Math.cos(Math.PI * (0.5 - (y + 0.5) / h)); for (let x = 0; x < w; x++) if (land[y * w + x]) col[x] += wgt; }
    let best = 0, score = Infinity;
    for (let x = 0; x < w; x++) { let s = 0; for (let k = -6; k <= 6; k++) s += col[(x + k + w) % w] * (1 + Math.abs(k) * 0.02); if (s < score) { score = s; best = x; } }
    return best;   // колонка, которая станет левым краем карты
  }

  // билинейная выборка поля сферы в точке (lon,lat) в градусах-долях: u в клетках по x (с замыканием), v в клетках по y (с зажимом)
  function sampler(w, h) {
    return (f, u, v, out) => {
      const x0 = Math.floor(u - 0.5), y0 = Math.floor(v - 0.5), fx = u - 0.5 - x0, fy = v - 0.5 - y0;
      const xa = ((x0 % w) + w) % w, xb = (xa + 1) % w, ya = clamp(y0, 0, h - 1), yb = clamp(y0 + 1, 0, h - 1);
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      out.i[0] = ya * w + xa; out.i[1] = ya * w + xb; out.i[2] = yb * w + xa; out.i[3] = yb * w + xb;
      out.w[0] = w00; out.w[1] = w10; out.w[2] = w01; out.w[3] = w11;
      let s = 0; for (let k = 0; k < 4; k++) s += f[out.i[k]] * out.w[k]; return s;
    };
  }

  function validate(p) {
    const W = p.W || 1440, H = p.H || 960;
    if (!Number.isInteger(W) || !Number.isInteger(H) || W < 96 || H < 64 || W > 4096 || H > 4096 || W * H > 6000000) throw Error('Unsupported grid');
    const land = p.landRatio == null ? 0.34 : p.landRatio;
    if (!Number.isFinite(land) || land < 0.18 || land > 0.45) throw Error('Land ratio for the spherical model must be 0.18..0.45');
    const K = p.continents == null || p.continents === 0 ? 2 + Math.floor(rng(String(p.seed), 'auto-K')() * 3) : p.continents;
    if (!Number.isInteger(K) || K < 1 || K > 7) throw Error('Continents must be 1..7');
    return { W, H, land, K };
  }

  // чистая часть: сфера → поля основной сетки (без финализатора), для тестов
  function build(params) {
    if (!FM.naturalWorld || !FM.naturalWorld.erode) throw Error('Run node scripts/enable-natural-v3.cjs first');
    if (!root().SphericalTerrainBase) throw Error('terrain-edit-spherical-base.js is not loaded');
    const { W, H, land, K } = validate(params), seed = String(params.seed), N = W * H;
    const sphere = orient(root().SphericalTerrainBase.generate({ seed, w: 720, h: 360, continents: K, landRatio: land }));
    const sw = sphere.w, sh = sphere.h, tec = sphere.tectonics, col0 = seamShiftColumns(sphere), sd = signedField(sphere);
    const smp = sampler(sw, sh), tmp = { i: new Int32Array(4), w: new Float64Array(4) };
    const hs = new Float64Array(N), sdm = new Float32Array(N), up = new Float32Array(N), rift = new Float32Array(N), shr = new Float32Array(N), id = new Uint8Array(N), lndMask = new Uint8Array(N);
    const landF = new Float64Array(sw * sh); for (let i = 0; i < sw * sh; i++) landF[i] = sphere.land[i] ? 1 : 0;
    const hgt = new Float64Array(sw * sh); for (let i = 0; i < sw * sh; i++) hgt[i] = sphere.land[i] ? sphere.height[i] : 0;
    for (let y = 0; y < H; y++) {
      const lat = LAT_SPAN * (1 - 2 * (y + 0.5) / H), v = (0.5 - lat / 180) * sh;
      for (let x = 0; x < W; x++) {
        const i = y * W + x, u = col0 + (x + 0.5) / W * sw;
        sdm[i] = smp(sd, u, v, tmp);
        const wl = smp(landF, u, v, tmp); let hh = 0, ws = 0; for (let k = 0; k < 4; k++) if (landF[tmp.i[k]]) { hh += hgt[tmp.i[k]] * tmp.w[k]; ws += tmp.w[k]; }
        hs[i] = ws > 1e-9 ? hh / ws : 0;
        up[i] = smp(tec.uplift, u, v, tmp); rift[i] = smp(tec.rift, u, v, tmp); shr[i] = smp(tec.shear, u, v, tmp);
        let bi = 0, bw = -1; for (let k = 0; k < 4; k++) if (tmp.w[k] > bw) { bw = tmp.w[k]; bi = tmp.i[k]; } id[i] = tec.plateId[bi];
        lndMask[i] = sdm[i] > 0 && x >= 3 && y >= 3 && x < W - 3 && y < H - 3 ? 1 : 0;   // рамка карты — океан (сток рек, нет резки материка рамкой)
        void wl;
      }
    }
    const sea = new Uint8Array(N); for (let i = 0; i < N; i++) sea[i] = lndMask[i] ? 0 : 1;
    const dSea = chamfer(sea, W, H, false), dLand = chamfer(lndMask, W, H, false);   // dSea: для суши расстояние до моря; dLand: для моря до суши
    const nz = noise(seed, 'detail'), h = new Float32Array(N), crust = new Float32Array(N), old = new Float32Array(N), reg = noise(seed, 'provinces');
    const conv = new Float32Array(N), upMain = new Float32Array(N), riftMain = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, active = clamp(up[i] * 1.8, 0, 1);
      conv[i] = active; upMain[i] = clamp(up[i], 0, 1.5); riftMain[i] = clamp(rift[i], 0, 1.5);
      if (lndMask[i]) {
        const d = (dSea[i] - 0.5) / W, coast = smooth(0, 0.014, d), n = FM.fbm(nz, x / (W * 0.05), y / (W * 0.05), 4), b = FM.fbm(reg, x / (W * 0.24) + 19, y / (W * 0.24) + 7, 3);
        const base = Math.max(hs[i], 0.02);
        h[i] = Math.max(0.0005, coast * (base * (1 + 0.28 * n) + 0.05 * b * Math.min(1, d / 0.05)));
        crust[i] = smooth(-0.035 + active * 0.02, 0.015, d); old[i] = 0.11 * coast * (1 - Math.abs(FM.fbm(reg, x / (W * 0.13) + 51, y / (W * 0.13) + 23, 3)));
      } else {
        const d = -(Math.max(0.5, dLand[i]) - 0.5) / W;
        h[i] = -0.015 - 0.9 * (1 - Math.exp(d / (0.018 + 0.018 * (1 - active)))); crust[i] = smooth(-0.035 + active * 0.02, 0.015, d);
      }
    }
    return { W, H, N, seed, K, land, h, crust, old, id, conv, up: upMain, rift: riftMain, shear: shr, lndMask, sphere, seamColumn: col0 };
  }

  function root() { return typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}); }

  function* stages(params) {
    if (!FM.finishNaturalWorld) throw Error('Run node scripts/enable-natural-v3.cjs first');
    const t0 = performance.now(); yield 'coast';
    const b = build(params), { W, H, N, seed, K, land } = b; yield 'plates';
    const P = 12, tec = b.sphere.tectonics, plates = [];
    for (let k = 0; k < P; k++) {   // центры плит сферы → координаты основной карты (для политики/подписей; вне полосы широт — на край)
      const c = tec.plates[k].center, lon = Math.atan2(c[1], c[0]), lat = Math.asin(clamp(c[2], -1, 1)) * 180 / Math.PI, sx = ((lon / (2 * Math.PI) + 0.5) * b.sphere.w - b.seamColumn + b.sphere.w) % b.sphere.w / b.sphere.w * W;
      const east = [-Math.sin(lon), Math.cos(lon), 0], om = tec.plates[k].omega, vel = [om[1] * c[2] - om[2] * c[1], om[2] * c[0] - om[0] * c[2], om[0] * c[1] - om[1] * c[0]];
      const y = clamp((1 - lat / LAT_SPAN) / 2 * H, 0, H - 1), x = clamp(sx, 0, W - 1), i = Math.round(y) * W + Math.round(x);
      plates.push({ x, y, weight: 1, type: b.lndMask[i] ? 'continental' : 'oceanic', vx: vel[0] * east[0] + vel[1] * east[1], vy: -vel[2] });
    }
    const edge = new Uint8Array(N), other = new Uint8Array(N), btype = new Uint8Array(N), mfld = { rift: new Float32Array(N), pass: new Float32Array(N), conv: new Float32Array(N), shear: new Float32Array(N) }, id = b.id;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = id[i]; let o = -1;
      if (x + 1 < W && id[i + 1] !== a) o = id[i + 1]; else if (x && id[i - 1] !== a) o = id[i - 1]; else if (y + 1 < H && id[i + W] !== a) o = id[i + W]; else if (y && id[i - W] !== a) o = id[i - W];
      if (o >= 0) { edge[i] = 1; other[i] = plates[o].type === 'continental' ? 1 : 0; }
      mfld.conv[i] = b.up[i]; mfld.rift[i] = b.rift[i]; mfld.pass[i] = b.rift[i]; mfld.shear[i] = Math.abs(b.shear[i]);
      btype[i] = o < 0 && b.up[i] < 0.05 && b.rift[i] < 0.05 ? 0 : b.up[i] > b.rift[i] && b.up[i] > 0.05 ? 1 : b.rift[i] > 0.05 ? 2 : 3;
    }
    yield 'height'; const h = b.h; FM.naturalWorld.erode(h, W, H, params.erosionIterations == null ? 2 : params.erosionIterations); yield 'rivers';
    const volcanoes = [], cand = []; for (let i = 0; i < N; i++) if (h[i] > 0.1 && b.up[i] > 0.35) cand.push(i);
    cand.sort((p, q) => b.up[q] - b.up[p] || p - q);
    const want = params.volcanoes == null ? 3 : params.volcanoes;
    for (const i of cand) { if (volcanoes.length >= want) break; const x = i % W, y = (i / W) | 0; if (volcanoes.every(v => Math.hypot(v.x - x, v.y - y) > W * 0.09)) volcanoes.push({ x, y, size: 1, active: true, kind: 'arc' }); }
    yield 'inlets';
    const S = { W, H, N, seed, genVersion: 3, params: Object.assign({}, params, { genVersion: 4 }), crust: b.crust, mfld, plates, id, bd: { conv: mfld.conv, shear: mfld.shear, edge, other, btype }, seaLevel: 0, young: { up: b.up, rift: b.rift }, old: b.old, volcanoes, islandGroups: [], noiseB: noise(seed, 'climate'), noiseC: noise(seed, 'routing'), lakePot: new Float32Array(N).fill(0.3), cat: null, inl: { events: [], mask: null }, t0, checkMasses: () => { }, landRatio: land, epochs: 0, h };
    let landCells = 0; for (let i = 0; i < N; i++) if (h[i] > 0) landCells++;
    S.postHook = map => { map.natural = { version: 1, bridge: VERSION, requestedContinents: K, measuredLandBeforeHydrology: landCells / N, sphere: { orientation: b.sphere.orientation, generator: b.sphere.metadata.generator, attempt: b.sphere.metadata.attempt, components: b.sphere.metadata.components, seamColumn: b.seamColumn, grid: '720x360', latitudeBand: LAT_SPAN } }; map.params.genVersion = 4; };
    return yield* FM.finishNaturalWorld(S);
  }

  FM.sphericalBridge = { VERSION, stages, build, validate, chamfer };
})(window.FM);
