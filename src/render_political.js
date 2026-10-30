// Политический слой: границы и подписи государств, ничьи/спорные земли, города и значки, дороги.
(function (FM) {
  'use strict';
  const R = FM.R;
  const { mulberry32, hashString, makeNoise, fbm, smooth, clamp } = FM;
  const { THEMES, PLATE_HUES, BOUNDARY_COLORS, makeCanvas, paperCache, getPaper, grainPattern, getGrain, chaikin, addLoops, rgb, renderMap, renderHeight } = R;

  // ---------- государства: границы, подписи, столицы ----------
  const STATE_HUES = [8, 205, 42, 140, 275, 22, 175, 330, 60, 240, 100, 0, 190, 300, 120, 350];
  const stateColor = (id, a) => `hsla(${STATE_HUES[(id - 1) % STATE_HUES.length]},60%,48%,${a})`;

  function textOnPath(ctx, pts, text, f, spacing, k, rects) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const widths = [...text].map(ch => ctx.measureText(ch).width);
    const len = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
    let pos = (total - len) / 2, j = 0;
    const chars = [...text];
    for (let c = 0; c < chars.length; c++) {
      const d = pos + widths[c] / 2;
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const seg = Math.max(1e-6, cum[j + 1] - cum[j]), t = clamp((d - cum[j]) / seg, 0, 1);
      const x = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, y = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t;
      const ang = Math.atan2(pts[j + 1][1] - pts[j][1], pts[j + 1][0] - pts[j][0]);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.strokeText(chars[c], 0, 0); ctx.fillText(chars[c], 0, 0);
      ctx.restore();
      if (rects) rects.push({ x: x - f * 0.6, y: y - f * 0.6, w: f * 1.2, h: f * 1.2 });
      pos += widths[c] + spacing;
    }
  }

  // ---------- ничьи и спорные земли: штриховка и подпись ----------
  function drawZones(ctx, map, pol, th, k, S, rects) {
    if (!pol.zone || !pol.zones || !pol.zones.length) return;
    const key = pol.version + '|' + S;
    if (!pol._zgeo || pol._zgeo.key !== key) {
      const W = map.W, H = map.H, ps = [new Path2D(), new Path2D(), new Path2D()];
      for (let y = 0; y < H; y++) for (let x = 0; x < W;) {
        const z = pol.zone[y * W + x]; if (!z) { x++; continue; }
        let x1 = x; while (x1 < W && pol.zone[y * W + x1] === z) x1++;
        ps[z].rect((x - 0.5) * S, (y - 0.5) * S, (x1 - x) * S, S); x = x1;
      }
      pol._zgeo = { key, ps };
    }
    const g = pol._zgeo;
    ctx.save();
    const W2 = map.W * S, H2 = map.H * S;
    for (const z of [1, 2]) {
      ctx.save(); ctx.clip(g.ps[z]);
      ctx.strokeStyle = z === 1 ? 'rgba(90,70,50,0.55)' : 'rgba(170,50,40,0.6)'; ctx.lineWidth = 1.1 * k; ctx.beginPath();
      const step = 7 * k;
      for (let d = -H2; d < W2; d += step) { ctx.moveTo(d, 0); ctx.lineTo(d + H2, H2); if (z === 2) { ctx.moveTo(d + H2, 0); ctx.lineTo(d, H2); } }
      ctx.stroke(); ctx.restore();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const zn of pol.zones) {
      const text = FM.T(zn.kind === 1 ? 'Ничьи земли' : 'Спорные земли'), f = clamp(Math.sqrt(zn.n) * S * 0.16, 10 * k, 19 * k);
      ctx.font = `italic ${f}px Georgia, "Times New Roman", serif`;
      ctx.fillStyle = th.ink; ctx.strokeStyle = rgb(th.paper, 0.85); ctx.lineWidth = f * 0.3;
      ctx.strokeText(text, zn.x * S, zn.y * S); ctx.fillText(text, zn.x * S, zn.y * S);
      if (rects) { const w = ctx.measureText(text).width; rects.push({ x: zn.x * S - w / 2, y: zn.y * S - f * 0.6, w, h: f * 1.2 }); }
    }
    ctx.restore();
  }

  function drawPolitical(ctx, map, pol, th, k, S, noise) {
    const key = pol.version + '|' + S;
    if (!pol._geo || pol._geo.key !== key) {
      const lines = FM.borderLines(pol.owner, map.W, map.H).map(l => {
        const p = FM.smoothOpen(l.map(q => [q[0] * S, q[1] * S]), 3), n = p.length;
        return p.map((q, i) => {
          const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
          let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
          const w = noise(q[0] * 0.05 + 70, q[1] * 0.05) * 1.3 * k;
          return [q[0] + nx * w, q[1] + ny * w];
        });
      });
      const labels = FM.labelPaths(pol.owner, map.W, map.H, pol.states).map(l => Object.assign({}, l, { pts: FM.smoothOpen(l.pts.map(q => [q[0] * S, q[1] * S]), 2) }));
      pol._geo = { key, lines, labels };
    }
    const geo = pol._geo;
    ctx.save();
    ctx.strokeStyle = th.ink; ctx.lineWidth = 2.3 * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([11 * k, 4 * k, 2.5 * k, 4 * k]); ctx.globalAlpha = 0.92;
    for (const l of geo.lines) {
      if (l.length < 2) continue;
      ctx.beginPath(); ctx.moveTo(l[0][0], l[0][1]);
      for (let i = 1; i < l.length; i++) ctx.lineTo(l[i][0], l[i][1]);
      ctx.stroke();
    }
    ctx.restore();
    const rects = [];
    drawZones(ctx, map, pol, th, k, S, rects);
    // подписи по дуге
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const l0 of geo.labels) { let l = l0;
      let pathLen = 0; for (let i = 1; i < l.pts.length; i++) pathLen += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]);
      const n = l.text.length;
      const target = Math.min(pathLen * 0.9, l.length * S * 0.8);
      if (l.pts[l.pts.length - 1][0] < l.pts[0][0]) l = Object.assign({}, l, { pts: l.pts.slice().reverse() });   // текст всегда читается слева направо, не вверх ногами
      let f = clamp(Math.min(l.thick * S * 0.3, target / (n * 1.05)), 11 * k, 44 * k);
      ctx.font = `${f}px Georgia, "Times New Roman", serif`;
      let w0 = [...l.text].reduce((a, ch) => a + ctx.measureText(ch).width, 0);
      if (w0 > target) { f *= target / w0; ctx.font = `${f}px Georgia, "Times New Roman", serif`; w0 = target; }
      const spacing = clamp((target - w0) / Math.max(1, n - 1), f * 0.12, f * 0.55);
      ctx.fillStyle = th.ink; ctx.strokeStyle = rgb(th.paper, 0.75); ctx.lineWidth = f * 0.28;
      textOnPath(ctx, l.pts, l.text, f, spacing, k, rects);
    }
    ctx.restore();
    drawCities(ctx, map, pol, th, k, S, rects);
  }


  // ---------- города: значки и подписи ----------
  function drawMarker(ctx, c, th, k, S) {
    const x = c.x * S, y = c.y * S, ink = th.ink, paper = rgb(th.paper);
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = ink; ctx.fillStyle = ink;
    const dia = (r, fill) => { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); };
    switch (c.type) {
      case 'capital': ctx.lineWidth = 1.8 * k; dia(6.5 * k, paper); ctx.beginPath(); ctx.arc(x, y, 2 * k, 0, 6.3); ctx.fillStyle = ink; ctx.fill(); break;
      case 'city': ctx.lineWidth = 1.5 * k; dia(5 * k, ink); break;
      case 'town': ctx.lineWidth = 1.5 * k; dia(3.8 * k, paper); break;
      case 'village': ctx.beginPath(); ctx.arc(x, y, 2.6 * k, 0, 6.3); ctx.fill(); break;
      case 'port':
        ctx.lineWidth = 1.4 * k; ctx.beginPath(); ctx.arc(x, y - 3.4 * k, 1.3 * k, 0, 6.3);
        ctx.moveTo(x, y - 2.1 * k); ctx.lineTo(x, y + 3.8 * k); ctx.moveTo(x - 2.6 * k, y - 0.6 * k); ctx.lineTo(x + 2.6 * k, y - 0.6 * k);
        ctx.moveTo(x - 3.6 * k, y + 1 * k); ctx.quadraticCurveTo(x, y + 6.5 * k, x + 3.6 * k, y + 1 * k); ctx.stroke(); break;
      case 'fortress':
        ctx.lineWidth = 1.5 * k; ctx.fillStyle = paper; ctx.beginPath(); ctx.rect(x - 3.8 * k, y - 3 * k, 7.6 * k, 6.6 * k); ctx.fill(); ctx.stroke();
        ctx.beginPath(); for (const dx of [-3.8, 0, 3.8]) { ctx.moveTo(x + dx * k, y - 3 * k); ctx.lineTo(x + dx * k, y - 5.2 * k); } ctx.stroke(); break;
      case 'mine':
        ctx.lineWidth = 1.9 * k; ctx.beginPath(); ctx.moveTo(x - 4 * k, y - 4 * k); ctx.lineTo(x + 4 * k, y + 4 * k); ctx.moveTo(x + 4 * k, y - 4 * k); ctx.lineTo(x - 4 * k, y + 4 * k); ctx.stroke();
        ctx.lineWidth = 1.5 * k; ctx.beginPath(); ctx.moveTo(x - 5.5 * k, y - 2.2 * k); ctx.lineTo(x - 2.4 * k, y - 5.4 * k); ctx.moveTo(x + 5.5 * k, y - 2.2 * k); ctx.lineTo(x + 2.4 * k, y - 5.4 * k); ctx.stroke(); break;
      case 'ruin':
        ctx.lineWidth = 1.5 * k; ctx.beginPath(); ctx.moveTo(x - 3.5 * k, y + 3.5 * k); ctx.lineTo(x - 3.5 * k, y - 2 * k); ctx.lineTo(x - 0.5 * k, y - 4 * k);
        ctx.moveTo(x + 3.5 * k, y + 3.5 * k); ctx.lineTo(x + 3.5 * k, y); ctx.moveTo(x - 1.5 * k, y + 3.5 * k); ctx.lineTo(x + 1.5 * k, y + 3.5 * k); ctx.stroke(); break;
    }
    ctx.restore();
  }

  const LABEL_SIZE = { capital: 13, city: 12, port: 10.5, town: 10.5, fortress: 9.5, mine: 9.5, village: 9.5, ruin: 9.5 };
  const LABEL_ORDER = { capital: 0, city: 1, port: 2, town: 3, fortress: 4, mine: 5, village: 6, ruin: 7 };

  function drawCities(ctx, map, pol, th, k, S, rects) {
    const list = FM.allCities(pol).sort((a, b) => LABEL_ORDER[a.type] - LABEL_ORDER[b.type]);
    for (const c of list) { drawMarker(ctx, c, th, k, S); rects.push({ x: c.x * S - 8 * k, y: c.y * S - 8 * k, w: 16 * k, h: 16 * k }); }
    ctx.save(); ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const hit = (r) => rects.some(q => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
    for (const c of list) {
      const f = LABEL_SIZE[c.type] * k, bold = c.type === 'capital' ? 'bold ' : '', it = (c.type === 'ruin' || c.type === 'mine') ? 'italic ' : '';
      ctx.font = `${it}${bold}${f}px Georgia, "Times New Roman", serif`;
      const text = c.type === 'capital' ? c.name.toUpperCase() : c.name;
      const w = ctx.measureText(text).width, x = c.x * S, y = c.y * S, off = 7.5 * k;
      const cands = [
        { x: x + off, y: y - f * 0.1, a: 'left' }, { x: x - off, y: y - f * 0.1, a: 'right' },
        { x: x, y: y + off + f * 0.55, a: 'center' }, { x: x, y: y - off - f * 0.55, a: 'center' }
      ];
      let chosen = null;
      for (const q of cands) {
        const r = { x: q.a === 'left' ? q.x : q.a === 'right' ? q.x - w : q.x - w / 2, y: q.y - f * 0.6, w, h: f * 1.2 };
        if (!hit(r)) { chosen = { q, r }; break; }
      }
      if (!chosen) { if (c.type === 'village' || c.type === 'ruin' || c.type === 'mine') continue; const q = cands[0]; chosen = { q, r: { x: q.x, y: q.y - f * 0.6, w, h: f * 1.2 } }; }
      ctx.textAlign = chosen.q.a; ctx.fillStyle = th.ink; ctx.strokeStyle = rgb(th.paper, 0.8); ctx.lineWidth = f * 0.3;
      ctx.strokeText(text, chosen.q.x, chosen.q.y); ctx.fillText(text, chosen.q.x, chosen.q.y);
      rects.push(chosen.r);
    }
    ctx.restore();
  }

  // ---------- дороги ----------
  function drawRoads(ctx, map, pol, th, k, S, noise) {
    const key = (pol.rv || 0) + '|' + S;
    if (!pol._rgeo || pol._rgeo.key !== key) {
      const g = FM.roadGeometry(map, pol);
      const sm = (l) => {
        const p = FM.smoothOpen(l.map(q => [q[0] * S, q[1] * S]), 3), n = p.length;
        return p.map((q, i) => {
          const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
          let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
          const w = noise(q[0] * 0.06 + 20, q[1] * 0.06 + 5) * 1.1 * k;
          return [q[0] + nx * w, q[1] + ny * w];
        });
      };
      pol._rgeo = { key, 1: g[1].map(sm), 2: g[2].map(sm), 3: g[3].map(sm), bridges: g.bridges };
    }
    const g = pol._rgeo;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const strokeAll = (lines) => { ctx.beginPath(); for (const l of lines) { if (l.length < 2) continue; ctx.moveTo(l[0][0], l[0][1]); for (let i = 1; i < l.length; i++) ctx.lineTo(l[i][0], l[i][1]); } ctx.stroke(); };
    if (th.game) {                                       // картографические дороги: тракты красные, дороги тёмные, тропы пунктиром
      ctx.strokeStyle = 'rgba(40,36,32,0.85)'; ctx.setLineDash([3 * k, 3 * k]); ctx.lineWidth = 1 * k; strokeAll(g[1]); ctx.setLineDash([]);
      ctx.lineWidth = 1.5 * k; strokeAll(g[2]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3.6 * k; strokeAll(g[3]);
      ctx.strokeStyle = 'rgb(178,40,34)'; ctx.lineWidth = 2 * k; strokeAll(g[3]);
      ctx.strokeStyle = 'rgba(40,36,32,0.9)'; ctx.lineWidth = 2.6 * k;
      for (const b of g.bridges) { const x = b.x * S, y = b.y * S, L = Math.hypot(b.dx, b.dy) || 1, ux = b.dx / L, uy = b.dy / L; ctx.beginPath(); ctx.moveTo(x - ux * 4 * k, y - uy * 4 * k); ctx.lineTo(x + ux * 4 * k, y + uy * 4 * k); ctx.stroke(); }
      ctx.restore(); return;
    }
    ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.25 * k; ctx.setLineDash([5 * k, 4 * k]); strokeAll(g[1]); ctx.setLineDash([]);
    ctx.lineWidth = 1.8 * k; strokeAll(g[2]);
    ctx.lineWidth = 3.4 * k; strokeAll(g[3]);
    ctx.strokeStyle = rgb(th.paper); ctx.lineWidth = 1.3 * k; ctx.globalAlpha = 1; strokeAll(g[3]);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1.2 * k; ctx.globalAlpha = 0.95;
    for (const b of g.bridges) {
      const x = b.x * S, y = b.y * S, L = Math.hypot(b.dx, b.dy) || 1, ux = b.dx / L, uy = b.dy / L, px = -uy, py = ux, w = (3 + b.cls) * k;
      ctx.beginPath();
      for (const off of [-2.4 * k, 2.4 * k]) { ctx.moveTo(x + ux * off + px * w, y + uy * off + py * w); ctx.lineTo(x + ux * off - px * w, y + uy * off - py * w); }
      ctx.stroke();
    }
    ctx.restore();
  }

  Object.assign(R, { STATE_HUES, stateColor, textOnPath, drawZones, drawPolitical, drawMarker, LABEL_SIZE, LABEL_ORDER, drawCities, drawRoads });
})(window.FM);
