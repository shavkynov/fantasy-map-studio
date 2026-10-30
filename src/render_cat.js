// Знаки катастроф на карте: кратеры и кальдеры (кольцо с штрихами), провалы (уступ), расколы и каньоны (линия с засечками). Слой «Катастрофы».
(function (FM) {
  'use strict';
  const R = FM.R;
  function ring(ctx, x, y, rx, ry, rot, seed, k, ticks, dashed) {
    const n = 40; ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2, wob = 1 + 0.06 * Math.sin(a * 3 + seed) + 0.04 * Math.sin(a * 5 + seed * 2.3);
      const px = Math.cos(a) * rx * wob, py = Math.sin(a) * ry * wob, X = x + px * Math.cos(rot) - py * Math.sin(rot), Y = y + px * Math.sin(rot) + py * Math.cos(rot);
      if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    }
    if (dashed) ctx.setLineDash([3.5 * k, 2.5 * k]); ctx.stroke(); ctx.setLineDash([]);
    if (ticks) {   // короткие штрихи внутрь по юго-западной (теневой) половине
      ctx.beginPath();
      for (let i = 0; i < ticks; i++) {
        const a = Math.PI * (0.45 + 1.1 * i / ticks) , cx = Math.cos(a), sy = Math.sin(a), px = cx * rx, py = sy * ry, qx = cx * rx * 0.8, qy = sy * ry * 0.8;
        ctx.moveTo(x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot)); ctx.lineTo(x + qx * Math.cos(rot) - qy * Math.sin(rot), y + qx * Math.sin(rot) + qy * Math.cos(rot));
      }
      ctx.stroke();
    }
  }
  function line(ctx, pts, S, k, tickLen, step, dashed) {
    if (pts.length < 2) return;
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0] * S, p[1] * S) : ctx.moveTo(p[0] * S, p[1] * S));
    if (dashed) ctx.setLineDash([5 * k, 3 * k]); ctx.stroke(); ctx.setLineDash([]);
    if (!tickLen) return; ctx.beginPath();
    for (let i = 1; i < pts.length - 1; i += step) {
      const a = pts[i - 1], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, sd = (i / step) % 2 ? 1 : -1;
      ctx.moveTo(pts[i][0] * S, pts[i][1] * S); ctx.lineTo(pts[i][0] * S + nx * tickLen * sd, pts[i][1] * S + ny * tickLen * sd);
    }
    ctx.stroke();
  }
  // долина раскола: два края на разном расстоянии от оси (асимметрия, своя «рябь» у каждого края), ширина берётся из самого раскола; засечки — только по одному краю, неравномерно
  function band(ctx, e, S, k, seed, fill) {
    const P = e.pts, n = P.length, L = [], Rr = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, w = Math.max(0.8, e.w[i]) * S;
      const hl = w * (0.55 + 0.25 * Math.sin(i * 1.7 + seed * 3.1) + 0.12 * Math.sin(i * 4.3 + seed)), hr = w * (0.55 + 0.25 * Math.sin(i * 1.3 + seed * 1.7 + 2) + 0.12 * Math.sin(i * 3.7 + seed * 2));
      L.push([P[i][0] * S + nx * hl, P[i][1] * S + ny * hl]); Rr.push([P[i][0] * S - nx * hr, P[i][1] * S - ny * hr]);
    }
    ctx.setLineDash([]);
    if (fill) {   // тёмная заливка долины: раскол читается на карте как провал, а не как тонкая линия
      ctx.save(); ctx.globalAlpha = 0.24; ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); L.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); for (let i = n - 1; i >= 0; i--) ctx.lineTo(Rr[i][0], Rr[i][1]); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(1.5 * k, 0.35 * (e.w.reduce((a, b) => a + b, 0) / n) * S); ctx.beginPath(); P.forEach((q, i) => i ? ctx.lineTo(q[0] * S, q[1] * S) : ctx.moveTo(q[0] * S, q[1] * S)); ctx.stroke(); ctx.restore();
    }
    ctx.lineWidth = 1.9 * k;
    for (const E of [L, Rr]) { ctx.beginPath(); E.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); }
    ctx.lineWidth = 1.1 * k; ctx.beginPath();   // засечки обрыва на обоих краях, направлены к оси
    for (let i = 1; i < n - 1; i += 1 + (i * 7 + seed) % 2) {
      ctx.moveTo(L[i][0], L[i][1]); ctx.lineTo(L[i][0] + (P[i][0] * S - L[i][0]) * 0.5, L[i][1] + (P[i][1] * S - L[i][1]) * 0.5);
      if ((i + seed) % 2) { ctx.moveTo(Rr[i][0], Rr[i][1]); ctx.lineTo(Rr[i][0] + (P[i][0] * S - Rr[i][0]) * 0.42, Rr[i][1] + (P[i][1] * S - Rr[i][1]) * 0.42); }
    }
    ctx.stroke();
  }
  function drawCatastrophes(ctx, map, th, k, S) {
    const ev = map.catastrophes; if (!ev || !ev.length) return;
    const col = th.game ? 'rgba(70,40,25,0.8)' : th.ink;
    ctx.save(); ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.85;
    ev.forEach((e, n) => {
      if (e.kind === 'meteor' || e.kind === 'caldera') {
        const isC = e.kind === 'caldera'; ctx.lineWidth = (isC ? 1.3 : 1.5) * k;
        ring(ctx, e.x * S, e.y * S, e.r * S, e.r * S * 0.92, 0.4, n, k, isC ? 0 : Math.round(8 + e.r), false);
        if (e.r > 8) { ctx.lineWidth = 1 * k; ring(ctx, e.x * S, e.y * S, e.r * S * 1.28, e.r * S * 1.18, 0.4, n + 1, k, 0, true); }
      } else if (e.kind === 'subsidence') {
        ctx.lineWidth = 1.2 * k; ring(ctx, e.x * S, e.y * S, e.r * S * 1.05, e.b * S * 1.05, e.rot, n, k, 14, true);
      } else if (e.kind === 'rift') {
        if (e.w && e.w.length === e.pts.length) band(ctx, e, S, k, n, e.sub === 'valley');   // долина: неровная полоса переменной ширины, края разные
        else { ctx.lineWidth = 1.2 * k; line(ctx, e.pts, S, k, 3.2 * k, 2, e.sub === 'valley'); }
      } else if (e.kind === 'canyon') {
        ctx.lineWidth = 1.5 * k; line(ctx, e.pts, S, k, 2.6 * k, 2, false);
      }
    });
    ctx.restore();
  }
  R.drawCatastrophes = drawCatastrophes;
})(window.FM);
