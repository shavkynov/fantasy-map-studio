// Моря и океаны: названия, полярные льды, морские пути между портами
(function (FM) {
  const { mulberry32, hashString, makeNoise, fbm, clamp } = FM;

  // ---------- полярные льды: океан холоднее порога -> паковый лёд с рваным краем ----------
  FM.polarIce = function (map) {
    if (map._ice) return map._ice;
    const { W, H, h, temp } = map, N = W * H, ice = new Uint8Array(N), nz = makeNoise(mulberry32(hashString(map.seed + '|ice'))), f = 1 / (W * 0.05);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (h[i] > 0) continue;
      if (temp[i] < 0.2 + 0.08 * fbm(nz, x * f, y * f, 3)) ice[i] = 1;
    }
    return (map._ice = ice);
  };

  // ---------- бассейны: океаны, моря, заливы ----------
  const NAME_SYL = { ru: { ocean: 'Океан', sea: 'Море', gulf: 'Залив', strait: 'Пролив' }, en: {} };
  function seaName(rand, kind, used) {
    const races = ['human', 'elf', 'dwarf'], race = races[Math.floor(rand() * 3)];
    let base = FM.cityName(rand, used, race);
    if (FM.uiLang === 'ru') return { ocean: 'Океан ', sea: 'Море ', gulf: 'Залив ' }[kind] + base;
    return { ocean: base + ' Ocean', sea: 'Sea of ' + base, gulf: 'Gulf of ' + base }[kind];
  }
  FM.seaBasins = function (map) {
    const key = map.seed + '|' + FM.uiLang;
    if (map._seas && map._seas.key === key) return map._seas.list;
    const { W, H, h, dist } = map, N = W * H, sc = W / 480, ice = FM.polarIce(map);
    const water = i => h[i] <= 0 && !ice[i];
    const d = new Float32Array(N); for (let i = 0; i < N; i++) d[i] = water(i) ? dist[i] : 0;
    // центры: локальные максимумы расстояния до берега, разнесённые минимум на R
    const R = 60 * sc, cand = []; for (let i = 0; i < N; i++) if (d[i] >= 3 * sc) cand.push(i);
    cand.sort((a, b) => d[b] - d[a]);
    const seeds = [];
    for (const i of cand) {
      const x = i % W, y = (i / W) | 0, rr = R * clamp(d[i] / (14 * sc), 0.5, 1.2);
      if (seeds.every(s => Math.hypot(s.x - x, s.y - y) >= rr)) seeds.push({ x, y, i });
      if (seeds.length > 40) break;
    }
    // разрастание бассейнов (Дейкстра по воде)
    const own = new Int16Array(N).fill(-1), g = new Float32Array(N).fill(Infinity), heap = new FM.Heap(4096);
    seeds.forEach((s, k) => { own[s.i] = k; g[s.i] = 0; heap.push(0, s.i); });
    while (heap.n) {
      const c = heap.pop(), cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx; if (!water(n)) continue;
        const ng = g[c] + 1 + 3 / (1 + d[n] * 0.5); if (ng < g[n]) { g[n] = ng; own[n] = own[c]; heap.push(ng, n); }
      }
    }
    const st = seeds.map(() => ({ n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, mx: 0, edge: 0 }));
    for (let i = 0; i < N; i++) { const k = own[i]; if (k < 0) continue; const s = st[k], x = i % W, y = (i / W) | 0; s.n++; s.sx += x; s.sy += y; s.sxx += x * x; s.syy += y * y; s.sxy += x * y; if (d[i] > s.mx) s.mx = d[i]; if (x === 0 || y === 0 || x === W - 1 || y === H - 1) s.edge++; }
    const rand = mulberry32(hashString(map.seed + '|seanames')), used = new Set(), list = [];
    let total = 0; for (let i = 0; i < N; i++) if (water(i)) total++;
    let gmx = 1; for (const q of st) gmx = Math.max(gmx, q.mx);
    let oceans = 0;
    const order = seeds.map((s, k) => k).sort((a, b) => st[b].mx - st[a].mx);
    for (const k of order) {
      const s = st[k], sd = seeds[k]; if (s.n < total * 0.03 || list.length >= 5) continue;
      let kind = s.mx >= 0.55 * gmx ? 'ocean' : s.mx < 0.3 * gmx ? 'gulf' : 'sea';
      if (kind === 'ocean') { if (oceans >= 2 || list.some(q => q.kind === 'ocean' && Math.hypot(q.x - sd.x, q.y - sd.y) < 150 * sc)) continue; oceans++; }
      
      // направление: главная ось, но не круче ~35°
      const mx = s.sx / s.n, my = s.sy / s.n, cxx = s.sxx / s.n - mx * mx, cyy = s.syy / s.n - my * my, cxy = s.sxy / s.n - mx * my;
      let ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy); if (ang > Math.PI / 2) ang -= Math.PI; if (Math.abs(ang) > 0.6) ang = Math.sign(ang) * 0.6;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const ext = dir => { let t = 0; for (; t < 400 * sc; t += 1) { const x = Math.round(sd.x + c * dir * t), y = Math.round(sd.y + sn * dir * t); if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) break; const i = y * W + x; if (!water(i) || d[i] < 1.2) break; } return t; };
      const half = Math.min(ext(1), ext(-1), 0.75 * Math.sqrt(s.n)); if (half < 6 * sc) continue;
      const name = seaName(rand, kind, used); used.add(name);
      list.push({ kind, name, x: sd.x, y: sd.y, ang, half, n: s.n, mx: s.mx, fr: s.n / total });
    }
    map._seas = { key, list };
    return list;
  };

  // ---------- морские пути между портами ----------
  FM.seaRoutes = function (map, pol) {
    const key = pol.version + '|' + map.seed;
    if (pol._sea && pol._sea.key === key) return pol._sea.routes;
    const { W, H, h, dist } = map, N = W * H, ice = FM.polarIce(map);
    const ports = FM.allCities(pol).filter(c => c.type === 'port' || ((c.type === 'capital' || c.type === 'city') && c.rank <= 4));   // порты, а также крупные города и столицы на побережье
    const cost = new Float32Array(N);
    for (let i = 0; i < N; i++) cost[i] = h[i] > 0 || ice[i] ? Infinity : 1 + 6 / (1 + dist[i] * 0.8) + (map.current ? (map.current[i] > 0.3 ? -0.15 : 0) : 0);
    const seaCell = (c, R) => { let best = -1, bd = 1e9; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = Math.round(c.x) + dx, y = Math.round(c.y) + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = y * W + x; if (cost[i] === Infinity) continue; const q = dx * dx + dy * dy; if (q < bd) { bd = q; best = i; } } return best; };
    const nodes = ports.map(c => ({ c, cell: seaCell(c, c.type === 'port' ? 6 : 3) })).filter(n => n.cell >= 0);
    const routes = [], seen = new Set();
    for (const a of nodes) {
      const near = nodes.filter(b => b !== a).map(b => ({ b, d: Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) })).sort((u, v) => u.d - v.d).slice(0, 2);
      for (const { b } of near) {
        const k = Math.min(a.c.id, b.c.id) + '-' + Math.max(a.c.id, b.c.id); if (seen.has(k)) continue; seen.add(k);
        const p = FM.astar(map, cost, a.cell, b.cell, 1, null, 1);
        if (!p || p.length < 4 || p.some((i, j) => cost[i] === Infinity || (j && Math.abs((i % W) - (p[j - 1] % W)) > 1))) continue;
        routes.push({ a: a.c.id, b: b.c.id, pts: p.map(i => [i % W, (i / W) | 0]) });
      }
    }
    pol._sea = { key, routes };
    return routes;
  };
})(window.FM);
