(function (root) {
'use strict';
// Тектоническая история мира на сфере (прототип, уровень A плана docs/TECTONIC_HISTORY_PLAN.md).
//
// Модель: континентальная кора = облако точек на сфере (решётка Фибоначчи, равная площадь), у каждой точки мощность коры (км).
// Старт — один суперматерик заданной площади. История — эпохи: в начале эпохи материк режется трещинами на плиты, у каждой плиты своя
// ось и угловая скорость (твёрдое вращение по сфере); при столкновении (две плиты накрыли друг друга) плиты свариваются и дальше
// движутся как одно тело; в конце эпохи плиты распускаются и следующая эпоха режет заново. Кора при столкновении не теряется:
// перекрытие даёт сумму мощностей (горы), щель между плитами остаётся океаном.
// Итог: мощность коры на сетке (равнопромежуточная развёртка, долгота периодична) → изостазия (высота) → эрозия со сносом в шельф →
// уровень моря из ОБЪЁМА ВОДЫ (гипсометрия): доля суши — результат, а не входной параметр.
//
// Что в прототипе НЕТ (честно): срединно-океанические хребты и возраст океанического дна, субдукция и дуги, ледниковые периоды,
// плюмы, климат-эрозия связь, ископаемые; эрозия — один проход после всей истории, а не по эпохам; шкала времени огрубляется
// эпохами (по умолчанию 150 млн лет). Ползунок времени: сейчас через stopAtMyr/snapshots, мгновенной промотки ещё нет.
const DEG = Math.PI / 180, TAU = Math.PI * 2;
const VERSION = 'sphere-tectonic-history-v1';
const KEYS = ['seed', 'w', 'radiusKm', 'activity', 'ageMyr', 'epochMyr', 'waterDepthKm', 'continentalFraction', 'stopAtMyr', 'snapshotEveryMyr'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function rng(seed) {
  let s = 2166136261;
  for (let i = 0; i < seed.length; i++) { s ^= seed.charCodeAt(i); s = Math.imul(s, 16777619); }
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// гладкий шум на R^3 (значения в узлах решётки, сглаженная интерполяция), диапазон ≈ [-1, 1]
function makeNoise(r) {
  const perm = new Uint8Array(512), val = new Float64Array(256), idx = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = idx[i & 255];
  for (let i = 0; i < 256; i++) val[i] = r() * 2 - 1;
  const f = t => t * t * (3 - 2 * t), L = (a, b, t) => a + (b - a) * t;
  const at = (x, y, z) => val[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  return (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), u = f(x - X), v = f(y - Y), w = f(z - Z);
    return L(L(L(at(X, Y, Z), at(X + 1, Y, Z), u), L(at(X, Y + 1, Z), at(X + 1, Y + 1, Z), u), v),
             L(L(at(X, Y, Z + 1), at(X + 1, Y, Z + 1), u), L(at(X, Y + 1, Z + 1), at(X + 1, Y + 1, Z + 1), u), v), w);
  };
}
function options(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !KEYS.includes(k))) throw Error('Invalid generation options');
  const p = {
    seed: input.seed, w: input.w === undefined ? 360 : input.w, radiusKm: input.radiusKm === undefined ? 6371 : input.radiusKm,
    activity: input.activity === undefined ? 1 : input.activity, ageMyr: input.ageMyr === undefined ? 4500 : input.ageMyr,
    epochMyr: input.epochMyr === undefined ? 150 : input.epochMyr, waterDepthKm: input.waterDepthKm === undefined ? 2.62 : input.waterDepthKm,
    continentalFraction: input.continentalFraction === undefined ? .4 : input.continentalFraction,
    stopAtMyr: input.stopAtMyr, snapshotEveryMyr: input.snapshotEveryMyr === undefined ? 0 : input.snapshotEveryMyr
  };
  if (typeof p.seed !== 'string' || !p.seed.trim() || p.seed.length > 128) throw Error('Seed must be a nonempty string, at most 128 code units');
  if (!Number.isInteger(p.w) || p.w % 2 || p.w < 90 || p.w > 720) throw Error('Width must be an even integer 90..720');
  if (!(p.radiusKm >= 3000 && p.radiusKm <= 6500)) throw Error('Radius must be 3000..6500 km');
  if (!(p.activity >= .5 && p.activity <= 1.5)) throw Error('Activity must be 0.5..1.5');
  if (!(p.ageMyr >= 300 && p.ageMyr <= 4600)) throw Error('Age must be 300..4600 Myr');
  if (!(p.epochMyr >= 50 && p.epochMyr <= 450)) throw Error('Epoch must be 50..450 Myr');
  if (!(p.waterDepthKm >= .3 && p.waterDepthKm <= 6)) throw Error('Water depth must be 0.3..6 km');
  if (!(p.continentalFraction >= .2 && p.continentalFraction <= .5)) throw Error('Continental fraction must be 0.2..0.5');
  if (p.stopAtMyr === undefined) p.stopAtMyr = p.ageMyr;
  if (!(p.stopAtMyr >= 0 && p.stopAtMyr <= p.ageMyr)) throw Error('stopAtMyr must be within 0..ageMyr');
  if (!(p.snapshotEveryMyr === 0 || (p.snapshotEveryMyr >= 25 && p.snapshotEveryMyr <= p.ageMyr))) throw Error('snapshotEveryMyr must be 0 or 25..ageMyr');
  return p;
}

const TREF = 35, E_SLOPE = .15, E_FLOOR = -4.85, TAU_EROSION = 120, T_SHELF = 22, PTS_PER_BIN = 4, SUB = 16, WELD_FRAC = .04, T_CAP = 60, ARC_RATE = .12, T_ARC_MAX = 52, AGE_MAX = 180, AGE_REF = 65, SUBSIDE = .26, SED_RATE = .03, T_CONT = 12, HOT_N = 8, HOT_RATE = .25, HOT_RAD = .11, T_HOT_MAX = 48, OCE_W = 4, OCE_CAP = 1.3, T_ARC_OCE = 30, T_HOT_OCE = 34, KEEL = 3, G_FORCE = 1.6, TAU_V = 25, F_RIDGE = .25, SPEED_MAX = 12;   // силы: KEEL — во сколько раз континент сильнее тормозится мантией; G_FORCE — переход от момента сил к угловой скорости; TAU_V — время подстройки скорости, млн лет; SPEED_MAX — предел скорости плиты, см/год   // OCE_W: океаническая точка представляет 4 континентальных по площади; OCE_CAP: запас пула; T_*_OCE: предел «избытка» мощности океанической коры (острова)   // горячие точки в мантийной системе (неподвижны): прирост коры под континентом, км/млн лет в центре, радиус в рад   // SED_RATE: морские осадки на мелководье, км/млн лет; T_CONT: мощность, с которой кора считается континентальной   // ARC_RATE: наращивание коры над зоной субдукции, км/млн лет при 5 см/год   // T_CAP: предельная мощность коры в горах (км); избыток растекается в стороны
// изостазия (Эйри): высота над общей отметкой, км; T = 0 даёт дно океана ≈ -4,85 км, T = 35 даёт ≈ +0,4 км
const isostasy = T => E_SLOPE * T + E_FLOOR;

function generate(input) {
  const p = options(input), W = p.w, H = W / 2, R = rng(p.seed + '|tectonics'), noise = makeNoise(rng(p.seed + '|noise'));
  // редуцированная сетка (число долготных ячеек в строке ~ cos широты): ячейки почти равной площади, счёт точек не зависит от широты
  const nlon = new Int32Array(H), off = new Int32Array(H + 1), binArea = [], rowTop = new Float64Array(H);
  for (let r = 0; r < H; r++) {
    const lat0 = (90 - r / H * 180) * DEG, lat1 = (90 - (r + 1) / H * 180) * DEG, mid = (lat0 + lat1) / 2;
    nlon[r] = Math.max(1, Math.round(W * Math.cos(mid))); off[r + 1] = off[r] + nlon[r]; rowTop[r] = lat0;
    const a = TAU / nlon[r] * (Math.sin(lat0) - Math.sin(lat1)); for (let k = 0; k < nlon[r]; k++) binArea.push(a);
  }
  const NB = off[H], ZT = 8192, rowLut = new Int32Array(ZT + 1);
  for (let i = 0; i <= ZT; i++) { const lat = Math.asin(i / ZT * 2 - 1); rowLut[i] = Math.min(H - 1, Math.max(0, Math.floor((90 - lat / DEG) / 180 * H))); }
  const binOf = (x, y, z) => {
    const r = rowLut[Math.round((z + 1) / 2 * ZT)];
    return off[r] + Math.min(nlon[r] - 1, Math.floor((Math.atan2(y, x) + Math.PI) / TAU * nlon[r]));
  };
  // центры ячеек и четыре соседа (В, З, С, Ю) — для растекания коры
  const bc = new Float64Array(3 * NB), nbr = new Int32Array(4 * NB);
  for (let r = 0; r < H; r++) { const lat = rowTop[r] - Math.PI / H / 1 * .5; for (let k = 0; k < nlon[r]; k++) { const lon = (k + .5) / nlon[r] * TAU - Math.PI, b = off[r] + k; bc[3 * b] = Math.cos(lat) * Math.cos(lon); bc[3 * b + 1] = Math.cos(lat) * Math.sin(lon); bc[3 * b + 2] = Math.sin(lat); } }
  for (let b = 0; b < NB; b++) {
    const x = bc[3 * b], y = bc[3 * b + 1], z = bc[3 * b + 2], el = Math.hypot(x, y) || 1, d = TAU / W * 1.05, ex = -y / el, ey = x / el, nx = -z * x / el, ny = -z * y / el, nz = el;
    const at = (sx, sy, sz) => { const l = Math.sqrt(sx * sx + sy * sy + sz * sz); return binOf(sx / l, sy / l, sz / l); };
    nbr[4 * b] = at(x + d * ex, y + d * ey, z); nbr[4 * b + 1] = at(x - d * ex, y - d * ey, z); nbr[4 * b + 2] = at(x + d * nx, y + d * ny, z + d * nz); nbr[4 * b + 3] = at(x - d * nx, y - d * ny, z - d * nz);
  }
  // решётка Фибоначчи; континентальные точки — по рангу очка «расстояние до центра + шум»
  const NP = Math.round(PTS_PER_BIN * NB), PA = 4 * Math.PI / NP, golden = Math.PI * (3 - Math.sqrt(5));
  const cx = R() * 2 - 1, cy = R() * 2 - 1, cz = R() * 2 - 1, cl = Math.hypot(cx, cy, cz) || 1, C0 = [cx / cl, cy / cl, cz / cl];
  // стартовый суперконтинент — коллаж кратонов: угловатые осколки (суперэллипс с вытянутостью и поворотом), сгруппированные вокруг центра; шум — только мелкий
  const crat = [], NCR = 5 + Math.floor(R() * 5), bx = Math.abs(C0[2]) > .9 ? [1, 0, 0] : [0, 0, 1];
  for (let c = 0; c < NCR; c++) {
    let dx = R() * 2 - 1, dy = R() * 2 - 1, dz = R() * 2 - 1; const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const dd = dx * C0[0] + dy * C0[1] + dz * C0[2]; dx -= dd * C0[0]; dy -= dd * C0[1]; dz -= dd * C0[2]; const dm = Math.hypot(dx, dy, dz) || 1, off0 = c === 0 ? 0 : .3 + .5 * R(), a = off0;
    const px = C0[0] * Math.cos(a) + dx / dm * Math.sin(a), py = C0[1] * Math.cos(a) + dy / dm * Math.sin(a), pz = C0[2] * Math.cos(a) + dz / dm * Math.sin(a);
    // локальный базис в точке (px,py,pz)
    let t1x = py * bx[2] - pz * bx[1], t1y = pz * bx[0] - px * bx[2], t1z = px * bx[1] - py * bx[0]; const t1l = Math.hypot(t1x, t1y, t1z) || 1; t1x /= t1l; t1y /= t1l; t1z /= t1l;
    const t2x = py * t1z - pz * t1y, t2y = pz * t1x - px * t1z, t2z = px * t1y - py * t1x, th = R() * Math.PI, e = 1 + 1.2 * R();
    crat.push({ px, py, pz, t1x, t1y, t1z, t2x, t2y, t2z, co: Math.cos(th), si: Math.sin(th), e, rho: .4 + .3 * R(), p: 1.1 + 1.6 * R() });
  }
  const dcr = (c, x, y, z) => {
    if (x * c.px + y * c.py + z * c.pz < 0) return 9;
    const u0 = x * c.t1x + y * c.t1y + z * c.t1z, v0 = x * c.t2x + y * c.t2y + z * c.t2z, u = (u0 * c.co + v0 * c.si) / c.e, v = -u0 * c.si + v0 * c.co;
    return Math.pow(Math.pow(Math.abs(u), c.p) + Math.pow(Math.abs(v), c.p), 1 / c.p) / c.rho;
  };
  const score = new Float32Array(NP), suture = new Uint8Array(NP), sx = new Float64Array(NP), sy = new Float64Array(NP), sz = new Float64Array(NP);
  for (let i = 0; i < NP; i++) {
    const z = 1 - (2 * i + 1) / NP, rr = Math.sqrt(1 - z * z), a = i * golden;
    sx[i] = rr * Math.cos(a); sy[i] = rr * Math.sin(a); sz[i] = z;
    let d1 = 9, d2 = 9; for (const c of crat) { const d = dcr(c, sx[i], sy[i], sz[i]); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
    score[i] = d1 + .05 * noise(sx[i] * 5.3 + 3, sy[i] * 5.3 + 9, sz[i] * 5.3 + 1); suture[i] = d2 < 1.25 && d1 < 1.25 ? 1 : 0;   // шов: рядом два кратона (коллизионный пояс)
  }
  const order = Array.from({ length: NP }, (_, i) => i).sort((a, b) => score[a] - score[b]), n = Math.round(p.continentalFraction * NP);
  const NO = Math.ceil(OCE_CAP * NB), N = n + NO, X = new Float64Array(3 * N), thick = new Float32Array(N), alive = new Uint8Array(N), oAge = new Float32Array(N);
  for (let k = 0; k < n; k++) {
    const i = order[k]; X[3 * k] = sx[i]; X[3 * k + 1] = sy[i]; X[3 * k + 2] = sz[i];
    thick[k] = TREF - 15 * smooth(.7, 1, k / n) + (suture[i] ? 8 : 0);   // ядро 35 км, к краю тоньше (шельф); швы между кратонами — древний коллизионный пояс, толще
  }
  // океаническая кора: по одной точке на ячейку там, где нет континента; хранит возраст (млн лет) и избыток мощности (острова, дуги)
  for (let k = 0; k < n; k++) alive[k] = 1;
  const free = []; { const has = new Uint8Array(NB); for (let k = 0; k < n; k++) has[binOf(X[3 * k], X[3 * k + 1], X[3 * k + 2])]++;
    let q = n; for (let b = 0; b < NB; b++) if (has[b] < 2 && q < N) { const k = q++; X[3 * k] = bc[3 * b]; X[3 * k + 1] = bc[3 * b + 1]; X[3 * k + 2] = bc[3 * b + 2]; alive[k] = 1; oAge[k] = R() * AGE_MAX; }
    for (let k = N - 1; k >= q; k--) free.push(k); }
  const volume0 = (() => { let s = 0; for (let k = 0; k < n; k++) s += thick[k] * PA; return s; })();

  // горячие точки: положения и время жизни заданы заранее (мантия неподвижна, плиты ползут над ней — получаются цепочки гор/вулканов вдоль следа)
  const HR = rng(p.seed + '|hotspots'), hots = [];
  for (let h = 0; h < HOT_N; h++) { const z = HR() * 2 - 1, a = HR() * TAU, rr = Math.sqrt(1 - z * z), t0 = HR() * p.ageMyr; hots.push({ x: rr * Math.cos(a), y: rr * Math.sin(a), z, t0, t1: t0 + 150 + 350 * HR(), s: .5 + HR() }); }
  const HCOS = Math.cos(2.2 * HOT_RAD);
  // ---- история ----
  const tOro = new Float32Array(NB).fill(-1), lastCont = new Float32Array(NB).fill(-1), subMyr = new Float32Array(NB), seaSed = new Float32Array(NB), lastSub = new Float32Array(NB).fill(-1), seaHist = [], nEpochs = Math.ceil(p.stopAtMyr / p.epochMyr), epochs = [], snapshots = [];
  const grp = new Int16Array(N), binIdx = new Int32Array(N), oceBin = new Int32Array(NB).fill(-1), contCnt = new Uint8Array(NB), contGrp = new Int16Array(NB), toArc = new Uint8Array(NB);
  let nextSnap = p.snapshotEveryMyr, time = 0, arcAdded = 0, hotAdded = 0;
  const rasterBins = () => { const T = new Float32Array(NB); for (let k = 0; k < n; k++) T[binIdx[k]] += thick[k] * PA; for (let b = 0; b < NB; b++) T[b] /= binArea[b]; return T; };
  for (let k = 0; k < N; k++) if (alive[k]) binIdx[k] = binOf(X[3 * k], X[3 * k + 1], X[3 * k + 2]);
  for (let k = n; k < N; k++) if (alive[k]) oceBin[binIdx[k]] = k;
  for (let e = 0; e < nEpochs; e++) {
    const dtEpoch = Math.min(p.epochMyr, p.stopAtMyr - e * p.epochMyr), dt = dtEpoch / SUB;
    // (а) трещины: k плит; зёрна по принципу наибольшей удалённости, границы искривлены шумом
    const K = 4 + Math.floor(R() * 5), pick = () => { let c; do c = Math.floor(R() * N); while (!alive[c]); return c; }, seeds = [pick()];
    while (seeds.length < K) { let bi = -1, bd = -1; for (let t = 0; t < 300; t++) { const c = pick(); let md = 9; for (const s of seeds) md = Math.min(md, 1 - (X[3 * c] * X[3 * s] + X[3 * c + 1] * X[3 * s + 1] + X[3 * c + 2] * X[3 * s + 2])); if (md > bd) { bd = md; bi = c; } } seeds.push(bi); }
    const wob = .1 + .12 * R(), nsx = R() * 50, size = new Float64Array(K);
    const csz = new Float64Array(K);
    for (let k = 0; k < N; k++) {
      if (!alive[k]) continue; const x = X[3 * k], y = X[3 * k + 1], z = X[3 * k + 2]; let bg = 0, bs = 1e9;
      for (let s = 0; s < K; s++) { const q = seeds[s], d = 1 - (x * X[3 * q] + y * X[3 * q + 1] + z * X[3 * q + 2]) + wob * noise(x * 3 + nsx + s * 7.1, y * 3 + s * 3.3, z * 3 - nsx); if (d < bs) { bs = d; bg = s; } }
      grp[k] = bg; size[bg] += k < n ? 1 : OCE_W; if (k < n) csz[bg]++;
    }
    // (б) у каждой плиты ось и угловая скорость; мелкие плиты быстрее; v в см/год → км/млн лет ×10
    let nOce = 0; for (let k = n; k < N; k++) if (alive[k]) nOce++; const omega = [], meanSize = (n + OCE_W * nOce) / K;
    for (let s = 0; s < K; s++) {
      let ax = R() * 2 - 1, ay = R() * 2 - 1, az = R() * 2 - 1; const al = Math.hypot(ax, ay, az) || 1;
      const v = p.activity * (1.5 + 3.5 * R()) * clamp(Math.pow(meanSize / Math.max(1, size[s]), .25), .7, 1.5), w = v * 10 / p.radiusKm;
      omega.push([ax / al * w, ay / al * w, az / al * w]);
    }
    // (в) дрейф; при заметном перекрытии двух плит они свариваются и движутся как одно тело (средняя угловая скорость по площади)
    const par = Array.from({ length: K }, (_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const sum = omega.map((o, s) => [o[0] * size[s], o[1] * size[s], o[2] * size[s]]), cnt = Float64Array.from(size), welds = [], Dm = Float64Array.from(size, (v, i) => v + (KEEL - 1) * csz[i]);
    const occ = new Uint8Array(NB * K), pair = new Int32Array(K * K), Tb = new Float32Array(NB), cntB = new Int32Array(NB), bStart = new Int32Array(NB + 1), fillPos = new Int32Array(NB), byBin = new Int32Array(n), STEP = TAU / W;
    for (let st = 0; st < SUB; st++) {
      const rot = Array.from({ length: K }, (_, s) => {
        const rt = find(s), c = cnt[rt], wx = sum[rt][0] / c, wy = sum[rt][1] / c, wz = sum[rt][2] / c, ang = Math.hypot(wx, wy, wz) * dt;
        if (ang < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
        const ux = wx / (ang / dt), uy = wy / (ang / dt), uz = wz / (ang / dt), co = Math.cos(ang), si = Math.sin(ang), t = 1 - co;
        return [co + ux * ux * t, ux * uy * t - uz * si, ux * uz * t + uy * si, uy * ux * t + uz * si, co + uy * uy * t, uy * uz * t - ux * si, uz * ux * t - uy * si, uz * uy * t + ux * si, co + uz * uz * t];
      });
      // субдукция: океан перед движущимся краем плиты (пустая ячейка по ходу) уходит под континент; над ним растёт магматическая дуга / берегововой хребет
      cntB.fill(0); for (let k = 0; k < n; k++) cntB[binIdx[k]]++;
      for (let b = 0; b < NB; b++) if (cntB[b] > 0) lastCont[b] = time;
      for (const h of hots) {
        if (time < h.t0 || time > h.t1) continue;
        for (let k = n; k < N; k++) {
          if (!alive[k] || thick[k] >= T_HOT_OCE) continue; const c = X[3 * k] * h.x + X[3 * k + 1] * h.y + X[3 * k + 2] * h.z; if (c < HCOS) continue;
          const th = Math.acos(clamp(c, -1, 1)) / HOT_RAD; thick[k] = Math.min(T_HOT_OCE, thick[k] + HOT_RATE * 2 * h.s * Math.exp(-th * th) * dt);
        }
        for (let k = 0; k < n; k++) {
          const c = X[3 * k] * h.x + X[3 * k + 1] * h.y + X[3 * k + 2] * h.z; if (c < HCOS || thick[k] >= T_HOT_MAX) continue;
          const th = Math.acos(clamp(c, -1, 1)) / HOT_RAD, inc = Math.min(T_HOT_MAX - thick[k], HOT_RATE * h.s * Math.exp(-th * th) * dt); thick[k] += inc; hotAdded += inc * PA; tOro[binIdx[k]] = time;
        }
      }
      for (let k = 0; k < n; k++) {
        const rt = find(grp[k]), c = cnt[rt], wx = sum[rt][0] / c, wy = sum[rt][1] / c, wz = sum[rt][2] / c, x = X[3 * k], y = X[3 * k + 1], z = X[3 * k + 2];
        let vx = wy * z - wz * y, vy = wz * x - wx * z, vz = wx * y - wy * x; const sp = Math.hypot(vx, vy, vz); if (sp < 1e-9) continue;
        const d = 1.5 * STEP / sp, ax = x + vx * d, ay = y + vy * d, az = z + vz * d, al = Math.sqrt(ax * ax + ay * ay + az * az), b2 = binOf(ax / al, ay / al, az / al);
        if (cntB[b2] > 0 || thick[k] >= T_ARC_MAX) continue; const o2 = oceBin[b2]; if (o2 < 0 || find(grp[o2]) === rt) continue;   // дуга — только там, где впереди океан ДРУГОЙ плиты (пассивная окраина своей плиты дуг не даёт)
        const inc = Math.min(T_ARC_MAX - thick[k], ARC_RATE * (sp * p.radiusKm / 10 / 5) * dt); thick[k] += inc; arcAdded += inc * PA; tOro[binIdx[k]] = time;
      }
      for (let k = 0; k < N; k++) {
        if (!alive[k]) continue; const m = rot[grp[k]], x = X[3 * k], y = X[3 * k + 1], z = X[3 * k + 2];
        let nx = m[0] * x + m[1] * y + m[2] * z, ny = m[3] * x + m[4] * y + m[5] * z, nz = m[6] * x + m[7] * y + m[8] * z; const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        X[3 * k] = nx *= l; X[3 * k + 1] = ny *= l; X[3 * k + 2] = nz *= l; binIdx[k] = binOf(nx, ny, nz);
      }
      time += dt;
      // растекание сверхмощной коры (обрушение орогена): доля точек перегруженной ячейки (T > T_CAP) переходит в самую лёгкую соседнюю ячейку
      for (let pass = 0; pass < 4; pass++) {
        Tb.fill(0); cntB.fill(0); for (let k = 0; k < n; k++) { const b = binIdx[k]; Tb[b] += thick[k] * PA / binArea[b]; cntB[b]++; }
        let any = false; for (let b = 0; b < NB; b++) if (Tb[b] > T_CAP) { any = true; break; } if (!any) break;
        for (let b = 0, acc = 0; b <= NB; b++) { bStart[b] = acc; if (b < NB) acc += cntB[b]; }
        fillPos.set(bStart.subarray(0, NB)); for (let k = 0; k < n; k++) byBin[fillPos[binIdx[k]]++] = k;
        for (let b = 0; b < NB; b++) {
          if (Tb[b] <= T_CAP) continue;
          let nb = -1, lo = Tb[b]; for (let q = 0; q < 4; q++) { const c = nbr[4 * b + q]; if (Tb[c] < lo) { lo = Tb[c]; nb = c; } }
          if (nb < 0) continue;
          const mvN = Math.ceil(cntB[b] * Math.min(.5, (Tb[b] - Math.max(lo, T_CAP * .6)) / (2 * Tb[b])));
          for (let u = 0; u < mvN; u++) {
            const k = byBin[bStart[b] + u], j = 1 / 2.2, jx = (R() - .5) * j * STEP, jy = (R() - .5) * j * STEP;
            let x = bc[3 * nb] + jx, y = bc[3 * nb + 1] + jy, z = bc[3 * nb + 2] + jx * .3; const l = Math.sqrt(x * x + y * y + z * z); x /= l; y /= l; z /= l;
            X[3 * k] = x; X[3 * k + 1] = y; X[3 * k + 2] = z; binIdx[k] = binOf(x, y, z);
          }
        }
      }
      // силы на плитах: натяжение погружающегося дна (по длине фронта; сила растёт с возрастом) и отталкивание от хребта; момент → угловая скорость
      const tor = new Float64Array(3 * K), velAt = (r, x, y, z) => { const c = cnt[r], wx = sum[r][0] / c, wy = sum[r][1] / c, wz = sum[r][2] / c; return [wy * z - wz * y, wz * x - wx * z, wx * y - wy * x]; };
      const pull = (rs, ro, x, y, z, age, w) => {   // плита rs уходит под плиту ro в точке (x,y,z)
        const a = velAt(rs, x, y, z), b = velAt(ro, x, y, z), vx = a[0] - b[0], vy = a[1] - b[1], vz = a[2] - b[2], vm = Math.hypot(vx, vy, vz); if (vm < 1e-9) return;
        const m = (.3 + Math.min(age, AGE_MAX) / 100) * w * Math.min(4, STEP / Math.max(vm * dt, STEP * .25)) / vm;
        tor[3 * rs] += (y * vz - z * vy) * m; tor[3 * rs + 1] += (z * vx - x * vz) * m; tor[3 * rs + 2] += (x * vy - y * vx) * m;
      };
      // океаническая кора: старение, субдукция (старое уходит под молодое и под континент), островные дуги, рождение нового дна в зазорах (хребты)
      contCnt.fill(0); for (let k = 0; k < n; k++) { const b = binIdx[k]; if (contCnt[b] < 255) contCnt[b]++; contGrp[b] = grp[k]; }
      oceBin.fill(-1);
      for (let k = n; k < N; k++) {
        if (!alive[k]) continue; oAge[k] += dt; const b = binIdx[k];
        if (contCnt[b] >= 2) { pull(find(grp[k]), find(contGrp[b]), X[3 * k], X[3 * k + 1], X[3 * k + 2], oAge[k], OCE_W); alive[k] = 0; free.push(k); continue; }
        const j = oceBin[b]; if (j < 0) { oceBin[b] = k; continue; }
        const same = find(grp[k]) === find(grp[j]);
        if (same) { alive[k] = 0; free.push(k); continue; }
        const old = oAge[k] > oAge[j] ? k : j, young = old === k ? j : k;
        pull(find(grp[old]), find(grp[young]), X[3 * old], X[3 * old + 1], X[3 * old + 2], oAge[old], OCE_W); alive[old] = 0; free.push(old); oceBin[b] = young; thick[young] = Math.min(T_ARC_OCE, thick[young] + ARC_RATE * dt);
      }
      for (let b = 0; b < NB; b++) {
        if (contCnt[b] > 0 || oceBin[b] >= 0 || !free.length) continue;
        let g = -1, gc = -1; for (let q = 0; q < 4; q++) { const c = nbr[4 * b + ((q + (st & 3)) & 3)]; if (oceBin[c] >= 0) { g = grp[oceBin[c]]; gc = c; break; } if (contCnt[c] > 0) { g = contGrp[c]; gc = c; break; } }
        if (g < 0) continue;
        { const r = find(g), dx = bc[3 * gc] - bc[3 * b], dy = bc[3 * gc + 1] - bc[3 * b + 1], dz = bc[3 * gc + 2] - bc[3 * b + 2], dl = Math.hypot(dx, dy, dz) || 1, wr = Math.hypot(sum[r][0], sum[r][1], sum[r][2]) / cnt[r], m = F_RIDGE * Math.min(4, STEP / Math.max(wr * dt, STEP * .25)) / dl, x = bc[3 * b], y = bc[3 * b + 1], z = bc[3 * b + 2];
          tor[3 * r] += (y * dz - z * dy) * m; tor[3 * r + 1] += (z * dx - x * dz) * m; tor[3 * r + 2] += (x * dy - y * dx) * m; }
        const k = free.pop(), j = 1 / 2.2, jx = (R() - .5) * j * STEP, jy = (R() - .5) * j * STEP; let x = bc[3 * b] + jx, y = bc[3 * b + 1] + jy, z = bc[3 * b + 2] + jx * .3; const l = Math.sqrt(x * x + y * y + z * z);
        X[3 * k] = x / l; X[3 * k + 1] = y / l; X[3 * k + 2] = z / l; alive[k] = 1; oAge[k] = 0; thick[k] = 0; grp[k] = g; binIdx[k] = b; oceBin[b] = k;
      }
      { const relax = 1 - Math.exp(-dt / TAU_V), wMax = SPEED_MAX * 10 / p.radiusKm;
        for (let r = 0; r < K; r++) {
          if (find(r) !== r) continue; const c = cnt[r], g = G_FORCE * p.activity / Dm[r];
          let tx = tor[3 * r] * g, ty = tor[3 * r + 1] * g, tz = tor[3 * r + 2] * g; const tm = Math.hypot(tx, ty, tz); if (tm > wMax) { const f = wMax / tm; tx *= f; ty *= f; tz *= f; }
          sum[r][0] += (tx * c - sum[r][0]) * relax; sum[r][1] += (ty * c - sum[r][1]) * relax; sum[r][2] += (tz * c - sum[r][2]) * relax;
        } }
      // роли: корни групп → слоты 0..K-1 по индексу плиты (корень), счёт точек плиты в ячейке
      occ.fill(0); for (let k = 0; k < n; k++) { const s = find(grp[k]), i = binIdx[k] * K + s; if (occ[i] < 255) occ[i]++; }
      pair.fill(0);
      for (let b = 0; b < NB; b++) {
        let m = 0; const hit = []; for (let s = 0; s < K; s++) if (occ[b * K + s] >= PTS_PER_BIN * .75) hit.push(s);
        if (hit.length < 2) continue;
        tOro[b] = time; for (let u = 0; u < hit.length; u++) for (let v = u + 1; v < hit.length; v++) pair[hit[u] * K + hit[v]]++;
      }
      for (let a = 0; a < K; a++) for (let s = a + 1; s < K; s++) {
        if (find(a) !== a || find(s) !== s || !pair[a * K + s]) continue;
        if (pair[a * K + s] > Math.max(6, WELD_FRAC * Math.min(csz[a], csz[s]) / PTS_PER_BIN)) { par[s] = a; sum[a][0] += sum[s][0]; sum[a][1] += sum[s][1]; sum[a][2] += sum[s][2]; cnt[a] += cnt[s]; csz[a] += csz[s]; Dm[a] += Dm[s]; welds.push({ tMyr: Math.round(time), a, b: s }); }
      }
      if (p.snapshotEveryMyr && time + 1e-9 >= nextSnap) { snapshots.push({ tMyr: Math.round(time), thickness: rasterBins() }); nextSnap += p.snapshotEveryMyr; }
    }
    // летопись затоплений: уровень моря по объёму воды при текущей коре; ячейка ниже уровня — под водой, на мелководье над континентальной корой копится морской осадок
    {
      const Tq = rasterBins(), V0 = p.waterDepthKm * 4 * Math.PI, el = new Float32Array(NB); for (let b = 0; b < NB; b++) el[b] = isostasy(Math.min(Tq[b], T_CAP));
      let l0 = -8, h0 = 14; for (let it = 0; it < 40; it++) { const m = (l0 + h0) / 2; let v = 0; for (let b = 0; b < NB; b++) if (el[b] < m) v += (m - el[b]) * binArea[b]; if (v > V0) h0 = m; else l0 = m; }
      const sl = (l0 + h0) / 2; seaHist.push(Math.round(sl * 1000) / 1000);
      for (let b = 0; b < NB; b++) if (el[b] < sl) { subMyr[b] += dtEpoch; lastSub[b] = time; if (Tq[b] >= T_CONT && sl - el[b] < .5) seaSed[b] += SED_RATE * dtEpoch; }
    }
    epochs.push({ index: e, plates: K, welds, omegaRadPerMyr: omega.map((o, s) => { const r = find(s); return Math.hypot(sum[r][0], sum[r][1], sum[r][2]) / cnt[r]; }) });
  }
  const volume1 = (() => { let s = 0; for (let k = 0; k < n; k++) s += thick[k] * PA; return s; })();

  // ---- растр на равнопромежуточную сетку ----
  const NC = W * H, area = new Float64Array(NC), T = new Float32Array(NC), tb = rasterBins();
  const subGrid = new Float32Array(NC), sedGrid = new Float32Array(NC), lastSubGrid = new Float32Array(NC), tOroGrid = new Float32Array(NC), ageV = new Float32Array(NC), ageW = new Float32Array(NC);
  for (let r = 0; r < H; r++) {
    const a = TAU / W * (Math.sin((90 - r / H * 180) * DEG) - Math.sin((90 - (r + 1) / H * 180) * DEG));
    for (let x = 0; x < W; x++) { const i = r * W + x, b = off[r] + Math.min(nlon[r] - 1, Math.floor((x + .5) / W * nlon[r])); area[i] = a; const ok = oceBin[b]; T[i] = tb[b] + (ok >= 0 ? thick[ok] : 0); ageV[i] = ok >= 0 ? oAge[ok] : 0; ageW[i] = ok >= 0 ? 1 : 0; tOroGrid[i] = tOro[b]; subGrid[i] = subMyr[b]; sedGrid[i] = seaSed[b]; lastSubGrid[i] = lastSub[b]; }
  }
  // сглаживание выборки точек (разброс числа точек в ячейке даёт «пятна»): один проход 3×3 по сетке; полюса — отражение по широте
  const blurX = (a, r) => { const o = new Float32Array(NC); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let d = -r; d <= r; d++) s += a[y * W + (x + d + W) % W]; o[y * W + x] = s / (2 * r + 1); } return o; };
  const blurY = (a, r) => { const o = new Float32Array(NC); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, c = 0; for (let d = -r; d <= r; d++) { const yy = y + d; if (yy < 0 || yy >= H) continue; s += a[yy * W + x]; c++; } o[y * W + x] = s / c; } return o; };
  { const sm = blurY(blurX(T, 1), 1); for (let i = 0; i < NC; i++) T[i] = sm[i]; }
  // ---- эрозия: сверхмощная кора (горы) стирается со временем после сжатия; снесённое оседает у континента (шельф); объём сохраняется ----
  const tEnd = p.stopAtMyr, Te = Float32Array.from(T), removed = new Float32Array(NC); let remTot = 0, tot0 = 0, lost = 0;
  for (let i = 0; i < NC; i++) {
    tot0 += T[i] * area[i];
    const ex = Math.max(0, T[i] - TREF); if (!ex) continue;
    const age = tOroGrid[i] < 0 ? tEnd : Math.max(0, tEnd - tOroGrid[i]), keep = ex * Math.exp(-age / TAU_EROSION);
    Te[i] = Math.min(T[i], TREF) + keep; removed[i] = T[i] - Te[i]; remTot += removed[i] * area[i];
  }
  if (remTot > 0) {
    const rr = Math.max(2, Math.round(W / 120));
    let dep = Float32Array.from(removed); for (let k = 0; k < 2; k++) dep = blurY(blurX(dep, rr), rr);
    const cont = blurY(blurX(Float32Array.from(Te, v => (v > 5 ? 1 : 0)), rr), rr); let depTot = 0;
    for (let i = 0; i < NC; i++) { dep[i] *= smooth(.02, .2, cont[i]) * (Te[i] < TREF ? 1 : 0); depTot += dep[i] * area[i]; }
    // осадок ложится слоем не толще T_SHELF (шельф уходит под воду); излишек уходит в глубоководье/зону субдукции и считается потерей
    const sc = depTot > 0 ? remTot / depTot : 0; let put = 0;
    for (let i = 0; i < NC; i++) { const d = Math.min(dep[i] * sc, Math.max(0, T_SHELF - Te[i])); Te[i] += d; put += d * area[i]; }
    lost = remTot - put;
  }
  // ---- обрушение перегруженной коры на сетке: избыток над T_COLLAPSE уходит в самого лёгкого соседа (объём сохраняется) ----
  {
    const T_COLLAPSE = 65, nbrs = (i) => { const x = i % W, y = (i / W) | 0, o = [y * W + (x + 1) % W, y * W + (x + W - 1) % W]; if (y > 0) o.push(i - W); if (y < H - 1) o.push(i + W); return o; };
    for (let it = 0; it < 40; it++) {
      let moved = 0;
      for (let i = 0; i < NC; i++) {
        if (Te[i] <= T_COLLAPSE) continue;
        let j = -1, lo = Te[i]; for (const q of nbrs(i)) if (Te[q] < lo) { lo = Te[q]; j = q; }
        if (j < 0) continue; const dv = (Te[i] - Math.max(lo, T_COLLAPSE * .7)) * .35; if (dv <= 0) continue;
        Te[i] -= dv; Te[j] += dv * area[i] / area[j]; moved++;
      }
      if (!moved) break;
    }
  }
  // ---- изостазия и уровень моря из объёма воды ----
  // возраст дна — из океанических точек (рождаются на хребтах в зазорах, уходят в субдукцию); дно остывает и оседает ~ √возраста
  const aV = blurY(blurX(ageV, 2), 2), aW = blurY(blurX(ageW, 2), 2), ageS = new Float32Array(NC); for (let i = 0; i < NC; i++) ageS[i] = aW[i] > .05 ? Math.min(AGE_MAX * 1.5, aV[i] / aW[i]) : AGE_MAX;
  const elev = new Float32Array(NC);
  for (let i = 0; i < NC; i++) elev[i] = isostasy(Te[i]) + SUBSIDE * (Math.sqrt(AGE_REF) - Math.sqrt(Math.min(AGE_MAX * 1.5, ageS[i]))) * (1 - smooth(2, 12, Te[i]));
  const V = p.waterDepthKm * 4 * Math.PI; let lo = -8, hi = 14;
  for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; let v = 0; for (let i = 0; i < NC; i++) if (elev[i] < m) v += (m - elev[i]) * area[i]; if (v > V) hi = m; else lo = m; }
  const seaLevelKm = (lo + hi) / 2, elevationKm = new Float32Array(NC); let landArea = 0;
  for (let i = 0; i < NC; i++) { elevationKm[i] = elev[i] - seaLevelKm; if (elevationKm[i] > 0) landArea += area[i]; }
  let formerSea = 0; for (let i = 0; i < NC; i++) if (elevationKm[i] > 0 && sedGrid[i] > .05) formerSea += area[i];
  let tot1 = 0; for (let i = 0; i < NC; i++) tot1 += Te[i] * area[i];
  return {
    w: W, h: H, thickness: Te, thicknessBeforeErosion: T, elevationKm, seaLevelKm, cellArea: area, oceanAgeMyr: ageS, submergedMyr: subGrid, marineSedimentKm: sedGrid, lastSubmergedMyr: lastSubGrid, seaLevelHistoryKm: seaHist, tOroMyr: tOroGrid,
    stats: { landFraction: landArea / (4 * Math.PI), landWithMarineSedimentFraction: landArea > 0 ? formerSea / landArea : 0, pointVolumeStart: volume0, pointVolumeEnd: volume1, arcAddedVolume: arcAdded, hotspotAddedVolume: hotAdded, crustVolumeBeforeErosion: tot0, crustVolumeAfterErosion: tot1, sedimentLostVolume: lost, points: n, epochs: nEpochs, time },
    history: epochs, snapshots, params: Object.assign({}, p), cratons: crat.length, hotspots: hots.map(h => ({ x: h.x, y: h.y, z: h.z, fromMyr: Math.round(h.t0), toMyr: Math.round(h.t1), strength: h.s })), metadata: { generator: VERSION }
  };
}
const api = { generate, VERSION, isostasy, constants: { TREF, E_SLOPE, E_FLOOR, TAU_EROSION } };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SphereTectonicHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
