// Дно океана: модель рельефа дна и его структур по тектонике плит.
// Всё выводится из уже сгенерированного мира (плиты, их границы и скорости, суша, реки), случайность — только детерминированная от seed.
//   возраст коры ← расстояние до срединных хребтов (спрединг), глубина ложа ← возраст (термическое оседание: 2600 + 350·√t м);
//   жёлоба и вулканические дуги — на сходящихся границах (под континент уходит океаническая плита, а между океаническими — более старая);
//   трансформные разломы смещают ось хребта, их продолжения — зоны разломов; горячие точки — цепи гор вдоль движения плиты (старые оседают,
//   теряют вершины-гайоты, в тропиках образуют атоллы); шельф/склон/подножие — от суши и типа окраины; каньоны — от устьев крупных рек.
// Биология и ресурсы дна — в seafloor_life.js (опираются на эту модель).
(function (FM) {
  'use strict';
  const { mulberry32, hashString, makeNoise, fbm, clamp, smooth } = FM;
  const lerp = (a, b, t) => a + (b - a) * t, G = (x, w) => Math.exp(-(x * x) / (w * w));

  // расстояние до ближайшего источника (хэмфер 1/√2 в два прохода) и метка этого источника
  function chamfer(W, H, seeds, labels) {
    const N = W * H, d = new Float32Array(N).fill(1e9), src = new Int32Array(N).fill(-1);
    for (let k = 0; k < seeds.length; k++) { const i = seeds[k]; d[i] = 0; src[i] = labels ? labels[k] : k; }
    const A = 1, B = 1.4142;
    const rel = (i, j, c) => { if (d[j] + c < d[i]) { d[i] = d[j] + c; src[i] = src[j]; } };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x > 0) rel(i, i - 1, A); if (y > 0) { rel(i, i - W, A); if (x > 0) rel(i, i - W - 1, B); if (x < W - 1) rel(i, i - W + 1, B); } }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (x < W - 1) rel(i, i + 1, A); if (y < H - 1) { rel(i, i + W, A); if (x < W - 1) rel(i, i + W + 1, B); if (x > 0) rel(i, i + W - 1, B); } }
    return { d, src };
  }
  function rasterPts(pts, W, H, out, step) {
    step = step || 0.5;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[Math.min(pts.length - 1, k + 1)], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let s = 0; s < n; s++) { const x = Math.round(a[0] + (b[0] - a[0]) * s / n), y = Math.round(a[1] + (b[1] - a[1]) * s / n); if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x); }
    }
  }
  // цепочки отрезков (границ плит) → ломаные
  function chain(segs) {
    const key = (x, y) => (x + 2) * 4096 + (y + 2), ends = new Map(), used = new Uint8Array(segs.length), out = [];
    segs.forEach((s, i) => { for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { let l = ends.get(k); if (!l) ends.set(k, l = []); l.push(i); } });
    const next = (x, y) => { const l = ends.get(key(x, y)); if (!l) return -1; for (const j of l) if (!used[j]) return j; return -1; };
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue; used[i] = 1;
      const s = segs[i], line = [[s[0], s[1]], [s[2], s[3]]];
      for (let dir = 0; dir < 2; dir++) for (;;) {
        const e = dir ? line[0] : line[line.length - 1], j = next(e[0], e[1]); if (j < 0) break;
        used[j] = 1; const t = segs[j], o = (t[0] === e[0] && t[1] === e[1]) ? [t[2], t[3]] : [t[0], t[1]];
        if (dir) line.unshift(o); else line.push(o);
      }
      out.push(line.map(p => [p[0] / 2, p[1] / 2]));
    }
    return out;
  }
  function smoothPoly(p, it) {
    let a = p;
    for (let k = 0; k < it; k++) { const b = a.map(q => q.slice()); for (let i = 1; i < a.length - 1; i++) { b[i][0] = (a[i - 1][0] + 2 * a[i][0] + a[i + 1][0]) / 4; b[i][1] = (a[i - 1][1] + 2 * a[i][1] + a[i + 1][1]) / 4; } a = b; }
    return a;
  }
  function resample(p, step) {
    if (p.length < 2) return p;
    const out = [p[0].slice()]; let acc = 0;
    for (let i = 1; i < p.length; i++) {
      let a = p[i - 1], seg = Math.hypot(p[i][0] - a[0], p[i][1] - a[1]), t = 0;
      while (acc + seg - t >= step) { t += step - acc; acc = 0; out.push([a[0] + (p[i][0] - a[0]) * t / seg, a[1] + (p[i][1] - a[1]) * t / seg]); }
      acc += seg - t;
    }
    out.push(p[p.length - 1].slice()); return out;
  }
  const plen = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };
  const tangent = (p, i) => { const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };

  FM.seafloor = function (map) {
    const key = map.seed + '|' + FM.uiLang + '|' + map.W + 'x' + map.H;
    if (map._sf && map._sf.key === key) return map._sf;
    const { W, H, h, plates, plateId, boundary: bd, temp, current } = map, N = W * H, sc = W / 720, sq = Math.sqrt(sc);
    const rnd = mulberry32(hashString(map.seed + '|seafloor')), nz = makeNoise(mulberry32(hashString(map.seed + '|sf1'))), nz2 = makeNoise(mulberry32(hashString(map.seed + '|sf2')));
    const water = new Uint8Array(N); for (let i = 0; i < N; i++) water[i] = h[i] <= 0 && !(map.lake && map.lake[i]) ? 1 : 0;
    const idx = (x, y) => Math.round(y) * W + Math.round(x), inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const isW = (x, y) => inb(Math.round(x), Math.round(y)) && water[idx(x, y)] === 1;
    const kmCell = 40000 / W;                                   // км на клетку при ширине карты = экватору

    // ---------- суша: компоненты, площади, расстояние до берега ----------
    const comp = new Int32Array(N).fill(-1), area = [];
    for (let s = 0; s < N; s++) {
      if (water[s] || comp[s] >= 0) continue;
      const id = area.length, st = [s]; comp[s] = id; let n = 0;
      while (st.length) { const i = st.pop(); n++; const x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && !water[j] && comp[j] < 0) { comp[j] = id; st.push(j); } }
      area.push(n);
    }
    const landSeeds = [], landLab = []; for (let i = 0; i < N; i++) if (!water[i]) { landSeeds.push(i); landLab.push(comp[i]); }
    const dl = chamfer(W, H, landSeeds, landLab), dLand = dl.d;

    // ---------- ширина шельфа: узкая у сходящихся границ, у островов уже ----------
    const act = new Float32Array(N); for (let i = 0; i < N; i++) if (bd.edge[i] && bd.btype[i] === 1) act[i] = 1;
    FM.blur(act, W, H, Math.max(4, Math.round(9 * W / 480))); let am = 1e-6; for (let i = 0; i < N; i++) am = Math.max(am, act[i]);
    const actN = new Float32Array(N), shW = new Float32Array(N), fsh = 1 / (W * 0.1), arf = new Float32Array(N);
    for (let i = 0; i < N; i++) { actN[i] = act[i] / am; const ar = dl.src[i] >= 0 ? area[dl.src[i]] : 1e5; arf[i] = smooth(20, 1500, ar); }
    FM.blur(arf, W, H, Math.max(4, Math.round(10 * sc)));        // площадной фактор сглажен по полю: на стыке «ближайших» берегов нет скачков и прямых обрывов дна
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      shW[i] = (4 + 11 * (1 - smooth(0.15, 0.7, actN[i]))) * (1 + 0.3 * fbm(nz, x * fsh + 9, y * fsh + 4, 2)) * sc * (0.3 + 0.7 * arf[i]);
    }

    // ---------- границы плит в воде: хребты, трансформы, желоба ----------
    const pairInfo = (a, b) => {
      const pa = plates[a], pb = plates[b]; let nx = pb.x - pa.x, ny = pb.y - pa.y; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const c = FM.pairConv(plates, a, b).c;
      return { n: [nx, ny], kind: c > 0.12 ? 1 : c < -0.12 ? 2 : 3 };
    };
    const plAge = plates.map(() => 40 + 120 * rnd());          // «возраст/плотность» плит: при столкновении океанических уходит под другую более старая
    const pairs = new Map();
    const addSeg = (a, b, s) => { if (a > b) { const t = a; a = b; b = t; } const k = a * 64 + b; let l = pairs.get(k); if (!l) pairs.set(k, l = []); l.push(s); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = plateId[i]; if (!water[i]) continue;
      if (x < W - 1 && water[i + 1] && plateId[i + 1] !== a) addSeg(a, plateId[i + 1], [2 * x + 1, 2 * y - 1, 2 * x + 1, 2 * y + 1]);
      if (y < H - 1 && water[i + W] && plateId[i + W] !== a) addSeg(a, plateId[i + W], [2 * x - 1, 2 * y + 1, 2 * x + 1, 2 * y + 1]);
    }
    const ridges = [], faults = [], fz = [], transforms = [], trenches = [], arcPts = [];
    const minLen = 7 * sc;
    // разбиение ломаной на подряд идущие участки, где выполняется условие
    const splitBy = (arr, okf) => { const out = []; let cur = []; arr.forEach((e, i) => { if (okf(e, i)) cur.push(e); else { if (cur.length) out.push(cur); cur = []; } }); if (cur.length) out.push(cur); return out; };
    const deepOk = (p) => isW(p[0], p[1]) && dLand[idx(p[0], p[1])] >= 9 * sc;     // хребты и разломы — только в открытом океане
    const runKind = (a, b, line) => {                                                // тип границы определяется локально: сближение / расхождение / сдвиг
      const pa = plates[a], pb = plates[b], mx = pb.x - pa.x, my = pb.y - pa.y, c0 = FM.pairConv(plates, a, b).c, ph = FM.pairHash(a, b, 5) * 6.283;
      const ns = line.map((p, i) => { const t = tangent(line, i); let nx = -t[1], ny = t[0]; if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; } return [nx, ny, clamp(c0 + 0.4 * Math.sin(i * 0.045 + ph), -1, 1)]; });   // c0 — тип стыка пары, синус — смена участков вдоль границы
      const cm = ns.map((_, i) => { let q = 0, n = 0; for (let j = Math.max(0, i - 5); j <= Math.min(ns.length - 1, i + 5); j++) { q += ns[j][2]; n++; } return q / n; });
      const kd = cm.map(c => c > 0.14 ? 1 : c < -0.14 ? 2 : 3);
      for (let pass = 0; pass < 2; pass++) { let s0 = 0; for (let i = 1; i <= kd.length; i++) if (i === kd.length || kd[i] !== kd[s0]) { if (i - s0 < 6 && s0 > 0) for (let q = s0; q < i; q++) kd[q] = kd[s0 - 1]; s0 = i; } }
      return { ns, kd };
    };
    for (const [k, segs] of pairs) {
      const a = k >> 6, b = k & 63, ta = plates[a].type, tb = plates[b].type;
      for (const raw of chain(segs)) {
        if (plen(raw) < minLen) continue;
        const line = resample(smoothPoly(raw, 14), 1.4); if (line.length < 5) continue;
        const { ns, kd } = runKind(a, b, line);
        let s0 = 0;
        for (let e = 1; e <= line.length; e++) {
          if (e < line.length && kd[e] === kd[s0]) continue;
          const part = line.slice(s0, e), nsp = ns.slice(s0, e), kind = kd[s0]; s0 = e;
          if (part.length < 4) continue;
          let nx0 = 0, ny0 = 0; for (const q of nsp) { nx0 += q[0]; ny0 += q[1]; } const nl = Math.hypot(nx0, ny0) || 1, info = { n: [nx0 / nl, ny0 / nl], kind };
          if (kind === 2) {
            // срединный хребет: секции, смещённые трансформными разломами вдоль направления спрединга
            for (const sub of splitBy(part, deepOk)) {
              if (plen(sub) < minLen) continue;
              const L = plen(sub), secLen = (16 + rnd() * 16) * sc, nSec = Math.max(1, Math.round(L / secLen)), per = Math.ceil(sub.length / nSec);
              let off = 0, prevEnd = null;
              for (let s = 0; s < nSec; s++) {
                const pt = sub.slice(s * per, Math.min(sub.length, (s + 1) * per + 1)); if (pt.length < 2) continue;
                let o2 = s === 0 ? 0 : clamp(off + (rnd() < 0.5 ? -1 : 1) * (1.5 + rnd() * 3.5) * sc, -6 * sc, 6 * sc);
                const sh = pt.map(p => [p[0] + info.n[0] * o2, p[1] + info.n[1] * o2]);
                if (!sh.every(deepOk)) { o2 = 0; }
                const pts = o2 === 0 ? pt : sh;
                if (prevEnd && Math.hypot(pts[0][0] - prevEnd[0], pts[0][1] - prevEnd[1]) > 0.8) faults.push({ pts: [prevEnd, pts[0]], n: info.n });
                ridges.push({ pts, pair: [a, b] }); prevEnd = pts[pts.length - 1]; off = o2;
              }
            }
          } else if (kind === 3) {
            for (const sub of splitBy(part, deepOk)) if (plen(sub) >= minLen) transforms.push({ pts: sub, pair: [a, b] });
          } else if (kind === 1 && !(ta === 'continental' && tb === 'continental')) {
            let sub = a, over = b;
            if (ta === 'continental') { sub = b; over = a; } else if (tb === 'continental') { sub = a; over = b; } else if (plAge[a] < plAge[b]) { sub = b; over = a; }
            const cs = plates[sub], out = []; let run = [];
            part.forEach((p, i) => {
              const t = tangent(part, i); let nx = -t[1], ny = t[0]; if (nx * (cs.x - p[0]) + ny * (cs.y - p[1]) < 0) { nx = -nx; ny = -ny; }
              const q = [p[0] + nx * 1.3 * sq, p[1] + ny * 1.3 * sq];
              if (isW(q[0], q[1])) run.push({ p: q, dir: [-nx, -ny] }); else { if (run.length) out.push(run); run = []; }
            });
            if (run.length) out.push(run);
            for (const r of out) if (r.length >= 5) trenches.push({ pts: r.map(e => e.p), dir: r.map(e => e.dir), sub, over, pair: [a, b] });
          }
        }
      }
    }
    // зоны разломов — продолжения трансформных смещений за пределы оси, вдоль направления спрединга
    for (const f of faults) {
      const mid = [(f.pts[0][0] + f.pts[1][0]) / 2, (f.pts[0][1] + f.pts[1][1]) / 2];
      for (const sg of [-1, 1]) {
        const len = (14 + rnd() * 42) * sc, pts = [mid.slice()]; let x = mid[0], y = mid[1], ph = rnd() * 6;
        for (let s = 0; s < len; s += 1.2) {
          x += f.n[0] * sg * 1.2; y += f.n[1] * sg * 1.2; const w = 0.9 * Math.sin(s * 0.07 + ph) + 0.5 * Math.sin(s * 0.19 + ph * 2); x += -f.n[1] * w * 0.22; y += f.n[0] * w * 0.22;
          if (!isW(x, y) || dLand[idx(x, y)] < 3) break; pts.push([x, y]);
        }
        if (pts.length > 4) fz.push({ pts });
      }
    }

    // ---------- поля расстояний ----------
    const rs = []; for (const r of ridges) rasterPts(r.pts, W, H, rs); const dR = rs.length ? chamfer(W, H, rs).d : null;
    const ts = [], tl = []; trenches.forEach((t, k) => { const before = ts.length; rasterPts(t.pts, W, H, ts); for (let q = before; q < ts.length; q++) tl.push(k); });
    const dtc = ts.length ? chamfer(W, H, ts, tl) : null;
    const fs2 = []; for (const f of fz) rasterPts(f.pts, W, H, fs2); for (const f of faults) rasterPts(f.pts, W, H, fs2); for (const t of transforms) rasterPts(t.pts, W, H, fs2);
    const dF = fs2.length ? chamfer(W, H, fs2).d : null;
    const cwS = new Float32Array(N); if (map.crust) cwS.set(map.crust); else { for (let i = 0; i < N; i++) cwS[i] = plates[plateId[i]].type === 'continental' ? 1 : 0; FM.blur(cwS, W, H, Math.max(2, Math.round(3 * sc))); }   // v2: единое поле коры из генератора
    const myrCell = kmCell / 35;                                // млн лет на клетку при полускорости 3.5 см/год
    const tw = 1.9 * sq;

    // ---------- глубины ----------
    const depth = new Float32Array(N), age = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!water[i]) { depth[i] = 0; continue; }
      const dR_ = dR ? dR[i] : 1e3, ag = dR ? Math.min(190, dR_ * myrCell * (0.92 + 0.16 * fbm(nz2, x * 0.03, y * 0.03, 2))) : 80 + 70 * fbm(nz2, x * 0.01, y * 0.01, 2);
      age[i] = ag;
      const d = dLand[i], w = shW[i];
      let oce = Math.min(5900, 2600 + 350 * Math.sqrt(ag));
      const rough = (60 + 150 * G(dR_, 7 * sc)) * (1 - 0.7 * Math.exp(-d / (18 * sc)));
      oce += rough * fbm(nz, x * 0.22, y * 0.22, 2) + 230 * fbm(nz2, x * 0.018 + 5, y * 0.018, 2);
      oce -= 700 * Math.exp(-d / (16 * sc));                    // осадки заполняют подножие континентов
      const cont = Math.pow(cwS[i], 1.3) * (1 - smooth(w * 1.6, w * 4.5, d)), base = lerp(oce, 160 + 380 * (0.5 + 0.5 * fbm(nz, x * 0.03, y * 0.03, 2)), cont);
      let dep;
      if (d < w) dep = 5 + 190 * Math.pow(d / w, 1.7);
      else { const sl = w * (0.35 + 0.65 * (1 - actN[i])); dep = lerp(196, Math.max(base, 196), smooth(w, w + sl * 1.6, d)); }
      if (dtc && dtc.d[i] < 16 * tw) {
        const dT = dtc.d[i], tr = trenches[dtc.src[i]], over = plateId[i] === tr.over ? 1 : plateId[i] === tr.sub ? -1 : 0;
        const target = clamp(7200 + 3300 * smooth(30, 160, ag) + 500 * fbm(nz, x * 0.1, y * 0.1, 2), 7000, 11000);
        dep = lerp(dep, Math.max(dep, target), G(dT, tw) * (over >= 0 ? 1 : 0.85));
        if (over > 0) dep -= 1100 * G(dT - 3.6 * tw, 2 * tw) + 1600 * G(dT - 8 * tw, 2.4 * tw);
        else if (over < 0) dep -= 280 * G(dT - 6 * tw, 2.5 * tw);
      }
      if (dR) dep += 330 * G(dR_, 1.1 * sq);
      if (dF) dep += 140 * G(dF[i], 0.9 * sq);
      depth[i] = clamp(dep, 5, 11500);
    }
    const sf = { key, W, H, sc, water, depth, age, dLand, comp, area, ridges, faults, fz, transforms, trenches, cones: [], hotspots: [], plateaus: [], canyons: [], fans: [], vents: [], labels: [], names: new Set() };

    // ---------- подводные горы: конусы, гайоты, атоллы ----------
    const carve = (c) => {
      const R = Math.ceil(c.r * 2) + 1, flat = c.flat ? 0.3 : 0;
      for (let yy = Math.max(0, Math.floor(c.y) - R); yy <= Math.min(H - 1, Math.floor(c.y) + R); yy++) for (let xx = Math.max(0, Math.floor(c.x) - R); xx <= Math.min(W - 1, Math.floor(c.x) + R); xx++) {
        const i = yy * W + xx; if (!water[i]) continue; const t = Math.hypot(xx - c.x, yy - c.y) / (c.r * 2); if (t >= 1) continue;
        const v = c.summit + (depth[i] - c.summit) * smooth(flat, 1, t) + 60 * Math.max(0, 1 - t) * (rnd() - 0.5) * 0;
        if (v < depth[i]) depth[i] = Math.max(15, v);
      }
    };
    const okCone = (x, y, minDep, gap) => {
      if (!isW(x, y)) return false; const i = idx(x, y); if (depth[i] < (minDep || 1200) || dLand[i] < 5 * sc) return false;
      if (dtc && dtc.d[i] < 3 * tw) return false;
      for (const c of sf.cones) if (Math.hypot(c.x - x, c.y - y) < (gap || 2.5)) return false; return true;
    };
    const addCone = (c) => { const i = idx(c.x, c.y); c.base = depth[i]; carve(c); c.summit = Math.min(c.summit, c.base); sf.cones.push(c); return c; };
    const warmAt = (x, y) => temp[idx(x, y)] >= 0.86;
    // горячие точки: цепи вдоль движения плиты, старые оседают → гайоты, в тропиках → атоллы
    const chains = [];
    for (const v of map.volcanoes) if (v.kind === 'hotspot') chains.push({ x: v.x, y: v.y, gen: true });
    const extra = 2 + Math.floor(rnd() * 2);
    for (let e = 0, tries = 0; e < extra && tries < 200; tries++) {
      const x = W * (0.1 + 0.8 * rnd()), y = H * (0.14 + 0.72 * rnd());
      if (!isW(x, y) || depth[idx(x, y)] < 3200 || dLand[idx(x, y)] < 14 * sc || chains.some(c => Math.hypot(c.x - x, c.y - y) < 60 * sc)) continue;
      chains.push({ x, y, gen: false }); e++;
    }
    for (const c of chains) {
      const pl = plates[plateId[idx(c.x, c.y)]], ang = FM.plateDir(plateId[idx(c.x, c.y)]) + Math.PI, vcm = 3 + 7 * 0.7, sp = (8 + 5 * rnd()) * sc, n = c.gen ? 7 : 6 + Math.floor(rnd() * 3), track = [[c.x, c.y]], pts = [];
      let ok = true;
      for (let k = 0; k < n; k++) {
        const px = c.x + Math.cos(ang) * sp * k, py = c.y + Math.sin(ang) * sp * k; if (!inb(Math.round(px), Math.round(py))) break;
        let bx = px, by = py;                                   // привязка к реальному «бугру» на карте высот (острова от генератора)
        if (c.gen) { let bh = -1e9; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const q = idx(px + dx, py + dy); if (inb(Math.round(px + dx), Math.round(py + dy)) && h[q] > bh) { bh = h[q]; bx = px + dx; by = py + dy; } } }
        const isl = inb(Math.round(bx), Math.round(by)) && h[idx(bx, by)] > 0;
        track.push([bx, by]);
        pts.push({ x: bx, y: by, k, island: isl, age: Math.round(k * sp * kmCell / (vcm * 10)) });
      }
      const hs = { x: c.x, y: c.y, ang, track, pts, speed: vcm };
      pts.forEach(p => {
        if (p.island || !isW(p.x, p.y)) return; const dep0 = depth[idx(p.x, p.y)];
        const warm = warmAt(p.x, p.y), atoll = warm && p.k >= 1 && p.k <= 5 && dep0 > 1500;
        const r = Math.max(1.0, (2.3 - 0.13 * p.k) * sq);
        const summit = atoll ? 12 : p.k === 0 ? 120 + 300 * rnd() : Math.min(dep0 - 300, 250 + 240 * p.k + 150 * rnd());
        addCone({ x: p.x, y: p.y, r, summit, flat: p.k >= 1, kind: atoll ? 'atoll' : p.k === 0 ? 'hot' : 'guyot', age: p.age });
      });
      sf.hotspots.push(hs);
    }
    // поля подводных гор
    const nField = 5 + Math.floor(rnd() * 4);
    for (let f = 0, tries = 0; f < nField && tries < 300; tries++) {
      const cx = W * (0.08 + 0.84 * rnd()), cy = H * (0.1 + 0.8 * rnd()); if (!okCone(cx, cy, 3000, 0)) continue;
      const m = 4 + Math.floor(rnd() * 8), R = (6 + rnd() * 8) * sc, seen = [];
      for (let q = 0; q < m; q++) {
        const a = rnd() * 6.28, rr = R * Math.sqrt(rnd()), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (!okCone(x, y, 2800, 2.2 * sq)) continue;
        const dep0 = depth[idx(x, y)], H0 = 1100 + rnd() * 2700, old = age[idx(x, y)] > 50 && rnd() < 0.4;
        seen.push(addCone({ x, y, r: (0.7 + rnd() * 1.5) * sq, summit: Math.max(250, dep0 - H0), flat: old, kind: old ? 'guyot' : 'cone' }));
      }
      if (seen.length >= 3) { sf.hotspots.push({ field: true, x: cx, y: cy, r: R, n: seen.length }); f++; }
    }
    // осевые вулканы вдоль хребтов
    for (const r of ridges) for (let s = 6; s < r.pts.length - 2; s += 10 + Math.floor(rnd() * 14)) {
      const p = r.pts[s], t = tangent(r.pts, s), sd = rnd() < 0.5 ? -1 : 1, off = (1.5 + rnd() * 3) * sq, x = p[0] - t[1] * off * sd, y = p[1] + t[0] * off * sd;
      if (!okCone(x, y, 1800, 2.2)) continue; const dep0 = depth[idx(x, y)];
      addCone({ x, y, r: (0.6 + rnd() * 0.7) * sq, summit: dep0 - (500 + rnd() * 800), flat: false, kind: 'cone', ridge: true });
    }
    // вулканические дуги над зонами субдукции (на надвигающейся плите, за призмой)
    for (const t of trenches) {
      if (plates[t.over].type === 'continental' && rnd() < 0.15) continue;
      for (let s = 2; s < t.pts.length - 1; s += 3 + Math.floor(rnd() * 3)) {
        const off = 9.4 * tw, x = t.pts[s][0] + t.dir[s][0] * off + (rnd() - 0.5) * 1.6, y = t.pts[s][1] + t.dir[s][1] * off + (rnd() - 0.5) * 1.6;
        if (!isW(x, y) || dLand[idx(x, y)] < 2) continue; const i = idx(x, y), dep0 = depth[i];
        if (sf.cones.some(c => Math.hypot(c.x - x, c.y - y) < 2)) continue;
        addCone({ x, y, r: (0.8 + rnd() * 0.9) * sq, summit: Math.max(60, dep0 - (1500 + rnd() * 1800)), flat: false, kind: 'arc' });
      }
    }
    // океанические плато (крупные базальтовые провинции)
    for (let p = 0, tries = 0, np = 1 + Math.floor(rnd() * 2); p < np && tries < 300; tries++) {
      const x = W * (0.12 + 0.76 * rnd()), y = H * (0.15 + 0.7 * rnd()); if (!isW(x, y)) continue; const i = idx(x, y);
      if (depth[i] < 3400 || dLand[i] < 22 * sc || (dtc && dtc.d[i] < 14 * sc) || sf.plateaus.some(q => Math.hypot(q.x - x, q.y - y) < 60 * sc)) continue;
      const rx = (9 + rnd() * 8) * sc, ry = rx * (0.5 + rnd() * 0.3), a = rnd() * 3.14, U = 1300 + rnd() * 700;
      for (let yy = Math.max(0, Math.floor(y - rx * 1.4)); yy <= Math.min(H - 1, Math.ceil(y + rx * 1.4)); yy++) for (let xx = Math.max(0, Math.floor(x - rx * 1.4)); xx <= Math.min(W - 1, Math.ceil(x + rx * 1.4)); xx++) {
        const j = yy * W + xx; if (!water[j]) continue; const dx = xx - x, dy = yy - y, u0 = (dx * Math.cos(a) + dy * Math.sin(a)) / rx, v0 = (-dx * Math.sin(a) + dy * Math.cos(a)) / ry;
        const u = Math.hypot(u0, v0) * (1 + 0.18 * fbm(nz, xx * 0.15, yy * 0.15, 2)); if (u >= 1) continue;
        depth[j] = Math.max(900, depth[j] - U * (1 - smooth(0.55, 1, u)) * (0.9 + 0.1 * fbm(nz2, xx * 0.4, yy * 0.4, 1)));
      }
      sf.plateaus.push({ x, y, rx, ry, a }); p++;
    }

    // ---------- каньоны от устьев крупных рек и конусы выноса ----------
    {
      const ds = Float32Array.from(depth); FM.blur(ds, W, H, 2);
      const mouths = []; for (const r of map.rivers) { const p = r[r.length - 1]; if (!p) continue; let best = null, bd2 = 1e9;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = Math.round(p[0]) + dx, y = Math.round(p[1]) + dy; if (inb(x, y) && water[y * W + x] && Math.hypot(dx, dy) < bd2) { bd2 = Math.hypot(dx, dy); best = [x, y]; } }
        if (best) mouths.push({ x: best[0], y: best[1], acc: map.riverAcc[Math.round(p[1]) * W + Math.round(p[0])] || 0 }); }
      mouths.sort((a, b) => b.acc - a.acc);
      sf.mouths = mouths;
      const chosen = []; for (const m of mouths) { if (chosen.length >= 9) break; if (chosen.every(c => Math.hypot(c.x - m.x, c.y - m.y) > 16 * sc)) chosen.push(m); }
      const grad = (x, y) => { const g = (xx, yy) => ds[clamp(Math.round(yy), 0, H - 1) * W + clamp(Math.round(xx), 0, W - 1)]; return [(g(x + 1.5, y) - g(x - 1.5, y)) / 3, (g(x, y + 1.5) - g(x, y - 1.5)) / 3]; };
      const descend = (x0, y0, ang0, maxLen) => {
        let x = x0, y = y0, dir = ang0, pts = [[x, y]], len = 0;
        while (len < maxLen) {
          const g = grad(x, y), gl = Math.hypot(g[0], g[1]); let a = dir;
          if (gl > 1) { const d = Math.atan2(-g[1], -g[0]); let da = d - dir; while (da > 3.14) da -= 6.28; while (da < -3.14) da += 6.28; a = dir + da * 0.55; }
          dir = a; const wob = 0.4 * fbm(nz, len * 0.17 + x * 0.3, y * 0.3, 2);   // извилистость не накапливается в курсе
          x += Math.cos(a + wob) * 0.9; y += Math.sin(a + wob) * 0.9; len += 0.9;
          if (!isW(x, y) || depth[idx(x, y)] > 4600) break; pts.push([x, y]);
        }
        return pts;
      };
      for (const m of chosen) {
        const nearL = (() => { let bx = 0, by = 0, bd3 = 1e9; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const x = m.x + dx, y = m.y + dy; if (inb(x, y) && !water[y * W + x] && Math.hypot(dx, dy) < bd3) { bd3 = Math.hypot(dx, dy); bx = dx; by = dy; } } return Math.atan2(-by, -bx); })();
        const main = descend(m.x, m.y, nearL, 55 * sc); (sf.dbgC = sf.dbgC || []).push([m.x, m.y, main.length, Math.round(depth[idx(m.x, m.y)]), +nearL.toFixed(2)]); if (main.length < 8) continue;
        const cn = { pts: main, acc: m.acc, tribs: [] };
        for (let q = 0; q < 2; q++) { const s0 = Math.floor(main.length * (0.25 + 0.3 * rnd() + q * 0.2)), p0 = main[s0], t = tangent(main, s0); const tr = descend(p0[0], p0[1], Math.atan2(t[1], t[0]) + (q ? 0.9 : -0.9), 10 + 10 * rnd()); if (tr.length > 4) cn.tribs.push(tr); }
        for (const line of [main, ...cn.tribs]) line.forEach((p, s) => { const fade = smooth(0, 4, s) * (1 - smooth(line.length - 5, line.length, s)); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = Math.round(p[0]) + dx, y = Math.round(p[1]) + dy; if (!inb(x, y) || !water[y * W + x]) continue; depth[y * W + x] += 230 * fade * G(Math.hypot(x - p[0], y - p[1]), 0.9); } });
        const e = main[main.length - 1]; sf.fans.push({ x: e[0], y: e[1], r: (4 + 3 * rnd()) * sq, a: Math.atan2(e[1] - main[Math.max(0, main.length - 6)][1], e[0] - main[Math.max(0, main.length - 6)][0]) });
        sf.canyons.push(cn);
      }
    }
    // ---------- гидротермальные источники: на осях хребтов; холодные — на аккреционной призме ----------
    for (const r of ridges) for (let s = 4; s < r.pts.length - 3; s += 18 + Math.floor(rnd() * 22)) if (rnd() < 0.7) sf.vents.push({ x: r.pts[s][0], y: r.pts[s][1], type: 'hot' });
    for (const t of trenches) if (rnd() < 0.8) { const s = Math.floor(t.pts.length * (0.25 + rnd() * 0.5)), off = 3.4 * tw, x = t.pts[s][0] + t.dir[s][0] * off, y = t.pts[s][1] + t.dir[s][1] * off; if (isW(x, y)) sf.vents.push({ x, y, type: 'cold' }); }
    sf.dR = dR; sf.dT = dtc ? dtc.d : null; sf.dTsrc = dtc ? dtc.src : null; sf.cwS = cwS; sf.shW = shW; sf.actN = actN; sf.nz = nz; sf.nz2 = nz2; sf.rnd = rnd; sf.tw = tw; sf.kmCell = kmCell;
    sf.helpers = { isW, idx, inb, tangent, plen, resample, smoothPoly, chamfer };
    if (FM.seafloorLife) FM.seafloorLife(map, sf);
    map._sf = sf; return sf;
  };
})(window.FM);
