// Обмен с приложением-календарём (Fantasy Calendar): файл формата world-exchange v1.
// Правило календаря: чего в карте нет — поле пропускается, ничего не выдумываем.
// Из карты берём: название, долю воды (по площади, с поправкой на широту) и города (широта по строке карты).
// Параметры планеты (радиус, сутки, год, наклон оси, луны) карта не вычисляет — их вводит автор в разделе «Для календаря».
(function (FM) {
  'use strict';
  const LAT_MAX = 75;                                   // карта охватывает широты ±75° (так же считают течения, currents.js)
  FM.mapLat = (y, H) => (1 - 2 * (y + 0.5) / H) * LAT_MAX;
  const num = (v) => { if (typeof v === 'number') return isFinite(v) ? v : null; const n = parseFloat(String(v == null ? '' : v).trim().replace(',', '.')); return isFinite(n) ? n : null; };
  const r2 = (v, k) => { const m = Math.pow(10, k == null ? 2 : k); return Math.round(v * m) / m; };

  // доля поверхности под водой: сумма по клеткам с весом cos(широты), т.к. на шаре узкие у полюсов строки меньше по площади
  FM.waterFraction = function (map) {
    const { h, W, H } = map; let water = 0, all = 0;
    for (let y = 0; y < H; y++) {
      const w = Math.cos(FM.mapLat(y, H) * Math.PI / 180); let c = 0;
      for (let x = 0; x < W; x++) if (!(h[y * W + x] > 0)) c++;
      water += w * c; all += w * W;
    }
    return all > 0 ? water / all : null;
  };


  // Планета «под карту»: значения детерминированы (seed + размер мира + параметры генерации), свой поток ГСЧ — на саму карту не влияют.
  // Рамки — чтобы человек мог жить: сила тяжести 0,85–1,2 g, сутки 20–32 ч, год 280–480 суток, наклон 5–32°, 0–3 луны.
  // Радиус растёт с размером карты: «Малый» мир — около 5000 км, «Огромный» — около 7800 км (Земля — 6371).
  FM.genPlanet = function (seed, o) {
    o = o || {};
    const rnd = FM.mulberry32(FM.hashString(String(seed) + '|planet')), R = (a, b) => a + (b - a) * rnd();
    const sc = Math.max(1, Math.min(3, o.worldScale || 1));
    const radius = Math.round((5000 + (sc - 1) / 2 * 2800 + R(-250, 250)) / 10) * 10;
    const gT = R(0.88, 1.15), rho = Math.max(4.2, Math.min(6.4, gT * 5.51 * 6371 / radius));
    const out = { radius: String(radius), density: rho.toFixed(2), rotation: R(20, 32).toFixed(1), orbit: String(Math.round(R(280, 480))), tilt: R(5, 32).toFixed(1), moons: [] };
    const q = rnd(), n = q < 0.08 ? 0 : q < 0.5 ? 1 : q < 0.85 ? 2 : 3;
    const used = new Set(), races = ['elf', 'human', 'dwarf']; let per = R(10, 38);
    for (let i = 0; i < n; i++) { out.moons.push({ name: FM.cityName(rnd, used, races[Math.floor(rnd() * races.length)]), period: per.toFixed(1) }); per = Math.min(150, per * R(1.5, 2.4)); }
    return out;
  };
  FM.planetGravity = (P) => (+P.radius / 6371) * (+P.density / 5.51);   // в g Земли

  // planet: {radius, density, rotation, orbit, tilt, moons:[{name, period}]}, строки или числа; пусто/некорректно — пропуск
  FM.buildWorldExchange = function ({ name, planet, map, cities }) {
    const out = { format: 'world-exchange', version: 1 };
    const nm = String(name || '').trim(); if (nm) out.name = nm.slice(0, 60);
    const P = planet || {}, pl = {};
    const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null; };
    let v;
    if ((v = pos(P.radius)) !== null) pl.radius_km = v;
    if ((v = pos(P.density)) !== null) pl.density_g_cm3 = v;
    if ((v = pos(P.rotation)) !== null) pl.rotation_hours = v;
    if ((v = pos(P.orbit)) !== null) pl.orbital_period_days = v;
    if ((v = num(P.tilt)) !== null && v >= 0 && v <= 90) pl.axial_tilt_deg = v;
    if (map) { const wf = FM.waterFraction(map); if (wf !== null) pl.water_fraction = r2(wf, 3); }
    const moons = [];
    (P.moons || []).slice(0, 8).forEach((m, i) => { const per = pos(m && m.period); if (per !== null) moons.push({ name: String((m.name || '').trim() || ('Луна ' + (i + 1))).slice(0, 40), orbital_period_days: per }); });
    if (moons.length) pl.moons = moons;
    if (Object.keys(pl).length) out.planet = pl;
    if (map && Array.isArray(cities)) {
      const kinds = { capital: 'capital', city: 'city', port: 'port', town: 'town', fortress: 'fortress', village: 'village' };   // шахты и руины — не места для календаря
      const list = cities.filter(c => c && c.name && kinds[c.type] && isFinite(c.y)).sort((a, b) => (a.rank || 0) - (b.rank || 0)).slice(0, 200)
        .map(c => ({ name: String(c.name).slice(0, 60), lat: r2(Math.max(-90, Math.min(90, FM.mapLat(c.y, map.H))), 1), kind: kinds[c.type] }));
      if (list.length) out.places = list;
    }
    return out;
  };
})(window.FM = window.FM || {});
