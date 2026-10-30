// Генератор мира: плиты -> границы -> горообразование (несколько эпох) -> рельеф -> уровень моря
(function (FM) {
  'use strict';
  const { mulberry32, hashString, makeNoise, fbm } = FM;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const sub = (seed, tag) => mulberry32(hashString(seed + '|' + tag));

  // ---------- утилиты полей ----------
  function blur(a, W, H, r) {
    const t = new Float32Array(a.length), k = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      const row = y * W; let s = 0;
      for (let x = -r; x <= r; x++) s += a[row + clamp(x, 0, W - 1)];
      for (let x = 0; x < W; x++) {
        t[row + x] = s / k;
        s += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += t[clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = s / k;
        s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x];
      }
    }
  }

  // Распространение значения от источников с линейным затуханием (двухпроходная "chamfer"-схема)
  function spread(a, W, H, decay) {
    const d2 = decay * 1.414;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let v = a[i];
      if (x > 0) v = Math.max(v, a[i - 1] - decay);
      if (y > 0) {
        v = Math.max(v, a[i - W] - decay);
        if (x > 0) v = Math.max(v, a[i - W - 1] - d2);
        if (x < W - 1) v = Math.max(v, a[i - W + 1] - d2);
      }
      a[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; let v = a[i];
      if (x < W - 1) v = Math.max(v, a[i + 1] - decay);
      if (y < H - 1) {
        v = Math.max(v, a[i + W] - decay);
        if (x < W - 1) v = Math.max(v, a[i + W + 1] - d2);
        if (x > 0) v = Math.max(v, a[i + W - 1] - d2);
      }
      a[i] = v;
    }
  }

  // Евклидово преобразование расстояний (Felzenszwalb). mask=1 -> источник (расстояние 0)
  function edt(mask, W, H) {
    const INF = 1e12, N = W * H;
    const g = new Float64Array(N);
    const n = Math.max(W, H);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    function pass(len) {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) {
        while (z[k + 1] < q) k++;
        d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = mask[y * W + x] ? 0 : INF;
      pass(H);
      for (let y = 0; y < H; y++) g[y * W + x] = d[y];
    }
    const out = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) f[x] = g[y * W + x];
      pass(W);
      for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
    }
    return out;
  }

  // ---------- плиты ----------
  function makePlates(rand, count, W, H, landRatio, continents) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      let best = null, bd = -1;
      for (let k = 0; k < 40; k++) {
        const x = W * (0.12 + 0.76 * rand()), y = H * (0.15 + 0.7 * rand());
        let d = 1e9;
        for (const p of pts) d = Math.min(d, (p.x - x) ** 2 + (p.y - y) ** 2);
        if (d > bd) { bd = d; best = { x, y }; }
      }
      pts.push(best);
    }
    const idx = pts.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const nCont = clamp(Math.round(count * (0.2 + landRatio * 0.9)), Math.max(2, continents || 0), Math.max(2, count - 1));
    let cont = new Set(idx.slice(0, nCont));
    if (continents > 0) {                                  // заданное число континентов: далёкие друг от друга «ядра» + ближайшие плиты вокруг каждого; между ними океанические плиты
      const K = Math.min(continents, nCont), d2 = (a, b) => (pts[a].x - pts[b].x) ** 2 + (pts[a].y - pts[b].y) ** 2;
      const seeds = [idx[0]];
      while (seeds.length < K) { let bi = -1, bd = -1; for (let i = 0; i < pts.length; i++) { if (seeds.includes(i)) continue; const d = Math.min(...seeds.map(sj => d2(i, sj))); if (d > bd) { bd = d; bi = i; } } seeds.push(bi); }
      const groups = seeds.map(sd => [sd]), taken = new Set(seeds);
      for (let guard = 0; taken.size < nCont && guard < 200; guard++) for (const g of groups) {
        if (taken.size >= nCont) break;
        let bi = -1, bd = 1e18; for (let i = 0; i < pts.length; i++) { if (taken.has(i)) continue; const d = Math.min(...g.map(m => d2(i, m))); if (d < bd) { bd = d; bi = i; } }
        if (bi >= 0) { g.push(bi); taken.add(bi); }
      }
      cont = taken;
    }
    return pts.map((p, i) => ({
      x: p.x, y: p.y,
      type: cont.has(i) ? 'continental' : 'oceanic',
      weight: 0.85 + rand() * 0.3
    }));
  }

  // Тип стыка двух плит задаётся простым правилом по их типам и фиксируется в мире (без скоростей и направлений движения):
  // c>0 — сближение (хребет / жёлоб / дуга), c<0 — расхождение (рифт / срединный хребет), s — доля сдвига. Симметрично по паре индексов.
  function pairHash(a, b, salt) { if (a > b) { const t = a; a = b; b = t; } let x = (Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; x ^= x >>> 15; return (x >>> 0) / 4294967296; }
  function pairConv(plates, a, b) {
    const ca = plates[a].type === 'continental', cb = plates[b].type === 'continental', r = pairHash(a, b, 1), q = pairHash(a, b, 2);
    if (ca && cb) return r < 0.6 ? { c: 0.5 + 0.5 * q, s: 0.1 } : r < 0.82 ? { c: -(0.4 + 0.5 * q), s: 0.1 } : { c: 0.05 * (q - 0.5), s: 0.6 + 0.4 * q };
    if (ca !== cb) return r < 0.72 ? { c: 0.4 + 0.6 * q, s: 0.1 } : r < 0.9 ? { c: -(0.3 + 0.3 * q), s: 0.1 } : { c: 0.05 * (q - 0.5), s: 0.6 + 0.4 * q };
    return r < 0.5 ? { c: 0.3 + 0.6 * q, s: 0.1 } : r < 0.9 ? { c: -(0.4 + 0.5 * q), s: 0.1 } : { c: 0.05 * (q - 0.5), s: 0.6 + 0.4 * q };
  }
  FM.pairConv = pairConv; FM.pairHash = pairHash;
  const plateDir = i => pairHash(i, i, 7) * Math.PI * 2;          // направление следа горячей точки на плите (условное)
  FM.plateDir = plateDir;

  // v2: выбор континентальных плит по настоящей смежности (после искажения границ): K групп, между группами всегда океаническая плита
  function separateContinents(plates, id, W, H, K, nCont) {
    const n = plates.length, adj = Array.from({ length: n }, () => new Set()), pts = Array.from({ length: n }, () => []), contact = new Map(), band = W * 0.1, ps = 3 * Math.max(1, Math.round(W / 480));   // шаг выборки точек для расстояний между плитами растёт с картой: на 480×320 как раньше (3), на 1440×960 — 9 (число пар точек не растёт с площадью)
    const touch = (a, c, x, y) => { adj[a].add(c); adj[c].add(a); if (x > band && y > band && x < W - band && y < H - band) { const k = a < c ? a * 64 + c : c * 64 + a; contact.set(k, (contact.get(k) || 0) + 1); } };   // contact: длина общей границы вдали от рамки
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = id[y * W + x]; if (x % ps === 0 && y % ps === 0) pts[a].push(x, y);
      if (x < W - 1) { const c = id[y * W + x + 1]; if (c !== a) touch(a, c, x, y); }
      if (y < H - 1) { const c = id[(y + 1) * W + x]; if (c !== a) touch(a, c, x, y); }
    }
    // плиты одной группы считаются связанными, только если общая граница достаточно длинна и лежит не у рамки (иначе континент распадётся на два массива)
    const joined = (i, j) => (contact.get(i < j ? i * 64 + j : j * 64 + i) || 0) >= W * 0.06;
    const d2 = (a, b) => (plates[a].x - plates[b].x) ** 2 + (plates[a].y - plates[b].y) ** 2;
    // наименьшее расстояние между плитами (по выборке точек), кэш
    const pdc = new Map(), pd = (i, j) => { const k = i < j ? i * 64 + j : j * 64 + i; let v = pdc.get(k); if (v === undefined) { v = 1e9; const A = pts[i], B = pts[j]; for (let u = 0; u < A.length; u += 2) for (let w = 0; w < B.length; w += 2) { const d = (A[u] - B[w]) ** 2 + (A[u + 1] - B[w + 1]) ** 2; if (d < v) v = d; } v = Math.sqrt(v); pdc.set(k, v); } return v; };
    // зазор между группами должен быть не меньше dmin: чем шире океаническая полоса, тем меньше суша «переливается» мостом; если зазор недостижим — ослабляем
    let best = null;
    for (const dmin of [W * 0.1, W * 0.075, W * 0.05, W * 0.025, 0]) {
      const owner = new Int8Array(n).fill(-1), groups = [];
      const close = (i, j) => adj[i].has(j) || pd(i, j) < dmin;
      const blocked = (i, g) => { for (let j = 0; j < n; j++) if (owner[j] >= 0 && owner[j] !== g && close(i, j)) return true; return false; };
      owner[0] = 0; groups.push([0]);
      while (groups.length < K) {
        let bi = -1, bd = -1;
        for (let i = 0; i < n; i++) { if (owner[i] >= 0 || blocked(i, -2)) continue; const d = Math.min(...groups.map(g => Math.min(...g.map(m => d2(i, m))))); if (d > bd) { bd = d; bi = i; } }
        if (bi < 0) break;
        owner[bi] = groups.length; groups.push([bi]);
      }
      if (groups.length < K) continue;
      let taken = groups.length;
      for (let guard = 0; taken < nCont && guard < 100; guard++) {
        let grew = false;
        for (let gi = 0; gi < groups.length && taken < nCont; gi++) {
          let bi = -1, bd = 1e18;
          for (let i = 0; i < n; i++) { if (owner[i] >= 0 || blocked(i, gi)) continue; if (!groups[gi].some(m => joined(i, m))) continue; const d = Math.min(...groups[gi].map(m => d2(i, m))); if (d < bd) { bd = d; bi = i; } }
          if (bi >= 0) { owner[bi] = gi; groups[gi].push(bi); taken++; grew = true; }
        }
        if (!grew) break;
      }
      best = { owner, groups, taken, dmin }; break;
    }
    if (!best) return [];
    plates.forEach((p, i) => { p.type = best.owner[i] >= 0 ? 'continental' : 'oceanic'; });
    return best.groups;
  }

  // v2, этап 3: поля типов окраины — близость к рифту, пассивной окраине, сближению (активной окраине) и сдвигу, 0..1, плавно убывают от границы плит
  function marginFields(plates, id, bd, W, H) {
    const N = W * H, rift = new Float32Array(N), pass = new Float32Array(N), conv = new Float32Array(N), shear = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (!bd.edge[i]) continue;
      const ca = plates[id[i]].type === 'continental', cb = bd.other[i] === 1, c = bd.conv[i];
      if (c > 0.12) conv[i] = Math.min(1, c * 1.4);
      else if (c < -0.12) { if (ca && cb) rift[i] = Math.min(1, -c * 1.4); else pass[i] = Math.min(1, -c * 1.4); }
      shear[i] = Math.min(1, bd.shear[i]) * (1 - Math.min(1, Math.abs(c)));
    }
    const w = W * 0.05;
    for (const f of [rift, pass, conv, shear]) { spread(f, W, H, 1 / w); blur(f, W, H, 2); }
    return { rift, pass, conv, shear };
  }

  // v2: единое поле коры crust (0 = океаническая, 1 = мощная континентальная) из плит и их границ.
  // Его читают и высоты суши, и карта дна. Края листа — океан (кора истончается к рамке сама).
  function buildCrust(plates, id, bd, W, H, noise, K) {
    const N = W * H, cw = new Float32Array(N);
    // кайма у рамки: за листом океан. Применяется ПОСЛЕ размытия коры, а ширина каймы задаётся шумом в трёх масштабах (крупные заливы и мысы,
    // средние и мелкие изгибы): если вырезать рамку до размытия, размытие стирает её рисунок, и край суши встаёт ровной «стеной» у рамки
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cw[y * W + x] = plates[id[y * W + x]].type === 'continental' ? 1 : 0;
    const r = Math.max(2, Math.round(W * 0.03)); blur(cw, W, H, r); blur(cw, W, H, r); blur(cw, W, H, r);
    const fm1 = 1 / (W * 0.33), fm2 = 1 / (W * 0.11), fm3 = 1 / (W * 0.045), fw = Math.max(2, W * 0.02);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const m = W * clamp(0.065 + 0.04 * edgeK(K) + 0.17 * fbm(noise, x * fm1 + 61.3, y * fm1 + 12.7, 2) + 0.08 * fbm(noise, x * fm2 + 8.8, y * fm2 + 40.1, 2) + 0.03 * fbm(noise, x * fm3 + 3.1, y * fm3 + 90.7, 2), 0.02 + 0.036 * edgeK(K), 0.2);
      cw[y * W + x] *= smooth(-fw, fw, Math.min(x, W - 1 - x, y, H - 1 - y) - m);
    }
    // берег континентальной коры повторял границу плит (ячейка Вороного, размытая ×3) — отсюда ровные длинные стороны материков.
    // Шум в двух масштабах смещает контур коры там, где она «средняя» (у самого берега): мысы и заливы 15–60 клеток вместо прямой
    { const fa = 1 / (W * 0.12), fb = 1 / (W * 0.045);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, c = cw[i], g = 4 * c * (1 - c); if (g > 0.001) cw[i] = clamp(c + g * (0.55 * fbm(noise, x * fa + 21.1, y * fa + 55.5, 2) + 0.3 * fbm(noise, x * fb + 77.7, y * fb + 9.9, 2)), 0, 1); } }
    const thick = new Float32Array(N), thin = new Float32Array(N), arc = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (!bd.edge[i]) continue;
      const ca = plates[id[i]].type === 'continental', cb = bd.other[i] === 1, c = bd.conv[i];
      if (c > 0.12) { if (ca) thick[i] = c * (cb ? 0.35 : 0.22); else if (!cb) arc[i] = c * 0.3; }   // сближение: утолщение коры; ocean–ocean — дуга
      else if (c < -0.12 && ca && cb) thin[i] = -c * 0.45;                                              // континентальный рифт: кора тоньше
    }
    const rr = Math.max(2, Math.round(W * 0.018));
    for (const f of [thick, thin, arc]) { blur(f, W, H, rr); blur(f, W, H, rr); for (let i = 0; i < N; i++) f[i] *= 2.2; }
    const crust = new Float32Array(N);
    for (let i = 0; i < N; i++) crust[i] = clamp(cw[i] + thick[i] * cw[i] + arc[i] * (1 - cw[i]) - thin[i] * cw[i], 0, 1);
    return crust;
  }

  function assignPlates(plates, W, H, noise) {
    const id = new Uint8Array(W * H);
    // при большом числе плит ячейки мельче, поэтому искажение границ уменьшаем, иначе плиты распадаются на обрывки
    const kc = clamp(Math.sqrt(9 / plates.length), 0.5, 1.1);
    const amp = W * 0.11 * kc, f = 1 / (W * 0.17 * kc);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const wx = x + amp * fbm(noise, x * f, y * f, 5);
      const wy = y + amp * fbm(noise, x * f + 31.7, y * f + 17.3, 5);
      let best = 0, bd = 1e18;
      for (let p = 0; p < plates.length; p++) {
        const pl = plates[p];
        const d = ((wx - pl.x) ** 2 + (wy - pl.y) ** 2) / (pl.weight * pl.weight);
        if (d < bd) { bd = d; best = p; }
      }
      id[y * W + x] = best;
    }
    return id;
  }

  // v2: осколки плит (отрезанные куски, которые взвешенное Вороное + искажение оставляет внутри чужой плиты) вливаются в соседа с самой длинной общей границей.
  // Осколок — любая 4-связная часть плиты, кроме самой большой, площадью < minFrac карты.
  function mergeEnclaves(id, W, H, minFrac) {
    const N = W * H, lab = new Int32Array(N).fill(-1), st = new Int32Array(N), lim = Math.max(20, Math.round(minFrac * N)), comps = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (lab[s0] >= 0) continue; const pid = id[s0], cells = []; let sp = 0; st[sp++] = s0; lab[s0] = comps.length;
      while (sp) { const i = st[--sp]; cells.push(i); const x = i % W;
        if (x > 0 && lab[i - 1] < 0 && id[i - 1] === pid) { lab[i - 1] = comps.length; st[sp++] = i - 1; }
        if (x < W - 1 && lab[i + 1] < 0 && id[i + 1] === pid) { lab[i + 1] = comps.length; st[sp++] = i + 1; }
        if (i >= W && lab[i - W] < 0 && id[i - W] === pid) { lab[i - W] = comps.length; st[sp++] = i - W; }
        if (i < N - W && lab[i + W] < 0 && id[i + W] === pid) { lab[i + W] = comps.length; st[sp++] = i + W; } }
      comps.push({ pid, cells });
    }
    const biggest = {}; comps.forEach((c, k) => { if (!(c.pid in biggest) || comps[biggest[c.pid]].cells.length < c.cells.length) biggest[c.pid] = k; });
    const order = comps.map((c, k) => k).filter(k => biggest[comps[k].pid] !== k && comps[k].cells.length < lim).sort((a, b) => comps[a].cells.length - comps[b].cells.length);
    let merged = 0;
    for (const k of order) {
      const c = comps[k], cnt = {}; 
      for (const i of c.cells) { const x = i % W; for (const nb of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1]) if (nb >= 0 && id[nb] !== c.pid) cnt[id[nb]] = (cnt[id[nb]] || 0) + 1; }
      let best = -1, bn = 0; for (const q in cnt) if (cnt[q] > bn) { bn = cnt[q]; best = +q; }
      if (best >= 0) { for (const i of c.cells) id[i] = best; merged++; }
    }
    return merged;
  }

  // Границы плит: сближение / расхождение / сдвиг
  function analyzeBoundaries(plates, id, W, H) {
    const N = W * H;
    const conv = new Float32Array(N), shear = new Float32Array(N);
    const edge = new Uint8Array(N), other = new Uint8Array(N), btype = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = id[i];
      let b = -1;
      if (x < W - 1 && id[i + 1] !== a) b = id[i + 1];
      else if (x > 0 && id[i - 1] !== a) b = id[i - 1];
      else if (y < H - 1 && id[i + W] !== a) b = id[i + W];
      else if (y > 0 && id[i - W] !== a) b = id[i - W];
      if (b < 0) continue;
      const pa = plates[a], pb = plates[b];
      const pc = pairConv(plates, a, b), c = pc.c, s = pc.s;
      edge[i] = 1; conv[i] = c; shear[i] = s;
      other[i] = pb.type === 'continental' ? 1 : 0;
      btype[i] = c > 0.12 ? 1 : c < -0.12 ? 2 : 3;
    }
    return { conv, shear, edge, other, btype };
  }

  // Горообразование одной эпохи -> поля подъёма и разлома
  function orogeny(bd, plates, id, W, H, o) {
    const N = W * H;
    const up = new Float32Array(N), rift = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (!bd.edge[i]) continue;
      const ca = plates[id[i]].type === 'continental', cb = bd.other[i] === 1;
      const c = bd.conv[i], s = bd.shear[i];
      if (c > 0.12) {
        if (ca && cb) up[i] = Math.max(up[i], c);                 // столкновение континентов: мощный хребет
        else if (ca && !cb) up[i] = Math.max(up[i], c * 0.8);     // прибрежный хребет над зоной субдукции
        else if (!ca && cb) rift[i] = Math.max(rift[i], c * 0.6); // океанический жёлоб
        else up[i] = Math.max(up[i], c * 0.55);                   // вулканическая дуга
      } else if (c < -0.12) {
        if (ca && cb) rift[i] = Math.max(rift[i], -c * 0.8);      // континентальный рифт
      }
      up[i] = Math.max(up[i], s * 0.3 * (1 - Math.abs(c)));       // сдвиги: короткие невысокие цепи
    }
    spread(up, W, H, 1 / o.width);
    spread(rift, W, H, 1 / (o.width * 0.6));
    blur(up, W, H, 2); blur(rift, W, H, 2);
    const outUp = new Float32Array(N), outRift = new Float32Array(N);
    const f = 1 / (o.width * 2.2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ox = o.noise(x * f, y * f) * o.width * 0.45, oy = o.noise(x * f + 50, y * f + 50) * o.width * 0.45;
      const sx = clamp(Math.round(x + ox), 0, W - 1), sy = clamp(Math.round(y + oy), 0, H - 1);
      let v = up[sy * W + sx];
      let r = 1 - Math.abs(o.noise(x * f * 2.4 + 9, y * f * 2.4 + 9)); r *= r;
      v *= (1 - o.ridge) + o.ridge * (0.3 + 1.4 * r);
      outUp[i] = v * o.strength;
      outRift[i] = rift[sy * W + sx] * o.strength;
    }
    return { up: outUp, rift: outRift };
  }

  // ---------- очистка мелких островов/озёр ----------
  function cleanup(h, W, H, minLand, minWater) {
    const N = W * H, lab = new Uint8Array(N), stack = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (lab[s]) continue;
      const land = h[s] > 0; const comp = []; let touches = false, sp = 0;
      stack[sp++] = s; lab[s] = 1;
      while (sp) {
        const i = stack[--sp]; comp.push(i);
        const x = i % W, y = (i / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
        if (x > 0 && !lab[i - 1] && (h[i - 1] > 0) === land) { lab[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < W - 1 && !lab[i + 1] && (h[i + 1] > 0) === land) { lab[i + 1] = 1; stack[sp++] = i + 1; }
        if (y > 0 && !lab[i - W] && (h[i - W] > 0) === land) { lab[i - W] = 1; stack[sp++] = i - W; }
        if (y < H - 1 && !lab[i + W] && (h[i + W] > 0) === land) { lab[i + W] = 1; stack[sp++] = i + W; }
      }
      if (land && comp.length < minLand) for (const c of comp) h[c] = -0.02;
      else if (!land && !touches && comp.length < minWater) for (const c of comp) h[c] = 0.02;
    }
  }

  // морфологическое «раскрытие» суши: убирает нитевидные перемычки и нити шириной ≤ 2r клеток (4-связная эрозия r раз, затем наращивание r раз)
  function openLand(h, W, H, r) {
    const N = W * H;
    let E = new Uint8Array(N); for (let i = 0; i < N; i++) if (h[i] > 0) E[i] = 1;
    const step = (src, grow) => {
      const T = new Uint8Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const l = x > 0 ? src[i - 1] : 0, rr = x < W - 1 ? src[i + 1] : 0, u = y > 0 ? src[i - W] : 0, d = y < H - 1 ? src[i + W] : 0;
        T[i] = grow ? (src[i] | l | rr | u | d) : (src[i] & l & rr & u & d);
      }
      return T;
    };
    for (let k = 0; k < r; k++) E = step(E, false);
    for (let k = 0; k < r; k++) E = step(E, true);
    for (let i = 0; i < N; i++) if (h[i] > 0 && !E[i]) h[i] = -0.02;
  }

  function oceanMask(h, W, H) {
    const N = W * H, m = new Uint8Array(N), stack = new Int32Array(N); let sp = 0;
    const push = (i) => { if (!m[i] && h[i] <= 0) { m[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i / W) | 0;
      if (x > 0) push(i - 1); if (x < W - 1) push(i + 1);
      if (y > 0) push(i - W); if (y < H - 1) push(i + W);
    }
    return m;
  }

  // ---------- контуры (marching squares) ----------
  function contours(f, W, H, level) {
    level = level || 0;
    const adj = new Map();
    const link = (a, b) => {
      let la = adj.get(a); if (!la) adj.set(a, la = []); la.push(b);
      let lb = adj.get(b); if (!lb) adj.set(b, lb = []); lb.push(a);
    };
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      const m = (f[i] > level ? 8 : 0) | (f[i + 1] > level ? 4 : 0) | (f[i + W + 1] > level ? 2 : 0) | (f[i + W] > level ? 1 : 0);
      if (m === 0 || m === 15) continue;
      const T = i * 2, B = (i + W) * 2, L = i * 2 + 1, R = (i + 1) * 2 + 1;
      switch (m) {
        case 1: case 14: link(L, B); break;
        case 2: case 13: link(B, R); break;
        case 3: case 12: link(L, R); break;
        case 4: case 11: link(T, R); break;
        case 5: link(T, R); link(L, B); break;
        case 6: case 9: link(T, B); break;
        case 7: case 8: link(T, L); break;
        case 10: link(T, L); link(B, R); break;
      }
    }
    const toPoint = (k) => {
      const idx = k >> 1, x = idx % W, y = (idx / W) | 0;
      if (k & 1) { const a = f[idx] - level, b = f[idx + W] - level; return [x, y + a / (a - b)]; }
      const a = f[idx] - level, b = f[idx + 1] - level; return [x + a / (a - b), y];
    };
    const seen = new Set(), loops = [];
    for (const [start, nb0] of adj) {
      if (seen.has(start)) continue;
      const keys = []; let prev = -1, cur = start;
      for (;;) {
        seen.add(cur); keys.push(cur);
        const nb = adj.get(cur);
        const next = nb[0] === prev && nb.length > 1 ? nb[1] : nb[0];
        if (next === undefined || seen.has(next)) break;
        prev = cur; cur = next;
      }
      if (keys.length >= 4) loops.push(keys.map(toPoint));
    }
    return loops;
  }


  // ---------- климат и гидрология ----------
  class Heap {
    constructor(n) { this.k = new Float64Array(n); this.v = new Int32Array(n); this.n = 0; }
    push(key, val) {
      if (this.n >= this.k.length) { const nk = new Float64Array(this.k.length * 2); nk.set(this.k); this.k = nk; const nv = new Int32Array(this.v.length * 2); nv.set(this.v); this.v = nv; }
      let i = this.n++; const k = this.k, v = this.v;
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v, out = v[0]; this.n--;
      const n = this.n;
      if (n > 0) {
        const key = k[n], val = v[n]; let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= key) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = key; v[i] = val;
      }
      return out;
    }
  }

  // Влажность: ветер несёт влагу с моря, суша и подъём её "выжимают" -> дождевая тень за хребтами
  // ---------- климат: широта, ветровые пояса, орографические осадки, дождевая тень ----------
  // Карта = полоса мира от ~75° с.ш. до ~75° ю.ш. (экватор посередине).
  // Ветер: пассаты (с востока) до ~30°, западные ветры 30–60°, полярные восточные выше.
  // Воздух набирает влагу над океаном (тем больше, чем он теплее), теряет её на подъёме над горами
  // и постепенно над сушей; за хребтом остаётся дождевая тень. Зональный множитель: дождливо у экватора
  // и в умеренных широтах, сухо у ~30° (пустыни).
  const LAND_SCALE = 0.9;      // v2: «Суши: X%» — доля пригодной площади (без океанского пояса у рамки); на всей карте ≈ X·LAND_SCALE
  const edgeK = K => (K || 0) <= 4 ? 1 : Math.max(0.1, 1 - ((K || 0) - 4) * 0.22);   // 1 для ≤4 материков, затем падает до 0.1 (при 8)
  const EDGE_SHIFT = 0.065;     // v2: океанический пояс у рамки (доля ширины карты)
  const MK = 0.34, JUNGLE_M = 0.86;   // v2: порог влажности джунглей (влажность в тропиках насыщается у 1.0, при 0.62 джунгли занимали две трети жаркого пояса)
  const MT_LO = 0.08, MT_HI = 0.15, HL_LO = 0.06, HL_HI = 0.12;   // v2: допустимая доля «молодых гор» (young>0.2) и холмов (old>0.14) на континентальной коре
  const BIOME = { OCEAN: 0, ICE: 1, TUNDRA: 2, TAIGA: 3, FOREST: 4, GRASS: 5, DESERT: 6, SAVANNA: 7, JUNGLE: 8, SWAMP: 9, ALPINE: 10 };
  function computeClimate(h, W, H, noise, v2) {
    const N = W * H, temp = new Float32Array(N), rain = new Float32Array(N);
    const phiOf = y => Math.abs((y + 0.5) / H * 2 - 1) * 75;
    const zonal = p => 0.16 + 0.95 * Math.exp(-Math.pow(p / 14, 2)) + 0.7 * Math.exp(-Math.pow((p - 55) / 13, 2));
    const f = 1 / (W * 0.12), sc = 480 / W;      // sc: поправка на размер мира (клетки мельче — расстояния в клетках больше)
    for (let y = 0; y < H; y++) {
      const p = phiOf(y), t0 = clamp((Math.cos(p * Math.PI / 180) - 0.2) / 0.8, 0, 1);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        temp[i] = h[i] > 0 ? t0 - 0.5 * Math.min(1.1, h[i]) + 0.06 * fbm(noise, x * f + 700, y * f + 700, 2) : t0;
      }
    }
    // морские течения: у восточных берегов суши в пассатной зоне идут тёплые течения к полюсу, у западных — холодные к экватору;
    // в умеренных широтах тёплые дрейфы греют западные берега материков, холодные течения идут у восточных. Влияет на температуру и (через испарение) осадки.
    const cur = new Float32Array(N), curDir = new Float32Array(N * 2), SC = Math.max(1, Math.round(14 * W / 480));
    for (let y = 0; y < H; y++) {
      const p = phiOf(y), north = y < H / 2 ? -1 : 1;                                        // north: куда «к полюсу» по оси y
      for (let x = 0; x < W; x++) {
        const i = y * W + x; if (h[i] > 0) continue;
        let dW = 99, dE = 99;
        for (let d = 1; d <= SC; d++) { if (dW === 99 && x - d >= 0 && h[y * W + x - d] > 0) dW = d; if (dE === 99 && x + d < W && h[y * W + x + d] > 0) dE = d; if (dW < 99 && dE < 99) break; }
        const near = Math.min(dW, dE); if (near === 99) continue;
        const fall = 1 - near / (SC + 1), east = dW <= dE;                                  // east: суша к западу от клетки, т.е. это восточный берег материка
        let v = 0, vx = 0, vy = 0;
        if (p < 42) { const k = (1 - p / 42) ** 0.5; if (east) { v = 1; vy = north; } else { v = -1; vy = -north; } v *= k; vx = 0; }
        else if (p < 68) { const k = Math.sin((p - 42) / 26 * Math.PI) * 0.9; if (!east) { v = 1; vx = 1; vy = north * 0.4; } else { v = -1; vy = -north; } v *= k; }
        cur[i] = v * fall; curDir[i * 2] = vx; curDir[i * 2 + 1] = vy;
      }
    }
    {   // распространение на сушу: нормированная свёртка, затухающая вглубь материка
      const om = new Float32Array(N), cv = new Float32Array(N), og = new Float32Array(N);
      for (let i = 0; i < N; i++) { if (h[i] <= 0) { om[i] = 1; cv[i] = cur[i]; } og[i] = h[i] <= 0 ? 1 : 0; }
      const cv2 = Float32Array.from(cv), om2 = Float32Array.from(om); FM.blur(cv2, W, H, Math.max(2, Math.round(5 * W / 480))); FM.blur(om2, W, H, Math.max(2, Math.round(5 * W / 480)));
      FM.blur(og, W, H, Math.max(3, Math.round(8 * W / 480)));
      for (let i = 0; i < N; i++) if (h[i] > 0) cur[i] = (cv2[i] / Math.max(0.02, om2[i])) * smooth(0.12, 0.5, og[i]) * 0.9;
    }
    for (let i = 0; i < N; i++) temp[i] += 0.14 * cur[i];
    FM.blur(temp, W, H, 2);
    for (let i = 0; i < N; i++) temp[i] = clamp(temp[i], 0, 1);
    const sweep = (dir, rowWeight) => {
      for (let y = 0; y < H; y++) {
        const wgt = rowWeight(phiOf(y)); if (wgt < 0.01) continue;
        const Z = zonal(phiOf(y));
        let q = 0.55, prev = 0;
        for (let xi = 0; xi < 2 * W; xi++) {        // два круга: воздух обходит планету по кругу, поэтому у края карты он уже несёт влагу с противоположного края (первый круг — разгон, не записывается)
          const wr = xi >= W, xx = xi % W, x = dir > 0 ? xx : W - 1 - xx, i = y * W + x, hv = h[i], T = temp[i];
          if (hv <= 0) { q += (1 - q) * 0.10 * sc * (0.3 + T); prev = 0; if (wr) rain[i] += wgt * 0.003 * q * Z; }
          else {
            const lift = Math.max(0, hv - prev); prev = hv;
            const r = q * (0.04 * sc * Z * (0.4 + T) + Math.min(0.5, lift * 12) * (0.6 + 0.4 * Z));
            if (wr) rain[i] += wgt * r; q = Math.max(0, q - r);
            q += 0.004 * sc * (0.3 + T) * (1 - q);
          }
        }
      }
    };
    const west = p => smooth(24, 36, p) * (1 - smooth(58, 68, p));
    sweep(1, west); sweep(-1, p => 1 - west(p));
    // холодные течения у берега иссушают сушу (Атакама, Намиб), тёплые добавляют осадков
    for (let i = 0; i < N; i++) if (h[i] > 0) rain[i] *= clamp(1 + 0.55 * cur[i], 0.45, 1.25);
    FM.blur(rain, W, H, 3);
    const moist = new Float32Array(N), biome = new Uint8Array(N);
    const wm = new Uint8Array(N); for (let i = 0; i < N; i++) wm[i] = h[i] <= 0 ? 1 : 0;
    const dsea = edt(wm, W, H);   // расстояние от суши до ближайшей воды (континентальность)
    // нормировка осадков по медиане над сушей: не зависит от размера мира и числа континентов
    const lr = []; for (let i = 0; i < N; i += 3) if (h[i] > 0) lr.push(rain[i]);
    lr.sort((a, b) => a - b);
    const med = Math.max(1e-6, lr.length ? lr[lr.length >> 1] : 1e-3);
    // v2: влажность для выбора биома сглажена (пустыни — связные области, а не россыпь пятен);
    // экватор влажнее (внутритропическая зона), subtropic-пояс ~27° суше (пустыни там, а не у экватора)
    const mb = v2 ? Float32Array.from(rain, (r, i) => clamp(0.08 + MK * Math.pow(r / med, 0.75), 0, 1)) : null;
    if (v2) FM.blur(mb, W, H, Math.max(2, Math.round(4 * W / 480)));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      moist[i] = clamp(0.08 + MK * Math.pow(rain[i] / med, 0.75) + 0.12 * fbm(noise, x * f + 300, y * f + 300, 3), 0, 1);
      if (h[i] <= 0) continue;
      const cont = clamp(dsea[i] * sc / 45, 0, 1);
      let M = moist[i] * (1 - 0.22 * cont);
      if (v2) { const ph = phiOf(y); M = (mb[i] + 0.1 * fbm(noise, x * f + 300, y * f + 300, 3)) * (1 - 0.22 * cont) + 0.12 * Math.exp(-Math.pow(ph / 11, 2)) - 0.12 * Math.exp(-Math.pow((ph - 27) / 9, 2)); }      // глубинные области материков суше
      const T = temp[i] - 0.07 * cont * smooth(0.15, 0.6, 1 - temp[i]);                      // и холоднее зимой (резче континентальность в умеренных и высоких широтах)
      let b;
      if (T < 0.1) b = BIOME.ICE;
      else if (T < 0.24) b = BIOME.TUNDRA;
      else if (T < 0.42) b = M > 0.38 ? BIOME.TAIGA : M > 0.17 ? BIOME.GRASS : BIOME.DESERT;
      else if (T < 0.72) b = M > 0.44 ? BIOME.FOREST : M > 0.24 ? BIOME.GRASS : BIOME.DESERT;
      else b = M > (v2 ? JUNGLE_M : 0.62) ? BIOME.JUNGLE : M > 0.37 ? BIOME.SAVANNA : M > 0.25 ? BIOME.GRASS : BIOME.DESERT;
      if (h[i] > 1.25 && T < 0.45) b = BIOME.ALPINE;
      biome[i] = b;
    }
    return { moist, temp, biome, current: cur, currentDir: curDir };
  }

  function chaikinOpen(pts, iter) {
    for (let it = 0; it < iter; it++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1], 0.75 * p[2] + 0.25 * q[2]]);
        out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1], 0.25 * p[2] + 0.75 * q[2]]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }

  function hydrology(h0, W, H, moist, threshold, noise, v2) {
    const N = W * H, EPS = 1e-4;
    const h = new Float32Array(N), fm = 1 / (W * 0.025);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; h[i] = h0[i] > 0 ? h0[i] + 0.075 * fbm(noise, x * fm + 500, y * fm + 500, 3) + 0.01 * noise(x * 0.9, y * 0.9) : h0[i]; if (h0[i] > 0 && h[i] <= 0) h[i] = 0.0005; }
    const filled = new Float32Array(N), down = new Int32Array(N).fill(-1), vis = new Uint8Array(N);
    const heap = new Heap(N), order = new Int32Array(N); let on = 0;
    for (let i = 0; i < N; i++) if (h[i] <= 0) { vis[i] = 1; filled[i] = h[i]; heap.push(h[i], i); }
    while (heap.n) {
      const c = heap.pop(); order[on++] = c;
      const x = c % W, y = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx; if (vis[n]) continue;
        vis[n] = 1; down[n] = c;
        filled[n] = Math.max(h[n], filled[c] + EPS * (dx && dy ? 1.4 : 1) * (1 + 5 * (((n * 2654435761) >>> 0) / 4294967296)));   // дрожание: реки в заполненных впадинах не идут по прямой
        heap.push(filled[n], n);
      }
    }
    const acc = new Float32Array(N);
    for (let i = 0; i < N; i++) acc[i] = h[i] > 0 ? 0.5 + 1.0 * moist[i] : 0;
    for (let j = on - 1; j >= 0; j--) { const c = order[j]; if (down[c] >= 0 && h[c] > 0) acc[down[c]] += acc[c]; }
    // озёра: связные впадины глубже LD и достаточного размера (уровень воды = уровень заполнения впадины)
    const lake = new Uint8Array(N), sz2 = (W / 480) * (W / 480), LD = v2 ? 0.06 : 0.055, minLake = v2 ? Math.max(5, Math.round(8 * sz2)) : Math.max(6, Math.round(14 * sz2)), bigLake = Math.max(20, Math.round(50 * sz2));
    {
      const cand = new Uint8Array(N), seen = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (h[i] > 0 && filled[i] - h[i] > (v2 && v2.force && v2.force[i] ? 0.01 : LD)) cand[i] = 1;
      const stack = [];
      for (let s0 = 0; s0 < N; s0++) {
        if (!cand[s0] || seen[s0]) continue;
        const comp = []; stack.push(s0); seen[s0] = 1;
        while (stack.length) {
          const c = stack.pop(); comp.push(c); const x = c % W, y = (c / W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (cand[n] && !seen[n]) { seen[n] = 1; stack.push(n); } }
        }
        if (v2) {   // v2: крупные озёра — только глубокие впадины (рельеф ухабистый); мелкие и цепочки — там, где их рождает природа (рифтовые долины, холодные широты, влажность): вероятность из поля pot
          let md = 0; for (const c of comp) md = Math.max(md, filled[c] - h[c]);
          const hs = (((comp[0] * 2654435761) >>> 0) / 4294967296);
          if (v2.force && comp.length >= minLake && comp.some(c => v2.force[c])) { for (const c of comp) lake[c] = 1; }
          else if (comp.length >= bigLake ? md > 0.1 : (comp.length >= minLake && md > 0.06 && hs < (v2.pot ? v2.pot[comp[0]] : 0.3))) for (const c of comp) lake[c] = 1;
        } else if (comp.length >= minLake) for (const c of comp) lake[c] = 1;
      }
    }
    const isRiver = new Uint8Array(N), upCount = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (h[i] > 0 && acc[i] >= threshold) isRiver[i] = 1;
    for (let i = 0; i < N; i++) if (isRiver[i] && down[i] >= 0 && isRiver[down[i]]) upCount[down[i]]++;
    const traced = new Uint8Array(N), rivers = [];
    const sources = [];
    for (let i = 0; i < N; i++) if (isRiver[i] && !upCount[i]) sources.push(i);
    sources.sort((a, b) => acc[b] - acc[a]);
    const wOf = (a) => Math.min(1, Math.sqrt(a / (threshold * 25)));
    for (const s of sources) {
      const pts = []; let c = s;
      for (;;) {
        pts.push([c % W, ((c / W) | 0), wOf(acc[c])]);
        const d = down[c];
        if (d < 0) break;
        if (h[d] <= 0) { pts.push([d % W, ((d / W) | 0), wOf(acc[c])]); break; }
        if (traced[d]) { pts.push([d % W, ((d / W) | 0), wOf(acc[d])]); break; }
        traced[c] = 1; c = d;
      }
      traced[c] = 1;
      if (pts.length < 9 * (W / 480)) continue;
      let run = [];                                      // русло режется озёрами: до входа в озеро и от выхода из него
      const idxOf = p => p[1] * W + p[0];
      const flushRun = () => { if (run.length >= 3) rivers.push(chaikinOpen(run, 2)); run = []; };
      for (let k = 0; k < pts.length; k++) {
        const inL = lake[idxOf(pts[k])];
        if (!inL) run.push(pts[k]);
        else { if (run.length) { run.push(pts[k]); flushRun(); } if (k + 1 < pts.length && !lake[idxOf(pts[k + 1])]) run = [pts[k]]; }
      }
      flushRun();
    }
    for (let i = 0; i < N; i++) if (lake[i]) { isRiver[i] = 0; h0[i] = -0.012; }
    return { rivers, riverMask: isRiver, acc, down, lake };
  }

  // ---------- батиметрия: шельф, склон, ложе океана, желоба у зон субдукции, срединные хребты ----------
  // Возвращает «эффективную глубину» wd в тех же единицах, что dist (клетки от берега, 0..~28): мелко у берега, глубоко вдали.
  // Шельф широкий у пассивных окраин и узкий у сходящихся границ плит; над границей схождения в океане — желоб, над расхождением — подъём дна.
  function bathymetry(h, dist, bd, W, H, noise) {
    const N = W * H, act = new Float32Array(N), trench = new Float32Array(N), ridge = new Float32Array(N), wd = new Float32Array(N);
    for (let i = 0; i < N; i++) if (bd.edge[i]) { if (bd.btype[i] === 1) { act[i] = 1; if (h[i] <= 0) trench[i] = 1; } else if (bd.btype[i] === 2 && h[i] <= 0) ridge[i] = 1; }
    FM.blur(act, W, H, Math.max(4, Math.round(9 * W / 480))); FM.blur(trench, W, H, 2); FM.blur(ridge, W, H, 3);
    let am = 1e-6; for (let i = 0; i < N; i++) am = Math.max(am, act[i]);
    const f = 1 / (W * 0.1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (h[i] > 0) continue;
      const d = dist[i], w = (22 - 13 * smooth(0.15, 0.7, act[i] / am)) * (1 + 0.25 * fbm(noise, x * f + 9, y * f + 4, 2));
      let v = d < w ? d * 12 / w : 12 + 16 * smooth(w, w * 3.2, d);
      v += 10 * smooth(0.05, 0.4, trench[i] * 8) * smooth(3, 10, d) - 6 * smooth(0.05, 0.4, ridge[i] * 6) * smooth(6, 16, d);
      wd[i] = Math.max(0, v);
    }
    return wd;
  }

  // ---------- основной генератор ----------
  // Генератор — функция-генератор: между этапами отдаёт имя этапа (yield), чтобы интерфейс мог показать ход работы. Синхронный FM.generate прогоняет её до конца без пауз.
  function* generateStages(params) {
    const t0 = performance.now();
    const W = params.W || 480, H = params.H || 320, N = W * H;
    const seed = String(params.seed);
    // модель мира одна (бывший genVersion 2); поле genVersion в карте оставлено для совместимости инструментов
    const genVersion = FM.GEN_VERSION;
    const count = Math.max(params.plateCount || 9, params.continents ? params.continents * (params.continents >= 4 ? 4 : 3) + 3 : 0);
    const landRatio = params.landRatio != null ? params.landRatio : 0.34;
    const epochs = params.epochs != null ? params.epochs : 2;

    yield 'plates';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // 1. плиты (можно передать отредактированные)
    const prand = sub(seed, params._try ? 'plates#' + params._try : 'plates');   // _try>0 — другая раскладка плит (v2: число массивов должно совпасть с K)
    let plates;
    if (params.plates && params.plates.length) {
      plates = params.plates.map(p => ({ x: p.x, y: p.y, type: p.type, weight: p.weight }));
    } else {
      plates = makePlates(prand, count, W, H, landRatio, params.continents || 0);
    }
    const noiseA = makeNoise(sub(seed, 'warp'));
    const noiseB = makeNoise(sub(seed, 'terrain'));
    const noiseC = makeNoise(sub(seed, 'ridge'));

    const id = assignPlates(plates, W, H, noiseA);
    mergeEnclaves(id, W, H, 0.012);   // осколки плит → в соседнюю плиту
    if (!(params.plates && params.plates.length) && (params.continents || 0) >= 2) {
      const K0 = params.continents, nC = clamp(Math.round(plates.length * (0.2 + landRatio * 0.9)), K0, plates.length - K0);
      separateContinents(plates, id, W, H, K0, nC);
      mergeEnclaves(id, W, H, 0.012);
    }
    const bd = analyzeBoundaries(plates, id, W, H);

    yield 'base';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // 2. базовая высота по типу коры
    const base = new Float32Array(N);
    for (let i = 0; i < N; i++) base[i] = plates[id[i]].type === 'continental' ? 0.22 : -0.42;
    blur(base, W, H, 7); blur(base, W, H, 5);
    let crust = null;
    {   // v2: основа высот — единое поле коры (плиты + границы); кратон высоко, шельф и океан низко
      crust = buildCrust(plates, id, bd, W, H, noiseA, params.continents);
      for (let i = 0; i < N; i++) base[i] = -0.87 + 2.14 * smooth(0.2, 0.9, crust[i]);
    }

    yield 'orogeny';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // 3. эпохи горообразования: текущая (молодые, острые хребты) + древние (стёртые, широкие)
    const kw = clamp(Math.sqrt(9 / plates.length), 0.6, 1.1);
    const kpl = clamp(Math.sqrt(9 / plates.length), 0.5, 1);   // мелкие плиты (много континентов) — мельче и формы: искажение берега подгоняем под размер плиты, иначе оно растягивает малые континенты в «головастиков» и щупальца
    const young = orogeny(bd, plates, id, W, H, { width: W * 0.032 * kw, strength: 1.25, ridge: 0.75, noise: noiseC });
    const old = new Float32Array(N);
    const oldRift = new Float32Array(N);
    for (let e = 0; e < epochs; e++) {
      const r = sub(seed, 'epoch' + e);
      const pl = makePlates(r, Math.max(5, count - 1), W, H, 0.55);
      const nz = makeNoise(sub(seed, 'epochnoise' + e));
      const eid = assignPlates(pl, W, H, nz);
      const ebd = analyzeBoundaries(pl, eid, W, H);
      const ev = orogeny(ebd, pl, eid, W, H, { width: W * (0.05 + e * 0.015), strength: 0.75 - e * 0.2, ridge: 0.35, noise: nz });
      for (let i = 0; i < N; i++) { old[i] = Math.max(old[i], ev.up[i]); oldRift[i] = Math.max(oldRift[i], ev.rift[i] * 0.4); }
    }
    // древние хребты существуют только на континентальной коре
    for (let i = 0; i < N; i++) {
      const cm = smooth(0.05, 0.3, base[i]);
      old[i] *= cm;
    }

    // v2: доля гор и холмов ограничена (иначе при удачном для хребтов раскладе плит горы занимают до трети суши, при неудачном — почти нет)
    {
      const fitShare = (f, thr, lo, hi) => {
        let n = 0; for (let i = 0; i < N; i++) if (base[i] > 0.2) n++;
        const share = (k) => { let c = 0; for (let i = 0; i < N; i++) if (base[i] > 0.2 && f[i] * k > thr) c++; return c / Math.max(1, n); };
        let a0 = 1, k = 1; const sh = share(1);
        if (sh > hi) { let l = 0.25, r = 1; for (let it = 0; it < 14; it++) { const m = (l + r) / 2; if (share(m) > hi) r = m; else l = m; } k = (l + r) / 2; }
        else if (sh < lo) { let l = 1, r = 2.2; for (let it = 0; it < 14; it++) { const m = (l + r) / 2; if (share(m) < lo) l = m; else r = m; } k = (l + r) / 2; }
        if (k !== a0) for (let i = 0; i < N; i++) f[i] *= k;
      };
      fitShare(young.up, 0.2, MT_LO, MT_HI);
      fitShare(old, 0.14, HL_LO, HL_HI);
    }

    yield 'height';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // 4. итоговая высота
    const elev = new Float32Array(N), rawN = new Float32Array(N);
    const edgeShift = W * EDGE_SHIFT * edgeK(params.continents);   // океанский пояс у рамки: при многих материках места мало — пояс уже
    const f1 = 1 / (W * 0.2), f2 = 1 / (W * 0.035);
    const lod = Math.max(0, Math.floor(Math.log2(W / 480) + 0.25));   // на крупных картах сетка разрешает октавы шума, которых на 480 не было видно: срезаем их, иначе берега рваные, а мелкой суши вдвое больше
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = 0.5 * fbm(noiseB, x * f1, y * f1, 6 - lod, 2, 0.55) + 0.12 * fbm(noiseB, x * f2 + 100, y * f2 + 100, 3 - Math.min(lod, 1));
      // у края листа суша плавно уходит под воду, граница моря неровная (шум), чтобы материки не «упирались» в рамку
      // пологий склон (≈0.2 ширины) + крупный шум: береговая линия определяется рельефом, а не повторяет рамку
      // вторая, мелкая волна смещения (0.04 W): без неё срез суши у рамки шёл почти прямой линией на 100+ клеток («прямоугольный» остров у угла); замер bbox-fill острова 0.47 → 0.34
      const eN = W * 0.09 * fbm(noiseA, x / (W * 0.28) + 7.3, y / (W * 0.28) + 2.1, 3) + W * 0.06 * fbm(noiseA, x / (W * 0.04) + 31.7, y / (W * 0.04) + 9.4, 4);
      // у боковых краёв спад шире (0.21 W), у полюсов уже (0.1 W): суша может доходить до субполярных широт (тундра, тайга), как на Земле
      let edge;
      // рамка — не форма материка: узкая шумовая кайма «океан у края листа», форму берега задаёт кора плит
      edge = (1 - smooth(0, 1, Math.min((Math.min(x, W - 1 - x) + eN - edgeShift) / (W * 0.07), (Math.min(y, H - 1 - y) + eN - edgeShift) / (W * 0.06)))) * 2.1;
      const rk = 0.35;   // v2: рифты — не прорези-трещины (их роль возьмёт этап 3: рифт → залив/внутреннее море)
      elev[i] = base[i] + n + young.up[i] * (crust ? 0.15 + 0.85 * smooth(0.1, 0.55, crust[i]) : 1) * 1.15 + old[i] * 0.8 - (young.rift[i] * 0.3 + oldRift[i] * 0.5) * rk - edge;
    }
    yield 'coast';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // v2, этап 3: иерархия береговых форм — по геологии, а не по шаблонам
    let mfld = null, lakePot = null;
    {
      mfld = marginFields(plates, id, bd, W, H);
      const fw = 1 / (W * 0.07), fb = 1 / (W * 0.028), fL = 1 / (W * 0.022);
      lakePot = new Float32Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, lat = Math.abs(y / H - 0.5) * 2; lakePot[i] = clamp(0.28 + 0.7 * mfld.rift[i] + 0.55 * smooth(0.5, 0.85, lat), 0, 0.95); }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, cr = crust[i], inland = 1 - smooth(0.5, 0.97, cr);
        // (а) рифт у берега → залив: вырез идёт вдоль линии рифта (кривая границы плит), ширина меняется шумом
        const wm = clamp(0.75 + 0.7 * fbm(noiseB, x * fw + 12.3, y * fw + 4.1, 2), 0.2, 1.5);
        elev[i] -= 2.3 * smooth(0.3, 0.85, mfld.rift[i]) * wm * inland;
        // расходящаяся окраина континент–океан: заливы очагами (бусины шума), а не по всему берегу
        const loc = smooth(0.15, 0.6, fbm(noiseB, x * fb * 0.55 + 41.7, y * fb * 0.55 + 7.9, 2));
        elev[i] -= 2.0 * smooth(0.3, 0.85, mfld.pass[i]) * loc * wm * (1 - smooth(0.45, 0.85, cr));
        // (б) субдукция/дуги → цепочки островов на океанической коре вдоль зоны сближения
        // цепочки озёр: бусины-впадины вдоль рифтовых долин и в холодных широтах (ледниковые озёра); только вглубь континента
        const lat = Math.abs(y / H - 0.5) * 2, glac = smooth(0.5, 0.85, lat), deep = smooth(0.85, 0.99, cr) * (1 - smooth(0.2, 0.5, mfld.conv[i]));
        const lb = smooth(0.36, 0.6, fbm(noiseB, x * fL + 7.1, y * fL * 0.8 + 3.3, 2));
        elev[i] -= 0.45 * lb * deep * (smooth(0.25, 0.65, mfld.rift[i]) + 0.45 + 0.9 * glac);
        const oc = 1 - smooth(0.1, 0.55, cr), beads = smooth(0.05, 0.5, fbm(noiseC, x * fb + 3.7, y * fb + 9.2, 2));
        elev[i] += young.up[i] * oc * 1.9 * beads;
      }
      // (в) внутренние моря — котловины в глубине континента (утончённая кора), неправильные по форме, без шаблона-эллипса
      const br = sub(seed, 'basins'), nB = Math.max(1, Math.floor((params.continents || 2) * 0.3 + br() * 0.9)), cand = [];
      for (let y = Math.round(H * 0.15); y < H * 0.85; y += 3) for (let x = Math.round(W * 0.15); x < W * 0.85; x += 3) { const i = y * W + x; if (crust[i] > 0.99 && young.up[i] < 0.12 && mfld.conv[i] < 0.2) cand.push([x, y]); }
      const bs = [];
      for (let t = 0; t < 80 && bs.length < nB && cand.length; t++) {
        const c = cand[Math.floor(br() * cand.length)];
        if (bs.some(b => Math.hypot(b.x - c[0], b.y - c[1]) < W * 0.17)) continue;
        bs.push({ x: c[0], y: c[1], R: W * (0.02 + 0.022 * br()), th: br() * 6.283, asp: 1.4 + 1.6 * br(), amp: 1.3 + 0.7 * br() });
      }
      for (const b of bs) {
        const R2 = b.R * 3, cs = Math.cos(b.th), sn = Math.sin(b.th);
        for (let y = Math.max(0, Math.floor(b.y - R2)); y < Math.min(H, b.y + R2); y++) for (let x = Math.max(0, Math.floor(b.x - R2)); x < Math.min(W, b.x + R2); x++) {
          const wx = x + b.R * 1.1 * fbm(noiseA, x / (b.R * 1.6) + b.x, y / (b.R * 1.6) + b.y, 3), wy = y + b.R * 1.1 * fbm(noiseA, x / (b.R * 1.6) + b.y + 30, y / (b.R * 1.6) + b.x + 30, 3);
          const dx = wx - b.x, dy = wy - b.y, u = (dx * cs + dy * sn) / (b.R * Math.sqrt(b.asp)), v = (-dx * sn + dy * cs) / (b.R / Math.sqrt(b.asp));
          elev[y * W + x] -= b.amp * Math.exp(-(u * u + v * v));
        }
      }
    }
    // заданное число континентов: у каждого своё ядро, между соседними ядрами вырезается океанический пролив (по искривлённой «биссектрисе»)
    const K = params.continents || 0;
    {   // коробление береговой линии: заливы и полуострова разной изрезанности (деформация поля высот вместе с рельефом)
      const wr = sub(seed, 'arch'), rug = 0.5 + 1.1 * wr(), amp1 = W * (0.02 + 0.06 * wr()) * kpl, amp2 = W * 0.011 * rug * kpl, f1 = 1 / (W * 0.19 * kpl), f2 = 1 / (W * 0.055 * kpl), amp3 = W * 0.0042 * rug, f3 = 1 / (W * 0.02);   // третий, мелкий масштаб: мысы, бухты и извилины берега (иначе берег — гладкие «кляксы»)
      const src = Float32Array.from(elev);
      let gxF = null, gyF = null, ptot = null;
      if (mfld) {   // v2: анизотропия по типу окраины — вдоль границы плит смещение свободно, поперёк (оно и рождает заливы и полуострова) слабое у активных окраин и сильное у рифтовых/пассивных
        ptot = new Float32Array(N); for (let i = 0; i < N; i++) ptot[i] = Math.max(mfld.rift[i], mfld.pass[i], mfld.conv[i], mfld.shear[i]);
        const pb = Float32Array.from(ptot); blur(pb, W, H, Math.max(2, Math.round(W * 0.012))); blur(pb, W, H, Math.max(2, Math.round(W * 0.012)));
        gxF = new Float32Array(N); gyF = new Float32Array(N);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; gxF[i] = pb[i + 1] - pb[i - 1]; gyF[i] = pb[i + W] - pb[i - W]; }
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let dx = amp1 * fbm(noiseA, x * f1 + 90.5, y * f1 + 11.3, 3) + amp2 * fbm(noiseA, x * f2 + 20.1, y * f2 + 70.7, 3) + amp3 * fbm(noiseA, x * f3 + 7.7, y * f3 + 31.9, 2);
        let dy = amp1 * fbm(noiseA, x * f1 + 33.3, y * f1 + 140.2, 3) + amp2 * fbm(noiseA, x * f2 + 61.9, y * f2 + 5.5, 3) + amp3 * fbm(noiseA, x * f3 + 52.3, y * f3 + 9.1, 2);
        if (mfld) {
          const i = y * W + x, gl = Math.hypot(gxF[i], gyF[i]), wgt = smooth(0.002, 0.012, gl);
          if (wgt > 0) {
            const nx = gxF[i] / gl, ny = gyF[i] / gl, dn = dx * nx + dy * ny, dt = -dx * ny + dy * nx;
            const kN = clamp(1 + 1.1 * mfld.rift[i] + 0.35 * mfld.pass[i] - 0.65 * mfld.conv[i], 0.3, 2.1), k = 1 + (kN - 1) * wgt;
            dx = dt * (-ny) + k * dn * nx; dy = dt * nx + k * dn * ny;
          }
        }
        const sx = clamp(x + dx, 0, W - 1.001), sy = clamp(y + dy, 0, H - 1.001);
        const x0 = Math.floor(sx), y0 = Math.floor(sy), u = sx - x0, v = sy - y0, i0 = y0 * W + x0;
        elev[y * W + x] = src[i0] * (1 - u) * (1 - v) + src[i0 + 1] * u * (1 - v) + src[i0 + W] * (1 - u) * v + src[i0 + W + 1] * u * v;
      }
    }
    blur(elev, W, H, 1);

    yield 'sea';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // 5. уровень моря по доле суши
    const sorted = Float32Array.from(elev).sort();
    const seaLevel = sorted[Math.floor((1 - landRatio * (1 - (1 - LAND_SCALE) * edgeK(params.continents))) * (N - 1))];
    const h = new Float32Array(N);
    for (let i = 0; i < N; i++) h[i] = elev[i] - seaLevel;
    if (K >= 2) {   // формы континентов подняли общий уровень рельефа — возвращаем привычное распределение высот суши (медиана ~0.5, p75 ~0.7)
      const lv = []; for (let i = 0; i < N; i++) if (h[i] > 0) lv.push(h[i]); lv.sort((a, b) => a - b);
      const p75 = lv[Math.floor(lv.length * 0.75)] || 1, kk = 0.71 / p75;
      for (let i = 0; i < N; i++) if (h[i] > 0) h[i] *= kk;
    }
    // страховка: у самого края всегда остаётся море (иначе береговая линия обрывается на рамке и замыкается прямыми)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dm = Math.min(x, W - 1 - x, y, H - 1 - y) + W * 0.015 * fbm(noiseA, x / (W * 0.1) + 3.3, y / (W * 0.1) + 9.1, 2);
      if (dm < W * 0.045) { const i = y * W + x; h[i] = Math.min(h[i], 0.3 * (dm / (W * 0.045)) - 3.2 * (1 - dm / (W * 0.045)) ); }
    }

    {   // регуляризация берега: сглаживание поля высот у уровня моря (кривизной) убирает «пальцы», узкие протоки и дыры, не трогая крупную форму материков
      const reg = FM.__reg == null ? 3.5 : FM.__reg, rr = Math.round(reg * W / 480);
      if (rr >= 1) {
        const hb = Float32Array.from(h); blur(hb, W, H, rr); blur(hb, W, H, rr);
        for (let i = 0; i < N; i++) { const v = h[i], w = Math.exp(-(v * v) / (2 * 0.25 * 0.25)); h[i] = v + (hb[i] - v) * w; }
      }
    }

    yield 'islands';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // 5b. острова и архипелаги: группы трёх видов — архипелаг (скопление вдоль вытянутого овала), дуга (цепь по дуге окружности), одиночный остров
    const islandGroups = [];
    {
      const nG = params.islands != null ? params.islands : 3, ir = sub(seed, 'isles'), sc = W / 480;
      const bumps = [];                                    // [x, y, радиус, пик]
      const okSpot = (x, y, margin) => { if (x < W * 0.08 || x > W * 0.92 || y < H * 0.12 || y > H * 0.88) return false; const i = Math.round(y) * W + Math.round(x); if (h[i] > -0.22) return false; for (const g2 of islandGroups) if (Math.hypot(g2.x - x, g2.y - y) < margin) return false; return true; };
      {   // v2: виды групп островов по геологии и окружению, а не «дуга или прямая»
        const hAt = (x, y) => (x < 1 || y < 1 || x > W - 2 || y > H - 2) ? 9 : h[Math.round(y) * W + Math.round(x)];
        const inBox = (x, y) => x > W * 0.07 && x < W * 0.93 && y > H * 0.1 && y < H * 0.9;
        const dl = new Float32Array(N); for (let i = 0; i < N; i++) dl[i] = h[i] > 0 ? 0 : 1e4;   // расстояние до суши (метрика 3-4)
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; let v = dl[i]; if (x > 0) v = Math.min(v, dl[i - 1] + 1); if (y > 0) { v = Math.min(v, dl[i - W] + 1); if (x > 0) v = Math.min(v, dl[i - W - 1] + 1.41); if (x < W - 1) v = Math.min(v, dl[i - W + 1] + 1.41); } dl[i] = v; }
        for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; let v = dl[i]; if (x < W - 1) v = Math.min(v, dl[i + 1] + 1); if (y < H - 1) { v = Math.min(v, dl[i + W] + 1); if (x < W - 1) v = Math.min(v, dl[i + W + 1] + 1.41); if (x > 0) v = Math.min(v, dl[i + W - 1] + 1.41); } dl[i] = v; }
        const dAt = (x, y) => dl[Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))];
        const far = (x, y, d) => islandGroups.every(g2 => Math.hypot(g2.x - x, g2.y - y) > d);
        const gauss = () => (ir() + ir() + ir() - 1.5) * 1.6;
        const pool = [['arc', 1.0], ['cluster', 1.4], ['shelf', 1.0], ['atoll', 0.5], ['skerries', 0.7], ['single', 0.5]], chosen = [];
        const pick = () => { const av = pool.filter(q => !chosen.includes(q[0])), src = av.length ? av : pool; let tot = 0; for (const q of src) tot += q[1]; let r = ir() * tot; for (const q of src) { r -= q[1]; if (r <= 0) return q[0]; } return src[0][0]; };
        for (let gi = 0; gi < nG; gi++) {
          let kind = pick(); chosen.push(kind);
          for (let attempt = 0; attempt < 2; attempt++) {
            let placed = false;
            for (let t = 0; t < 90 && !placed; t++) {
              const x = W * (0.1 + 0.8 * ir()), y = H * (0.15 + 0.7 * ir()), lat = Math.abs(y / H - 0.5) * 2, list = [];
              const add = (px, py, r, pk) => { if (inBox(px, py) && hAt(px, py) < -0.04) list.push([px, py, r, pk]); };
              if (kind === 'single') { if (!okSpot(x, y, 60 * sc)) continue; add(x, y, (5 + 4 * ir()) * sc, 0.32); }
              else if (kind === 'cluster') {          // скопление из нескольких подгрупп с гауссовым разбросом, размеры неравные
                if (!okSpot(x, y, 60 * sc)) continue;
                const nSub = 2 + Math.floor(ir() * 3);
                for (let q = 0; q < nSub; q++) { const a0 = ir() * 6.283, r0 = ir() * 30 * sc, cx = x + Math.cos(a0) * r0, cy = y + Math.sin(a0) * r0, cnt = 4 + Math.floor(ir() * 5), sg = (4.5 + 4 * ir()) * sc; for (let k = 0; k < cnt; k++) add(cx + gauss() * sg, cy + gauss() * sg, (2 + 4.6 * ir() * ir()) * sc, 0.24 + 0.2 * ir()); }
              } else if (kind === 'arc') {            // вулканическая дуга: идёт вдоль настоящей зоны сближения плит (с изгибами), а не по окружности
                const cvAt = (px, py) => mfld ? mfld.conv[Math.min(H - 1, Math.max(0, Math.round(py))) * W + Math.min(W - 1, Math.max(0, Math.round(px)))] : 0;
                if (cvAt(x, y) < 0.35 || hAt(x, y) > -0.3 || !far(x, y, 50 * sc)) continue;
                const gx = cvAt(x + 3, y) - cvAt(x - 3, y), gy = cvAt(x, y + 3) - cvAt(x, y - 3);
                let head = Math.atan2(gy, gx) + (ir() < 0.5 ? 1 : -1) * Math.PI / 2, px = x, py = y; const n = 8 + Math.floor(ir() * 7), step = (5 + 2.5 * ir()) * sc;
                for (let k = 0; k < n; k++) {
                  let bh = head, bv = -1; for (let q = -2; q <= 2; q++) { const hh = head + q * 0.4 + (ir() - 0.5) * 0.3, v = cvAt(px + Math.cos(hh) * step, py + Math.sin(hh) * step) + 0.1 * ir(); if (v > bv) { bv = v; bh = hh; } }
                  if (bv < 0.12) break; head = bh; px += Math.cos(head) * step; py += Math.sin(head) * step;
                  if (ir() < 0.12) continue;
                  const env = Math.pow(Math.sin(Math.PI * (k + 0.5) / n), 0.7); add(px, py, (2.6 + 3.6 * ir() * env) * (ir() < 0.2 ? 1.5 : 1) * sc, 0.28 + 0.25 * env);
                }
              } else if (kind === 'shelf') {          // обломки шельфа: вытянутые острова у берега с мелкими спутниками
                if (hAt(x, y) > -0.06 || hAt(x, y) < -0.4 || dAt(x, y) < 3 * sc || dAt(x, y) > 14 * sc || !inBox(x, y) || !far(x, y, 40 * sc)) continue;
                const nIs = 1 + Math.floor(ir() * 3);
                for (let q = 0; q < nIs; q++) { const ox = x + (ir() - 0.5) * 16 * sc, oy = y + (ir() - 0.5) * 16 * sc, a0 = ir() * Math.PI, L = (10 + 14 * ir()) * sc, m = 4 + Math.floor(ir() * 3), r0 = (3 + 2.5 * ir()) * sc; for (let k = 0; k < m; k++) { const tt = k / (m - 1) - 0.5; add(ox + Math.cos(a0) * L * tt, oy + Math.sin(a0) * L * tt, r0 * (1 - 0.5 * Math.abs(tt) * 1.6), 0.3 + 0.1 * ir()); } }
                for (let q = 0; q < 3 + Math.floor(ir() * 3); q++) add(x + gauss() * 14 * sc, y + gauss() * 14 * sc, (1.8 + 1.4 * ir()) * sc, 0.26);
              } else if (kind === 'atoll') {          // кольцо островков вокруг лагуны, в тёплых широтах и глубокой воде
                if (lat > 0.55 || hAt(x, y) > -0.35 || dAt(x, y) < 14 * sc || !far(x, y, 50 * sc)) continue;
                const R0 = (7 + 4 * ir()) * sc, n = 10 + Math.floor(ir() * 6);
                for (let k = 0; k < n; k++) { if (ir() < 0.2) continue; const a = (k + (ir() - 0.5) * 0.4) / n * 6.283, rr = R0 * (0.85 + 0.3 * ir()); add(x + Math.cos(a) * rr, y + Math.sin(a) * rr, (1.9 + 1.4 * ir()) * sc, 0.24 + 0.1 * ir()); }
              } else {                                // шхеры: россыпь мелких островков вдоль берега
                if (dAt(x, y) < 2 * sc || dAt(x, y) > 8 * sc || hAt(x, y) > -0.04 || !far(x, y, 40 * sc)) continue;
                const cnt = 14 + Math.floor(ir() * 12);
                for (let k = 0; k < cnt; k++) { const px = x + gauss() * 14 * sc, py = y + gauss() * 14 * sc, d = dAt(px, py); if (d < 1.5 * sc || d > 11 * sc) continue; add(px, py, (1.7 + 1.6 * ir()) * sc, 0.24 + 0.12 * ir()); }
              }
              if (list.length < (kind === 'single' ? 1 : 3)) continue;
              for (const b of list) bumps.push(b);
              islandGroups.push({ kind, x, y, n: list.length, pts: list.map(b => [b[0], b[1]]) }); placed = true;
            }
            if (placed) break; kind = 'cluster';
          }
        }
      }
      const inoise = makeNoise(sub(seed, 'isle-noise')), fq = 1 / (W * 0.03);
      for (const [bx, by, br, pk] of bumps) {
        const asp = 1 + 1.3 * Math.abs(Math.sin(bx * 12.9898 + by * 78.233 + br * 3.7)), ang = (Math.sin(bx * 4.1 + by * 9.3) * 43758.5453 % 1) * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);   // острова вытянуты (не круглая «галька»), ось случайна
        const R = Math.ceil(br * 1.6 * Math.sqrt(asp));
        for (let y = Math.max(0, Math.floor(by - R)); y <= Math.min(H - 1, Math.ceil(by + R)); y++) for (let x = Math.max(0, Math.floor(bx - R)); x <= Math.min(W - 1, Math.ceil(bx + R)); x++) {
          const fr = 1 / (br * 2.4), ux = ((x - bx) * ca + (y - by) * sa) / Math.sqrt(asp), uy = (-(x - bx) * sa + (y - by) * ca) * Math.sqrt(asp), d = Math.hypot(ux, uy) / br, shape = d * d + 0.55 * fbm(inoise, x * fq + 3, y * fq + 7, 3) + 0.7 * fbm(inoise, x * fr + bx * 0.37, y * fr + by * 0.37, 2);   // второй шум — в масштабе самого островка: берег изрезан, а не гладкий овал
          if (shape >= 1.3) continue;
          const v = pk * (1 - Math.max(0, shape) / 1.3) ** 1.2 + 0.015 * (1 - d);
          const i = y * W + x; if (v > 0.02) h[i] = Math.max(h[i], v - 0.04 + (h[i] > -0.3 ? h[i] * 0 : 0));
        }
      }
    }

    yield 'hotspots';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // 6. горячие точки: цепочки вулканических островов вдоль следа плиты
    const hrand = sub(seed, 'hotspots');
    const volcanoes = [];
    const chains = params.hotspots != null ? params.hotspots : 2;
    for (let c = 0; c < chains; c++) {
      for (let tries = 0; tries < 60; tries++) {
        const sx = W * (0.12 + 0.76 * hrand()), sy = H * (0.15 + 0.7 * hrand());
        const si = Math.round(sy) * W + Math.round(sx);
        if (h[si] > -0.4) continue;
        const pl = plates[id[si]];
        const ang = plateDir(id[si]) + Math.PI, n = 4 + Math.floor(hrand() * 3), sp = (9 + hrand() * 5) * (W / 480);
        const pts = []; let ok = true, cx = sx, cy = sy, aa = ang; const bend2 = (hrand() - 0.5) * 0.7;
        for (let k = 0; k < n; k++) {
          let px, py;
          { if (k > 0) { aa += bend2 * (0.6 + 0.8 * hrand()); const st = sp * (0.7 + 0.7 * hrand()); cx += Math.cos(aa) * st; cy += Math.sin(aa) * st; } px = cx; py = cy; }   // v2: цепочка изгибается (смена движения плиты), шаги неравные
          if (px < W * 0.07 || px > W * 0.93 || py < H * 0.1 || py > H * 0.9 || h[Math.round(py) * W + Math.round(px)] > -0.25) { ok = false; break; }
          pts.push([px, py]);
        }
        if (!ok) continue;
        pts.forEach(([px, py], k) => {
          const sigma = Math.max(1.8, 4.2 - k * 0.5) * (W / 480);   // размеры цепочки — в долях карты, не в клетках
          const amp = -h[Math.round(py) * W + Math.round(px)] + 0.1 + 0.4 * (1 - k / n);
          const R = Math.ceil(sigma * 3);
          for (let yy = Math.max(0, Math.floor(py) - R); yy <= Math.min(H - 1, Math.floor(py) + R); yy++)
            for (let xx = Math.max(0, Math.floor(px) - R); xx <= Math.min(W - 1, Math.floor(px) + R); xx++)
              h[yy * W + xx] += amp * Math.exp(-((xx - px) ** 2 + (yy - py) ** 2) / (2 * sigma * sigma));
          if (k === 0) volcanoes.push({ x: px, y: py, size: 1, active: true, kind: 'hotspot' });
        });
        break;
      }
    }

    {   // шероховатость берега: шум добавляется к высоте только вблизи уровня моря. Перемещение берега = амплитуда / уклон, поэтому пологие берега рвутся сильно (заливы, лиманы, шхеры), крутые остаются чистыми
      const cr = sub(seed, 'coast-rough'), cn = makeNoise(cr), c1 = 1 / (W * 0.045), c2 = 1 / (W * 0.016), cp = 1 / (W * 0.13), oc = Math.max(2, 4 - lod), lscale = W / 480, hs0 = Float32Array.from(h); blur(hs0, W, H, 2);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, v = h[i]; if (v > 0.2 || v < -0.2 || x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
        const band = Math.exp(-(v * v) / (2 * 0.12 * 0.12)), r = 0.7 * fbm(cn, x * c1 + 13.1, y * c1 + 5.7, oc) + 0.5 * fbm(cn, x * c2 + 71.3, y * c2 + 29.9, 2);
        const patch = smooth(-0.3, 0.35, fbm(cn, x * cp + 41.7, y * cp + 17.3, 2)), kc = mfld ? 1 - 0.5 * mfld.conv[i] : 1;   // изрезанность участками: гладкие дуги берега чередуются с рваными; у гор (сближение плит) берег ровнее
        if (FM.__rough === 'old') { h[i] = v + 0.15 * band * r * (0.3 + 1.15 * patch) * kc; continue; }
        // смещение берега ограничено в клетках: амплитуда = уклон × расстояние (иначе на пологой равнине тот же шум рвёт берег на «пальцы» и протоки)
        const gx = (hs0[i + 1] - hs0[i - 1]) * 0.5, gy = (hs0[i + W] - hs0[i - W]) * 0.5, gl = Math.hypot(gx, gy);
        h[i] = v + Math.min(0.15 * band, gl * 3.4 * lscale * band) * r * (0.3 + 1.15 * patch) * kc;
      }
    }
    // вулканы на суше: на самых высоких участках молодых хребтов, вдали друг от друга; часть действующих
    const nLand = params.volcanoes != null ? params.volcanoes : 3;
    const cand = [];
    for (let i = 0; i < N; i++) if (h[i] > 0.15 && young.up[i] > 0.7) cand.push(i);
    for (let k = 0; k < nLand && cand.length; k++) {
      for (let t = 0; t < 40; t++) {
        const i = cand[Math.floor(hrand() * cand.length)], x = i % W, y = (i / W) | 0;
        if (x < W * 0.1 || x > W * 0.9 || y < H * 0.12 || y > H * 0.88) continue;
        if (volcanoes.some(v => (v.x - x) ** 2 + (v.y - y) ** 2 < 45 * 45)) continue;
        volcanoes.push({ x, y, size: 1, active: hrand() < 0.55, kind: 'arc' }); break;
      }
    }

    const checkMasses = () => {
    if (params._try != null && params._try < 16 && (params.continents || 0) >= 2 && !(params.plates && params.plates.length)) {   // число массивов (≥3% суши, 4-связно) = K, иначе — следующая раскладка плит
      const lab = new Uint8Array(N), st = new Int32Array(N); let landN = 0; const sizes = [];
      for (let i = 0; i < N; i++) if (h[i] > 0) landN++;
      for (let s0 = 0; s0 < N; s0++) {
        if (lab[s0] || h[s0] <= 0) continue; let sp = 0, n = 0; st[sp++] = s0; lab[s0] = 1;
        while (sp) { const i = st[--sp]; n++; const x = i % W; if (x > 0 && !lab[i - 1] && h[i - 1] > 0) { lab[i - 1] = 1; st[sp++] = i - 1; } if (x < W - 1 && !lab[i + 1] && h[i + 1] > 0) { lab[i + 1] = 1; st[sp++] = i + 1; } if (i >= W && !lab[i - W] && h[i - W] > 0) { lab[i - W] = 1; st[sp++] = i - W; } if (i < N - W && !lab[i + W] && h[i + W] > 0) { lab[i + W] = 1; st[sp++] = i + W; } }
        if (n >= Math.max(8 * (W / 480) ** 2, 0)) sizes.push(n);
      }
      if (sizes.filter(n => n >= 0.03 * landN / (1 - (1 - LAND_SCALE) * edgeK(params.continents))).length !== params.continents) throw { fmRetry: true };   // порог «массива» — 3% суши в масштабе до сужения (острова не растут в долях при меньшей суше)
    }
    };
    if (params.landEdits && params.landEdits.some(e => !e.local) && FM.applyLandEdits) {   // ручная правка суши старого вида (до 0.86): до фьордов, катастроф и климата; «точечные» (local) применяет FM.patchMap
      FM.applyLandEdits(h, W, H, params.landEdits.map(e => e.local ? { pts: [] } : e), (i) => sub(seed, 'land' + i));
      for (let k = volcanoes.length - 1; k >= 0; k--) { const v = volcanoes[k]; if (v.kind === 'arc' && h[Math.round(v.y) * W + Math.round(v.x)] <= 0.02) volcanoes.splice(k, 1); }
    }
    yield 'inlets';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // изрезанные берега: фьорды в горных берегах высоких широт, рии в умеренных; свой поток ГСЧ
    const inl = FM.__noInl ? { events: [], mask: null } : FM.carveInlets(h, W, H, young.up, old, sub(seed, 'inlets'));
    // катастрофы (метеориты, расколы, каньоны, кальдеры, провалы): после тектоники, до климата и гидрологии; свой поток ГСЧ
    const cat = (params.catastrophes || (params.catManual && params.catManual.length)) ? FM.applyCatastrophes(h, W, H, params.catastrophes, sub(seed, 'catastrophes'), { volcanoes, manual: params.catManual, manualRand: (i) => sub(seed, 'catm' + i) }) : null;
    cleanup(h, W, H, Math.round(8 * (W / 480) ** 2), Math.round(150 * (W / 480) ** 2));
    {   // нитевидные перемычки суши: срезаем (r≈1 клетка на 480), при несовпадении числа массивов — сильнее; только потом перебор раскладок
      const lm = Math.max(1, Math.round(W / 480)), minW = Math.round(150 * (W / 480) ** 2), minL = Math.round(8 * (W / 480) ** 2);
      openLand(h, W, H, lm); cleanup(h, W, H, minL, minW);
      try { checkMasses(); } catch (e) {
        if (!(e && e.fmRetry)) throw e;
        openLand(h, W, H, lm * 2); cleanup(h, W, H, minL, minW);
        checkMasses();   // ранняя дешёвая проверка: перебор раскладок до климата и гидрологии
      }
    }
    if (params._probe) return null;   // пробный прогон (подбор раскладки плит для крупной карты): дальше считать нечего

    const S = { W, H, N, seed, genVersion, params, crust, mfld, plates, id, bd, seaLevel, young, old, volcanoes, islandGroups, noiseB, noiseC, lakePot, cat, inl, t0, checkMasses, landRatio, epochs, h };
    return yield* finishWorld(S);
  }
  // Хвост генерации (климат → реки → дно → итоговая карта) вынесен отдельно: им же пересчитывается карта после правки суши (FM.patchMap), состояние S хранится в map._S
  function* finishWorld(S) {
    const { W, H, N, seed, genVersion, params, crust, mfld, plates, id, bd, seaLevel, young, old, volcanoes, islandGroups, noiseB, noiseC, lakePot, cat, inl, t0, checkMasses, landRatio, epochs, h } = S;
    S.hPre = Float32Array.from(h);   // высоты до климата и гидрологии (гидрология вписывает озёра в h)
    yield 'climate';   // граница этапа для индикатора прогресса (FM.generateAsync)
    // 7. производные поля
    const clim = computeClimate(h, W, H, noiseB, true); if (S.climHook) S.climHook(clim);
    const moist = clim.moist;
    yield 'rivers';   // граница этапа для индикатора прогресса (FM.generateAsync)
    const hyd = hydrology(h, W, H, moist, (params.riverThreshold || 55) * (W / 480) * (W / 480), noiseC, { pot: lakePot, force: cat ? cat.force : null });   // озёра вписываются в h как вода
    {   // озёра вырезаются из суши уже после cleanup и оставляют одиночные клетки и осколки между собой (на крупных картах их много): осколок мельче порога — тоже вода озера
      const minL2 = Math.round(12 * (W / 480) ** 2), lab = new Uint8Array(N), st = new Int32Array(N);
      for (let s0 = 0; s0 < N; s0++) {
        if (lab[s0] || h[s0] <= 0) continue;
        let sp = 0, n = 0; st[sp++] = s0; lab[s0] = 1; const comp = [];
        while (sp) { const i = st[--sp]; comp.push(i); n++; const x = i % W;
          if (x > 0 && !lab[i - 1] && h[i - 1] > 0) { lab[i - 1] = 1; st[sp++] = i - 1; } if (x < W - 1 && !lab[i + 1] && h[i + 1] > 0) { lab[i + 1] = 1; st[sp++] = i + 1; }
          if (i >= W && !lab[i - W] && h[i - W] > 0) { lab[i - W] = 1; st[sp++] = i - W; } if (i < N - W && !lab[i + W] && h[i + W] > 0) { lab[i + W] = 1; st[sp++] = i + W; } }
        if (n < minL2) for (const c of comp) { h[c] = -0.012; hyd.lake[c] = 1; hyd.riverMask[c] = 0; }
      }
    }
    for (let i = 0; i < N; i++) if (hyd.lake[i]) clim.biome[i] = 0;
    const landMask = new Uint8Array(N);
    let landCount = 0;
    for (let i = 0; i < N; i++) { landMask[i] = h[i] > 0 ? 1 : 0; landCount += landMask[i]; }
    yield 'seabed';   // граница этапа для индикатора прогресса (FM.generateAsync)
    const dist = edt(landMask, W, H);       // расстояние от воды до суши (клетки)
    const ocean = oceanMask(h, W, H);
    const wd = bathymetry(h, dist, bd, W, H, noiseC);
    // болота: низкие ровные влажные места у рек, озёр и пологих берегов (в тёплом и умеренном поясе)
    {
      const wet = new Uint8Array(N); for (let i = 0; i < N; i++) if (hyd.lake[i] || hyd.riverMask[i]) wet[i] = 1;
      const nearWet = new Uint8Array(N), R2 = Math.max(2, Math.round(3.5 * W / 480));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (wet[y * W + x]) for (let dy = -R2; dy <= R2; dy++) for (let dx = -R2; dx <= R2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) nearWet[ny * W + nx] = 1; }
      const sn = makeNoise(sub(seed, 'swamp')), fq = 1 / (W * 0.04);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, b = clim.biome[i];
        if (h[i] <= 0 || h[i] > 0.4 || young.up[i] > 0.12 || old[i] > 0.3 || clim.temp[i] < 0.3 || clim.moist[i] < 0.34) continue;
        if (b !== BIOME.FOREST && b !== BIOME.GRASS && b !== BIOME.JUNGLE && b !== BIOME.SAVANNA && b !== BIOME.TAIGA) continue;
        const slope = Math.abs(h[i + 1] - h[i - 1]) + Math.abs(h[i + W] - h[i - W]);
        if (slope > 0.22) continue;   // порог под рельеф v2: низменности у берега круче, чем были в старой модели
        if (!nearWet[i] && !(h[i] < 0.05)) continue;
        if (fbm(sn, x * fq, y * fq, 3) > (nearWet[i] ? 0.0 : 0.25)) clim.biome[i] = BIOME.SWAMP;
      }
    }

    checkMasses();   // итоговая проверка (озёра и реки могут изменить сушу)
    const map = {
      W, H, seed, genVersion, crust, margin: mfld, params: { plateCount: plates.length, landRatio, epochs },
      plates, plateId: id, boundary: bd,
      h, seaLevel, young: young.up, old, dist, wd, ocean, volcanoes,
      moist, temp: clim.temp, biome: clim.biome, current: clim.current, currentDir: clim.currentDir, islandGroups, rivers: hyd.rivers, riverMask: hyd.riverMask, riverAcc: hyd.acc, riverDown: hyd.down, acc: hyd.acc, lake: hyd.lake,
      landFraction: landCount / N, inlets: inl.events, inletMask: inl.mask, catastrophes: cat ? cat.events.filter(e => !((e.kind === 'meteor' || e.kind === 'caldera') && h[Math.round(e.y) * W + Math.round(e.x)] <= 0 && !hyd.lake[Math.round(e.y) * W + Math.round(e.x)])) : [],
      genMs: performance.now() - t0
    };
    if (S.postHook) S.postHook(map);
    Object.defineProperty(map, '_S', { value: S, enumerable: false, writable: true });
    return map;
  }

  FM.BIOME = BIOME;
  // Расстояние (клетки, фаска 1/1.41) до ближайшей клетки маски
  function maskDist(mask, W, H) {
    const N = W * H, d = new Float32Array(N), INF = 1e9, q = 1.4142;
    for (let i = 0; i < N; i++) d[i] = mask[i] ? 0 : INF;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; let v = d[i]; if (x > 0) v = Math.min(v, d[i - 1] + 1); if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + q); if (x < W - 1) v = Math.min(v, d[i - W + 1] + q); } d[i] = v; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; let v = d[i]; if (x < W - 1) v = Math.min(v, d[i + 1] + 1); if (y < H - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + q); if (x > 0) v = Math.min(v, d[i + W - 1] + q); } d[i] = v; }
    return d;
  }
  // Точечная правка готовой карты: мазки суши (FM.applyLandEdits) применяются к высотам ДО климата и гидрологии (S.hPre), хвост генерации (finishWorld: климат → реки → озёра → дно)
  // пересчитывается целиком, но в итоговую карту берётся только зона правки (+ запас): вне неё остаются прежние значения всех полей. baseIdx — номер первого мазка (для его ГСЧ).
  // Возвращает { map, region, changed, dist } либо null (карта без состояния _S, например загруженная из старого кода). Реки: старые линии вне зоны + новые внутри.
  function patchMap(map, edits, baseIdx) {
    const S0 = map && map._S; if (!S0 || !S0.hPre || !edits || !edits.length) return null;
    const { W, H, N } = S0, sc = W / 480, t0 = performance.now();
    const hNew = Float32Array.from(S0.hPre);
    FM.applyLandEdits(hNew, W, H, edits, (i) => sub(S0.seed, 'land' + ((baseIdx || 0) + i)));
    cleanup(hNew, W, H, Math.round(8 * sc * sc), Math.round(150 * sc * sc));
    const changed = new Uint8Array(N); let nCh = 0, maxR = 0;
    for (let i = 0; i < N; i++) if (Math.abs(hNew[i] - S0.hPre[i]) > 1e-6) { changed[i] = 1; nCh++; }
    for (const e of edits) maxR = Math.max(maxR, e.r || 0);
    if (!nCh) return { map, region: new Uint8Array(N), changed, dist: null, same: true };
    const volc = S0.volcanoes.filter(v => !(v.kind === 'arc' && hNew[Math.round(v.y) * W + Math.round(v.x)] <= 0.02));   // вулкан на вырезанной суше исчезает
    const S2 = Object.assign({}, S0, { h: hNew, volcanoes: volc, checkMasses: () => {}, postHook: null, climHook: null });
    const it = finishWorld(S2); let r; while (!(r = it.next()).done);
    const mN = r.value;
    const dc = maskDist(changed, W, H), D1 = Math.round(10 * sc + 0.5 * maxR), D2 = Math.round(32 * sc), F = Math.max(3, Math.round(0.4 * D1));
    const R1 = new Uint8Array(N), R2 = new Uint8Array(N), wt = new Float32Array(N);
    for (let i = 0; i < N; i++) { const d = dc[i]; if (d <= D1) { R1[i] = 1; wt[i] = d <= D1 - F ? 1 : (D1 - d) / F; } if (d <= D2) R2[i] = 1; }
    const out = {}; for (const k of Object.keys(map)) if (k[0] !== '_') out[k] = map[k];
    const mix = (key, R, soft) => {
      const o = map[key], nw = mN[key]; if (!o || !nw || o.length !== N) return;
      const c = o.constructor === Float64Array ? new Float64Array(o) : new o.constructor(o);
      for (let i = 0; i < N; i++) if (R[i]) c[i] = soft ? o[i] + (nw[i] - o[i]) * wt[i] : (soft === false ? nw[i] : nw[i]);
      out[key] = c;
    };
    for (const k of ['h', 'riverMask', 'riverDown', 'lake']) mix(k, R1, false);
    for (const k of ['moist', 'temp', 'current', 'currentDir']) mix(k, R1, true);
    { const o = map.biome, c = new o.constructor(o); for (let i = 0; i < N; i++) if (R1[i] && wt[i] >= 0.5) c[i] = mN.biome[i]; out.biome = c; }
    mix('riverAcc', R1, false); out.acc = out.riverAcc;
    for (const k of ['dist', 'wd', 'ocean']) mix(k, R2, false);
    // линии рек: старые — только вне зоны, новые — только внутри (стык ±1 точка)
    const inR = (p) => R1[Math.min(H - 1, Math.max(0, Math.round(p[1]))) * W + Math.min(W - 1, Math.max(0, Math.round(p[0])))] === 1;
    const clip = (list, keepInside) => { const res = []; for (const rv of list) { let run = []; for (let k = 0; k < rv.length; k++) { const ok = inR(rv[k]) === keepInside; if (ok) { if (!run.length && k > 0) run.push(rv[k - 1]); run.push(rv[k]); } else { if (run.length) { run.push(rv[k]); if (run.length >= 2) res.push(run); run = []; } } } if (run.length >= 2) res.push(run); } return res; };
    out.rivers = clip(map.rivers, false).concat(clip(mN.rivers, true));
    out.volcanoes = volc; out.catastrophes = mN.catastrophes;
    let lc = 0; for (let i = 0; i < N; i++) if (out.h[i] > 0) lc++; out.landFraction = lc / N; out.genMs = performance.now() - t0;
    S2.h = out.h; Object.defineProperty(out, '_S', { value: S2, enumerable: false, writable: true });
    return { map: out, region: R1, changed, dist: dc };
  }
  FM.patchMap = patchMap;
  FM.GEN_VERSION = 2;           // единственная модель; legacy (genVersion 1) удалён в 0.75.0
  function generateOnce(params) { const it = generateStages(params); let r; while (!(r = it.next()).done); return r.value; }
  // v2 без заданных плит: до 8 раскладок плит, пока число массивов не станет равно K (детерминированно по seed)
  function generate(params) {
    if ((params.continents || 0) < 2 || (params.plates && params.plates.length)) return generateOnce(params);
    // крупная карта: раскладку плит, дающую K массивов, ищем «пробой» на 480×320 (до климата и гидрологии, без катастроф) — одна попытка на крупной карте стоит секунды и десятки секунд (у 1440×960 ≈ 17 с), а число попыток при K ≥ 5 доходит до 7
    let t0 = 0;
    if ((params.W || 480) > 600) {
      for (let t = 0; t < 16; t++) {
        t0 = t;
        try { generateOnce(Object.assign({}, params, { W: 480, H: 320, _try: t, _probe: true, catastrophes: null, catManual: null })); break; } catch (e) { if (!(e && e.fmRetry)) throw e; t0 = t + 1; }
      }
    }
    for (let t = t0; t < 16; t++) {
      try { FM.lastTries = t + 1; return generateOnce(Object.assign({}, params, { _try: t })); } catch (e) { if (!(e && e.fmRetry)) throw e; }
    }
    FM.lastTries = 17; return generateOnce(Object.assign({}, params, { _try: 16 }));   // не вышло — последняя (без проверки)
  }
  // Асинхронный вариант с отчётом о ходе: onStage(имя_этапа, номер_попытки) вызывается на границах этапов и может вернуть Promise (дать браузеру перерисоваться). Результат тот же, что у FM.generate.
  async function generateAsync(params, onStage) {
    const step = async (p, tryNo) => { const it = generateStages(p); for (;;) { const r = it.next(); if (r.done) return r.value; if (onStage) await onStage(r.value, tryNo); } };
    if ((params.continents || 0) < 2 || (params.plates && params.plates.length)) return step(params, 0);
    let t0 = 0;
    if ((params.W || 480) > 600) {
      if (onStage) await onStage('probe', 0);
      for (let t = 0; t < 16; t++) {
        t0 = t;
        try { generateOnce(Object.assign({}, params, { W: 480, H: 320, _try: t, _probe: true, catastrophes: null, catManual: null })); break; } catch (e) { if (!(e && e.fmRetry)) throw e; t0 = t + 1; }
      }
    }
    for (let t = t0; t < 16; t++) {
      try { FM.lastTries = t + 1; return await step(Object.assign({}, params, { _try: t }), t); } catch (e) { if (!(e && e.fmRetry)) throw e; }
    }
    FM.lastTries = 17; return step(Object.assign({}, params, { _try: 16 }), 16);
  }
  FM.generateAsync = generateAsync;
  FM.generate = generate;
  FM.blur = blur;
  FM.Heap = Heap;
  FM.edt = edt;
  FM.contours = contours;
  FM.smooth = smooth;
  FM.clamp = clamp;
})(window.FM);
