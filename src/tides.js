// Упрощённая приливная модель. Размах прилива в метрах на каждой клетке океана у побережья:
//   размах = (фон + вклад шельфа · воронка залива) · открытость моря · шум · множитель лун.
// Шельф: чем шире мелководье вокруг, тем выше прилив (Ла-Манш, Фанди, Жёлтое море).
// Воронка: вогнутый берег (залив, устье) сужает волну и поднимает её; мыс — наоборот.
// Открытость: узкие и замкнутые моря (Балтика, Средиземное) почти не приливны; озёра — нет.
// Множитель лун: Земля = 1 (Луна 27,3 сут + Солнце); сила приливов луны ∝ (27,3/период)²; без лун — только солнечный.
// Это упрощение для разметки карты, а не гидродинамика: на форму рельефа и течения оно не влияет.
(function (FM) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  FM.TIDE_STRONG = 4; FM.TIDE_HUGE = 8;                     // пороги «сильный» / «очень сильный», метры

  FM.tideFactor = function (periods) {                         // periods: периоды лун, земных суток
    let F = 0.46;                                              // Солнце (у Земли — 0,46 от лунного)
    for (const p of periods || []) if (p > 0) F += Math.min(2.5, Math.pow(27.3 / p, 2));
    return clamp(F / 1.46, 0.3, 2.6);
  };

  const cache = new WeakMap();
  // базовое поле (множитель лун = 1): { r: Float32Array размах, shelf: Float32Array, flat: Float32Array ширина осушки в клетках при f=1 не хранится }
  FM.tideBase = function (map) {
    if (cache.has(map)) return cache.get(map);
    const { W, H, h, wd, dist, ocean } = map, N = W * H, s = W / 480;
    const water = new Float32Array(N), shallow = new Float32Array(N);
    for (let i = 0; i < N; i++) if (h[i] <= 0) { water[i] = 1; shallow[i] = Math.min(wd[i], 14); }
    const bl = (a, r) => { const t = Float32Array.from(a); FM.blur(t, W, H, r); return t; };   // FM.blur правит массив на месте
    const bw = bl(water, 20), bs = bl(shallow, 20);   // средняя «глубина» вокруг: мала на широком шельфе
    const bay = bl(water, Math.max(4, Math.round(14 * s)));
    const open = bl(water, Math.max(8, Math.round(45 * s)));
    const noise = FM.makeNoise(FM.mulberry32(FM.hashString(String(map.seed) + '|tide')));
    const r = new Float32Array(N), shelf = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (h[i] > 0 || !ocean[i] || dist[i] > 14 * s) continue;
      const shI = 1 - smooth(2.5, 6.5, bs[i] / Math.max(0.05, bw[i]));
      const fun = smooth(0.5, 0.22, bay[i]), damp = 0.15 + 0.85 * smooth(0.28, 0.62, open[i]);
      const nz = 1 + 0.4 * FM.fbm(noise, x / (35 * s), y / (35 * s), 2);
      r[i] = (0.3 + 11 * Math.pow(shI, 1.8) * (0.25 + 0.75 * fun)) * damp * nz; shelf[i] = shI;
    }
    const out = { r, shelf }; cache.set(map, out); return out;
  };
  // ширина осушки (отливной полосы), клетки: чем больше размах и положе шельф, тем шире
  FM.tideFlat = (range, shelfI, s) => clamp((range - 1.8) * 0.9, 0, 8) * (0.5 + 0.5 * shelfI) * Math.sqrt(s);
})(window.FM = window.FM || {});
