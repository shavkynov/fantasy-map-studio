// Города, ресурсы, культуры и дороги
(function (FM) {
  'use strict';
  const { mulberry32, hashString, makeNoise, fbm, smooth, clamp } = FM;

  // ---------- культуры: профили весов для оценки места под город ----------
  FM.CULTURES = {
    realistic: { label: 'Реалистичная', w: { fert: 1, river: 0.8, coast: 0.5, def: 0.35, res: 0.4, mount: 0, forest: 0, open: 0.2 } },
    highland: { label: 'Горцы', w: { fert: 0.35, river: 0.5, coast: 0.1, def: 1, res: 1.2, mount: 1, forest: 0.1, open: 0 } },
    woodland: { label: 'Лесные', w: { fert: 0.5, river: 0.7, coast: 0.1, def: 0.2, res: 0.3, mount: 0, forest: 1.2, open: 0 } },
    seafarers: { label: 'Мореходы', w: { fert: 0.4, river: 0.5, coast: 1.6, def: 0.3, res: 0.3, mount: 0, forest: 0, open: 0 } },
    steppe: { label: 'Степняки', w: { fert: 0.7, river: 1, coast: 0, def: 0.1, res: 0.1, mount: 0, forest: 0, open: 1 } }
  };

  FM.allCities = function (pol) {
    const out = [];
    for (const s of pol.states) out.push({ key: 's' + s.id, name: s.capName || s.name, x: s.capital.x, y: s.capital.y, type: 'capital', rank: 0, stateId: s.id, capital: true, ref: s });
    for (const c of pol.cities) out.push(Object.assign({ key: 'c' + c.id }, c));
    return out;
  };

  // ---------- поля местности для оценки мест ----------
  function terrainFields(map) {
    if (map._tf) return map._tf;
    const { W, H, h } = map, N = W * H, nv = FM.nav(map);
    const riverNear = new Uint8Array(N), confl = new Uint8Array(N), mouth = new Uint8Array(N);
    const harbor = new Float32Array(N), defense = new Float32Array(N), foothill = new Float32Array(N);
    const forest = new Float32Array(N), plains = new Float32Array(N), fert = new Float32Array(N);
    const hb = Float32Array.from(h); FM.blur(hb, W, H, 6);
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (map.riverMask[i]) {
        let up = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = i + dy * W + dx; if (n !== i && map.riverMask[n] && map.riverDown[n] === i) up++; }
        if (up >= 2) confl[i] = 1;
        const d = map.riverDown[i]; if (d >= 0 && h[d] <= 0) mouth[i] = 1;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) riverNear[i + dy * W + dx] = 1;
      }
    }
    for (let y = 5; y < H - 5; y++) for (let x = 5; x < W - 5; x++) {
      const i = y * W + x; if (h[i] <= 0.03) continue;
      if (h[i - 1] <= 0 || h[i + 1] <= 0 || h[i - W] <= 0 || h[i + W] <= 0) {
        let oc = false;
        for (let dy = -1; dy <= 1 && !oc; dy++) for (let dx = -1; dx <= 1; dx++) { const n = i + dy * W + dx; if (h[n] <= 0 && map.ocean[n]) { oc = true; break; } }
        if (!oc) continue;
        let land = 0, tot = 0;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 16) { tot++; if (h[i + dy * W + dx] > 0) land++; }
        harbor[i] = clamp((land / tot - 0.25) / 0.35, 0, 1);
      }
    }
    for (let i = 0; i < N; i++) {
      if (h[i] <= 0) continue;
      const belt = nv.belt[i];
      defense[i] = clamp((h[i] - hb[i]) / 0.1, 0, 1) * (1 - belt) + (riverNear[i] ? 0.15 : 0);
      foothill[i] = clamp(1 - Math.abs(belt - 0.4) / 0.4, 0, 1);
      forest[i] = smooth(0.55, 0.85, map.moist[i]) * (1 - belt);
      plains[i] = (1 - nv.slope[i]) * (1 - belt) * (1 - forest[i]) * smooth(0.25, 0.5, map.moist[i]);
      fert[i] = clamp(0.55 * map.moist[i] + 0.45 * (1 - clamp(h[i] / 0.6, 0, 1)) + 0.25 * riverNear[i], 0, 1) * (1 - 0.8 * belt);
      if (map.biome[i] === 9) fert[i] *= 0.15;                  // болото: строиться невыгодно
    }
    return (map._tf = { riverNear, confl, mouth, harbor, defense, foothill, forest, plains, fert });
  }

  // Поля вокруг действующих вулканов: danger — зона поражения (~10 клеток), ash — пепельные плодородные земли кольцом (~10–22 клетки)
  function volcanoFields(map) {
    if (map._vf) return map._vf;
    const { W, H } = map, N = W * H, danger = new Float32Array(N), ash = new Float32Array(N), act = (map.volcanoes || []).filter(v => v.active);
    for (const v of act) {
      const R = 28;
      for (let y = Math.max(0, Math.floor(v.y) - R); y <= Math.min(H - 1, Math.floor(v.y) + R); y++)
        for (let x = Math.max(0, Math.floor(v.x) - R); x <= Math.min(W - 1, Math.floor(v.x) + R); x++) {
          const d = Math.hypot(x - v.x, y - v.y), i = y * W + x;
          danger[i] = Math.max(danger[i], Math.exp(-d * d / 72));
          ash[i] = Math.max(ash[i], Math.exp(-((d - 15) ** 2) / 40) * 0.8);
        }
    }
    return (map._vf = { danger, ash, act });
  }
  FM.volcanoFields = volcanoFields;

  // ---------- расстановка городов ----------
  FM.placeCities = function (map, pol, opts) {
    const { W, H, h } = map, N = W * H, nv = FM.nav(map), T = terrainFields(map);
    const seed = opts.seed, density = opts.density || 1;
    const rand = mulberry32(hashString(seed + '|cities|' + (opts.salt || 0)));
    const nz = makeNoise(mulberry32(hashString(seed + '|cityn')));
    const res = FM.getResources(map, seed, opts.cfg);
    const volc = opts.volc != null ? opts.volc : 0.6, VF = volcanoFields(map);
    pol.volc = volc;
    const used = new Set([...pol.states.map(s => s.capName || ''), ...pol.cities.map(c => c.name)]);
    const result = [];
    const owner = pol.owner;
    const localRace = (id, x, y, force) => {   // смешанные области: поселение другой расы, если местность ей явно ближе, чем расе государства
      const base = raceOf(id), a = FM.raceAffinity(map, x, y, Math.max(3, Math.round(5 * W / 480)));
      let best = base; for (const k in a) if (a[k] > a[best]) best = k;
      if (force) return force;
      return best !== base && a[best] > 0.45 && a[best] > a[base] * 2.2 && rand() < 0.65 ? best : base;
    };
    const raceOf = id => { const st = pol.states.find(q => q.id === id); return (st && st.race) || 'human'; };
    const byState = new Map();
    for (let i = 0; i < N; i++) if (owner[i]) { let l = byState.get(owner[i]); if (!l) byState.set(owner[i], l = []); l.push(i); }
    let uid = pol.cities.reduce((m, c) => Math.max(m, c.id), 0) + 1;
    const mk = (props) => Object.assign({ id: uid++, manual: false }, props);
    const taken = [];     // все занятые точки: столицы и ручные города
    for (const s of pol.states) taken.push([s.capital.x, s.capital.y]);
    for (const c of pol.cities) taken.push([c.x, c.y]);
    const farFrom = (x, y, d) => taken.every(t => (t[0] - x) ** 2 + (t[1] - y) ** 2 >= d * d);

    for (const s of pol.states) {
      const cells = byState.get(s.id); if (!cells || cells.length < 60) continue;
      const w = (FM.CULTURES[s.culture] || FM.CULTURES.realistic).w;
      const existing = pol.cities.filter(c => c.stateId === s.id && c.type !== 'mine' && c.type !== 'ruin' && c.type !== 'fortress').length;
      const tp = FM.STATE_TYPES[s.type] || FM.STATE_TYPES.kingdom;
      const n = clamp(Math.round(cells.length * tp.cities / (850 / density)), 2, 20) - existing;
      if (n <= 0) continue;
      const dmin = Math.max(5, Math.sqrt(cells.length / (n + 1)) * 0.72);
      const score = new Map();
      for (const i of cells) {
        if (h[i] < 0.06) continue;
        const x = i % W, y = (i / W) | 0;
        const resNear = Math.max(res.fields.metal[i], res.fields.stone[i] * 0.7, res.fields.fuel[i] * 0.8, res.fields.luxury[i] * 0.8, res.fields.sea[i] * 0.6, res.fields.special[i] * 0.9, res.fields.timber[i] * 0.5, res.fields.agri[i] * 0.5, cfgTimber(opts.cfg) ? T.forest[i] * 0.3 : 0);
        const sc = w.fert * T.fert[i]
          + w.river * (0.35 * T.riverNear[i] + 0.9 * T.confl[i] + 0.5 * T.mouth[i])
          + w.coast * T.harbor[i] + w.def * T.defense[i] + w.res * resNear
          + w.mount * T.foothill[i] + w.forest * T.forest[i] + w.open * T.plains[i]
          - 0.9 * nv.belt[i] * (1 - w.mount * 0.7) - 0.6 * nv.slope[i] - (map.riverMask[i] ? 0.25 : 0)
          - 2.2 * volc * VF.danger[i] + 0.45 * volc * VF.ash[i]
          + 0.12 * nz(x * 0.2, y * 0.2);
        score.set(i, sc);
      }
      const order = [...score.entries()].sort((a, b) => b[1] - a[1]);
      const picked = [];
      for (const [i] of order) {
        if (picked.length >= n) break;
        const x = i % W, y = (i / W) | 0;
        if (!farFrom(x, y, dmin)) continue;
        taken.push([x, y]); picked.push({ i, x, y });
      }
      picked.forEach((p, k) => {
        const rel = k / Math.max(1, picked.length);
        let type = k < Math.max(1, Math.round(picked.length * 0.22)) ? 'city' : rel < 0.55 ? 'town' : 'village';
        if (s.type === 'nomads' && type === 'city') type = 'town';                 // у кочевников нет больших городов
        if (type !== 'city' && T.harbor[p.i] > 0.55 && w.coast >= 0.3 && rand() < 0.7) type = 'port';
        result.push(mk({ name: FM.cityName(rand, used, localRace(s.id, p.x, p.y)), x: p.x, y: p.y, type, rank: k + 1, stateId: s.id }));
      });

      // крепости на границе: хорошая оборона, водораздел
      const border = [];
      for (const i of cells) {
        const x = i % W, y = (i / W) | 0;
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const o = [owner[i - 1], owner[i + 1], owner[i - W], owner[i + W]];
        if (!o.some(v => v && v !== s.id)) continue;
        border.push([i, T.defense[i] + 0.8 * nv.divide[i] + 0.3 * nv.belt[i]]);
      }
      border.sort((a, b) => b[1] - a[1]);
      let forts = 0;
      for (const [i] of border) {
        if (forts >= 2) break;
        const x = i % W, y = (i / W) | 0;
        if (!farFrom(x, y, 22)) continue;
        taken.push([x, y]); forts++;
        result.push(mk({ name: FM.cityName(rand, used, localRace(s.id, x, y)), x, y, type: 'fortress', rank: 8, stateId: s.id }));
      }
    }

    // рудники на месторождениях металла и камня
    const mines = res.deposits.filter(d => d.t === 'metal' || d.t === 'stone').sort(() => rand() - 0.5);
    let nm = 0;
    for (const d of mines) {
      if (nm >= 10) break;
      const i = Math.round(d.y) * W + Math.round(d.x);
      if (!owner[i] || !farFrom(d.x, d.y, 14)) continue;
      taken.push([d.x, d.y]); nm++;
      result.push(mk({ name: FM.cityName(rand, used, localRace(owner[i], d.x, d.y, FM.raceAffinity(map, d.x, d.y).dwarf > 0.3 ? 'dwarf' : null)), x: d.x, y: d.y, type: 'mine', rank: 9, stateId: owner[i], res: d.t }));
    }
    // погребённый вулканом город: руины рядом с действующим вулканом
    if (volc > 0.25) for (const v of VF.act) {
      const a0 = rand() * 6.28;
      for (let t = 0; t < 12; t++) {
        const a = a0 + t * 0.52, d = 7 + rand() * 4, x = Math.round(v.x + Math.cos(a) * d), y = Math.round(v.y + Math.sin(a) * d);
        if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3 || h[y * W + x] < 0.08 || !farFrom(x, y, 12)) continue;
        taken.push([x, y]); result.push(mk({ name: FM.cityName(rand, used, raceOf(owner[y * W + x])), x, y, type: 'ruin', rank: 10, stateId: owner[y * W + x] || 0, buried: true })); break;
      }
    }
    // руины в древних горах и глуши
    let nr = 0, tries = 0;
    while (nr < 3 + Math.floor(rand() * 3) && tries++ < 400) {
      const x = 4 + Math.floor(rand() * (W - 8)), y = 4 + Math.floor(rand() * (H - 8)), i = y * W + x;
      if (h[i] < 0.1 || T.defense[i] < 0.3 || !farFrom(x, y, 18)) continue;
      taken.push([x, y]); nr++;
      result.push(mk({ name: FM.cityName(rand, used, raceOf(owner[i])), x, y, type: 'ruin', rank: 10, stateId: owner[i] || 0 }));
    }
    return result;
  };
  const cfgTimber = (cfg) => FM.normResCfg(cfg).on.timber;

  // ---------- дороги ----------
  function roadCost(map, volc) {
    volc = volc != null ? volc : 0.6;
    if (map._rc && map._rcv === volc) return map._rc;
    const VF = volcanoFields(map);
    const { W, H, h } = map, N = W * H, nv = FM.nav(map), c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (h[i] <= 0) { c[i] = Infinity; continue; }
      let v = 1 + 5 * nv.slope[i] + 2.5 * nv.belt[i];
      if (map.riverMask[i]) v += 2 + 5 * clamp(map.riverAcc[i] / 800, 0, 1);
      v += 7 * volc * VF.danger[i];             // дороги обходят зону действующего вулкана
      c[i] = v;
    }
    map._rcv = volc; return (map._rc = c);
  }

  function usageOf(pol, N, extra) {
    const u = new Uint8Array(N);
    for (const r of pol.roads) { const seen = new Set(r.path); for (const i of seen) if (u[i] < 250) u[i]++; }
    if (extra) for (const i of new Set(extra)) if (u[i] < 250) u[i]++;
    return u;
  }

  FM.routeRoad = function (map, pol, a, b) {
    const u = usageOf(pol, map.W * map.H);
    return FM.astar(map, roadCost(map, pol.volc), a, b, 0.5, u, 0.35, map.riverMask);
  };

  const IMPORT = { capital: 5, city: 4, town: 3, port: 3, fortress: 2, village: 1.5, mine: 1 };

  FM.buildRoads = function (map, pol) {
    const { W, H } = map, N = W * H;
    const nodes = FM.allCities(pol).filter(c => c.type !== 'ruin').map(c => ({ c, cell: FM.snapLand(map, c.x, c.y, 4) })).filter(n => n.cell >= 0);
    if (nodes.length < 2) return [];
    if (!map._lc) map._lc = FM.landComponents(map.h, W, H);
    const lab = map._lc.lab;
    const pts = nodes.map(n => [n.cell % W, (n.cell / W) | 0]);
    const n = nodes.length;
    // кандидаты: остов (MST) + граф Габриэля внутри одного континента
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (lab[nodes[i].cell] !== lab[nodes[j].cell]) continue;
      pairs.push([i, j, (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2]);
    }
    pairs.sort((a, b) => a[2] - b[2]);
    const par = nodes.map((_, i) => i), find = (x) => (par[x] === x ? x : (par[x] = find(par[x])));
    const keep = new Set();
    for (const [i, j] of pairs) { const a = find(i), b = find(j); if (a !== b) { par[a] = b; keep.add(i * 1000 + j); } }
    const mst = new Set(keep);
    const nn = nodes.map((_, i) => Math.min(...pairs.filter(p => p[0] === i || p[1] === i).map(p => p[2]), 1e9));
    const lmax2 = Math.max(400, [...nn].sort((a, b) => a - b)[Math.floor(n / 2)] * 7);
    for (const [i, j, d2] of pairs) {
      if (d2 > lmax2) continue;
      const mx = (pts[i][0] + pts[j][0]) / 2, my = (pts[i][1] + pts[j][1]) / 2;
      let ok = true;
      for (let k = 0; k < n && ok; k++) if (k !== i && k !== j && (pts[k][0] - mx) ** 2 + (pts[k][1] - my) ** 2 < d2 / 4) ok = false;
      if (ok) keep.add(i * 1000 + j);
    }
    // лишние петли между мелкими посёлками частично отбрасываем (остов и важные связи остаются всегда)
    const edges = [...keep].map(k => [Math.floor(k / 1000), k % 1000]).filter(([a, b]) => {
      if (mst.has(a * 1000 + b)) return true;
      if (IMPORT[nodes[a].c.type] + IMPORT[nodes[b].c.type] >= 6) return true;
      return ((a * 2654435761 + b * 40503) >>> 0) % 100 < 55;
    });
    edges.sort((e1, e2) => {
      const w1 = IMPORT[nodes[e1[0]].c.type] + IMPORT[nodes[e1[1]].c.type], w2 = IMPORT[nodes[e2[0]].c.type] + IMPORT[nodes[e2[1]].c.type];
      return w2 - w1;
    });
    const cost = roadCost(map, pol.volc);
    const manual = pol.roads.filter(r => r.manual);
    const usage = new Uint8Array(N);
    for (const r of manual) for (const i of new Set(r.path)) usage[i] = 1;
    const out = [];
    for (const [a, b] of edges) {
      const path = FM.astar(map, cost, nodes[a].cell, nodes[b].cell, 0.5, usage, 0.35, map.riverMask);
      for (const i of path) usage[i] = 1;
      out.push({ manual: false, path, cls: 1 });
    }
    return out;
  };

  // ---------- геометрия дорог: уникальные рёбра по классам -> цепочки ----------
  FM.roadGeometry = function (map, pol) {
    const { W, H } = map, N = W * H;
    const use = usageOf(pol, N);
    const ucls = (i) => (use[i] >= 3 ? 3 : use[i] === 2 ? 2 : 1);
    const edges = new Map();
    for (const r of pol.roads) {
      for (let k = 0; k < r.path.length - 1; k++) {
        const a = r.path[k], b = r.path[k + 1]; if (a === b) continue;
        let cls = Math.max(ucls(a), ucls(b));
        if (r.manual) cls = Math.max(cls, r.cls || 1);
        const key = a < b ? a * 100000 + b : b * 100000 + a;
        if (!edges.has(key) || edges.get(key)[2] < cls) edges.set(key, [Math.min(a, b), Math.max(a, b), cls]);
      }
    }
    const res = { 1: [], 2: [], 3: [], bridges: [] };
    for (const cls of [1, 2, 3]) {
      const adj = new Map();
      for (const [a, b, c] of edges.values()) if (c === cls) {
        (adj.get(a) || adj.set(a, []).get(a)).push(b);
        (adj.get(b) || adj.set(b, []).get(b)).push(a);
      }
      const seen = new Set(), key = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);
      const walk = (s, nx) => {
        const line = [s]; let prev = s, cur = nx; seen.add(key(s, cur)); line.push(cur);
        while (adj.get(cur).length === 2) {
          const nb = adj.get(cur), t = nb[0] === prev ? nb[1] : nb[0];
          if (seen.has(key(cur, t))) break;
          seen.add(key(cur, t)); prev = cur; cur = t; line.push(cur);
        }
        return line;
      };
      for (const [n, nb] of adj) if (nb.length !== 2) for (const m of nb) if (!seen.has(key(n, m))) res[cls].push(walk(n, m));
      for (const [n, nb] of adj) for (const m of nb) if (!seen.has(key(n, m))) res[cls].push(walk(n, m));
    }
    // мосты: место, где дорога входит в русло реки
    for (const cls of [1, 2, 3]) for (const line of res[cls]) {
      for (let i = 1; i < line.length - 1; i++) {
        const c = line[i];
        if (map.riverMask[c] && !map.riverMask[line[i - 1]]) {
          const p = line[i - 1], q = line[i + 1];
          res.bridges.push({ x: c % W, y: (c / W) | 0, dx: (q % W) - (p % W), dy: ((q / W) | 0) - ((p / W) | 0), cls });
        }
      }
    }
    for (const cls of [1, 2, 3]) res[cls] = res[cls].map(l => l.map(c => [c % W, (c / W) | 0]));
    return res;
  };
})(window.FM);
