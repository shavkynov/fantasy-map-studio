// Модель Стоммела на сфере (см. docs/CURRENTS_MODEL.md). Чистые функции, без зависимостей от карты — работает и в браузере (FM.currentSolver), и в Node (tools/currents-test.js).
//
// Уравнение (R = 1, 2Ω = 1, ψ: u = ∂ψ/∂φ, v = −∂ψ/∂λ/cos φ):   r∇²ψ + ∂ψ/∂λ = G(φ),   G = (1/cos φ)·d(τx cos φ)/dφ,   τx = −τ0·cos θ(φ)
//   (β∂ψ/∂x = ∂ψ/∂λ — cos φ сокращается: β = 2Ω cos φ/R, x = R cos φ·λ). Знак β между полушариями не меняется. Профиль ветра — PCHIP через 0/30/46/62/90°.
// ψ — на УЗЛАХ сетки (углы ячеек), скорости — потоки через грани: ψ = const на узлах, касающихся суши, ⇒ нормальный поток через берег ТОЧНО нулевой,
// дивергенция по ячейке ТОЧНО нулевая (телескопирование разностей ψ). Суша — 8-связная, вода — 4-связная (диагональных протечек нет).
// Константы ψ на компонентах суши — по правилу островов (Godfrey): r∮∂ψ/∂n dl = ∬_A G dA, K×K система (K ≤ maxIslands+2).
// Решатель: BiCGSTAB + ILU(0) на маскированной сетке, периодичность по λ, стенки на ±latMax.
(function (FM) {
  'use strict';
  const PI = Math.PI;

  function labelComps(mask, W, Hh, want, conn8) { // компоненты mask===want, периодично по x; возвращает {lab, n, area}
    const N = W * Hh, lab = new Int32Array(N), st = new Int32Array(N), area = [0]; let n = 0;
    for (let s = 0; s < N; s++) {
      if (mask[s] !== want || lab[s]) continue;
      n++; let sp = 0, a = 0; st[sp++] = s; lab[s] = n;
      while (sp) {
        const c = st[--sp]; a++; const x = c % W, y = (c / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (!conn8 && dx && dy)) continue;
          const yy = y + dy; if (yy < 0 || yy >= Hh) continue;
          const q = yy * W + ((x + dx + W) % W);
          if (mask[q] === want && !lab[q]) { lab[q] = n; st[sp++] = q; }
        }
      }
      area.push(a);
    }
    return { lab, n, area };
  }

  function gauss(A, b, n) { // плотная система n×n с выбором главного элемента
    const M = A.map((r, i) => r.slice().concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-300) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
    return x;
  }

  // o: {W,H,land(Uint8, 1 = суша, W*H), r, tau0, omega, latMax(град), minIsland, maxIslands, tol, maxIter}
  function solve(o) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const W = o.W, H = o.H, land = o.land, tol = o.tol || 1e-6, maxIter = o.maxIter || 600;
    const tau0 = o.tau0 === undefined ? 1 : o.tau0, sgn = (o.omega === undefined ? 1 : o.omega) < 0 ? -1 : 1;
    const Hh = H + 2, NC = W * Hh, Wn = W, Nn = W * (Hh + 1);
    const dlam = 2 * PI / W, lat0 = (o.latMax || 75) * PI / 180, dphi = 2 * lat0 / H;
    const r = Math.max(o.r === undefined ? 0.03 : o.r, 0.6 * dlam);           // нижняя граница r: число Пекле ячейки ≤ 1 (центральные разности устойчивы)
    const diag = { ok: true, rEff: r, rRequested: o.r === undefined ? 0.03 : o.r, solves: [], notes: [] };

    // --- 1. маска суши с полярными стенками, отбор крупных компонент ---
    const E = new Uint8Array(NC); E.fill(1, 0, W); E.fill(1, W * (Hh - 1), NC);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) E[(y + 1) * W + x] = land[y * W + x] ? 1 : 0;
    let L = labelComps(E, W, Hh, 1, true);
    const minIsland = o.minIsland === undefined ? Math.max(30, Math.round(0.0003 * W * H)) : o.minIsland, maxIslands = o.maxIslands === undefined ? 8 : o.maxIslands;
    const wallLab = new Set([L.lab[0], L.lab[NC - 1]]);
    const order = []; for (let k = 1; k <= L.n; k++) if (!wallLab.has(k)) order.push(k);
    order.sort((a, b) => L.area[b] - L.area[a]);
    const keep = new Set(wallLab); let kept = 0;
    for (const k of order) if (kept < maxIslands && L.area[k] >= minIsland) { keep.add(k); kept++; }
    const sub = new Uint8Array(W * H); let nSub = 0;
    for (let c = 0; c < NC; c++) if (E[c] && !keep.has(L.lab[c])) { E[c] = 0; const y = (c / W | 0) - 1; if (y >= 0 && y < H) { sub[y * W + c % W] = 1; nSub++; } }
    L = labelComps(E, W, Hh, 1, true);
    const B = labelComps(E, W, Hh, 0, false), nComp = L.n;
    diag.comps = nComp; diag.subgridCells = nSub; diag.basins = B.n;

    // --- 2. узлы: свободные (все 4 ячейки — вода) и граничные (касаются суши → ψ = константа компоненты) ---
    const fr = new Uint8Array(Nn + 1), nodeComp = new Int32Array(Nn + 1), nodeBasin = new Int32Array(Nn + 1);
    const jnOf = new Int32Array(Nn + 1), iE = new Int32Array(Nn + 1), iW = new Int32Array(Nn + 1);
    for (let jn = 0; jn <= Hh; jn++) for (let i = 0; i < W; i++) { const p = jn * W + i; jnOf[p] = jn; iE[p] = jn * W + (i + 1) % W; iW[p] = jn * W + (i - 1 + W) % W; }
    const bcount = new Int32Array(B.n + 1);
    for (let jn = 1; jn <= Hh - 1; jn++) for (let i = 0; i < W; i++) {
      const xw = (i - 1 + W) % W, c1 = (jn - 1) * W + xw, c2 = (jn - 1) * W + i, c3 = jn * W + xw, c4 = jn * W + i, p = jn * W + i;
      if (!E[c1] && !E[c2] && !E[c3] && !E[c4]) { fr[p] = 1; nodeBasin[p] = B.lab[c4]; bcount[B.lab[c4]]++; }
      else nodeComp[p] = E[c1] ? L.lab[c1] : E[c2] ? L.lab[c2] : E[c3] ? L.lab[c3] : L.lab[c4];
    }
    const lists = Array.from({ length: B.n + 1 }, (_, b) => b ? new Int32Array(bcount[b]) : null), fill = new Int32Array(B.n + 1);
    for (let p = 0; p < Nn; p++) if (fr[p]) { const b = nodeBasin[p]; lists[b][fill[b]++] = p; }

    // --- 3. коэффициенты по строкам (зависят только от широты) ---
    const RC = new Float64Array(Hh + 1), RE = new Float64Array(Hh + 1), RW = new Float64Array(Hh + 1), RN = new Float64Array(Hh + 1), RS = new Float64Array(Hh + 1), G = new Float64Array(Hh + 1), wE = new Float64Array(Hh + 1), wN = new Float64Array(Hh + 1), wS = new Float64Array(Hh + 1);
    // профиль ветра τx = −τ0·cos θ(|φ|): θ — монотонная гладкая (PCHIP) кривая через узлы 0°,30°,46°,62°,90° → 0,π/2,π,3π/2,2π:
    // пассаты (τx<0) до 30°, западные ветры (τx>0) 30–62° с максимумом 46°, полярные восточные (τx<0) за 62°
    const KP = [0, 30, 46, 62, 90].map(d => d * PI / 180), KT = [0, 0.5, 1, 1.5, 2].map(q => q * PI), KD = [];
    { const dl = []; for (let k = 0; k < 4; k++) dl.push((KT[k + 1] - KT[k]) / (KP[k + 1] - KP[k]));
      KD[0] = dl[0]; KD[4] = dl[3]; for (let k = 1; k < 4; k++) { const a = dl[k - 1], b = dl[k]; KD[k] = 2 * a * b / (a + b); } }
    const theta = (ph) => { const a = Math.min(Math.abs(ph), KP[4]); let k = 0; while (k < 3 && a > KP[k + 1]) k++;
      const h = KP[k + 1] - KP[k], t = (a - KP[k]) / h, t2 = t * t, t3 = t2 * t;
      const th = (2 * t3 - 3 * t2 + 1) * KT[k] + (t3 - 2 * t2 + t) * h * KD[k] + (-2 * t3 + 3 * t2) * KT[k + 1] + (t3 - t2) * h * KD[k + 1];
      const d = ((6 * t2 - 6 * t) * KT[k] + (3 * t2 - 4 * t + 1) * h * KD[k] + (-6 * t2 + 6 * t) * KT[k + 1] + (3 * t2 - 2 * t) * h * KD[k + 1]) / h; return [th, d]; };
    const T = (ph) => -sgn * tau0 * Math.cos(theta(ph)[0]) * Math.cos(ph);   // τx cos φ (с учётом знака вращения)
    const Gf = (ph) => { const [th, d] = theta(ph), sg = ph < 0 ? -1 : 1; return sgn * tau0 * (sg * Math.sin(th) * d + Math.cos(th) * Math.tan(ph)); };
    let peMax = 0;
    for (let jn = 1; jn <= Hh - 1; jn++) {
      const j = jn - 1, ph = lat0 * (1 - 2 * j / H), c0 = Math.cos(ph), cN = Math.cos(ph + dphi / 2), cS = Math.cos(ph - dphi / 2);
      const aE0 = r / (c0 * c0 * dlam * dlam), aN0 = r * cN / (c0 * dphi * dphi), aS0 = r * cS / (c0 * dphi * dphi), adv = sgn / (2 * dlam);
      RE[jn] = -(aE0 + adv); RW[jn] = -(aE0 - adv); RN[jn] = -aN0; RS[jn] = -aS0; RC[jn] = 2 * aE0 + aN0 + aS0;
      G[jn] = Gf(ph);
      wE[jn] = dphi / (c0 * dlam); wN[jn] = cN * dlam / dphi; wS[jn] = cS * dlam / dphi;
      peMax = Math.max(peMax, Math.abs(adv) / aE0);
    }
    diag.pe = peMax;
    // интеграл G по площади ячейки: dλ·(T(верх) − T(низ)) (точно, без дискретизации производной); стенки — до полюса
    const gcell = new Float64Array(NC);
    for (let ye = 0; ye < Hh; ye++) {
      const y = ye - 1, top = ye === 0 ? PI / 2 : lat0 * (1 - 2 * y / H), bot = ye === Hh - 1 ? -PI / 2 : lat0 * (1 - 2 * (y + 1) / H), g = dlam * (T(top) - T(bot));
      for (let x = 0; x < W; x++) gcell[ye * W + x] = g;
    }

    // --- 4. ILU(0) + BiCGSTAB на списке свободных узлов одного бассейна ---
    const lW = new Float64Array(Nn + 1), lN = new Float64Array(Nn + 1), uE = new Float64Array(Nn + 1), uS = new Float64Array(Nn + 1), dinv = new Float64Array(Nn + 1);
    const dd = new Float64Array(Nn + 1).fill(1), milu = o.milu === undefined ? 0.95 : o.milu;
    function prep(list) {
      for (let k = 0; k < list.length; k++) {
        const p = list[k], jn = jnOf[p], i = p % W;
        let d = RC[jn];
        if (i > 0 && fr[p - 1]) { const a = RW[jn], b = RE[jn]; d -= a * b / dd[p - 1]; lW[p] = a / dd[p - 1]; } else lW[p] = 0;
        if (fr[p - W]) { const a = RN[jn], b = RS[jn - 1]; d -= a * b / dd[p - W]; lN[p] = a / dd[p - W]; } else lN[p] = 0;
        if (milu) { // модифицированный ILU: недостающее «заполнение» (ЮЗ и СВ) компенсируется на диагонали — сильно сокращает число итераций
          if (lW[p] && fr[p - 1 + W]) d -= milu * lW[p] * uS[p - 1];
          if (lN[p] && i < W - 1 && fr[p - W + 1]) d -= milu * lN[p] * uE[p - W];
        }
        dd[p] = d; dinv[p] = 1 / d;
        uE[p] = (i < W - 1 && fr[p + 1]) ? RE[jn] : 0; uS[p] = fr[p + W] ? RS[jn] : 0;
      }
    }
    const names = ['x', 'rr', 'rh', 'pp', 'v', 's', 't', 'y', 'z']; const ws = {}; for (const n of names) ws[n] = new Float64Array(Nn + 1);
    function matvec(list, x, out) {
      for (let k = 0; k < list.length; k++) { const p = list[k], jn = jnOf[p]; out[p] = RC[jn] * x[p] + RE[jn] * x[iE[p]] + RW[jn] * x[iW[p]] + RN[jn] * x[p - W] + RS[jn] * x[p + W]; }
    }
    function precond(list, rv, z) {
      const y = ws.y;
      for (let k = 0; k < list.length; k++) { const p = list[k]; y[p] = rv[p] - lW[p] * y[p - 1] - lN[p] * y[p - W]; }
      for (let k = list.length - 1; k >= 0; k--) { const p = list[k]; z[p] = (y[p] - uE[p] * z[p + 1] - uS[p] * z[p + W]) * dinv[p]; }
    }
    const dot = (list, a, b) => { let s = 0; for (let k = 0; k < list.length; k++) { const p = list[k]; s += a[p] * b[p]; } return s; };
    function bicgstab(list, b, label) { // решает B x = b на list, возвращает новый Float64Array (Nn+1)
      const { x, rr, rh, pp, v, s, t, z } = ws, n = list.length, out = new Float64Array(Nn + 1);
      const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
      for (let k = 0; k < n; k++) { const p = list[k]; x[p] = 0; rr[p] = b[p]; rh[p] = b[p]; pp[p] = 0; v[p] = 0; ws.y[p] = 0; z[p] = 0; s[p] = 0; t[p] = 0; }
      const bn = Math.sqrt(dot(list, b, b)) || 1; let rho = 1, alpha = 1, omega = 1, it = 0, res = 1;
      if (Math.sqrt(dot(list, rr, rr)) / bn > tol) {
        for (it = 1; it <= maxIter; it++) {
          const rho1 = dot(list, rh, rr); if (Math.abs(rho1) < 1e-300) break;
          const beta = (rho1 / rho) * (alpha / omega); rho = rho1;
          for (let k = 0; k < n; k++) { const p = list[k]; pp[p] = rr[p] + beta * (pp[p] - omega * v[p]); }
          precond(list, pp, z); matvec(list, z, v);
          alpha = rho / dot(list, rh, v);
          for (let k = 0; k < n; k++) { const p = list[k]; s[p] = rr[p] - alpha * v[p]; }
          if (Math.sqrt(dot(list, s, s)) / bn < tol) { for (let k = 0; k < n; k++) { const p = list[k]; x[p] += alpha * z[p]; } res = Math.sqrt(dot(list, s, s)) / bn; break; }
          const z2 = ws.y2 || (ws.y2 = new Float64Array(Nn + 1)); precond(list, s, z2); matvec(list, z2, t);
          omega = dot(list, t, s) / dot(list, t, t);
          for (let k = 0; k < n; k++) { const p = list[k]; x[p] += alpha * z[p] + omega * z2[p]; rr[p] = s[p] - omega * t[p]; }
          res = Math.sqrt(dot(list, rr, rr)) / bn; if (res < tol) break; if (!isFinite(res)) break;
        }
      }
      // истинная невязка
      matvec(list, x, t); let e = 0; for (let k = 0; k < n; k++) { const p = list[k]; e += (b[p] - t[p]) ** 2; } const trueRes = Math.sqrt(e) / bn;
      for (let k = 0; k < n; k++) { const p = list[k]; out[p] = x[p]; }
      const ok = trueRes < tol * 10 && isFinite(trueRes); if (!ok) { diag.ok = false; diag.notes.push(label + ': не сошлось (невязка ' + trueRes.toExponential(2) + ', ' + it + ' ит.)'); }
      diag.solves.push({ label, n, iters: it, res: trueRes, ms: (typeof performance !== 'undefined' ? performance : Date).now() - t1 });
      return out;
    }

    // --- 5. бассейны: частное решение, однородные решения, правило островов ---
    const known = new Uint8Array(nComp + 1), cval = new Float64Array(nComp + 1);
    const psi = new Float64Array(Nn + 1);
    const bOrder = []; for (let b = 1; b <= B.n; b++) if (lists[b].length) bOrder.push(b);
    bOrder.sort((a, b) => lists[b].length - lists[a].length);
    // площади суши + «внутренних» одно-компонентных бассейнов для правила островов
    const compComps = new Map(); // бассейн → набор компонент суши
    for (const b of bOrder) {
      const set = new Set(), list = lists[b];
      for (let k = 0; k < list.length; k++) { const p = list[k]; for (const q of [iE[p], iW[p], p - W, p + W]) if (!fr[q]) set.add(nodeComp[q]); }
      compComps.set(b, [...set]);
    }
    const Iland = new Float64Array(nComp + 1);
    for (let c = 0; c < NC; c++) if (E[c]) Iland[L.lab[c]] += gcell[c];
    const bcWater = new Float64Array(nComp + 1); // вода внутренних бассейнов, замкнутых одной компонентой
    const basinG = new Float64Array(B.n + 1); for (let c = 0; c < NC; c++) if (!E[c] && B.lab[c]) basinG[B.lab[c]] += gcell[c];
    for (const [b, cs] of compComps) if (cs.length === 1) bcWater[cs[0]] += basinG[b];
    const drag = o.islandDrag === undefined ? 1 : o.islandDrag; diag.islandDrag = drag;   // параметризация формного сопротивления (см. docs, §5): r_остр = drag·r
    diag.islandResidual = [];

    for (const b of bOrder) {
      const list = lists[b], cs = compComps.get(b).filter(c => c > 0);
      let U = cs.filter(c => !known[c]);
      if (!cs.some(c => known[c]) && U.length) { U.sort((a, c) => L.area[c] - L.area[a]); const ref = U.shift(); known[ref] = 1; cval[ref] = 0; }
      prep(list);
      const bcOf = (q) => known[nodeComp[q]] ? cval[nodeComp[q]] : 0;
      const bP = new Float64Array(Nn + 1);
      for (let k = 0; k < list.length; k++) {
        const p = list[k], jn = jnOf[p]; let s = -G[jn];
        const qE = iE[p], qW = iW[p], qN = p - W, qS = p + W;
        if (!fr[qE]) s -= RE[jn] * bcOf(qE); if (!fr[qW]) s -= RW[jn] * bcOf(qW); if (!fr[qN]) s -= RN[jn] * bcOf(qN); if (!fr[qS]) s -= RS[jn] * bcOf(qS);
        bP[p] = s;
      }
      const P = bicgstab(list, bP, 'бассейн ' + b + ' (частное)');
      const flux = (field, bcf) => { // r·Σ w(ψ_p − c_k) по парам «свободный узел – граничный узел компоненты k»
        const F = new Float64Array(nComp + 1);
        for (let k = 0; k < list.length; k++) {
          const p = list[k], jn = jnOf[p];
          const qs = [iE[p], iW[p], p - W, p + W], ws2 = [wE[jn], wE[jn], wN[jn], wS[jn]];
          for (let m = 0; m < 4; m++) if (!fr[qs[m]]) { const c = nodeComp[qs[m]]; F[c] += drag * r * ws2[m] * (field[p] - bcf(c)); }
        }
        return F;
      };
      const final = new Float64Array(Nn + 1); for (let k = 0; k < list.length; k++) final[list[k]] = P[list[k]];
      if (U.length) {
        const u = U.length, Hs = [], FP = flux(P, c => known[c] ? cval[c] : 0);
        for (const m of U) {
          const bH = new Float64Array(Nn + 1);
          for (let k = 0; k < list.length; k++) {
            const p = list[k], jn = jnOf[p]; let s = 0;
            if (!fr[iE[p]] && nodeComp[iE[p]] === m) s -= RE[jn]; if (!fr[iW[p]] && nodeComp[iW[p]] === m) s -= RW[jn];
            if (!fr[p - W] && nodeComp[p - W] === m) s -= RN[jn]; if (!fr[p + W] && nodeComp[p + W] === m) s -= RS[jn];
            bH[p] = s;
          }
          Hs.push(bicgstab(list, bH, 'бассейн ' + b + ' (остров ' + m + ')'));
        }
        const M = U.map(() => new Array(u).fill(0)), rhs = U.map((k) => Iland[k] + bcWater[k] - FP[k]);
        Hs.forEach((Hm, mi) => { const FH = flux(Hm, c => c === U[mi] ? 1 : 0); U.forEach((k, ki) => { M[ki][mi] = FH[k]; }); });
        const cs2 = gauss(M, rhs, u);
        if (!cs2) { diag.ok = false; diag.notes.push('бассейн ' + b + ': вырожденная система острова'); }
        else {
          U.forEach((k, mi) => { cval[k] = cs2[mi]; known[k] = 1; });
          for (let k = 0; k < list.length; k++) { const p = list[k]; let s = P[p]; for (let mi = 0; mi < u; mi++) s += cs2[mi] * Hs[mi][p]; final[p] = s; }
          // невязка правила островов для оставшихся (известных) компонент бассейна — проверка согласованности знаков и дискретизации
          const FT = flux(final, c => cval[c]); let sc = 0; for (const k of cs) sc += Math.abs(Iland[k] + bcWater[k]);
          for (const k of cs) if (!U.includes(k)) diag.islandResidual.push({ basin: b, comp: k, resid: (FT[k] - (Iland[k] + bcWater[k])) / (sc || 1) });
        }
      }
      for (let k = 0; k < list.length; k++) psi[list[k]] = final[list[k]];
    }
    // граничные узлы
    for (let p = 0; p < Nn; p++) if (!fr[p] && nodeComp[p]) psi[p] = known[nodeComp[p]] ? cval[nodeComp[p]] : 0;

    // --- 6. скорости в центрах ячеек из разностей ψ по углам (физические компоненты u на восток, v на север) ---
    const u = new Float32Array(W * H), v = new Float32Array(W * H), sp = new Float32Array(W * H);
    function computeVel() {
      for (let y = 0; y < H; y++) {
        const ye = y + 1, ph = lat0 * (1 - 2 * (y + 0.5) / H), cc = Math.cos(ph);
        for (let x = 0; x < W; x++) {
          if (E[ye * W + x]) continue;
          const x1 = (x + 1) % W, a = psi[ye * W + x], b2 = psi[ye * W + x1], c = psi[(ye + 1) * W + x], d = psi[(ye + 1) * W + x1];
          const uu = (a + b2 - c - d) / (2 * dphi), vv = -(b2 + d - a - c) / (2 * dlam * cc);
          u[y * W + x] = uu; v[y * W + x] = vv; sp[y * W + x] = Math.hypot(uu, vv);
        }
      }
    }
    computeVel();

    // --- 6b. меандры и вихри: гладкие возмущения ψ в 2 масштабах (docs §8). ψ' = Σ ε_s·ℓ_s·S(x,y)·η_s(x,y)·taper(d): амплитуда ∝ местной скорости S (сглаженной) —
    // крупные гиры не разрушаются; taper → 0 у берега ⇒ граничные константы ψ не меняются, нормальный поток через берег остаётся нулевым, дивергенция ячеек — тождественно нулевой.
    if (o.meander) {
      const mo = o.meander === true ? {} : o.meander, eps = [mo.eps1 === undefined ? 0.12 : mo.eps1, mo.eps2 === undefined ? 0.05 : mo.eps2], len = [mo.l1 || 16, mo.l2 || 6], seed = (o.seed | 0) + 1;
      const Wn = W, Hn = Hh + 1, S0 = new Float32Array(Nn + 1), S1 = new Float32Array(Nn + 1), dn = new Int16Array(Nn + 1).fill(32000);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const q = sp[y * W + x]; if (!q) continue; const ye = y + 1, x1 = (x + 1) % W; for (const n of [ye * W + x, ye * W + x1, (ye + 1) * W + x, (ye + 1) * W + x1]) S0[n] = Math.max(S0[n], q); }
      const rad = mo.smooth === undefined ? 2 : mo.smooth;   // сглаживание скорости: два прохода ящичного фильтра радиуса ~ℓ₂ (по x периодично)
      for (let pass = 0; pass < 2; pass++) {
        for (let jn = 0; jn < Hn; jn++) for (let i = 0; i < W; i++) { let sum = 0; for (let d = -rad; d <= rad; d++) sum += S0[jn * W + (i + d + W * 4) % W]; S1[jn * W + i] = sum / (2 * rad + 1); }
        for (let jn = 0; jn < Hn; jn++) for (let i = 0; i < W; i++) { let sum = 0, c = 0; for (let d = -rad; d <= rad; d++) { const q = jn + d; if (q >= 0 && q < Hn) { sum += S1[q * W + i]; c++; } } S0[jn * W + i] = sum / c; }
      }
      { const q = []; for (let p = 0; p < Nn; p++) if (!fr[p]) { dn[p] = 0; q.push(p); } else dn[p] = 32000;  // расстояние до берега (в узлах), 4-связный обход
        for (let h2 = 0; h2 < q.length; h2++) { const p = q[h2]; for (const t of [iE[p], iW[p], p - W, p + W]) { if (t < 0 || t >= Nn || !fr[t] || dn[t] <= dn[p] + 1) continue; dn[t] = dn[p] + 1; q.push(t); } } }
      const hsh = (i, j, sd) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(sd, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return ((h >>> 0) / 4294967295) * 2 - 1; };
      const vn = (x, y, l, sd) => { const nx = Math.max(2, Math.round(Wn / l)), sx = Wn / nx, ny = Math.max(2, Math.round(Hn / l)), sy = Hn / ny, fx = x / sx, fy = y / sy, ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); const X = (k) => ((ix + k) % nx + nx) % nx;
        const a = hsh(X(0), iy, sd), b = hsh(X(1), iy, sd), c = hsh(X(0), iy + 1, sd), d = hsh(X(1), iy + 1, sd); return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty; };
      let maxA = 0;
      for (let k = 0; k < Nn; k++) { if (!fr[k]) continue; const jn = jnOf[k], i = k % W, t = Math.min(1, Math.max(0, (dn[k] - 1) / 4)), tp = t * t * (3 - 2 * t); if (!tp) continue;
        let add = 0; for (let m = 0; m < 2; m++) add += eps[m] * len[m] * dphi * S0[k] * vn(i, jn, len[m], seed + 17 * m); psi[k] += add * tp; maxA = Math.max(maxA, Math.abs(add * tp)); }
      diag.meanderMaxPsi = maxA; computeVel();
    }
    // малые замкнутые акватории (меньше minGyre свободных узлов) гиру не образуют: поле обнуляется (ТЗ: не создавать гиры в каждом замкнутом водоёме)
    const minGyre = o.minGyre === undefined ? Math.max(60, Math.round(0.005 * W * H)) : o.minGyre, reg = new Int32Array(Nn + 1), regSize = [0]; let nReg = 0;
    { const st = new Int32Array(Nn); for (let s0 = 0; s0 < Nn; s0++) { if (!fr[s0] || reg[s0]) continue; nReg++; let sp2 = 0, cnt = 0; st[sp2++] = s0; reg[s0] = nReg;
        while (sp2) { const c = st[--sp2]; cnt++; for (const q of [iE[c], iW[c], c - W, c + W]) if (fr[q] && !reg[q]) { reg[q] = nReg; st[sp2++] = q; } } regSize.push(cnt); } }
    let nSmall = 0; const smallMask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const ye = y + 1, x1 = (x + 1) % W; if (E[ye * W + x]) continue;
      const cn = [ye * W + x, ye * W + x1, (ye + 1) * W + x, (ye + 1) * W + x1]; let big = false; for (const q of cn) if (fr[q] && regSize[reg[q]] >= minGyre) big = true;
      if (!big) { u[y * W + x] = 0; v[y * W + x] = 0; sp[y * W + x] = 0; smallMask[y * W + x] = 1; nSmall++; } }
    diag.smallRegionCells = nSmall; diag.minGyre = minGyre;
    diag.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    diag.iters = diag.solves.reduce((s, q) => s + q.iters, 0); diag.maxRes = diag.solves.reduce((s, q) => Math.max(s, q.res), 0);
    return { W, H, Hh, psi, u, v, sp, E, sub, smallMask, nodeComp, fr, nodeBasin, diag, dlam, dphi, lat0, r, known, cval, comps: nComp };
  }


  // ---- Этап 2: температура поверхности. Стационарная адвекция–диффузия с релаксацией к широтному профилю:  ∇·(uT) = ∇·(κ∇T) − γ(T − T*(φ))
  // Конечные объёмы на ячейках, потоки через грани берутся ИЗ ψ (разности на концах граней) ⇒ поле потоков бездивергентно, берег непроницаем.
  // Диффузия — на отклонении от T*. Адвекция — противопоточная 1-го порядка (монотонна: M-матрица, принцип максимума T ∈ [min T*, max T*]); диффузия κ — явный параметр сверх численной.
  // Решение: симметричный Гаусс–Зейдель (вперёд/назад) до сходимости; γ > 0 делает матрицу строго диагонально доминирующей ⇒ устойчиво.
  // Ограничения: нет сезонности, вертикального перемешивания, обмена с атмосферой кроме релаксации γ; T в условных °C.
  function tStar(phi, o) { const s = Math.sin(phi); return (o && o.tEq !== undefined ? o.tEq : 28.5) - (o && o.tRange !== undefined ? o.tRange : 30.5) * s * s; }
  function temperature(res, o) {
    o = o || {}; const { W, H, psi, E, dlam, dphi, lat0 } = res, N = W * H, sps = [];
    for (let i = 0; i < N; i++) if (res.sp[i] > 0) sps.push(res.sp[i]);
    sps.sort((a, b) => a - b); const U = sps.length ? sps[sps.length >> 1] : 1;
    const gamma = o.gamma !== undefined ? o.gamma : U / 0.3, kappa = o.kappa !== undefined ? o.kappa : 0.4 * U * dlam, maxSweeps = o.maxSweeps || 800, tol = o.tol || 1e-5;
    const T = new Float32Array(N), Ts = new Float32Array(N), cD = new Float64Array(N * 5), rhs = new Float64Array(N), idx = [];
    // cD: [diag, E, W, N, S] — коэффициенты связи с соседями (положительные веса: T_P·diag = Σ w_nb T_nb + rhs)
    for (let y = 0; y < H; y++) {
      const ye = y + 1, ph = lat0 * (1 - 2 * (y + 0.5) / H), cc = Math.cos(ph), cN = Math.cos(ph + dphi / 2), cS = Math.cos(ph - dphi / 2), A = cc * dlam * dphi, ts = tStar(ph, o);
      for (let x = 0; x < W; x++) {
        const i = y * W + x; Ts[i] = ts; if (E[ye * W + x]) continue; T[i] = ts; idx.push(i);
        const x1 = (x + 1) % W, xw = (x - 1 + W) % W, NW = psi[ye * W + x], NE = psi[ye * W + x1], SW = psi[(ye + 1) * W + x], SE = psi[(ye + 1) * W + x1];
        const outs = [NE - SE, -(NW - SW), NW - NE, -(SW - SE)];                    // потоки наружу через E, W, N, S
        const nbE = !E[ye * W + x1], nbW = !E[ye * W + xw], nbN = !E[(ye - 1) * W + x], nbS = !E[(ye + 1) * W + x];
        const nb = [nbE, nbW, nbN, nbS], D = [kappa * dphi / (cc * dlam), kappa * dphi / (cc * dlam), kappa * cN * dlam / dphi, kappa * cS * dlam / dphi];
        let d = A * gamma;
        for (let k = 0; k < 4; k++) { if (!nb[k]) continue; const o2 = outs[k]; d += Math.max(o2, 0) + D[k]; cD[i * 5 + 1 + k] = Math.max(-o2, 0) + D[k]; }
        // диффузия действует на ОТКЛОНЕНИЕ θ = T − T*, а не на T: градиент самого профиля T* через изолированные берега не даёт ложных потоков (без течений T ≡ T* всюду, в т.ч. в заливах)
        let rr = A * gamma * ts; const nbi = [i + 0, 0, 0, 0]; for (let k = 0; k < 4; k++) { if (!nb[k]) continue; const yy = k < 2 ? y : (k === 2 ? y - 1 : y + 1), tn = tStar(lat0 * (1 - 2 * (yy + 0.5) / H), o); rr -= D[k] * (tn - ts); }
        cD[i * 5] = d; rhs[i] = rr;
      }
    }
    const nbr = (i, k) => { const y = (i / W) | 0, x = i % W; return k === 0 ? y * W + (x + 1) % W : k === 1 ? y * W + (x - 1 + W) % W : k === 2 ? i - W : i + W; };
    const sweep = (list) => { let mx = 0; for (let n = 0; n < list.length; n++) { const i = list[n], c = i * 5; let s = rhs[i];
        if (cD[c + 1]) s += cD[c + 1] * T[nbr(i, 0)]; if (cD[c + 2]) s += cD[c + 2] * T[nbr(i, 1)]; if (cD[c + 3]) s += cD[c + 3] * T[i - W]; if (cD[c + 4]) s += cD[c + 4] * T[i + W];
        const t = s / cD[c], dT = Math.abs(t - T[i]); if (dT > mx) mx = dT; T[i] = t; } return mx; };
    const rev = idx.slice().reverse(); let it = 0, ch = 1;
    for (it = 1; it <= maxSweeps; it++) { ch = Math.max(sweep(idx), sweep(rev)); if (ch < tol) break; }
    // истинная невязка (макс. по ячейкам, в °C·площадь/площадь)
    let resid = 0; for (const i of idx) { const c = i * 5; let s = rhs[i]; if (cD[c + 1]) s += cD[c + 1] * T[nbr(i, 0)]; if (cD[c + 2]) s += cD[c + 2] * T[nbr(i, 1)]; if (cD[c + 3]) s += cD[c + 3] * T[i - W]; if (cD[c + 4]) s += cD[c + 4] * T[i + W]; resid = Math.max(resid, Math.abs(s - cD[c] * T[i]) / cD[c]); }
    let tmin = 1e9, tmax = -1e9, smin = 1e9, smax = -1e9; for (const i of idx) { tmin = Math.min(tmin, T[i]); tmax = Math.max(tmax, T[i]); smin = Math.min(smin, Ts[i]); smax = Math.max(smax, Ts[i]); }
    // аномалия: T минус среднее по воде в том же ряду (широте), сглаженное по ±2 рядам; нормировка на p90 |аномалии|
    const rs = new Float64Array(H), rn = new Float64Array(H); for (const i of idx) { const y = (i / W) | 0; rs[y] += T[i]; rn[y]++; }
    // опорная температура широты = T* (строки) + среднее по окну ±2 строки от (T − T*): градиент T* по широте не попадает в аномалию (без течений аномалия ≈ 0)
    const rdl = Array.from({ length: H }, () => []); for (const i of idx) { const y = (i / W) | 0; rdl[y].push(T[i] - Ts[i]); }
    const rowMean = new Float64Array(H);   // медиана (устойчива к тупиковым заливам и пятнам тёплой воды): без течений аномалия в открытой воде = 0
    for (let y = 0; y < H; y++) { const arr = []; for (let d = -2; d <= 2; d++) { const q = y + d; if (q >= 0 && q < H) for (const v of rdl[q]) arr.push(v); } arr.sort((a, b) => a - b); rowMean[y] = Ts[y * W] + (arr.length ? arr[arr.length >> 1] : 0); }
    const an = new Float32Array(N), abs = []; for (const i of idx) { const q = T[i] - rowMean[(i / W) | 0]; an[i] = q; abs.push(Math.abs(q)); }
    abs.sort((a, b) => a - b); const scale = abs.length ? Math.max(abs[Math.floor(abs.length * 0.9)], 0.5) : 1;   // не меньше 0.5 °C: при нулевых течениях аномалий нет
    const anN = new Float32Array(N); for (const i of idx) anN[i] = Math.max(-1.5, Math.min(1.5, an[i] / scale));
    return { T, Ts, an, anN, scale, diag: { sweeps: it, change: ch, resid, tmin, tmax, tsMin: smin, tsMax: smax, gamma, kappa, U, converged: ch < tol, cells: idx.length } };
  }
  const WARM_T = 0.3;   // порог нормированной аномалии: > +WARM_T — тёплое, < −WARM_T — холодное, между — нейтральное
  const classify = (a) => a > WARM_T ? 1 : a < -WARM_T ? 0 : 2;

  // Скорости в «пиксельных» координатах карты (для линий тока): Ẋ = u/(cos φ dλ), Ẏ = −v/dφ; направление верное, модуль — физическая скорость
  function pixelDir(res, x, y) {
    const { W, dlam, dphi, lat0, H } = res, i = y * W + x, cc = Math.cos(lat0 * (1 - 2 * (y + 0.5) / H));
    const X = res.u[i] / (cc * dlam), Y = -res.v[i] / dphi, l = Math.hypot(X, Y) || 1;
    return [X / l, Y / l, res.sp[i]];
  }

  FM.currentSolver = { solve, pixelDir, labelComps, temperature, classify, tStar, WARM_T };
  if (typeof module !== 'undefined' && module.exports) module.exports = FM.currentSolver;
})(typeof window !== 'undefined' ? window.FM : (globalThis.FM = globalThis.FM || {}));
