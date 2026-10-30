// Редакторские слои: плиты, подсветка государств, города/дороги в режимах редактирования; публичные экспорты FM.*.
(function (FM) {
  'use strict';
  const R = FM.R;
  const { mulberry32, hashString, makeNoise, fbm, smooth, clamp } = FM;
  const { THEMES, PLATE_HUES, BOUNDARY_COLORS, makeCanvas, paperCache, getPaper, grainPattern, getGrain, chaikin, addLoops, rgb, renderMap, renderHeight } = R;

  // ---------- слой плит ----------
  function plateTint(map) {
    if (map._tint) return map._tint;
    const { W, H } = map, c = makeCanvas(W, H), ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const hue = PLATE_HUES[map.plateId[i] % PLATE_HUES.length];
      const col = hslToRgb(hue / 360, 0.55, map.plates[map.plateId[i]].type === 'continental' ? 0.5 : 0.42);
      let a = 70;
      if (map.boundary.edge[i]) { const bc = BOUNDARY_COLORS[map.boundary.btype[i]]; img.data[i * 4] = bc[0]; img.data[i * 4 + 1] = bc[1]; img.data[i * 4 + 2] = bc[2]; a = 235; }
      else { img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; }
      img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    map._tint = c; return c;
  }

  function hslToRgb(h, s, l) {
    const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  }

  const ARROW_BASE = 40, ARROW_SCALE = 90;
  function plateHandles(plates, S) {
    return plates.map(p => {
      return { cx: p.x * S, cy: p.y * S };
    });
  }

  function drawOverlay(ctx, map, plates, S, selected) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(plateTint(map), 0, 0, map.W * S, map.H * S);
    const k = S / 3.75, hs = plateHandles(plates, S);
    plates.forEach((p, i) => {
      const hnd = hs[i];
      const col = i === selected ? '#fff3b0' : '#ffffff';
      // центр плиты: залитый круг = континентальная, пустой = океаническая
      ctx.beginPath(); ctx.arc(hnd.cx, hnd.cy, 9 * k, 0, Math.PI * 2);
      ctx.fillStyle = p.type === 'continental' ? '#1b1b1b' : '#ffffff'; ctx.fill();
      ctx.lineWidth = (i === selected ? 5 : 3) * k; ctx.strokeStyle = i === selected ? col : (p.type === 'continental' ? '#ffffff' : '#1b1b1b'); ctx.stroke();
    });
    ctx.restore();
  }


  function drawCitiesOverlay(ctx, map, pol, S, ui) {
    const k = S / 3.75;
    ctx.save();
    if (ui.showRes) {
      for (const d of FM.getResources(map, map.seed, pol.resCfg).deposits) {
        const x = d.x * S, y = d.y * S;
        ctx.beginPath(); ctx.arc(x, y, (3.5 + 1.5 * d.amt) * k, 0, 6.3);
        ctx.fillStyle = FM.RESOURCES[d.t].color; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * k; ctx.stroke();
      }
    }
    const poly = (cells) => { ctx.beginPath(); cells.forEach((c, i) => { const x = (c % map.W) * S, y = ((c / map.W) | 0) * S; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (ui.roadDraft && ui.roadDraft.length) {
      if (ui.roadPath && ui.roadPath.length) { ctx.strokeStyle = '#f5b800'; ctx.lineWidth = 3.5 * k; poly(ui.roadPath); ctx.stroke(); }
      if (ui.roadPreview && ui.roadPreview.length) { ctx.strokeStyle = 'rgba(245,184,0,0.7)'; ctx.lineWidth = 2.5 * k; ctx.setLineDash([4 * k, 4 * k]); poly(ui.roadPreview); ctx.stroke(); ctx.setLineDash([]); }
      for (const c of ui.roadDraft) { ctx.beginPath(); ctx.arc((c % map.W) * S, ((c / map.W) | 0) * S, 5 * k, 0, 6.3); ctx.fillStyle = '#f5b800'; ctx.fill(); ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.5 * k; ctx.stroke(); }
    }
    if (ui.selCity) {
      const c = FM.allCities(pol).find(q => q.key === ui.selCity);
      if (c) { ctx.beginPath(); ctx.arc(c.x * S, c.y * S, 12 * k, 0, 6.3); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * k; ctx.stroke(); ctx.strokeStyle = '#d93a3a'; ctx.lineWidth = 2 * k; ctx.stroke(); }
    }
    ctx.restore();
  }

  function stateTint(map, pol) {
    const key = pol.version;
    if (pol._tint && pol._tintKey === key) return pol._tint;
    const { W, H } = map, c = makeCanvas(W, H), ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const id = pol.owner[i]; if (!id) continue;
      const col = hslToRgb(R.STATE_HUES[(id - 1) % R.STATE_HUES.length] / 360, 0.6, 0.5);
      img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 90;
    }
    ctx.putImageData(img, 0, 0);
    pol._tint = c; pol._tintKey = key; return c;
  }

  function drawPoliticsOverlay(ctx, map, pol, S, ui) {
    const k = S / 3.75;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(stateTint(map, pol), 0, 0, map.W * S, map.H * S);
    R.drawZones(ctx, map, pol, { ink: '#2b2118', paper: [255, 255, 255] }, k, S, null);
    const poly = (cells, W) => { ctx.beginPath(); cells.forEach((c, i) => { const x = (c % W) * S, y = ((c / W) | 0) * S; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(200,40,40,0.9)'; ctx.lineWidth = 3 * k; ctx.setLineDash([8 * k, 5 * k]);
    for (const b of pol.barriers) { poly(b.path, map.W); ctx.stroke(); }
    ctx.setLineDash([]);
    if (ui.draft && ui.draft.length) {
      if (ui.draftPath && ui.draftPath.length) { ctx.strokeStyle = '#f5b800'; ctx.lineWidth = 3.5 * k; poly(ui.draftPath, map.W); ctx.stroke(); }
      if (ui.previewPath && ui.previewPath.length) { ctx.strokeStyle = 'rgba(245,184,0,0.7)'; ctx.lineWidth = 2.5 * k; ctx.setLineDash([4 * k, 4 * k]); poly(ui.previewPath, map.W); ctx.stroke(); ctx.setLineDash([]); }
      for (const c of ui.draft) { ctx.beginPath(); ctx.arc((c % map.W) * S, ((c / map.W) | 0) * S, 5 * k, 0, 6.3); ctx.fillStyle = '#f5b800'; ctx.fill(); ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.5 * k; ctx.stroke(); }
    }
    for (const s of pol.states) {
      const x = s.capital.x * S, y = s.capital.y * S, r = 9 * k;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      ctx.fillStyle = R.stateColor(s.id, 1); ctx.fill();
      ctx.strokeStyle = s.id === ui.activeId ? '#ffffff' : '#1b1b1b'; ctx.lineWidth = (s.id === ui.activeId ? 3.5 : 2) * k; ctx.stroke();
    }
    if (ui.brushPos && ui.tool === 'brush') {
      ctx.beginPath(); ctx.arc(ui.brushPos.x, ui.brushPos.y, ui.radius * S, 0, 6.3);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5 * k; ctx.stroke(); ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1 * k; ctx.stroke();
    }
    ctx.restore();
  }

  Object.assign(R, { plateTint, hslToRgb, ARROW_BASE, plateHandles, drawOverlay, drawCitiesOverlay, stateTint, drawPoliticsOverlay });
  FM.textOnPath = R.textOnPath; FM.drawLegend = R.drawLegend; FM.legendCanvas = R.legendCanvas; FM.drawOverlay = drawOverlay; FM.drawPoliticsOverlay = drawPoliticsOverlay;
  FM.drawCitiesOverlay = drawCitiesOverlay; FM.stateColor = R.stateColor; FM.plateHandles = plateHandles;
})(window.FM);
