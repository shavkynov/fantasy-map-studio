// Линии тока для рисования (этап 3, docs/CURRENTS_MODEL.md §4): интегрирование поля, посев по интенсивности, минимальная дистанция, согласованность с направлением поля.
// Чистая функция: ничего не знает о карте — вода и берега приходят колбэком free(x,y); работает в браузере (FM.currentLines) и в Node (тесты).
//   ux,uy — направление × сжатая скорость m (0…1.5) в «пиксельных» осях; sep — базовая дистанция между линиями (пикселей); rand — генератор [0,1).
// Посев: узлы сетки сортируются по убыванию скорости — сильные течения занимают место первыми; дистанция между линиями растёт для слабых течений (редкие линии там, где течение слабое).
(function (FM) {
  'use strict';
  function lines(o) {
    const { W, H, ux, uy, free, rand } = o, sc = o.sc || 1, sep = o.sep || 8 * sc, seedStep = o.seedStep || 6 * sc, minLen = o.minLen === undefined ? 22 * sc : o.minLen, maxN = o.maxN || 180 * sc, weakK = o.weakK === undefined ? 0.9 : o.weakK;
    const cell = sep, gw = Math.ceil(W / cell), gh = Math.ceil(H / cell), occ = Array.from({ length: gw * gh }, () => []);
    const mag = (x, y) => { const xi = Math.min(W - 1, Math.max(0, Math.round(x))), yi = Math.min(H - 1, Math.max(0, Math.round(y))), i = yi * W + xi; return Math.hypot(ux[i], uy[i]); };
    const localSep = (m) => sep * (1 + weakK * (1 - Math.min(1, m / 0.8)));            // сильное течение (m ≥ 0.8) — базовая дистанция, слабое — до 1+weakK раз реже
    const near = (x, y, own, r) => { const cx = (x / cell) | 0, cy = (y / cell) | 0, k = Math.ceil(r / cell); for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) { const gx = cx + a, gy = cy + b; if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue; for (const q of occ[gy * gw + gx]) if (q.id !== own && (q.x - x) ** 2 + (q.y - y) ** 2 < r * r) return true; } return false; };
    const trace = (x, y, dir, id, n, r) => {
      const pts = []; let px = x, py = y;
      for (let s = 0; s < n; s++) {
        const xi = Math.min(W - 1, Math.max(0, Math.round(px))), yi = Math.min(H - 1, Math.max(0, Math.round(py))), i = yi * W + xi, vx = ux[i], vy = uy[i], l = Math.hypot(vx, vy); if (l < 0.1) break;
        px += dir * vx / l; py += dir * vy / l;
        if (!free(px, py) || near(px, py, id, 0.55 * localSep(l))) break;
        pts.push([px, py, l]);
      }
      return pts;
    };
    const seeds = [];
    for (let y = seedStep; y < H - seedStep; y += seedStep) for (let x = seedStep; x < W - seedStep; x += seedStep) { const sx = x + (rand() - 0.5) * seedStep, sy = y + (rand() - 0.5) * seedStep; seeds.push([sx, sy, mag(sx, sy) * (0.9 + 0.2 * rand())]); }
    seeds.sort((a, b) => b[2] - a[2]);                                                // интенсивность → приоритет
    const out = []; let id = 0;
    for (const [sx, sy, m] of seeds) {
      if (m < 0.1 || !free(sx, sy) || near(sx, sy, -1, 0.55 * localSep(m))) continue;
      id++; const fw = trace(sx, sy, 1, id, maxN, 0), bw = trace(sx, sy, -1, id, maxN, 0).reverse(), pts = bw.concat([[sx, sy, m]], fw);
      if (pts.length < minLen * (m > 0.8 ? 0.7 : 1)) continue;
      for (const p of pts) occ[Math.min(gh - 1, Math.max(0, (p[1] / cell) | 0)) * gw + Math.min(gw - 1, Math.max(0, (p[0] / cell) | 0))].push({ x: p[0], y: p[1], id });
      out.push({ pts, spd: pts.reduce((a, p) => a + p[2], 0) / pts.length });
    }
    return out;
  }
  FM.currentLines = { lines };
  if (typeof module !== 'undefined' && module.exports) module.exports = FM.currentLines;
})(typeof window !== 'undefined' ? window.FM : (globalThis.FM = globalThis.FM || {}));
