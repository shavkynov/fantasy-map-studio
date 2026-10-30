// Государства: поле стоимости, маршрутизация по рельефу (A*), рост территорий, границы и подписи
(function (FM) {
  'use strict';
  const { mulberry32, hashString, smooth, clamp } = FM;

  // ---------- навигационные поля (кэш на карте) ----------
  function nav(map) {
    if (map._nav) return map._nav;
    const { W, H, h } = map, N = W * H;
    const hb = Float32Array.from(h); FM.blur(hb, W, H, 5);
    const divide = new Float32Array(N), belt = new Float32Array(N), slope = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (h[i] <= 0) continue;
      divide[i] = clamp((h[i] - hb[i]) / 0.12, 0, 1) * smooth(0.12, 0.45, h[i]);   // линия водораздела
      belt[i] = smooth(0.2, 0.7, map.young[i] + 0.5 * map.old[i]);                  // горный пояс
      const gx = h[y * W + Math.min(W - 1, x + 1)] - h[y * W + Math.max(0, x - 1)];
      const gy = h[Math.min(H - 1, y + 1) * W + x] - h[Math.max(0, y - 1) * W + x];
      slope[i] = clamp(Math.hypot(gx, gy) / 0.35, 0, 1);
    }
    return (map._nav = { divide, belt, slope });
  }

  function snapLand(map, x, y, maxR) {
    const { W, H, h } = map;
    x = Math.round(x); y = Math.round(y);
    for (let r = 0; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (h[ny * W + nx] > 0.03) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = ny * W + nx; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // ---------- A*: общий поиск пути по массиву стоимостей ----------
  // disc/df: клетки со скидкой (уже проложенные дороги); noCut: маска рек, через которую нельзя "срезать" по диагонали
  function astar(map, cost, a, b, hmin, disc, df, noCut) {
    const { W, H } = map, N = W * H;
    const bx = b % W, by = (b / W) | 0;
    const g = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = new FM.Heap(4096);
    const cc = (i) => (disc && disc[i] ? cost[i] * df : cost[i]);
    g[a] = 0; heap.push(Math.hypot((a % W) - bx, ((a / W) | 0) - by) * hmin, a);
    while (heap.n) {
      const c = heap.pop();
      if (closed[c]) continue; closed[c] = 1;
      if (c === b) break;
      const cx = c % W, cy = (c / W) | 0, c0 = cc(c);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx; if (closed[n] || cost[n] === Infinity) continue;
        if (noCut && dx && dy && noCut[cy * W + nx] && noCut[ny * W + cx]) continue;
        const ng = g[c] + 0.5 * (c0 + cc(n)) * (dx && dy ? 1.4142 : 1);
        if (ng < g[n]) { g[n] = ng; prev[n] = c; heap.push(ng + Math.hypot(nx - bx, ny - by) * hmin, n); }
      }
    }
    if (!closed[b] && prev[b] < 0 && a !== b) return [a, b];
    const path = [];
    for (let c = b; c >= 0; c = prev[c]) { path.push(c); if (c === a) break; }
    return path.reverse();
  }

  // ---------- маршрут границы: "прилипание" к рельефу (хребты и реки дёшевы, склоны и вода дороги) ----------
  function route(map, a, b, stick) {
    const { W, H } = map, N = W * H, nv = nav(map), h = map.h;
    const cost = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (h[i] <= 0) { cost[i] = 1 + stick * 24; continue; }
      const ridge = Math.max(nv.divide[i], map.riverMask[i] ? 0.9 : 0);
      let T = (1 + 2.5 * nv.slope[i]) * (1 + 1.5 * nv.belt[i] * (1 - nv.divide[i])) * (1 - 0.72 * ridge);
      cost[i] = 1 + stick * (Math.max(0.25, T) - 1);
    }
    return astar(map, cost, a, b, Math.max(0.2, 1 - 0.75 * stick), null, 1, null);
  }

  // ---------- авто-расстановка столиц ----------
  function landComponents(h, W, H) {
    const N = W * H, lab = new Int32Array(N).fill(-1), sizes = [], stack = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (h[s] <= 0 || lab[s] >= 0) continue;
      const id = sizes.length; let sp = 0, cnt = 0; stack[sp++] = s; lab[s] = id;
      while (sp) {
        const i = stack[--sp]; cnt++;
        const x = i % W, y = (i / W) | 0;
        if (x > 0 && lab[i - 1] < 0 && h[i - 1] > 0) { lab[i - 1] = id; stack[sp++] = i - 1; }
        if (x < W - 1 && lab[i + 1] < 0 && h[i + 1] > 0) { lab[i + 1] = id; stack[sp++] = i + 1; }
        if (y > 0 && lab[i - W] < 0 && h[i - W] > 0) { lab[i - W] = id; stack[sp++] = i - W; }
        if (y < H - 1 && lab[i + W] < 0 && h[i + W] > 0) { lab[i + W] = id; stack[sp++] = i + W; }
      }
      sizes.push(cnt);
    }
    return { lab, sizes };
  }

  function autoStates(map, n, seed, existing) {
    const rand = mulberry32(hashString(seed + '|states' + (existing ? existing.length : 0) + '|' + Math.floor(Math.random() * 1e6)));
    const { W, H, h } = map, N = W * H, nv = nav(map);
    const score = new Float32Array(N).fill(-1);
    let landCells = 0;
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (h[i] < 0.06) continue;
      landCells++;
      let river = 0;
      for (let dy = -2; dy <= 2 && !river; dy++) for (let dx = -2; dx <= 2; dx++) if (map.riverMask[i + dy * W + dx]) { river = 1; break; }
      const coast = (h[i - 1] <= 0 || h[i + 1] <= 0 || h[i - W] <= 0 || h[i + W] <= 0) ? 1 : 0;
      score[i] = 0.55 * map.moist[i] + 0.25 * (1 - clamp(h[i] / 0.6, 0, 1)) + 0.2 * river + 0.1 * coast
        - 0.5 * nv.belt[i] - 0.3 * nv.slope[i] + 0.15 * rand();
    }
    const R = Math.sqrt(landCells / Math.max(1, n)) * 0.85;
    const picks = [];
    const take = (i) => {
      picks.push(i);
      const cx = i % W, cy = (i / W) | 0, r = Math.ceil(R);
      for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 < R * R) score[y * W + x] = -1;
    };
    const comps = landComponents(h, W, H);
    const big = Math.max(250, landCells * 0.03);
    comps.sizes.forEach((sz, id) => {
      if (sz < big) return;
      let best = -1, bs = -1;
      for (let i = 0; i < N; i++) if (comps.lab[i] === id && score[i] > bs) { bs = score[i]; best = i; }
      if (best >= 0) take(best);
    });
    while (picks.length < n) {
      let best = -1, bs = -0.5;
      for (let i = 0; i < N; i++) if (score[i] > bs) { bs = score[i]; best = i; }
      if (best < 0) break;
      take(best);
    }
    const used = new Set((existing || []).map(s => s.name));
    const raceCount = {}, cap = Math.max(2, Math.ceil(picks.length / 2));
    const res = picks.map(i => {
      let race = FM.raceAt(map, i % W, (i / W) | 0, rand);
      if ((raceCount[race] || 0) >= cap) { const af = FM.raceAffinity(map, i % W, (i / W) | 0), alt = Object.keys(FM.RACES).filter(r => (raceCount[r] || 0) < cap).sort((u, v) => af[v] - af[u]); race = alt[0] || race; }   // разнообразие: не больше половины государств одной расы
      raceCount[race] = (raceCount[race] || 0) + 1;
      const name = FM.stateName(rand, used, race);
      return { name, race, capital: { x: i % W, y: (i / W) | 0 }, power: +(0.8 + rand() * 0.6).toFixed(2) };
    });
    FM.assignStateTypes(map, res).forEach((t, k) => { res[k].type = t; });
    return res;
  }

  // ---------- типы государств: зависят от окружения столицы (богатство земли, горы, леса, степь, море) и расы ----------
  FM.STATE_TYPES = {
    empire: { label: 'Империя', pow: 1.35, cities: 1.4, culture: 'realistic' },
    kingdom: { label: 'Королевство', pow: 1, cities: 1, culture: 'realistic' },
    republic: { label: 'Торговая республика', pow: 0.85, cities: 1.15, culture: 'seafarers' },
    nomads: { label: 'Кочевой союз', pow: 1.1, cities: 0.35, culture: 'steppe' },
    clans: { label: 'Горные кланы', pow: 0.7, cities: 0.7, culture: 'highland' },
    tribes: { label: 'Племенной союз', pow: 0.8, cities: 0.55, culture: 'woodland' }
  };
  function envStats(map, x, y) {
    const { W, H } = map, R = Math.round(20 * W / 480), R2 = R * R, st = { n: 0, water: 0, rich: 0, dry: 0, mount: 0, forest: 0, river: 0 };
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R2) continue; const nx = Math.round(x) + dx, ny = Math.round(y) + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = ny * W + nx; st.n++;
      if (map.h[i] <= 0) { st.water++; continue; }
      const b = map.biome[i];
      if (b === 5 || b === 4) st.rich++; if (b === 6 || b === 7 || b === 2 || (b === 5 && map.moist[i] < 0.35)) st.dry++;
      if (map.young[i] > 0.2 || map.old[i] > 0.35 || map.h[i] > 0.85) st.mount++;
      if (b === 3 || b === 4 || b === 8) st.forest++;
      if (map.riverMask[i]) st.river++;
    }
    const n = Math.max(1, st.n); for (const k of Object.keys(st)) if (k !== 'n') st[k] /= n;
    return st;
  }
  // list: [{capital, race, power}] -> типы; не более одной империи на 4 государства, у самого богатого и сильного окружения
  FM.assignStateTypes = function (map, list) {
    const out = list.map(s => {
      const e = envStats(map, s.capital.x, s.capital.y), r = s.race;
      const sc = {
        nomads: 1.6 * e.dry + (r === 'orc' ? 0.25 : 0) - 0.5 * e.forest,
        clans: 1.5 * Math.max(0, e.mount - 0.08) + (r === 'dwarf' ? 0.35 : 0),
        tribes: 1.1 * Math.max(0, e.forest - 0.2) + (r === 'orc' ? 0.1 : 0) + (r === 'elf' ? 0.08 : 0),
        republic: 1.2 * Math.max(0, e.water - 0.12) + 0.3 * e.river + (r === 'human' ? 0.05 : 0),
        kingdom: 0.12 + 0.2 * e.rich,
        empire: -9
      };
      const ranked = Object.keys(sc).sort((a, b) => sc[b] - sc[a]);
      return { s, e, ranked, sc, type: ranked[0], wealth: (e.rich + 0.5 * e.river - e.dry - 0.5 * e.mount) * (s.power || 1) };
    });
    const cap = Math.max(2, Math.ceil(list.length / 3)), cnt = {};            // разнообразие: не больше трети государств одного типа
    out.slice().sort((a, b) => b.sc[b.ranked[0]] - a.sc[a.ranked[0]]).forEach(o => {
      const t = o.ranked.find(k => k === 'kingdom' || (cnt[k] || 0) < cap && o.sc[k] > 0.08) || 'kingdom'; o.type = t; cnt[t] = (cnt[t] || 0) + 1;
    });
    const nEmp = Math.max(0, Math.floor(list.length / 4)), cand = out.filter(o => o.type === 'kingdom' || o.type === 'republic').sort((a, b) => b.wealth - a.wealth);
    for (let i = 0; i < Math.min(nEmp, cand.length); i++) cand[i].type = 'empire';
    return out.map(o => o.type);
  };

  // ---------- рост территорий: Dijkstra от столиц, хребты и реки "дорогие" -> границы ложатся по ним ----------
  function growStates(map, pol) {
    const { W, H, h } = map, N = W * H, nv = nav(map);
    const owner = new Uint8Array(N), dist = new Float32Array(N).fill(Infinity);
    const barrier = new Uint8Array(N);
    for (const b of pol.barriers) for (const i of b.path) barrier[i] = 1;
    const e = new Float32Array(N);
    for (let i = 0; i < N; i++) e[i] = h[i] > 0 ? 1 + 5 * nv.divide[i] + (map.riverMask[i] ? 3 : 0) + 1.2 * nv.belt[i] + 1.5 * nv.slope[i] : Infinity;
    const power = new Float32Array(256).fill(1);
    const heap = new FM.Heap(N);
    for (const s of pol.states) {
      power[s.id] = (s.power || 1) * ((FM.STATE_TYPES[s.type] || {}).pow || 1);
      const i = Math.round(s.capital.y) * W + Math.round(s.capital.x);
      if (h[i] <= 0) continue;
      owner[i] = s.id; dist[i] = 0; heap.push(0, i);
    }
    while (heap.n) {
      const c = heap.pop(), d = dist[c];
      const cx = c % W, cy = (c / W) | 0, id = owner[c];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (e[n] === Infinity || barrier[n]) continue;
        if (dx && dy && (barrier[cy * W + nx] || barrier[ny * W + cx])) continue;
        const nd = d + (dx && dy ? 1.4142 : 1) * e[n] / power[id];
        if (nd < dist[n]) { dist[n] = nd; owner[n] = id; heap.push(nd, n); }
      }
    }
    // клетки самой границы достаются ближайшей стороне
    for (let i = 0; i < N; i++) {
      if (!barrier[i] || owner[i] || h[i] <= 0) continue;
      const x = i % W, y = (i / W) | 0; let bd = Infinity, bo = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx; if (owner[n] && dist[n] < bd) { bd = dist[n]; bo = owner[n]; }
      }
      owner[i] = bo;
    }
    const alive = new Set(pol.states.map(s => s.id));
    for (let i = 0; i < N; i++) if (pol.overrides[i] && h[i] > 0 && alive.has(pol.overrides[i])) owner[i] = pol.overrides[i];
    markWastes(map, pol, owner, dist);
    return owner;
  }

  // ---------- малопригодные земли: пустыни, тундра, высокогорья, топи без воды -> ничьи (zone 1) или спорные (zone 2) ----------
  const BIOME_LIVE = { 1: 0, 2: 0.15, 3: 0.5, 4: 0.8, 5: 0.85, 6: 0.1, 7: 0.6, 8: 0.6, 9: 0.25, 10: 0.1 };
  function markWastes(map, pol, owner, dist) {
    const { W, H, h } = map, N = W * H, nv = nav(map);
    const zone = new Uint8Array(N); pol.zone = zone; pol.zones = [];
    if (!pol.states.length) return;
    const wet = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!(map.riverMask[i] || (h[i] <= 0))) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) wet[ny * W + nx] = 1; }
    }
    const poor = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (h[i] <= 0 || pol.overrides[i]) continue;
      const base = BIOME_LIVE[map.biome[i]] != null ? BIOME_LIVE[map.biome[i]] : 0.6;
      const score = (base + (wet[i] ? 0.3 : 0)) * (1 - 0.5 * nv.belt[i]);
      if (score < 0.26) poor[i] = 1;
    }
    const caps = new Set(pol.states.map(s => Math.round(s.capital.y) * W + Math.round(s.capital.x)));
    const seen = new Uint8Array(N), minSize = Math.round(110 * (W / 480) * (W / 480)), stack = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (!poor[s0] || seen[s0]) continue;
      const comp = []; let hasCap = false, sx = 0, sy = 0; const owners = new Set();
      stack.push(s0); seen[s0] = 1;
      while (stack.length) {
        const c = stack.pop(); comp.push(c); if (caps.has(c)) hasCap = true;
        const x = c % W, y = (c / W) | 0; sx += x; sy += y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx; if (poor[n]) { if (!seen[n]) { seen[n] = 1; stack.push(n); } } else if (owner[n] && h[n] > 0) owners.add(owner[n]);
        }
      }
      if (comp.length < minSize || hasCap) continue;
      const kind = owners.size >= 2 ? 2 : 1;                       // зажата между государствами — спорная, иначе ничейная
      for (const c of comp) { zone[c] = kind; if (kind === 1) owner[c] = 0; }
      pol.zones.push({ kind, x: sx / comp.length, y: sy / comp.length, n: comp.length });
    }
  }

  // ---------- границы: цепочки рёбер между клетками разных государств ----------
  function borderLines(owner, W, H) {
    const adj = new Map();
    const link = (a, b) => {
      let la = adj.get(a); if (!la) adj.set(a, la = []); la.push(b);
      let lb = adj.get(b); if (!lb) adj.set(b, lb = []); lb.push(a);
    };
    const node = (cx, cy) => cy * (W + 1) + cx;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = owner[i]; if (!a) continue;
      if (x < W - 1) { const b = owner[i + 1]; if (b && b !== a) link(node(x + 1, y), node(x + 1, y + 1)); }
      if (y < H - 1) { const b = owner[i + W]; if (b && b !== a) link(node(x, y + 1), node(x + 1, y + 1)); }
    }
    const seen = new Set(), key = (a, b) => (a < b ? a * 4000000 + b : b * 4000000 + a);
    const lines = [];
    const walk = (start, next) => {
      const line = [start]; let prev = start, cur = next; seen.add(key(start, cur)); line.push(cur);
      while (adj.get(cur).length === 2) {
        const nb = adj.get(cur), nx = nb[0] === prev ? nb[1] : nb[0];
        if (seen.has(key(cur, nx))) break;
        seen.add(key(cur, nx)); prev = cur; cur = nx; line.push(cur);
      }
      return line;
    };
    for (const [n, nbs] of adj) if (nbs.length !== 2) for (const nb of nbs) if (!seen.has(key(n, nb))) lines.push(walk(n, nb));
    for (const [n, nbs] of adj) for (const nb of nbs) if (!seen.has(key(n, nb))) lines.push(walk(n, nb));
    return lines.map(l => l.map(nd => [(nd % (W + 1)) - 0.5, ((nd / (W + 1)) | 0) - 0.5]));
  }

  // ---------- подпись: ось государства (PCA) и средняя линия по срезам ----------
  function labelPaths(owner, W, H, states) {
    const out = [];
    const cells = new Map();
    for (let i = 0; i < owner.length; i++) if (owner[i]) { let l = cells.get(owner[i]); if (!l) cells.set(owner[i], l = []); l.push(i); }
    for (const s of states) {
      const list = cells.get(s.id); if (!list || list.length < 40) continue;
      let mx = 0, my = 0; for (const i of list) { mx += i % W; my += (i / W) | 0; }
      mx /= list.length; my /= list.length;
      let cxx = 0, cyy = 0, cxy = 0;
      for (const i of list) { const dx = (i % W) - mx, dy = ((i / W) | 0) - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
      let th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      const ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
      const BIN = 3, bins = new Map(); let smin = Infinity, smax = -Infinity;
      const ss = [];
      for (const i of list) {
        const dx = (i % W) - mx, dy = ((i / W) | 0) - my;
        const sp = dx * ux + dy * uy, tp = dx * vx + dy * vy; ss.push(sp);
        const b = Math.round(sp / BIN); let o = bins.get(b);
        if (!o) bins.set(b, o = { n: 0, tmin: Infinity, tmax: -Infinity, ts: 0 });
        o.n++; o.ts += tp; if (tp < o.tmin) o.tmin = tp; if (tp > o.tmax) o.tmax = tp;
      }
      ss.sort((a, b) => a - b);
      smin = ss[Math.floor(ss.length * 0.08)]; smax = ss[Math.floor(ss.length * 0.92)];
      const keys = [...bins.keys()].sort((a, b) => a - b).filter(b => b * BIN >= smin && b * BIN <= smax && bins.get(b).n >= 3);
      if (keys.length < 4) continue;
      let ts = keys.map(b => { const o = bins.get(b); return 0.5 * (o.tmin + o.tmax) * 0.5 + 0.5 * (o.ts / o.n); });
      for (let pass = 0; pass < 3; pass++) ts = ts.map((_, j) => { let a = 0, c = 0; for (let k = -2; k <= 2; k++) { const q = ts[j + k]; if (q !== undefined) { a += q; c++; } } return a / c; });
      let pts = keys.map((b, j) => [mx + b * BIN * ux + ts[j] * vx, my + b * BIN * uy + ts[j] * vy]);
      let thick = 0; keys.forEach(b => { const o = bins.get(b); thick += o.tmax - o.tmin; }); thick /= keys.length;
      out.push({ id: s.id, text: s.name.toUpperCase(), pts, length: (keys[keys.length - 1] - keys[0]) * BIN, thick });
    }
    return out;
  }

  function smoothOpen(pts, iter) {
    for (let it = 0; it < iter; it++) {
      if (pts.length < 3) break;
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
      }
      out.push(pts[pts.length - 1]); pts = out;
    }
    return pts;
  }

  FM.nav = nav; FM.snapLand = snapLand; FM.route = route; FM.astar = astar; FM.landComponents = landComponents; FM.autoStates = autoStates;
  FM.growStates = growStates; FM.borderLines = borderLines; FM.labelPaths = labelPaths; FM.smoothOpen = smoothOpen;
})(window.FM);
