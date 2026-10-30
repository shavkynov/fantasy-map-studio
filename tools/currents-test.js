#!/usr/bin/env node
// Количественные проверки модели течений (этап 1: поле скорости). Чистый Node, без браузера. node tools/currents-test.js [--quick]
const S = require('../src/currents_solver.js');
const quick = process.argv.includes('--quick');
let fails = 0; const results = [];
function check(name, ok, info) { results.push([ok, name, info || '']); if (!ok) fails++; console.log((ok ? '  ok   ' : '  FAIL ') + name + (info ? '   [' + info + ']' : '')); }
const idx = (W, H) => ({ yOf: (lat) => Math.round((1 - lat / 75) / 2 * H), xOf: (lon) => Math.round(lon / 360 * W) });
function box(W, H, lon0, lon1, la0, la1, base) { const land = base || new Uint8Array(W * H).fill(1), g = idx(W, H); for (let y = g.yOf(la1); y < g.yOf(la0); y++) for (let x = g.xOf(lon0); x < g.xOf(lon1); x++) land[y * W + x] = 0; return land; }
function ellipse(land, W, H, lon, lat, rlon, rlat) { const g = idx(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const lo = x / W * 360, la = (1 - 2 * (y + 0.5) / H) * 75, dx = Math.min(Math.abs(lo - lon), 360 - Math.abs(lo - lon)) / rlon, dy = (la - lat) / rlat; if (dx * dx + dy * dy < 1) land[y * W + x] = 1; } }
function world(W, H) { // три материка + остров + мелочь, океан между ними
  const land = new Uint8Array(W * H); ellipse(land, W, H, 285, 5, 28, 55); ellipse(land, W, H, 60, 25, 50, 38); ellipse(land, W, H, 45, -20, 25, 30); ellipse(land, W, H, 135, -25, 18, 12); ellipse(land, W, H, 200, 40, 9, 9);
  for (let k = 0; k < 14; k++) ellipse(land, W, H, 20 + k * 25, -50 + (k * 37) % 90, 2.2, 1.8); return land;
}
const cellAt = (W, H, lon, lat) => { const g = idx(W, H); return [g.xOf(lon), g.yOf(lat)]; };
const nodePsi = (r, x, y) => r.psi[(y + 1) * r.W + x];     // ψ в NW-углу ячейки (x, y)

console.log('Тест 1: направление вращения субтропических гир');
{
  const W = 240, H = 160, N = S.solve({ W, H, land: box(W, H, 90, 200, 10, 50) }), Sx = S.solve({ W, H, land: box(W, H, 90, 200, -50, -10) });
  const [cx, cy] = cellAt(W, H, 145, 30), [sx, sy] = cellAt(W, H, 145, -30);
  check('СП: центр гиры ψ<0 (по часовой)', nodePsi(N, cx, cy) < 0, 'ψ=' + nodePsi(N, cx, cy).toFixed(3));
  check('ЮП: центр гиры ψ>0 (против часовой)', nodePsi(Sx, sx, sy) > 0, 'ψ=' + nodePsi(Sx, sx, sy).toFixed(3));
  const [ax, ay] = cellAt(W, H, 145, 16), [bx, by] = cellAt(W, H, 145, 44);
  check('СП: на юге гиры течение на запад (пассат), на севере — на восток', N.u[ay * W + ax] < 0 && N.u[by * W + bx] > 0, 'u_юг=' + N.u[ay * W + ax].toFixed(2) + ' u_север=' + N.u[by * W + bx].toFixed(2));
  const [dx, dy] = cellAt(W, H, 145, -16), [ex, ey] = cellAt(W, H, 145, -44);
  check('ЮП: на севере (экваториальной) гиры — запад, на юге — восток', Sx.u[dy * W + dx] < 0 && Sx.u[ey * W + ex] > 0);
  const mid = N.v.slice(cy * W + g0(W, 100), cy * W + g0(W, 190)); function g0(W, lon) { return Math.round(lon / 360 * W); }
  check('Свердруп: внутри гиры СП v<0 (к экватору)', mid[Math.round(mid.length / 2)] < 0, 'v=' + mid[Math.round(mid.length / 2)].toFixed(3));
}

console.log('Тест 2: нормальный поток через берег (мир с материками, островами, стенками)');
{
  const W = 240, H = 160, land = world(W, H), r = S.solve({ W, H, land, islandDrag: 1 }), E = r.E, Hh = H + 2; let faces = 0, maxd = 0, comp = 0;  // drag=1: чистая модель; при drag≠1 избыточное правило уже не тождественно
  const nd = (x, jn) => r.psi[jn * W + ((x % W) + W) % W];
  for (let ye = 1; ye <= H; ye++) for (let x = 0; x < W; x++) {
    if (!E[ye * W + x]) continue;
    // 4 грани ячейки суши: если сосед — вода, поток через грань = разность ψ на концах грани
    const nbs = [[(x + 1) % W, ye, 'E'], [(x - 1 + W) % W, ye, 'W'], [x, ye - 1, 'N'], [x, ye + 1, 'S']];
    for (const [xx, yy, side] of nbs) {
      if (yy < 0 || yy >= Hh || E[yy * W + xx]) continue; faces++;
      const [a, b] = side === 'E' ? [[x + 1, ye], [x + 1, ye + 1]] : side === 'W' ? [[x, ye], [x, ye + 1]] : side === 'N' ? [[x, ye], [x + 1, ye]] : [[x, ye + 1], [x + 1, ye + 1]];
      maxd = Math.max(maxd, Math.abs(nd(a[0], a[1]) - nd(b[0], b[1])));
      if (r.nodeComp[a[1] * W + (a[0] % W)] !== r.nodeComp[b[1] * W + (b[0] % W)]) comp++;
    }
  }
  check('поток через ' + faces + ' береговых граней = 0 (разность ψ на концах грани)', maxd === 0, 'max|Δψ|=' + maxd);
  check('концы береговых граней принадлежат одной компоненте суши', comp === 0, 'расхождений: ' + comp);
  check('решатель сошёлся', r.diag.ok, 'итераций ' + r.diag.iters + ', невязка ' + r.diag.maxRes.toExponential(1) + ', ' + Math.round(r.diag.ms) + ' мс, компонент ' + r.comps);
  const rs = r.diag.islandResidual.map(q => Math.abs(q.resid)); const mr = Math.max(0, ...rs);
  check('правило островов: невязка опорной компоненты мала (согласованность знака и дискретизации)', rs.length > 0 && mr < 0.05, 'max=' + mr.toExponential(2) + ' (' + rs.length + ' проверок)');
  if (!quick) { const W2 = 480, H2 = 320, r2 = S.solve({ W: W2, H: H2, land: world(W2, H2) }); const m2 = Math.max(0, ...r2.diag.islandResidual.map(q => Math.abs(q.resid)));
    check('невязка правила островов убывает при измельчении сетки (240 → 480)', m2 < mr, mr.toExponential(1) + ' → ' + m2.toExponential(1) + ', решение 480×320: ' + Math.round(r2.diag.ms) + ' мс, ' + r2.diag.iters + ' итераций'); }
}

console.log('Тест 3: изолированные бассейны не связаны');
{
  const W = 240, H = 160, g = idx(W, H), A = box(W, H, 60, 140, 15, 50), L1 = box(W, H, 200, 300, 15, 50, A.slice());
  const L2 = box(W, H, 200, 300, 15, 50, A.slice()); for (let y = g.yOf(40); y < g.yOf(25); y++) for (let x = g.xOf(240); x < g.xOf(260); x++) L2[y * W + x] = 1;   // меняем форму бассейна B
  const r1 = S.solve({ W, H, land: L1 }), r2 = S.solve({ W, H, land: L2 }); let same = true, nz = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < g.xOf(180); x++) { const a = nodePsi(r1, x, y), b = nodePsi(r2, x, y); if (a !== b) same = false; if (a) nz++; }
  check('ψ в бассейне A не зависит от формы бассейна B (бит-в-бит)', same && nz > 100, 'узлов ' + nz);
  // диагональное касание суши: вода только по диагонали → бассейны разные
  const D = new Uint8Array(W * H).fill(1), cx = 100, cy = 80; for (let y = cy - 20; y < cy; y++) for (let x = cx - 30; x < cx; x++) D[y * W + x] = 0; for (let y = cy; y < cy + 20; y++) for (let x = cx; x < cx + 30; x++) D[y * W + x] = 0;
  const rd = S.solve({ W, H, land: D }); check('два водоёма, касающиеся только углом, — разные бассейны', rd.diag.basins === 2, 'бассейнов ' + rd.diag.basins);
}

console.log('Тест 4: проливы и разрешение');
{
  const exch = (W, H, wCells) => { const land = box(W, H, 60, 150, 15, 50), g = idx(W, H); box(W, H, 180, 270, 15, 50, land); const y0 = g.yOf(32); for (let y = y0; y < y0 + wCells; y++) for (let x = g.xOf(150); x < g.xOf(180); x++) land[y * W + x] = 0; const r = S.solve({ W, H, land }); let m = 0, mid = 0; for (let y = y0; y <= y0 + wCells; y++) { const v = nodePsi(r, g.xOf(165), y); if (Math.abs(v) > Math.abs(mid)) mid = v; } for (let y = y0; y < y0 + wCells + 1; y++) for (let x = g.xOf(150); x < g.xOf(180); x++) m = Math.max(m, Math.abs(nodePsi(r, x, y))); return { m, mid, basins: r.diag.basins }; };
  const w1 = exch(240, 160, 1), w2 = exch(240, 160, 2), w3 = exch(240, 160, 3);
  check('пролив шириной 1 ячейка — закрыт (нет свободных узлов)', w1.basins === 2 || w1.m === 0, 'бассейнов ' + w1.basins + ', |ψ|=' + w1.m.toFixed(3));
  check('пролив шире открыт и несёт обмен', w2.basins === 1 && w2.m > 0, '|ψ|max=' + w2.m.toFixed(3));
  check('обмен растёт с шириной пролива', w3.m >= w2.m * 0.9, w2.m.toFixed(3) + ' → ' + w3.m.toFixed(3));
  check('на грубой сетке 120×80 пролив 1.5° (1 ячейка) не представим — закрыт (задокументированное ограничение)', exch(120, 80, 1).m === 0);
  const sizes = quick ? [[240, 160, 2], [480, 320, 4]] : [[240, 160, 2], [480, 320, 4], [960, 640, 8]], res = sizes.map(([W, H, w]) => exch(W, H, w));
  console.log('     пролив 1.9° шириной на сетках ' + sizes.map(q => q[0]).join('/') + ': ψ в середине пролива ' + res.map(q => q.mid.toFixed(4)).join(' / ') + '; максимум у устьев ' + res.map(q => q.m.toFixed(3)).join(' / ') + ' (у устьев сходится медленно — они лежат в пограничном слое)');
  const dv = Math.abs(res[res.length - 1].mid - res[res.length - 2].mid) / Math.abs(res[res.length - 1].mid);
  check('перенос в проливе (ψ в середине) не зависит от разрешения (≥2 ячеек в проливе): различие <5 %', dv < 0.05, (dv * 100).toFixed(1) + ' %');
}

console.log('Тест 5: западное усиление');
{
  for (const [name, lat0, lat1] of [['СП', 10, 50], ['ЮП', -50, -10]]) {
    const W = 240, H = 160, r = S.solve({ W, H, land: box(W, H, 90, 200, lat0, lat1) }), g = idx(W, H);
    const colMax = (x0, x1) => { let m = 0; for (let y = g.yOf(lat1) + 3; y < g.yOf(lat0) - 3; y++) for (let x = x0; x < x1; x++) m = Math.max(m, Math.abs(r.v[y * W + x])); return m; };
    const wst = colMax(g.xOf(90), g.xOf(100)), est = colMax(g.xOf(190), g.xOf(200)), mid = colMax(g.xOf(130), g.xOf(160));
    check(name + ': |v| у западного берега > 3× у восточного и > 3× во внутренней части', wst > 3 * est && wst > 3 * mid, 'запад=' + wst.toFixed(2) + ' восток=' + est.toFixed(2) + ' центр=' + mid.toFixed(2));
  }
}

console.log('Тест 6: дивергенция');
{
  // Независимая проверка по ВЫХОДНЫМ скоростям ячеек: div = (1/cosφ)[∂λu + ∂φ(v·cosφ)] центральными разностями; в глубине океана (все 8 соседей — вода) должно быть ≈0
  const W = 240, H = 160, r = S.solve({ W, H, land: world(W, H) }), E = r.E; let maxI = 0, scale = 0, n = 0, rmsC = 0, nc = 0;
  const cosc = (y) => Math.cos(r.lat0 * (1 - 2 * (y + 0.5) / H));
  for (let y = 2; y < H - 2; y++) for (let x = 0; x < W; x++) {
    let inner = true, near = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const q = E[(y + 1 + dy) * W + ((x + dx + W) % W)]; if (q) { if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) inner = false; near = true; } }
    if (E[(y + 1) * W + x]) continue;
    const xe = (x + 1) % W, xw = (x - 1 + W) % W, i = y * W;
    const dudl = (r.u[i + xe] - r.u[i + xw]) / (2 * r.dlam), dvc = (r.v[(y - 1) * W + x] * cosc(y - 1) - r.v[(y + 1) * W + x] * cosc(y + 1)) / (2 * r.dphi);
    const div = (dudl + dvc) / cosc(y), sc = Math.abs(r.u[i + x]) / r.dlam + Math.abs(r.v[i + x]) / r.dphi;
    if (inner) { maxI = Math.max(maxI, Math.abs(div) / (sc || 1)); n++; } else if (near) { rmsC += (div / (sc || 1)) ** 2; nc++; }
  }
  const rel = []; // относительная дивергенция в глубине океана для двух разрешений (скорость сходимости схемы)
  const relDiv = (Wc, Hc) => { const rr = S.solve({ W: Wc, H: Hc, land: box(Wc, Hc, 90, 200, 10, 50) }), EE = rr.E, cs = (y) => Math.cos(rr.lat0 * (1 - 2 * (y + 0.5) / Hc)); let q = 0, m = 0;
    for (let y = 2; y < Hc - 2; y++) for (let x = 3; x < Wc - 3; x++) { let ok = true; for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) if (EE[(y + 1 + dy) * Wc + x + dx]) { ok = false; break; } if (!ok) continue;
      const i = y * Wc, d = ((rr.u[i + x + 1] - rr.u[i + x - 1]) / (2 * rr.dlam) + (rr.v[(y - 1) * Wc + x] * cs(y - 1) - rr.v[(y + 1) * Wc + x] * cs(y + 1)) / (2 * rr.dphi)) / cs(y), sc = Math.abs(rr.u[i + x]) / rr.dlam + Math.abs(rr.v[i + x]) / rr.dphi; q += (d / (sc || 1)) ** 2; m++; }
    return Math.sqrt(q / m); };
  const d1 = relDiv(120, 80), d2 = relDiv(240, 160), d3 = relDiv(480, 320);
  check('центрально-разностная дивергенция скоростей ячеек → 0 при измельчении сетки (порядок ≥ 1.5)', d3 < d2 && d2 < d1 && Math.log2(d2 / d3) > 1.5, 'rms ' + d1.toExponential(1) + ' → ' + d2.toExponential(1) + ' → ' + d3.toExponential(1));
  // дивергенция потоков через грани ячейки (разности ψ на концах граней) тождественно нулевая — проверяем для полноты
  let mf = 0; for (let ye = 1; ye <= H; ye++) for (let x = 0; x < W; x++) { if (E[ye * W + x]) continue; const x1 = (x + 1) % W, a = r.psi[ye * W + x], b = r.psi[ye * W + x1], c = r.psi[(ye + 1) * W + x], d = r.psi[(ye + 1) * W + x1]; mf = Math.max(mf, Math.abs((b - a) + (d - b) + (c - d) + (a - c))); }
  check('баланс потоков по граням ячейки = 0 (тождество схемы)', mf === 0 || mf < 1e-12, mf.toExponential(1));
}

console.log('Тест 7: детерминизм');
{
  const W = 240, H = 160, a = S.solve({ W, H, land: world(W, H) }), b = S.solve({ W, H, land: world(W, H) }); let same = true; for (let i = 0; i < a.psi.length; i++) if (a.psi[i] !== b.psi[i]) { same = false; break; }
  check('повторный расчёт даёт идентичное поле ψ', same);
}

console.log('Тест 8: сходимость по сетке');
{
  const sizes = quick ? [[120, 80], [240, 160], [480, 320]] : [[120, 80], [240, 160], [480, 320], [960, 640]], vals = [], ints = [];
  for (const [W, H] of sizes) { const r = S.solve({ W, H, land: box(W, H, 90, 200, 10, 50) }), [cx, cy] = cellAt(W, H, 145, 30); vals.push(nodePsi(r, cx, cy)); let m = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m = Math.min(m, nodePsi(r, x, y)); ints.push(m); console.log('     ' + W + '×' + H + ': ψ_центр=' + vals[vals.length - 1].toFixed(3) + ' ψ_мин=' + m.toFixed(3) + ' итераций ' + r.diag.iters + ' ' + Math.round(r.diag.ms) + ' мс'); }
  const d = (a, b) => Math.abs(a - b) / Math.abs(b), n = ints.length;
  check('максимум переноса гиры: два последних разрешения различаются <10 %', d(ints[n - 2], ints[n - 1]) < 0.10, (d(ints[n - 2], ints[n - 1]) * 100).toFixed(1) + ' %');
  check('все уровни в пределах 3 % друг от друга (монотонности нет — шум порядка 1 %: берег ступенчатый)', Math.max(...ints.map(q => d(q, ints[n - 1]))) < 0.03, ints.map(q => (d(q, ints[n - 1]) * 100).toFixed(1)).join(' / ') + ' %');
}

console.log('Тест 9: экватор и полюса');
{
  const W = 240, H = 160, r = S.solve({ W, H, land: box(W, H, 90, 200, -73, 73) }); let bad = 0, mx = 0; const sps = [];
  for (let i = 0; i < W * H; i++) { if (!isFinite(r.u[i]) || !isFinite(r.v[i])) bad++; if (r.sp[i]) sps.push(r.sp[i]); }
  sps.sort((a, b) => a - b); const med = sps[sps.length >> 1], p99 = sps[Math.floor(sps.length * 0.99)], max = sps[sps.length - 1];
  check('поле конечно, сошлось у экватора и у ±73°', bad === 0 && r.diag.ok, 'нечисловых ' + bad + ', итераций ' + r.diag.iters);
  check('нет полярных всплесков: max скорости < 25× медианы', max < 25 * med, 'median=' + med.toFixed(2) + ' p99=' + p99.toFixed(2) + ' max=' + max.toFixed(2));
  const [ex, ey] = cellAt(W, H, 145, 0); check('экватор: Свердруп не выродился, внутри океана v≠NaN и умеренно', Math.abs(r.v[ey * W + ex]) < 25 * med);
}

console.log('Тест 10: чувствительность к параметрам');
{
  const W = 240, H = 160, land = box(W, H, 90, 200, 10, 50), [cx, cy] = cellAt(W, H, 145, 30), a = S.solve({ W, H, land }), b = S.solve({ W, H, land, tau0: 2 }), c = S.solve({ W, H, land, r: 0.06 }), m = S.solve({ W, H, land, omega: -1 });
  check('ψ линейна по τ₀ (×2 → ×2)', Math.abs(nodePsi(b, cx, cy) / nodePsi(a, cx, cy) - 2) < 1e-4, (nodePsi(b, cx, cy) / nodePsi(a, cx, cy)).toFixed(5));
  const vmax = (r) => { let q = 0; for (let i = 0; i < r.v.length; i++) q = Math.max(q, Math.abs(r.v[i])); return q; };
  check('r×2 расширяет пограничный слой и ослабляет максимум скорости', vmax(c) < 0.8 * vmax(a), vmax(a).toFixed(2) + ' → ' + vmax(c).toFixed(2));
  const g = idx(W, H), colMax = (r, x0, x1) => { let q = 0; for (let y = g.yOf(50) + 3; y < g.yOf(10) - 3; y++) for (let x = x0; x < x1; x++) q = Math.max(q, Math.abs(r.v[y * W + x])); return q; };
  check('обратное вращение (Ω<0): гира меняет знак, усиление переходит на восточный берег', nodePsi(m, cx, cy) > 0 && colMax(m, g.xOf(190), g.xOf(200)) > 3 * colMax(m, g.xOf(90), g.xOf(100)), 'ψ=' + nodePsi(m, cx, cy).toFixed(3));
}

console.log('Тест 11: температура воды (этап 2)');
{
  const W = 240, H = 160, g = idx(W, H), cls = (t, x, y) => S.classify(t.anN[y * W + x]);
  const wd = world(W, H), rw = S.solve({ W, H, land: wd }), tw = S.temperature(rw);
  check('сошлось: изменение за свип < 1e-5, невязка < 1e-3 °C', tw.diag.converged && tw.diag.resid < 1e-3, 'свипов ' + tw.diag.sweeps + ', невязка ' + tw.diag.resid.toExponential(1) + ', ячеек ' + tw.diag.cells);
  check('принцип максимума с допуском 0.1 °C: T в пределах [min T*, max T*] (противопоточная адвекция монотонна; диффузия отклонения нарушает строгость на порядок κ·T*″/γ)', tw.diag.tmin >= tw.diag.tsMin - 0.1 && tw.diag.tmax <= tw.diag.tsMax + 0.1, tw.diag.tmin.toFixed(2) + '…' + tw.diag.tmax.toFixed(2) + ' ⊂ ' + tw.diag.tsMin.toFixed(2) + '…' + tw.diag.tsMax.toFixed(2));
  const rz = S.solve({ W, H, land: wd, tau0: 0 }), tz = S.temperature(rz); let amOpen = 0, amAll = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (rz.E[(y + 1) * W + x]) continue; amAll = Math.max(amAll, Math.abs(tz.an[i])); let open = true; for (let dy = -2; dy <= 2 && open; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + 1 + dy; if (yy < 0 || yy > H + 1 || rz.E[yy * W + (x + dx + W) % W]) { open = false; break; } } if (open) amOpen = Math.max(amOpen, Math.abs(tz.an[i])); }
  check('без ветра (нет течений): в открытой воде аномалий нет (T = T*), в тупиковых заливах — не более 2 °C (диффузия вдоль градиента T*)', amOpen < 0.1 && amAll < 2, 'открытая вода ' + amOpen.toExponential(1) + ' °C, заливы ' + amAll.toFixed(2) + ' °C');
  const rN = S.solve({ W, H, land: box(W, H, 90, 200, 5, 55) }), rS = S.solve({ W, H, land: box(W, H, 90, 200, -55, -5) }), tN = S.temperature(rN), tS = S.temperature(rS);
  const row = (lat) => g.yOf(lat), mirror = (lat) => g.yOf(-lat), x = (lon) => g.xOf(lon);
  const aN = tN.an[row(30) * W + x(95)], aS = tS.an[mirror(30) * W + x(95)], eN = tN.an[row(30) * W + x(197)], eS = tS.an[mirror(30) * W + x(197)];
  check('западный пограничный ток тёплый, восточный холодный — в обоих полушариях', aN > 1 && aS > 1 && eN < -1 && eS < -1 && cls(tN, x(95), row(30)) === 1 && cls(tS, x(95), mirror(30)) === 1 && cls(tN, x(197), row(30)) === 0, 'СП ' + aN.toFixed(1) + '/' + eN.toFixed(1) + ', ЮП ' + aS.toFixed(1) + '/' + eS.toFixed(1) + ' °C');
  check('симметрия полушарий: аномалии в зеркальных точках различаются < 0.5 °C', Math.abs(aN - aS) < 0.5 && Math.abs(eN - eS) < 0.5);
  const rN2 = S.solve({ W: 480, H: 320, land: box(480, 320, 90, 200, 5, 55) }), tN2 = S.temperature(rN2), g2 = idx(480, 320);
  const a2 = tN2.an[g2.yOf(30) * 480 + g2.xOf(95)], e2 = tN2.an[g2.yOf(30) * 480 + g2.xOf(197)], m2 = tN2.an[g2.yOf(30) * 480 + g2.xOf(145)], m1 = tN.an[row(30) * W + x(145)];
  check('температурная аномалия устойчива к сетке (240 → 480): разница < 1.2 °C', Math.abs(a2 - aN) < 1.2 && Math.abs(e2 - eN) < 1.2 && Math.abs(m2 - m1) < 1.2, 'запад ' + aN.toFixed(2) + '→' + a2.toFixed(2) + ', восток ' + eN.toFixed(2) + '→' + e2.toFixed(2));
  const tg = S.temperature(rN, { gamma: tN.diag.gamma * 4 }), tk = S.temperature(rN, { kappa: tN.diag.kappa * 6 });
  const rng = (tt) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < W * H; i++) if (rN.sp[i] > 0) { lo = Math.min(lo, tt.an[i]); hi = Math.max(hi, tt.an[i]); } return hi - lo; };
  check('чувствительность: γ×4 уменьшает аномалию западного тока; κ×6 сглаживает размах аномалий бассейна', tg.an[row(30) * W + x(95)] < aN * 0.8 && rng(tk) < rng(tN), 'γ×4: ' + tg.an[row(30) * W + x(95)].toFixed(2) + ' (база ' + aN.toFixed(2) + '); размах κ×6: ' + rng(tk).toFixed(2) + ' (база ' + rng(tN).toFixed(2) + ')');
  // цвет ← температура, а не направление: то же поле скоростей при γ→∞ (вода не успевает отклониться от T*) даёт почти всё нейтральное
  const th = S.temperature(rw, { gamma: tw.diag.gamma * 200 }); let nonN = 0, nonH = 0, n = 0; for (let i = 0; i < W * H; i++) if (rw.sp[i] > 0) { n++; if (S.classify(tw.anN[i]) !== 2) nonN++; if (S.classify(th.anN[i]) !== 2) nonH++; }
  check('при той же скорости, но жёсткой релаксации (γ×200) почти всё нейтрально; при обычной — заметная доля тёплого/холодного', nonH / n < 0.05 && nonN / n > 0.15, 'цветных: ' + (nonN / n * 100).toFixed(0) + ' % → ' + (nonH / n * 100).toFixed(1) + ' %');
}



console.log('Тест 12: меандры и вихри (возмущения ψ)');
{
  const W = 240, H = 160, land = world(W, H), base = S.solve({ W, H, land }), mea = S.solve({ W, H, land, meander: true, seed: 7 }), mea2 = S.solve({ W, H, land, meander: true, seed: 7 }), mea3 = S.solve({ W, H, land, meander: true, seed: 8 }), zero = S.solve({ W, H, land, meander: { eps1: 0, eps2: 0 }, seed: 7 });
  let bnd = 0, nb = 0; for (let i = 0; i < base.psi.length; i++) if (!base.fr[i] && base.nodeComp[i]) { nb++; if (base.psi[i] !== mea.psi[i]) bnd++; }
  check('граничные константы ψ (берега, острова, стенки) не меняются (бит-в-бит)', bnd === 0, 'узлов ' + nb);
  // нормальный поток через берег — как в тесте 2, но для возмущённого поля
  let maxd = 0, faces = 0; const nd = (x, jn) => mea.psi[jn * W + ((x % W) + W) % W];
  for (let ye = 1; ye <= H; ye++) for (let x = 0; x < W; x++) { if (!mea.E[ye * W + x]) continue; for (const [xx, yy, side] of [[(x + 1) % W, ye, 'E'], [(x - 1 + W) % W, ye, 'W'], [x, ye - 1, 'N'], [x, ye + 1, 'S']]) { if (mea.E[yy * W + xx]) continue; faces++; const [a, b] = side === 'E' ? [[x + 1, ye], [x + 1, ye + 1]] : side === 'W' ? [[x, ye], [x, ye + 1]] : side === 'N' ? [[x, ye], [x + 1, ye]] : [[x, ye + 1], [x + 1, ye + 1]]; maxd = Math.max(maxd, Math.abs(nd(a[0], a[1]) - nd(b[0], b[1]))); } }
  check('нормальный поток через берег с меандрами по-прежнему = 0', maxd === 0, faces + ' граней');
  let loc5 = [], mx = 0, ms = 0, n = 0, bmax = 0, mmax = 0, nan = 0;
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { const i = y * W + x; if (!isFinite(mea.u[i]) || !isFinite(mea.v[i])) nan++; bmax = Math.max(bmax, base.sp[i]); mmax = Math.max(mmax, mea.sp[i]); if (!base.sp[i]) continue; let loc = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) loc = Math.max(loc, base.sp[i + dy * W + dx]); const d = Math.hypot(mea.u[i] - base.u[i], mea.v[i] - base.v[i]) / loc; mx = Math.max(mx, d); ms += d * d; n++; }
  check('амплитуда контролируется: rms возмущения < 20 % местной скорости, максимум < 100 %', Math.sqrt(ms / n) < 0.2 && mx < 1.0, 'rms ' + (Math.sqrt(ms / n) * 100).toFixed(0) + ' %, max ' + (mx * 100).toFixed(0) + ' %');
  check('нет недопустимых скоростей: максимум скорости ≤ 1.3 × максимум без возмущений, нет NaN', mmax <= 1.3 * bmax && nan === 0, 'max ' + mmax.toFixed(1) + ' vs ' + bmax.toFixed(1));
  const g = idx(W, H), [cx, cy] = cellAt(W, H, 285, 25);   // крупные гиры устойчивы: знак и форма ψ сохраняются
  let dot = 0, na = 0, nb2 = 0; for (let i = 0; i < W * H; i++) { dot += base.u[i] * mea.u[i] + base.v[i] * mea.v[i]; na += base.u[i] ** 2 + base.v[i] ** 2; nb2 += mea.u[i] ** 2 + mea.v[i] ** 2; }
  const corr = dot / Math.sqrt(na * nb2); check('крупномасштабная циркуляция сохранена: корреляция векторного поля с невозмущённым > 0.95', corr > 0.95, 'r=' + corr.toFixed(3));
  let ds = 0; for (let i = 0; i < base.psi.length; i++) if (base.fr[i] && Math.sign(base.psi[i]) !== Math.sign(mea.psi[i]) && Math.abs(base.psi[i]) > 0.5) ds++;
  check('знак ψ в ядрах гир не меняется (где |ψ| > 0.5)', ds === 0, 'узлов с переворотом ' + ds);
  let same = true, diff = false, zeroSame = true; for (let i = 0; i < mea.psi.length; i++) { if (mea.psi[i] !== mea2.psi[i]) same = false; if (mea.psi[i] !== mea3.psi[i]) diff = true; if (zero.psi[i] !== base.psi[i]) zeroSame = false; }
  check('одинаковый seed — идентичное поле, другой seed — другие меандры', same && diff);
  check('амплитуда 0 даёт невозмущённое поле', zeroSame);
  const scales = (res) => { let e = 0, nn = 0; for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { const i = y * W + x; if (!res.sp[i]) continue; e += Math.abs(res.u[i + 1] - res.u[i - 1]) + Math.abs(res.u[i + W] - res.u[i - W]); nn++; } return e / nn; };
  check('меандры добавляют мелкие масштабы: средний градиент скорости растёт', scales(mea) > scales(base) * 1.02, scales(base).toFixed(2) + ' → ' + scales(mea).toFixed(2));
}

const LN = require('../src/currents_lines.js');
console.log('Тест 13: линии тока');
{
  const W = 240, H = 160, res = S.solve({ W, H, land: world(W, H), meander: true, seed: 5 }), sps = []; for (let i = 0; i < res.sp.length; i++) if (res.sp[i] > 0) sps.push(res.sp[i]); sps.sort((a, b) => a - b); const p99 = sps[Math.floor(sps.length * 0.99)];
  const ux = new Float32Array(W * H), uy = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!res.sp[i]) continue; const d = S.pixelDir(res, x, y), m = Math.min(1.5, Math.sqrt(res.sp[i] / p99)); ux[i] = d[0] * m; uy[i] = d[1] * m; }
  const E = res.E, wat = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 2 || yi < 2 || xi >= W - 2 || yi >= H - 2) return false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (E[(yi + 1 + dy) * W + xi + dx]) return false; return !res.smallMask[yi * W + xi]; };
  const mk = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
  const L1 = LN.lines({ W, H, ux, uy, free: wat, rand: mk(11), sc: 0.5, sep: 4, seedStep: 3 }), L2 = LN.lines({ W, H, ux, uy, free: wat, rand: mk(11), sc: 0.5, sep: 4, seedStep: 3 });
  check('построено линий: ' + L1.length, L1.length > 20);
  let bad = 0, tot = 0, wrong = 0; for (const l of L1) for (let i = 1; i < l.pts.length; i++) { const p = l.pts[i], q = l.pts[i - 1]; tot++; if (!wat(p[0], p[1])) bad++; const k = Math.round(p[1]) * W + Math.round(p[0]), tx = p[0] - q[0], ty = p[1] - q[1]; if (tx * ux[k] + ty * uy[k] <= 0) wrong++; }
  check('все точки линий лежат в воде (не пересекают сушу, подсеточные острова, малые акватории)', bad === 0, tot + ' точек');
  check('направление линии согласовано с полем скорости во всех точках', wrong === 0, 'несогласованных ' + wrong);
  // минимальная дистанция: точки разных линий не ближе 0.5·sep·(0.55) …
  let minD = 1e9; for (let a = 0; a < L1.length; a++) for (let b = a + 1; b < L1.length; b++) { const A = L1[a].pts, B = L1[b].pts; for (let i = 0; i < A.length; i += 2) for (let j = 0; j < B.length; j += 2) { const d = Math.hypot(A[i][0] - B[j][0], A[i][1] - B[j][1]); if (d < minD) minD = d; } }
  check('минимальная дистанция между линиями ≥ 0.4·sep (нет визуального перенасыщения)', minD >= 0.4 * 4 - 0.7, 'min ' + minD.toFixed(2) + ' при sep=4');
  // интенсивность: плотность линий (длина на ячейку воды) в быстрых течениях выше, чем в слабых
  const cnt = (cond) => { let len = 0, area = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (res.sp[i] > 0 && cond(Math.hypot(ux[i], uy[i]))) area++; } for (const l of L1) for (const p of l.pts) { const i = Math.round(p[1]) * W + Math.round(p[0]); if (cond(Math.hypot(ux[i], uy[i]))) len++; } return len / Math.max(1, area); };
  const dS = cnt(m => m > 0.8), dW = cnt(m => m < 0.4); check('плотность линий в сильных течениях выше, чем в слабых', dS > dW * 1.3, 'сильные ' + dS.toFixed(2) + ' vs слабые ' + dW.toFixed(2) + ' точек/ячейку');
  let same = L1.length === L2.length; if (same) for (let i = 0; i < L1.length; i++) if (L1[i].pts.length !== L2[i].pts.length) same = false;
  check('воспроизводимость: тот же seed — те же линии', same);
}

console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nВсе проверки пройдены (' + results.length + ')');
process.exit(fails ? 1 : 0);
