// Ресурсы: каталог видов, размещение по геологии и климату, градация доступности добычи, профиль государства.
// Размещение детерминировано (seed + настройки), считается лениво и кэшируется в map._res. Настройки (resCfg) задаются при создании мира:
//   resCfg = { on: {категория: bool}, amt: {категория: 0.3…2.2} }, фэнтези-категория 'special' по умолчанию ВЫКЛЮЧЕНА.
// Месторождение: { t: категория, k: вид, x, y, amt (богатство 0.4…2), acc (доступность добычи 1…4) }.
(function (FM) {
  'use strict';
  const { mulberry32, hashString, makeNoise, smooth, clamp } = FM;

  // ---------- категории ----------
  FM.RESOURCES = {
    metal: { label: 'Металлы', color: '#5f7a99', core: true },
    stone: { label: 'Камень и минералы', color: '#8d7b5c', core: true },
    fuel: { label: 'Топливо', color: '#3c3c3c', core: true },
    timber: { label: 'Древесина', color: '#4f8a3d', core: true },
    luxury: { label: 'Роскошь', color: '#b0487a', core: true },
    sea: { label: 'Морские промыслы', color: '#2f8fa8', core: true },
    agri: { label: 'Земледелие и скот', color: '#c4a032', core: true },
    special: { label: 'Фэнтези-ресурсы', color: '#7a45c4', core: false }
  };
  FM.RES_CATS = Object.keys(FM.RESOURCES);
  // доступность добычи: 1 — выходы на поверхность/россыпи, 2 — карьер и неглубокие штольни, 3 — шахты (крепь, водоотлив), 4 — сверхглубокие/опасные работы
  FM.ACCESS = [null, { label: 'поверхностная', short: 'поверхн.', how: 'россыпи, выходы, сбор — без шахт' }, { label: 'неглубокая', short: 'неглуб.', how: 'карьер, неглубокие штольни' },
    { label: 'глубокая', short: 'глуб.', how: 'шахты с крепью и водоотливом' }, { label: 'сверхглубокая', short: 'сверхглуб.', how: 'сверхглубокие или опасные работы' }];

  FM.defaultResCfg = () => { const on = {}, amt = {}; for (const k of FM.RES_CATS) { on[k] = k !== 'special'; amt[k] = 1; } return { on, amt, off: {} }; };   // off: отдельные виды, выключенные при создании мира
  FM.normResCfg = (c) => {   // старые сохранения: булевы флаги по категориям; новые — {on, amt}
    const d = FM.defaultResCfg(); if (!c) return d;
    if (c.on) { for (const k of FM.RES_CATS) { if (k in c.on) d.on[k] = !!c.on[k]; if (c.amt && typeof c.amt[k] === 'number') d.amt[k] = clamp(c.amt[k], 0.2, 2.5); } if (c.off) for (const k in c.off) if (c.off[k]) d.off[k] = true; return d; }
    for (const k of FM.RES_CATS) if (k in c && typeof c[k] === 'boolean') d.on[k] = c[k];
    d.on.special = false; return d;
  };

  // ---------- вспомогательные поля ----------
  const band = (a, b, x) => smooth(a, a + 0.1, x) * (1 - smooth(b - 0.1, b, x));   // широкое плато с короткими краями (для земледелия: подходит большая часть диапазона)
  const bump = (a, b, x) => { const w = (b - a) / 3; return smooth(a, a + w, x) * (1 - smooth(b - w, b, x)); };
  function fieldsOf(map) {
    if (map._rf) return map._rf;
    const { W, H, h } = map, N = W * H, sc = W / 480, nv = FM.nav(map);
    // расстояние до моря по суше (chamfer 3-4), в клетках
    const ld = new Float32Array(N).fill(1e4); for (let i = 0; i < N; i++) if (h[i] <= 0) ld[i] = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; let v = ld[i]; if (x > 0) v = Math.min(v, ld[i - 1] + 1); if (y > 0) { v = Math.min(v, ld[i - W] + 1); if (x > 0) v = Math.min(v, ld[i - W - 1] + 1.41); if (x < W - 1) v = Math.min(v, ld[i - W + 1] + 1.41); } ld[i] = v; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; let v = ld[i]; if (x < W - 1) v = Math.min(v, ld[i + 1] + 1); if (y < H - 1) { v = Math.min(v, ld[i + W] + 1); if (x < W - 1) v = Math.min(v, ld[i + W + 1] + 1.41); if (x > 0) v = Math.min(v, ld[i + W - 1] + 1.41); } ld[i] = v; }
    // близость к вулканам (действующие сильнее) и к рекам
    const volc = new Float32Array(N), sg = 11 * sc;
    for (const v of (map.volcanoes || [])) { const w = v.active ? 1 : 0.55, r = Math.ceil(sg * 2.6); for (let y = Math.max(0, Math.round(v.y) - r); y <= Math.min(H - 1, Math.round(v.y) + r); y++) for (let x = Math.max(0, Math.round(v.x) - r); x <= Math.min(W - 1, Math.round(v.x) + r); x++) { const q = w * Math.exp(-((x - v.x) ** 2 + (y - v.y) ** 2) / (2 * sg * sg)); if (q > volc[y * W + x]) volc[y * W + x] = q; } }
    const riv = new Uint8Array(N), rr = Math.max(1, Math.round(1.5 * sc));
    for (let y = rr; y < H - rr; y++) for (let x = rr; x < W - rr; x++) if (map.riverMask[y * W + x]) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) riv[(y + dy) * W + x + dx] = 1;
    // шельф и холодные течения у берега (по воде вокруг): средняя «глубина» (map.wd) и среднее течение в радиусе
    const shelf = new Float32Array(N), cold = new Float32Array(N), R = Math.max(3, Math.round(8 * sc)), st = Math.max(2, Math.round(2 * sc));
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const i = y * W + x; if (h[i] <= 0 || ld[i] > 3 * sc) continue;
      let n = 0, sd = 0, sc2 = 0; for (let dy = -R; dy <= R; dy += st) for (let dx = -R; dx <= R; dx += st) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; if (h[j] > 0) continue; n++; sd += map.wd ? map.wd[j] : 10; sc2 += map.current ? map.current[j] : 0; }
      if (n) { shelf[i] = 1 - smooth(8, 24, sd / n); cold[i] = clamp(-sc2 / n * 2.2, 0, 1); }
    }
    return (map._rf = { ld, volc, riv, shelf, cold, nv, sc });
  }

  // ---------- каталог видов ----------
  // s(c, i, x, y) → пригодность 0…1; d — плотность (вероятность на ячейку сетки при пригодности 1); acc — базовая доступность (a(c,i) — своя); rank 1 обычное … 3 драгоценное.
  // c: { h, moist, temp, biome, young, old, belt, slope, ld, volc, riv, shelf, cold, low (низина), dry, coast, f (поля), river }
  const KINDS = [
    // ---- металлы: рудные пояса, щиты, вулканические дуги ----
    { id: 'iron', cat: 'metal', label: 'Железо', rank: 1, d: 0.55, acc: 2, why: 'древние щиты и горные пояса; болотная руда в заболоченных низинах',
      s: (c, i) => Math.max(smooth(0.1, 0.5, c.belt[i] + 0.8 * c.old[i]) * smooth(0.12, 0.3, c.h[i]), c.biome[i] === 9 || (c.biome[i] === 3 && c.moist[i] > 0.6 && c.low[i] > 0.6) ? 0.35 : 0),
      a: (c, i) => (c.biome[i] === 9 ? 1 : 0) },
    { id: 'copper', cat: 'metal', label: 'Медь', rank: 1, d: 0.55, acc: 2, why: 'горные пояса столкновения плит и вулканические дуги',
      s: (c, i) => Math.min(1, 0.85 * smooth(0.25, 0.8, c.young[i]) + 0.6 * c.volc[i]) * smooth(0.15, 0.3, c.h[i]) },
    { id: 'tin', cat: 'metal', label: 'Олово', rank: 2, d: 0.5, acc: 2, why: 'граниты древних щитов (и их россыпи в реках)',
      s: (c, i) => smooth(0.2, 0.45, c.old[i]) * bump(0.18, 0.9, c.h[i]), a: (c, i) => (c.riv[i] && c.h[i] < 0.4 ? -1 : 0) },
    { id: 'lead', cat: 'metal', label: 'Свинец и цинк', rank: 1, d: 0.5, acc: 2, why: 'осадочные толщи у горных поясов (рядом с известняком)',
      s: (c, i) => bump(0.12, 0.65, c.belt[i]) * (c.h[i] > 0.15 ? 1 : 0) * (0.5 + 0.5 * smooth(0.25, 0.5, c.moist[i])) },
    { id: 'silver', cat: 'metal', label: 'Серебро', rank: 2, d: 0.5, acc: 3, why: 'жилы молодых поясов, особенно у вулканов',
      s: (c, i) => smooth(0.35, 1, c.young[i]) * (0.45 + 0.55 * Math.min(1, c.volc[i] * 1.5)) * smooth(0.25, 0.45, c.h[i]) },
    { id: 'gold', cat: 'metal', label: 'Золото', rank: 3, d: 0.45, acc: 3, why: 'кварцевые жилы молодых поясов; россыпи в реках, берущих начало в горах',
      s: (c, i) => Math.max(smooth(0.5, 1.1, c.young[i]) * 0.7 * smooth(0.35, 0.6, c.h[i]), c.riv[i] && c.belt[i] > 0.3 && c.h[i] < 0.5 ? 0.6 : 0, smooth(0.3, 0.5, c.old[i]) * 0.35 * smooth(0.2, 0.4, c.h[i])),
      a: (c, i) => (c.riv[i] && c.h[i] < 0.5 ? -2 : 0) },
    // ---- камень и минералы ----
    { id: 'granite', cat: 'stone', label: 'Гранит', rank: 1, d: 0.5, acc: 1, why: 'интрузивные массивы древних щитов',
      s: (c, i) => smooth(0.22, 0.42, c.old[i] + 0.3 * c.young[i]) * smooth(0.12, 0.3, c.h[i]) },
    { id: 'marble', cat: 'stone', label: 'Мрамор', rank: 2, d: 0.6, acc: 2, why: 'метаморфизованные известняки в горных поясах',
      s: (c, i) => bump(0.22, 0.8, c.belt[i]) * smooth(0.3, 0.5, c.h[i]) * (0.4 + 0.6 * c.f.lime[i]) },
    { id: 'limestone', cat: 'stone', label: 'Известняк', rank: 1, d: 0.5, acc: 1, why: 'осадочные равнины тёплых морей, у побережий и бывших бассейнов',
      s: (c, i) => c.f.lime[i] },
    { id: 'sandstone', cat: 'stone', label: 'Песчаник', rank: 1, d: 0.42, acc: 1, why: 'засушливые котловины и пустынные плато',
      s: (c, i) => c.dry[i] * smooth(0.1, 0.35, c.h[i]) * (1 - smooth(0.6, 0.8, c.h[i])) },
    { id: 'slate', cat: 'stone', label: 'Сланец и шифер', rank: 1, d: 0.5, acc: 2, why: 'слабо метаморфизованные толщи на склонах поясов',
      s: (c, i) => bump(0.12, 0.55, c.belt[i]) * smooth(0.2, 0.4, c.h[i]) },
    { id: 'clay', cat: 'stone', label: 'Глина', rank: 1, d: 0.5, acc: 1, why: 'речные поймы и озёрные низины',
      s: (c, i) => (c.riv[i] || c.biome[i] === 9 ? 1 : 0) * c.low[i] * (c.biome[i] === 6 ? 0.2 : 1) },
    { id: 'salt', cat: 'stone', label: 'Соль', rank: 2, d: 0.42, acc: 2, why: 'пересыхающие лагуны, солончаки засушливых низин; каменная соль в котловинах',
      s: (c, i) => Math.max(c.dry[i] * c.low[i] * (c.ld[i] < 18 * c.sc ? 1 : 0.45) * (c.temp[i] > 0.5 ? 1 : 0.4), c.biome[i] === 6 && c.low[i] > 0.4 ? 0.5 : 0),
      a: (c, i) => (c.ld[i] < 6 * c.sc ? -1 : 0) },
    { id: 'sulfur', cat: 'stone', label: 'Сера', rank: 2, d: 0.55, acc: 2, why: 'фумаролы и склоны вулканов',
      s: (c, i) => smooth(0.3, 0.75, c.volc[i]), vol: true },
    { id: 'obsidian', cat: 'stone', label: 'Обсидиан', rank: 2, d: 0.65, acc: 1, why: 'застывшие кислые лавы вулканических областей',
      s: (c, i) => smooth(0.3, 0.75, c.volc[i]) * 0.9, vol: true },
    // ---- топливо ----
    { id: 'coal', cat: 'fuel', label: 'Каменный уголь', rank: 2, d: 0.3, acc: 3, why: 'угольные бассейны: влажные низины у горных поясов (древние болотные леса)',
      s: (c, i) => bump(0.0, 0.6, c.belt[i] + 0.1) * Math.max(c.low[i], 0.3) * smooth(0.25, 0.5, c.moist[i]) * (c.temp[i] > 0.3 ? 1 : 0.4),
      a: (c, i) => (c.belt[i] > 0.3 ? -1 : 0)  },
    { id: 'peat', cat: 'fuel', label: 'Торф', rank: 1, d: 0.55, acc: 1, why: 'холодные влажные низины и болота',
      s: (c, i) => Math.max(c.biome[i] === 9 ? 0.9 : 0, c.low[i] * smooth(0.5, 0.7, c.moist[i]) * (1 - smooth(0.45, 0.65, c.temp[i]))) * (c.biome[i] === 6 ? 0 : 1) },
    { id: 'oil', cat: 'fuel', label: 'Нефть и битум', rank: 3, d: 0.4, acc: 3, why: 'осадочные бассейны на сухих низменностях у морей (смоляные ключи на поверхности)',
      s: (c, i) => c.low[i] * smooth(0.5, 0.2, c.moist[i]) * (c.ld[i] < 40 * c.sc ? 1 : 0.35) * (1 - smooth(0.3, 0.6, c.belt[i])) * smooth(0.3, 0.5, c.temp[i]) * c.f.basin[i],
      a: (c, i) => (c.f.basin[i] > 0.85 ? -1 : 0) },
    // ---- древесина (лесные массивы) ----
    { id: 'oak', cat: 'timber', label: 'Дуб и бук', rank: 1, d: 0.5, acc: 1, sp: 1.3, why: 'широколиственные леса умеренного пояса',
      s: (c, i) => (c.biome[i] === 4 ? 1 : 0) * bump(0.38, 0.8, c.temp[i]) },
    { id: 'pine', cat: 'timber', label: 'Сосна и ель', rank: 1, d: 0.55, acc: 1, sp: 1.3, why: 'тайга и хвойные склоны гор',
      s: (c, i) => (c.biome[i] === 3 ? 1 : c.biome[i] === 4 && c.temp[i] < 0.5 ? 0.6 : c.biome[i] === 10 && c.moist[i] > 0.4 && c.h[i] < 0.9 ? 0.4 : 0) },
    { id: 'hardwood', cat: 'timber', label: 'Тропические породы (тик, эбен)', rank: 2, d: 0.5, acc: 2, sp: 1.3, why: 'влажные тропические леса',
      s: (c, i) => (c.biome[i] === 8 ? 1 : c.biome[i] === 7 && c.moist[i] > 0.45 ? 0.3 : 0) },
    { id: 'masts', cat: 'timber', label: 'Корабельный лес', rank: 2, d: 0.38, acc: 1, sp: 1.3, why: 'высокоствольные хвойные у рек и побережий (сплав)',
      s: (c, i) => (c.biome[i] === 3 || c.biome[i] === 4 ? 1 : 0) * Math.max(c.riv[i] ? 1 : 0, c.ld[i] < 14 * c.sc ? 0.8 : 0) * (c.temp[i] < 0.62 ? 1 : 0.3) },
    { id: 'bamboo', cat: 'timber', label: 'Бамбук и тростник', rank: 1, d: 0.4, acc: 1, sp: 1.3, why: 'тёплые влажные низины и болота',
      s: (c, i) => ((c.biome[i] === 8 || c.biome[i] === 9) ? 1 : 0) * c.low[i] * smooth(0.55, 0.7, c.temp[i]) },
    // ---- роскошь ----
    { id: 'gems', cat: 'luxury', label: 'Самоцветы', rank: 3, d: 0.7, acc: 3, sp: 1.2, why: 'пегматиты и контактовые зоны молодых поясов, трубки на древних щитах',
      s: (c, i) => Math.max(smooth(0.45, 1, c.young[i]) * 0.8, smooth(0.35, 0.5, c.old[i]) * 0.5) * smooth(0.3, 0.5, c.h[i]) },
    { id: 'wine', cat: 'luxury', label: 'Вино', rank: 2, d: 0.65, acc: 1, sp: 1.2, why: 'тёплые солнечные склоны с умеренной влажностью',
      s: (c, i) => bump(0.5, 0.74, c.temp[i]) * bump(0.28, 0.65, c.moist[i]) * bump(0.18, 0.6, c.h[i]) * (c.biome[i] === 5 || c.biome[i] === 4 || c.biome[i] === 7 ? 1 : 0.2) },
    { id: 'spices', cat: 'luxury', label: 'Пряности', rank: 3, d: 0.5, acc: 1, sp: 1.2, why: 'жаркий влажный пояс',
      s: (c, i) => smooth(0.65, 0.8, c.temp[i]) * smooth(0.5, 0.68, c.moist[i]) * (c.biome[i] === 8 || c.biome[i] === 7 || c.biome[i] === 9 ? 1 : 0.3) * (1 - smooth(0.55, 0.8, c.h[i])) },
    { id: 'furs', cat: 'luxury', label: 'Меха', rank: 2, d: 0.45, acc: 1, sp: 1.2, why: 'холодные леса и тундра',
      s: (c, i) => (c.biome[i] === 3 ? 1 : c.biome[i] === 2 ? 0.8 : c.biome[i] === 4 && c.temp[i] < 0.42 ? 0.5 : 0) },
    { id: 'silk', cat: 'luxury', label: 'Шёлк', rank: 3, d: 0.75, acc: 1, sp: 1.2, why: 'тёплые влажные речные долины с шелковицей',
      s: (c, i) => bump(0.55, 0.8, c.temp[i]) * bump(0.45, 0.8, c.moist[i]) * c.low[i] * (c.riv[i] ? 1 : 0.4) * (c.biome[i] === 6 ? 0 : 1) },
    { id: 'amber', cat: 'luxury', label: 'Янтарь', rank: 2, d: 0.55, acc: 1, sp: 1.2, why: 'побережья умеренного севера, смолы хвойных лесов, вымытые морем',
      s: (c, i) => (c.ld[i] < 7 * c.sc ? 1 : 0) * bump(0.18, 0.5, c.temp[i]) * (c.biome[i] === 3 || c.biome[i] === 4 || c.biome[i] === 2 ? 1 : 0.3) * c.low[i] },
    { id: 'incense', cat: 'luxury', label: 'Благовония и смолы', rank: 2, d: 0.5, acc: 1, sp: 1.2, why: 'жаркие сухие нагорья и саванны',
      s: (c, i) => smooth(0.62, 0.78, c.temp[i]) * bump(0.12, 0.5, c.moist[i]) * (c.biome[i] === 7 || c.biome[i] === 6 ? 1 : 0.2) },
    { id: 'ivory', cat: 'luxury', label: 'Слоновая кость', rank: 3, d: 0.4, acc: 2, sp: 1.2, why: 'саванны с крупной фауной',
      s: (c, i) => (c.biome[i] === 7 ? 1 : 0) * smooth(0.6, 0.72, c.temp[i]) },
    { id: 'dyes', cat: 'luxury', label: 'Красители (индиго, пурпур)', rank: 2, d: 0.5, acc: 1, sp: 1.2, why: 'тёплые побережья и влажные тропики',
      s: (c, i) => smooth(0.6, 0.75, c.temp[i]) * ((c.ld[i] < 8 * c.sc ? 1 : 0.35)) * (c.biome[i] === 6 ? 0.4 : 1) * smooth(0.25, 0.45, c.moist[i]) },
    // ---- морские промыслы (прибрежные клетки суши, привязаны к шельфу и течениям) ----
    { id: 'fish', cat: 'sea', label: 'Рыбные банки', rank: 1, d: 0.6, acc: 1, sp: 1.1, why: 'широкий шельф; холодные течения поднимают питательные воды',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * Math.max(c.shelf[i], c.cold[i]) * (0.5 + 0.5 * smooth(0.1, 0.45, c.temp[i])) },
    { id: 'whales', cat: 'sea', label: 'Китобойные и тюленьи промыслы', rank: 2, d: 0.5, acc: 2, sp: 1.1, why: 'холодные полярные и субполярные воды',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * (1 - smooth(0.25, 0.42, c.temp[i])) * (0.4 + 0.6 * Math.max(c.shelf[i], c.cold[i])) },
    { id: 'pearls', cat: 'sea', label: 'Жемчуг', rank: 3, d: 0.5, acc: 2, sp: 1.1, why: 'тёплые мелководные лагуны',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * smooth(0.64, 0.78, c.temp[i]) * c.shelf[i] },
    { id: 'coral', cat: 'sea', label: 'Кораллы и губки', rank: 2, d: 0.5, acc: 2, sp: 1.1, why: 'тёплые прозрачные мелководья тропиков',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * smooth(0.68, 0.82, c.temp[i]) * (0.4 + 0.6 * c.shelf[i]) * (c.cold[i] > 0.3 ? 0.3 : 1) },
    // ---- фэнтези ----
    { id: 'mithril', cat: 'special', label: 'Мифрил', rank: 3, d: 0.28, acc: 4, why: 'древние сердцевины горных цепей, глубже всех рудных жил',
      s: (c, i) => smooth(0.55, 1, c.young[i] + 0.8 * c.old[i]) * smooth(0.55, 0.85, c.h[i]) },
    { id: 'adamant', cat: 'special', label: 'Адамант', rank: 3, d: 0.3, acc: 4, why: 'корни вулканов — там, где магма поднимает вещество из глубин',
      s: (c, i) => smooth(0.3, 0.75, c.volc[i]) * smooth(0.2, 0.5, c.belt[i] + 0.3), vol: true },
    { id: 'mana', cat: 'special', label: 'Кристаллы маны', rank: 3, d: 0.38, acc: 3, why: 'линии сдвига и столкновения плит — «разломы силы»',
      s: (c, i) => Math.max(smooth(0.5, 1, c.young[i]) * 0.7, c.volc[i] * 0.8) * smooth(0.2, 0.4, c.h[i]) },
    { id: 'springs', cat: 'special', label: 'Целебные источники', rank: 2, d: 0.4, acc: 1, why: 'родники у подножий гор, питающие реки',
      s: (c, i) => (c.riv[i] ? 1 : 0.2) * smooth(0.25, 0.55, c.belt[i]) * bump(0.2, 0.6, c.h[i]) },
    { id: 'silverwood', cat: 'special', label: 'Серебряный лес', rank: 3, d: 0.4, acc: 1, sp: 1.3, why: 'древние влажные леса умеренного пояса',
      s: (c, i) => (c.biome[i] === 4 ? 1 : 0) * smooth(0.55, 0.75, c.moist[i]) * bump(0.4, 0.7, c.temp[i]) },
    { id: 'dragonbone', cat: 'special', label: 'Кость драконов', rank: 3, d: 0.4, acc: 2, why: 'долины огнедышащих гор — места древних гнездовий',
      s: (c, i) => smooth(0.45, 0.85, c.volc[i]), vol: true },
    { id: 'starfall', cat: 'special', label: 'Падучее железо', rank: 3, d: 0.15, acc: 2, why: 'упавшие звёзды — места падений не зависят от геологии',
      s: (c, i) => (c.biome[i] === 1 ? 0.2 : 1) * smooth(0.05, 0.2, c.h[i]) },
    // ================= расширение каталога (0.57.0): виды по законам природы =================
    // ---- металлы ----
    { id: 'mercury', cat: 'metal', label: 'Ртуть (киноварь)', rank: 3, d: 0.3, acc: 3, why: 'гидротермальные жилы вулканических поясов и горячих источников',
      s: (c, i) => Math.min(1, 0.9 * c.volc[i] + 0.35 * smooth(0.4, 1, c.young[i])) * smooth(0.2, 0.4, c.h[i]) },
    { id: 'nickel', cat: 'metal', label: 'Никель', rank: 2, d: 0.45, acc: 3, why: 'древние щиты и ультраосновные массивы',
      s: (c, i) => smooth(0.3, 0.6, c.old[i]) * smooth(0.22, 0.45, c.h[i]) },
    { id: 'cobalt', cat: 'metal', label: 'Кобальт', rank: 3, d: 0.4, acc: 3, why: 'медно-никелевые зоны на краях древних щитов (синий пигмент и сплавы)',
      s: (c, i) => smooth(0.35, 0.6, c.old[i]) * bump(0.3, 0.8, c.h[i]) * (0.5 + 0.5 * smooth(0.1, 0.4, c.belt[i])) },
    { id: 'platinum', cat: 'metal', label: 'Платина', rank: 3, d: 0.35, acc: 2, why: 'россыпи в реках, размывающих древние ультраосновные массивы',
      s: (c, i) => smooth(0.4, 0.7, c.old[i]) * (c.riv[i] ? 1 : 0.15) * (c.h[i] < 0.5 ? 1 : 0.3), a: (c, i) => (c.riv[i] ? -1 : 0) },
    { id: 'ironsand', cat: 'metal', label: 'Железистые пески', rank: 1, d: 0.4, acc: 1, why: 'чёрные пляжи у вулканов и размываемых древних щитов',
      s: (c, i) => (c.ld[i] < 4 * c.sc ? 1 : 0) * Math.max(c.volc[i], 0.6 * c.old[i]) * c.low[i] },
    // ---- камень и минералы ----
    { id: 'gypsum', cat: 'stone', label: 'Гипс и алебастр', rank: 1, d: 0.4, acc: 1, why: 'испарившиеся мелководные бассейны сухих низин',
      s: (c, i) => c.dry[i] * c.low[i] * smooth(0.1, 0.5, c.f.basin[i]) },
    { id: 'chalk', cat: 'stone', label: 'Мел', rank: 1, d: 0.45, acc: 1, why: 'осадки тёплых мелководных морей, ныне прибрежные равнины',
      s: (c, i) => c.f.lime[i] * (c.h[i] < 0.35 ? 1 : 0.5) * bump(0.3, 0.75, c.temp[i]) },
    { id: 'flint', cat: 'stone', label: 'Кремень', rank: 1, d: 0.4, acc: 1, why: 'желваки в меловых и известняковых толщах',
      s: (c, i) => c.f.lime[i] * 0.9 * (1 - smooth(0.3, 0.6, c.belt[i])) * bump(0.3, 0.7, c.temp[i]) },
    { id: 'basalt', cat: 'stone', label: 'Базальт', rank: 1, d: 0.6, acc: 1, why: 'застывшие излияния лав вулканических плато', vol: true,
      s: (c, i) => smooth(0.25, 0.7, c.volc[i]) * 0.9 },
    { id: 'quartz', cat: 'stone', label: 'Кварц и горный хрусталь', rank: 2, d: 0.38, acc: 2, why: 'жилы и пегматиты в горных поясах и щитах',
      s: (c, i) => bump(0.15, 0.8, c.belt[i]) * smooth(0.3, 0.55, c.h[i]) * (0.4 + 0.6 * Math.max(c.old[i], c.young[i])) },
    { id: 'kaolin', cat: 'stone', label: 'Каолин (белая глина)', rank: 2, d: 0.35, acc: 1, why: 'выветренные граниты тёплого влажного климата',
      s: (c, i) => smooth(0.45, 0.7, c.temp[i]) * smooth(0.4, 0.65, c.moist[i]) * c.low[i] * smooth(0.25, 0.5, c.old[i] + 0.2) },
    { id: 'jade', cat: 'stone', label: 'Нефрит', rank: 3, d: 0.4, acc: 2, why: 'серпентинитовые зоны молодых горных поясов, речная галька',
      s: (c, i) => smooth(0.4, 1, c.young[i]) * bump(0.3, 0.9, c.h[i]) * 0.8, a: (c, i) => (c.riv[i] ? -1 : 0) },
    { id: 'saltpeter', cat: 'stone', label: 'Селитра', rank: 2, d: 0.35, acc: 1, why: 'сухие пещеры и гуано в жарких пустынях',
      s: (c, i) => c.dry[i] * smooth(0.5, 0.7, c.temp[i]) * (c.ld[i] < 20 * c.sc ? 1 : 0.5) },
    { id: 'alum', cat: 'stone', label: 'Квасцы', rank: 2, d: 0.55, acc: 2, why: 'гидротермально изменённые породы вулканических склонов', vol: true,
      s: (c, i) => smooth(0.3, 0.75, c.volc[i]) * 0.8 },
    { id: 'pumice', cat: 'stone', label: 'Пемза', rank: 1, d: 0.55, acc: 1, why: 'вулканические пеплопады и плавающая пемза у побережий', vol: true,
      s: (c, i) => smooth(0.35, 0.8, c.volc[i]) * (c.ld[i] < 30 * c.sc ? 1 : 0.6) },
    { id: 'ochre', cat: 'stone', label: 'Охра и пигменты', rank: 1, d: 0.45, acc: 1, why: 'железистые коры выветривания тёплых саванн и равнин',
      s: (c, i) => smooth(0.55, 0.75, c.temp[i]) * bump(0.2, 0.55, c.moist[i]) * (1 - smooth(0.35, 0.55, c.h[i])) },
    { id: 'glasssand', cat: 'stone', label: 'Стекольный песок', rank: 1, d: 0.45, acc: 1, why: 'кварцевые пляжи и дюны',
      s: (c, i) => Math.max(c.dry[i] * c.low[i] * 0.8, c.ld[i] < 4 * c.sc ? 0.8 : 0) * (c.biome[i] === 9 ? 0.2 : 1) },
    // ---- топливо ----
    { id: 'lignite', cat: 'fuel', label: 'Бурый уголь', rank: 1, d: 0.5, acc: 2, why: 'молодые торфяные бассейны умеренных низин',
      s: (c, i) => c.low[i] * smooth(0.4, 0.7, c.moist[i]) * bump(0.15, 0.6, c.temp[i]) * c.f.basin[i] * (1 - smooth(0.5, 0.8, c.belt[i])) },
    { id: 'gas', cat: 'fuel', label: 'Природный газ («вечные огни»)', rank: 2, d: 0.25, acc: 3, why: 'нефтеносные бассейны и болотные низины',
      s: (c, i) => Math.max(c.low[i] * c.f.basin[i] * (1 - smooth(0.3, 0.6, c.belt[i])) * smooth(0.3, 0.5, c.temp[i]) * (c.ld[i] < 40 * c.sc ? 1 : 0.4) * smooth(0.5, 0.2, c.moist[i]), c.biome[i] === 9 ? 0.35 : 0) },
    { id: 'oilshale', cat: 'fuel', label: 'Горючий сланец', rank: 1, d: 0.35, acc: 2, why: 'осадочные бассейны с древним органическим илом',
      s: (c, i) => c.low[i] * c.f.basin[i] * bump(0.2, 0.6, c.temp[i]) * (0.6 + 0.4 * smooth(0.2, 0.5, c.belt[i])) },
    { id: 'asphalt', cat: 'fuel', label: 'Асфальтовые озёра', rank: 2, d: 0.3, acc: 1, why: 'выходы нефти на поверхность в жарких сухих котловинах',
      s: (c, i) => c.low[i] * smooth(0.4, 0.7, c.temp[i]) * (1 - smooth(0.3, 0.5, c.moist[i])) * c.f.basin[i] * (c.ld[i] < 50 * c.sc ? 1 : 0.3) },
    // ---- древесина ----
    { id: 'cedar', cat: 'timber', label: 'Кедр и кипарис', rank: 2, d: 0.4, acc: 1, sp: 1.3, ok: [3, 4, 5, 10], why: 'тёплые горные леса умеренной влажности',
      s: (c, i) => bump(0.4, 0.75, c.temp[i]) * bump(0.22, 0.6, c.moist[i]) * bump(0.25, 0.75, c.h[i]) },
    { id: 'yew', cat: 'timber', label: 'Тис (луки)', rank: 2, d: 0.32, acc: 1, sp: 1.3, ok: [4], why: 'влажные широколиственные леса умеренного пояса',
      s: (c, i) => bump(0.3, 0.6, c.temp[i]) * smooth(0.5, 0.7, c.moist[i]) },
    { id: 'cork', cat: 'timber', label: 'Пробковый дуб', rank: 2, d: 0.3, acc: 1, sp: 1.3, ok: [4, 5, 7], why: 'тёплые сухие леса средиземноморского типа у побережий',
      s: (c, i) => bump(0.5, 0.72, c.temp[i]) * bump(0.25, 0.48, c.moist[i]) * (c.ld[i] < 35 * c.sc ? 1 : 0.4) },
    { id: 'rubber', cat: 'timber', label: 'Каучук и смоляные деревья', rank: 3, d: 0.35, acc: 1, sp: 1.3, ok: [8], why: 'жаркие влажные тропические леса',
      s: (c, i) => smooth(0.72, 0.85, c.temp[i]) },
    { id: 'mangrove', cat: 'timber', label: 'Мангровые заросли', rank: 1, d: 0.45, acc: 1, sp: 1.3, why: 'тёплые илистые побережья',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * smooth(0.68, 0.8, c.temp[i]) * smooth(0.45, 0.65, c.moist[i]) * c.low[i] },
    { id: 'birch', cat: 'timber', label: 'Берёза и береста', rank: 1, d: 0.4, acc: 1, sp: 1.3, ok: [2, 3, 4], why: 'холодные леса и лесотундра',
      s: (c, i) => (c.biome[i] === 3 ? 1 : c.biome[i] === 4 && c.temp[i] < 0.45 ? 0.6 : 0.3) },
    { id: 'willow', cat: 'timber', label: 'Ива и лоза', rank: 1, d: 0.45, acc: 1, sp: 1.3, why: 'речные поймы умеренного пояса',
      s: (c, i) => (c.riv[i] ? 1 : 0) * bump(0.3, 0.7, c.temp[i]) * c.low[i] * (c.biome[i] === 6 ? 0 : 1) },
    // ---- земледелие и скот ----
    { id: 'grain', cat: 'agri', label: 'Зерно (пшеница, ячмень)', rank: 1, d: 0.7, acc: 1, sp: 1.2, ok: [4, 5, 7], why: 'плодородные равнины умеренного пояса с достаточной влагой',
      s: (c, i) => band(0.2, 0.78, c.temp[i]) * band(0.2, 0.7, c.moist[i]) * c.low[i] },
    { id: 'rice', cat: 'agri', label: 'Рис', rank: 2, d: 0.5, acc: 1, sp: 1.2, ok: [4, 5, 7, 8, 9], why: 'тёплые затопляемые низины и речные дельты',
      s: (c, i) => smooth(0.55, 0.7, c.temp[i]) * smooth(0.45, 0.62, c.moist[i]) * c.low[i] * (c.riv[i] ? 1 : 0.5) },
    { id: 'millet', cat: 'agri', label: 'Просо и сорго', rank: 1, d: 0.45, acc: 1, sp: 1.2, ok: [5, 7], why: 'тёплые полусухие равнины и саванны',
      s: (c, i) => band(0.5, 0.9, c.temp[i]) * band(0.15, 0.55, c.moist[i]) * c.low[i] },
    { id: 'horses', cat: 'agri', label: 'Кони', rank: 2, d: 0.45, acc: 1, sp: 1.2, ok: [5, 7], why: 'степи и луговые равнины с кормом круглый год',
      s: (c, i) => (c.biome[i] === 5 ? 1 : 0.7) * band(0.25, 0.8, c.temp[i]) * band(0.15, 0.55, c.moist[i]) * (1 - smooth(0.4, 0.6, c.h[i])) },
    { id: 'cattle', cat: 'agri', label: 'Крупный скот', rank: 1, d: 0.55, acc: 1, sp: 1.2, ok: [4, 5, 7], why: 'травянистые низины с достаточной влагой',
      s: (c, i) => band(0.2, 0.82, c.temp[i]) * band(0.3, 0.8, c.moist[i]) * c.low[i] },
    { id: 'sheep', cat: 'agri', label: 'Овцы и шерсть', rank: 1, d: 0.5, acc: 1, sp: 1.2, ok: [2, 4, 5, 10], why: 'прохладные нагорья и холмы с лугами',
      s: (c, i) => band(0.15, 0.75, c.temp[i]) * band(0.15, 0.65, c.moist[i]) * band(0.12, 0.75, c.h[i]) },
    { id: 'camels', cat: 'agri', label: 'Верблюды', rank: 2, d: 0.4, acc: 1, sp: 1.2, ok: [6, 7], why: 'жаркие пустыни и сухие саванны',
      s: (c, i) => (c.biome[i] === 6 ? 1 : 0.4) * smooth(0.5, 0.7, c.temp[i]) },
    { id: 'reindeer', cat: 'agri', label: 'Северные олени', rank: 1, d: 0.4, acc: 1, sp: 1.2, ok: [2, 3], why: 'тундра и лесотундра',
      s: (c, i) => (c.biome[i] === 2 ? 1 : 0.6) },
    { id: 'flax', cat: 'agri', label: 'Лён и конопля', rank: 1, d: 0.45, acc: 1, sp: 1.2, ok: [3, 4, 5], why: 'прохладные влажные равнины',
      s: (c, i) => band(0.2, 0.65, c.temp[i]) * band(0.35, 0.85, c.moist[i]) * c.low[i] },
    { id: 'cotton', cat: 'agri', label: 'Хлопок', rank: 2, d: 0.4, acc: 1, sp: 1.2, ok: [5, 7, 8], why: 'жаркие речные долины с орошением',
      s: (c, i) => smooth(0.58, 0.72, c.temp[i]) * band(0.2, 0.65, c.moist[i]) * c.low[i] * (c.riv[i] ? 1 : 0.5) },
    { id: 'olives', cat: 'agri', label: 'Оливы и инжир', rank: 2, d: 0.5, acc: 1, sp: 1.2, ok: [4, 5, 7], why: 'сухое жаркое лето и мягкая зима у тёплых морей',
      s: (c, i) => band(0.45, 0.78, c.temp[i]) * band(0.22, 0.55, c.moist[i]) * (c.ld[i] < 45 * c.sc ? 1 : 0.4) * band(0.08, 0.55, c.h[i]) },
    { id: 'dates', cat: 'agri', label: 'Финиковые пальмы (оазисы)', rank: 2, d: 0.5, acc: 1, sp: 1.2, ok: [6, 7], why: 'оазисы и речные долины в жарких пустынях',
      s: (c, i) => c.dry[i] * smooth(0.65, 0.8, c.temp[i]) * (c.riv[i] ? 1 : 0.35) },
    // ---- роскошь (добавки) ----
    { id: 'tea', cat: 'luxury', label: 'Чай', rank: 3, d: 0.4, acc: 1, sp: 1.2, ok: [4, 5, 8], why: 'тёплые влажные склоны предгорий',
      s: (c, i) => bump(0.5, 0.75, c.temp[i]) * smooth(0.55, 0.7, c.moist[i]) * bump(0.22, 0.65, c.h[i]) },
    { id: 'coffee', cat: 'luxury', label: 'Кофе', rank: 3, d: 0.35, acc: 1, sp: 1.2, ok: [4, 7, 8], why: 'тропические нагорья с влажным климатом',
      s: (c, i) => bump(0.65, 0.88, c.temp[i]) * smooth(0.5, 0.65, c.moist[i]) * bump(0.25, 0.7, c.h[i]) },
    { id: 'cacao', cat: 'luxury', label: 'Какао', rank: 3, d: 0.35, acc: 1, sp: 1.2, ok: [8], why: 'жаркий влажный экваториальный пояс',
      s: (c, i) => smooth(0.78, 0.88, c.temp[i]) * smooth(0.62, 0.75, c.moist[i]) * c.low[i] },
    { id: 'sugar', cat: 'luxury', label: 'Сахарный тростник', rank: 2, d: 0.4, acc: 1, sp: 1.2, ok: [5, 7, 8, 9], why: 'жаркие влажные низины вдоль рек',
      s: (c, i) => smooth(0.68, 0.8, c.temp[i]) * smooth(0.45, 0.62, c.moist[i]) * c.low[i] * (c.riv[i] ? 1 : 0.5) },
    { id: 'saffron', cat: 'luxury', label: 'Шафран', rank: 3, d: 0.45, acc: 1, sp: 1.2, ok: [5, 7], why: 'сухие нагорья с жарким летом и холодной зимой',
      s: (c, i) => band(0.4, 0.75, c.temp[i]) * band(0.1, 0.45, c.moist[i]) * band(0.15, 0.65, c.h[i]) },
    { id: 'honey', cat: 'luxury', label: 'Мёд и воск', rank: 1, d: 0.45, acc: 1, sp: 1.2, ok: [3, 4, 5, 7], why: 'цветущие леса и луга',
      s: (c, i) => bump(0.3, 0.75, c.temp[i]) * smooth(0.35, 0.55, c.moist[i]) },
    { id: 'lapis', cat: 'luxury', label: 'Лазурит', rank: 3, d: 0.45, acc: 3, sp: 1.2, why: 'метаморфизованные известняки сухих высокогорий',
      s: (c, i) => bump(0.2, 0.9, c.belt[i]) * smooth(0.3, 0.55, c.h[i]) * (0.4 + 0.6 * c.dry[i]) * (c.old[i] + c.young[i] > 0.5 ? 1 : 0.5) },
    // ---- морские промыслы (добавки) ----
    { id: 'oysters', cat: 'sea', label: 'Устрицы и моллюски', rank: 1, d: 0.5, acc: 1, sp: 1.1, why: 'мелководья умеренных и тёплых морей',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * c.shelf[i] * bump(0.25, 0.7, c.temp[i]) },
    { id: 'kelp', cat: 'sea', label: 'Ламинария и водоросли', rank: 1, d: 0.5, acc: 1, sp: 1.1, why: 'прохладные мелководья и холодные течения',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * Math.max(c.cold[i], 0.5 * c.shelf[i]) * (c.temp[i] < 0.6 ? 1 : 0.4) },
    { id: 'walrus', cat: 'sea', label: 'Моржовый клык и ластоногие', rank: 2, d: 0.4, acc: 2, sp: 1.1, why: 'кромка льдов арктических побережий',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * (1 - smooth(0.15, 0.28, c.temp[i])) * (0.5 + 0.5 * c.shelf[i]) },
    { id: 'ambergris', cat: 'sea', label: 'Амбра', rank: 3, d: 0.15, acc: 1, sp: 1.1, why: 'выбросы кашалотов на тёплых и умеренных берегах (редкая находка)',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * bump(0.3, 0.8, c.temp[i]) },
    { id: 'caviar', cat: 'sea', label: 'Осётр и икра', rank: 2, d: 0.45, acc: 1, sp: 1.1, why: 'устья крупных рек прохладных морей',
      s: (c, i) => (c.ld[i] < 4 * c.sc ? 1 : 0) * (c.riv[i] ? 1 : 0) * bump(0.25, 0.6, c.temp[i]) },
    { id: 'turtles', cat: 'sea', label: 'Черепаховый панцирь', rank: 2, d: 0.35, acc: 1, sp: 1.1, why: 'тёплые тропические лагуны и пляжи',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * smooth(0.66, 0.8, c.temp[i]) * (0.4 + 0.6 * c.shelf[i]) },
    // ---- фэнтези (добавки; по умолчанию вся категория выключена) ----
    { id: 'aether', cat: 'special', label: 'Эфирные кристаллы', rank: 3, d: 0.3, acc: 4, why: 'вершины высочайших хребтов — ближе всего к небесной сфере',
      s: (c, i) => smooth(0.78, 0.95, c.h[i]) * 0.9 },
    { id: 'sunstone', cat: 'special', label: 'Солнечный камень', rank: 3, d: 0.3, acc: 2, ok: [6, 7], why: 'раскалённые пустыни, где песок спекается в самоцветное стекло',
      s: (c, i) => smooth(0.7, 0.85, c.temp[i]) * c.dry[i] },
    { id: 'frostiron', cat: 'special', label: 'Холодное железо', rank: 3, d: 0.3, acc: 3, why: 'вечная мерзлота и ледниковые нагорья',
      s: (c, i) => (1 - smooth(0.12, 0.3, c.temp[i])) * smooth(0.25, 0.55, c.h[i]) },
    { id: 'stormglass', cat: 'special', label: 'Штормовое стекло', rank: 2, d: 0.35, acc: 1, sp: 1.1, why: 'холодные штормовые берега, где молнии плавят песок',
      s: (c, i) => (c.ld[i] < 3 * c.sc ? 1 : 0) * Math.max(c.cold[i], 0.4) * (c.temp[i] < 0.55 ? 1 : 0.3) },
    { id: 'phoenixash', cat: 'special', label: 'Пепел феникса', rank: 3, d: 0.3, acc: 2, vol: true, why: 'кратеры действующих вулканов',
      s: (c, i) => smooth(0.6, 1, c.volc[i]) },
    { id: 'dreamlotus', cat: 'special', label: 'Лотос грёз', rank: 3, d: 0.35, acc: 1, sp: 1.2, ok: [9], why: 'тёплые туманные топи',
      s: (c, i) => smooth(0.55, 0.75, c.temp[i]) }
  ];
  FM.RES_KINDS = {}; for (const k of KINDS) FM.RES_KINDS[k.id] = k;
  FM.RES_KIND_LIST = KINDS;

  // ---------- размещение ----------
  FM.getResources = function (map, seed, cfgIn) {
    const cfg = FM.normResCfg(cfgIn), key = seed + '|' + JSON.stringify(cfg);
    if (map._res && map._res.key === key) return map._res;
    const { W, H, h } = map, N = W * H, sc = W / 480, F = fieldsOf(map), nz = makeNoise(mulberry32(hashString(seed + '|resn')));
    // поля пригодности (известняк — осадочные равнины тёплых морей; бассейн — впадины, где копились осадки)
    const hb = Float32Array.from(h); FM.blur(hb, W, H, 7);
    const lime = new Float32Array(N), basin = new Float32Array(N), low = new Float32Array(N), dry = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (h[i] <= 0) continue;
      low[i] = 1 - smooth(0.22, 0.55, h[i]); dry[i] = smooth(0.38, 0.12, map.moist[i]) * smooth(0.45, 0.6, map.temp[i] * 0.7 + 0.3);
      lime[i] = low[i] * bump(0.28, 0.85, map.moist[i]) * smooth(0.3, 0.5, map.temp[i]) * (F.ld[i] < 45 * sc ? 1 : 0.5) * (1 - smooth(0.3, 0.6, F.nv.belt[i]) * 0.6);
      basin[i] = clamp((hb[i] - h[i]) / 0.08 + 0.5, 0, 1) * 0.5 + 0.5 * low[i];
    }
    const c = { h, moist: map.moist, temp: map.temp, biome: map.biome, young: map.young, old: map.old, belt: F.nv.belt, slope: F.nv.slope, ld: F.ld, volc: F.volc, riv: F.riv, shelf: F.shelf, cold: F.cold, low, dry, sc, f: { lime, basin } };
    const deposits = [], perKind = {};
    for (const k of KINDS) {
      if (!cfg.on[k.cat] || cfg.off[k.id]) continue;
      const r = mulberry32(hashString(seed + '|res|' + k.id)), amtMul = cfg.amt[k.cat], sp = Math.max(4, Math.round(9 * sc * (k.sp || 1)));
      let n = 0;
      for (let y = sp; y < H - sp; y += sp) for (let x = sp; x < W - sp; x += sp) {
        const px = x + (r() - 0.5) * sp, py = y + (r() - 0.5) * sp, pr = r(), am = r(), ar = r(), i = Math.round(py) * W + Math.round(px);
        if (h[i] <= 0.03) continue;
        if (k.ok && !k.ok.includes(c.biome[i])) continue;                                   // жёсткое экологическое ограничение вида (культуры, породы деревьев)
        const suit = k.s(c, i, px, py); if (!(suit > 0.04)) continue;
        const prov = 0.55 + 0.9 * (0.5 + 0.5 * nz(px * 0.025 + KINDS.indexOf(k) * 31, py * 0.025));          // «провинции»: месторождения собираются в районы
        if (pr > Math.min(0.92, k.d * suit * prov * amtMul)) continue;
        let acc = k.acc + (k.a ? k.a(c, i) : 0) + (h[i] > 0.85 ? 1 : 0) + (ar > 0.8 ? 1 : ar < 0.12 ? -1 : 0);   // рельеф и случайная глубина залегания
        acc = clamp(Math.round(acc), 1, 4);
        deposits.push({ t: k.cat, k: k.id, x: px, y: py, amt: +(0.4 + 1.6 * Math.pow(am, 0.8) * (0.6 + 0.4 * suit)).toFixed(2), acc, volcanic: !!k.vol });
        n++;
      }
      perKind[k.id] = n;
    }
    // поля влияния для расстановки городов — по категориям
    const fields = {};
    for (const cat of FM.RES_CATS) {
      const f = new Float32Array(N); fields[cat] = f; const rad = Math.ceil(8 * sc);
      for (const d of deposits) if (d.t === cat) {
        for (let y = Math.max(0, Math.floor(d.y) - rad); y <= Math.min(H - 1, Math.floor(d.y) + rad); y++)
          for (let x = Math.max(0, Math.floor(d.x) - rad); x <= Math.min(W - 1, Math.floor(d.x) + rad); x++) {
            const v = Math.exp(-((x - d.x) ** 2 + (y - d.y) ** 2) / (18 * sc * sc)) * (0.5 + 0.25 * (5 - d.acc) / 4 + 0.25 * Math.min(1, d.amt / 1.5));
            if (v > f[y * W + x]) f[y * W + x] = v;
          }
      }
    }
    return (map._res = { key, cfg, deposits, fields, perKind });
  };

  // ---------- профиль государства и согласование статуса с ресурсами ----------
  // вес категории = Σ богатство·ценность(ранг)·множитель доступности (поверхностные — полный вес, сверхглубокие — малый)
  const ACCW = [0, 1, 0.8, 0.5, 0.25], RANKW = [0, 0.7, 1, 1.5];
  FM.stateResources = function (map, pol, seed, cfg) {
    const R = FM.getResources(map, seed, cfg), W = map.W, out = new Map();
    for (const s of pol.states) out.set(s.id, { cats: {}, kinds: {}, n: 0, acc: [0, 0, 0, 0, 0] });
    for (const d of R.deposits) {
      const o = pol.owner[Math.round(d.y) * W + Math.round(d.x)], p = out.get(o); if (!p) continue;
      const kd = FM.RES_KINDS[d.k], w = d.amt * RANKW[kd ? kd.rank : 1] * ACCW[d.acc];
      p.cats[d.t] = (p.cats[d.t] || 0) + w; p.kinds[d.k] = (p.kinds[d.k] || 0) + 1; p.n++; p.acc[d.acc]++;
    }
    const enabledCore = FM.RES_CATS.filter(k => FM.RESOURCES[k].core && R.cfg.on[k]);
    const total = new Float64Array(1); void total;
    for (const p of out.values()) {
      p.div = enabledCore.filter(k => (p.cats[k] || 0) >= 0.9).length;                      // сколько базовых категорий представлено ощутимо
      p.wealth = enabledCore.reduce((a, k) => a + Math.min(3, p.cats[k] || 0), 0);
    }
    return { by: out, enabledCore, cfg: R.cfg };
  };
  // Что нужно государству данного статуса. need — число базовых категорий, must — обязательные (если категория включена), any — достаточно одной из.
  FM.STATE_NEEDS = {
    empire: { need: 5, must: ['metal'], any: [['timber', 'stone'], ['agri', 'sea']], wealth: 7 },
    kingdom: { need: 3, any: [['metal', 'stone', 'fuel'], ['agri', 'sea', 'timber']] },
    republic: { need: 2, any: [['sea', 'luxury', 'agri']] },
    clans: { need: 1, any: [['metal', 'stone', 'fuel', 'agri']] },
    tribes: { need: 1, any: [['timber', 'sea', 'luxury', 'agri']] },
    nomads: { need: 0 }
  };
  function fits(type, p, enabledCore) {
    const n = FM.STATE_NEEDS[type]; if (!n) return true;
    const need = Math.min(n.need, enabledCore.length), on = (k) => enabledCore.includes(k);
    if (p.div < need) return false;
    if (n.wealth && p.wealth < Math.min(n.wealth, 1.4 * enabledCore.length)) return false;
    for (const k of (n.must || [])) if (on(k) && !(p.cats[k] >= 0.5)) return false;
    for (const grp of (n.any || [])) { const g = grp.filter(on); if (g.length && !g.some(k => p.cats[k] >= 0.5)) return false; }
    return true;
  }
  FM.stateFits = (type, p, enabledCore) => fits(type, p, enabledCore);
  // Согласует тип каждого государства с его ресурсами: империя без разнообразной базы понижается, богатейшие королевства могут стать империями (не более 1/4 государств).
  // Возвращает true, если что-то изменилось (тогда нужно заново вырастить территории — тип меняет мощь).
  FM.reconcileStatus = function (map, pol, seed, cfg) {
    const prof = FM.stateResources(map, pol, seed, cfg); let changed = false;
    if (!prof.enabledCore.length) return false;
    const order = ['empire', 'kingdom', 'republic', 'clans', 'tribes', 'nomads'];
    for (const s of pol.states) {
      const p = prof.by.get(s.id); if (!p) continue;
      if (s.type === 'nomads') continue;                                    // кочевникам оседлая база не нужна
      if (fits(s.type, p, prof.enabledCore)) continue;
      let t = order.slice(order.indexOf(s.type) + 1).find(q => fits(q, p, prof.enabledCore)) || 'nomads';
      if (s.type === 'empire' && !fits('kingdom', p, prof.enabledCore)) t = ['republic', 'clans', 'tribes'].find(q => fits(q, p, prof.enabledCore)) || 'tribes';
      s.type = t; s.culture = (FM.STATE_TYPES[t] || {}).culture || s.culture; changed = true;
    }
    const maxEmp = Math.max(0, Math.floor(pol.states.length / 4)), emp = pol.states.filter(s => s.type === 'empire').length;
    if (emp < maxEmp) {
      const cand = pol.states.filter(s => (s.type === 'kingdom' || s.type === 'republic') && fits('empire', prof.by.get(s.id) || { div: 0, cats: {}, wealth: 0 }, prof.enabledCore)).sort((a, b) => prof.by.get(b.id).wealth - prof.by.get(a.id).wealth);
      for (let i = 0; i < Math.min(maxEmp - emp, cand.length); i++) { cand[i].type = 'empire'; cand[i].culture = FM.STATE_TYPES.empire.culture; changed = true; }
    }
    return changed;
  };
})(window.FM);
