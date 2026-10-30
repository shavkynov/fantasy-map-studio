// Рисованные символы рельефа и растительности: горы, холмы, вулканы, деревья, болота; расстановка по карте.
(function (FM) {
  'use strict';
  const R = FM.R;
  const { mulberry32, hashString, makeNoise, fbm, smooth, clamp } = FM;
  const { THEMES, PLATE_HUES, BOUNDARY_COLORS, makeCanvas, paperCache, getPaper, grainPattern, getGrain, chaikin, addLoops, rgb, renderMap, renderHeight } = R;

  // ---------- горы ----------
  function placeFeatures(map, S, seed) {
    const rand = mulberry32(hashString(seed + '|features')), rn = makeNoise(mulberry32(hashString(seed + '|range')));
    const { W, H } = map, items = [];
    const sp = 11 * (S / 3.75);
    const mtn = new Map();
    const vs = (map.volcanoes || []).map(v => [v.x * S, v.y * S]);
    const nearV = (x, y, d) => vs.some(v => (v[0] - x) ** 2 + (v[1] - y) ** 2 < (d * S) ** 2);
    for (let py = sp; py < H * S - sp; py += sp) for (let px = sp; px < W * S - sp; px += sp) {
      let x = px + (rand() - 0.5) * sp * 1.5, y = py + (rand() - 0.5) * sp * 1.5;
      const gx = clamp(Math.round(x / S), 0, W - 1), gy = clamp(Math.round(y / S), 0, H - 1), i = gy * W + gx;
      if (map.h[i] < 0.05) { rand(); rand(); continue; }
      const ym = map.young[i], om = map.old[i];
      const r = []; for (let k = 0; k < 14; k++) r.push(rand());
      if (ym > 0.2) {
        const s = smooth(0.2, 0.95, ym);
        if (r[13] > 0.3 + 0.5 * s || nearV(x, y, 9)) continue;
        // цепочка: сдвиг к гребню по градиенту поля подъёма (горы встают вдоль оси хребта, а не россыпью по склону)
        let cx = x, cy = y;
        for (let it2 = 0; it2 < 3; it2++) {
          const qx = clamp(Math.round(cx / S), 1, W - 2), qy = clamp(Math.round(cy / S), 1, H - 2), q = qy * W + qx;
          const gX = map.young[q + 1] - map.young[q - 1], gY = map.young[q + W] - map.young[q - W], gl = Math.hypot(gX, gY);
          if (gl < 0.004) break;
          cx += gX / gl * S * 1.3; cy += gY / gl * S * 1.3;
        }
        const kx = Math.floor(cx / (sp * 0.8)), ky = Math.floor(cy / (sp * 0.8)), key = ky * 4096 + kx;
        let busy = false; for (let ax = -1; ax <= 1 && !busy; ax++) for (let ay = -1; ay <= 1; ay++) { const o = mtn.get(key + ay * 4096 + ax); if (o && (o[0] - cx) ** 2 + (o[1] - cy) ** 2 < (sp * 0.78) ** 2) { busy = true; break; } }
        if (busy) continue;
        mtn.set(key, [cx, cy]);
        x = cx; y = cy;
        const mult = 0.75 + 0.5 * (fbm(rn, x * 0.03, y * 0.03, 2) * 0.5 + 0.5);   // хребет то выше, то ниже
        const w = (16 + 24 * Math.pow(s, 1.2)) * mult * (0.85 + 0.3 * r[12]) * (S / 3.75);
        items.push({ t: 'm', x, y, w, h: w * (0.62 + 0.3 * r[11]), r, s });
      } else if ((om > 0.14 || ym > 0.1) && !nearV(x, y, 6)) {
        const s = smooth(0.12, 0.7, Math.max(om, ym));
        if (r[13] > 0.12 + 0.55 * s) continue;
        const w = (11 + 9 * s) * (0.8 + 0.4 * r[12]) * (S / 3.75);
        items.push({ t: 'h', x, y, w, h: w * (0.38 + 0.12 * r[11]), r, s });
      }
    }
    // леса: кластеры по влажности
    const trand = mulberry32(hashString(seed + '|trees')), tn = makeNoise(mulberry32(hashString(seed + '|treenoise')));
    const ts = 6.5 * (S / 3.75);
    for (let py = ts; py < H * S - ts; py += ts) for (let px = ts; px < W * S - ts; px += ts) {
      const x = px + (trand() - 0.5) * ts * 1.6, y = py + (trand() - 0.5) * ts * 1.6, rr = trand(), rs = trand();
      const gx = clamp(Math.round(x / S), 0, W - 1), gy = clamp(Math.round(y / S), 0, H - 1), i = gy * W + gx;
      if (map.h[i] < 0.06 || map.young[i] > 0.12 || map.old[i] > 0.3 || map.riverMask[i] || nearV(x, y, 5)) continue;
      const cluster = smooth(-0.05, 0.35, fbm(tn, x / S * 0.045, y / S * 0.045, 3));
      const bm = map.biome[i], mo = map.moist[i];
      let kind = null, p = 0, sz = 1;
      if (bm === 4) { kind = 't'; p = smooth(0.42, 0.8, mo) * cluster * 0.85; }                  // лиственный лес
      else if (bm === 3) { kind = 'c'; p = (0.35 + 0.5 * smooth(0.38, 0.7, mo)) * (0.4 + 0.6 * cluster); }  // тайга: хвойные
      else if (bm === 8) { kind = 'j'; p = (0.55 + 0.4 * cluster); sz = 1.15; }                    // джунгли: густо
      else if (bm === 7) { kind = 'a'; p = 0.10 * cluster + 0.02; }                                // саванна: редкие деревья
      else if (bm === 5) { kind = 't'; p = smooth(0.3, 0.9, cluster) * 0.2 * smooth(0.3, 0.5, mo); } // степь/луга: рощицы
      else if (bm === 9) { kind = 's'; p = 0.6; sz = 1.0; }                                        // болото: камыш и лужи
      else if (bm === 2) { kind = 'u'; p = 0.20 * (0.5 + cluster); sz = 0.7; }                     // тундра: кочки
      else if (bm === 6) { kind = 'd'; p = 0.16 * (0.4 + cluster); sz = 1.2; }                     // пустыня: барханы
      else if (bm === 1) { kind = 'i'; p = 0.30; sz = 1.2; }                                       // лёд
      if (!kind || rr > p) continue;
      const hh = (8 + 4 * rs) * (S / 3.75) * sz;
      items.push({ t: kind, x, y, w: hh * (kind === 't' ? 0.38 : kind === 'c' ? 0.34 : kind === 'j' ? 0.5 : kind === 'a' ? 0.7 : kind === 'u' ? 0.9 : kind === 's' ? 1.1 : 1.3), h: kind === 'a' ? hh * 0.7 : kind === 'u' || kind === 'd' || kind === 'i' || kind === 's' ? hh * 0.5 : hh, r: [rs], s: 0 });
    }
    for (const v of map.volcanoes) {
      const w = 38 * (S / 3.75);
      items.push({ t: 'v', active: !!v.active, x: v.x * S, y: v.y * S + w * 0.3, w, h: w * 0.62, r: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], s: 1 });
    }
    items.sort((a, b) => a.y - b.y);
    return items;
  }

  const polyAt = (arr, t) => {
    const f = clamp(t, 0, 1) * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(f)), u = f - i;
    return [arr[i][0] + (arr[i + 1][0] - arr[i][0]) * u, arr[i][1] + (arr[i + 1][1] - arr[i][1]) * u];
  };
  const shadeCol = (th, a) => `rgba(${th.inkRGB[0]},${th.inkRGB[1]},${th.inkRGB[2]},${a})`;

  // штриховка грани между двумя гребнями: штрихи идут вдоль склона и веером расходятся к подножию
  function hatchFacet(ctx, P, Q, n, tMin, r, seed, lw) {
    ctx.lineWidth = lw;
    for (let j = 0; j < n; j++) {
      const s = (j + 0.5 + (r[(seed + j) % 14] - 0.5) * 0.6) / n;
      const t0 = tMin + 0.26 * r[(seed + j * 3 + 1) % 14];
      const t1 = Math.min(0.98, 0.6 + 0.4 * r[(seed + j * 5 + 2) % 14]);
      ctx.beginPath();
      for (let t = t0, first = true; t <= t1 + 1e-6; t += 0.12) {
        const a = polyAt(P, t), b = polyAt(Q, t);
        const px = a[0] + (b[0] - a[0]) * s, py = a[1] + (b[1] - a[1]) * s;
        if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  // Один пик: силуэт с изломами, три-четыре гребня делят склон на грани (свет слева), тень штрихуется вдоль склона,
  // у высоких пиков вершина остаётся светлой (снежная шапка с зубчатой границей)
  function drawPeak(ctx, it, th, k) {
    const { x, y, w, h, r } = it, hw = w / 2, R = (i) => r[((i % 14) + 14) % 14];
    const big = h > 16, tall = h > 24;
    const ax = x + (R(0) - 0.5) * w * 0.22, ay = y - h;
    const ridge = (bx, by, seed, wob) => {
      const pts = [[ax, ay]];
      for (let j = 1; j <= 4; j++) {
        const t = j / 4;
        pts.push([ax + (bx - ax) * Math.pow(t, 1.15) + (R(seed + j) - 0.5) * w * wob * (j < 4 ? 1 : 0.3),
          ay + (by - ay) * t + (R(seed + j + 5) - 0.5) * h * 0.03]);
      }
      return pts;
    };
    const L = ridge(x - hw, y, 1, 0.13);
    const Rr = ridge(x + hw, y + (R(6) - 0.5) * h * 0.05, 7, 0.13);
    const M = ridge(ax + (R(2) - 0.35) * w * 0.14, y + h * 0.04, 3, 0.07);
    const N = big ? ridge(x + hw * (0.35 + 0.25 * R(4)), y + h * 0.03, 5, 0.07) : null;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const sil = new Path2D();
    sil.moveTo(L[4][0], L[4][1]);
    for (let i = 3; i >= 0; i--) sil.lineTo(L[i][0], L[i][1]);
    for (let i = 1; i <= 4; i++) sil.lineTo(Rr[i][0], Rr[i][1]);
    sil.quadraticCurveTo(x, y + h * 0.13, L[4][0], L[4][1]); sil.closePath();
    ctx.fillStyle = rgb(th.paper); ctx.fill(sil);

    const facet = (P, Q, fill) => {
      const p = new Path2D(); p.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < P.length; i++) p.lineTo(P[i][0], P[i][1]);
      for (let i = Q.length - 1; i >= 0; i--) p.lineTo(Q[i][0], Q[i][1]);
      p.closePath(); ctx.fillStyle = fill; ctx.fill(p);
    };
    ctx.save(); ctx.clip(sil);
    if (N) { facet(M, N, shadeCol(th, 0.13)); facet(N, Rr, shadeCol(th, 0.27)); } else facet(M, Rr, shadeCol(th, 0.22));
    ctx.restore();

    const tMin = tall ? 0.38 : 0.25;
    ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.9;
    if (N) { hatchFacet(ctx, N, Rr, Math.max(4, Math.round(w / 5)), tMin, r, 8, 0.8 * k); hatchFacet(ctx, M, N, Math.max(2, Math.round(w / 11)), tMin + 0.05, r, 2, 0.7 * k); }
    else hatchFacet(ctx, M, Rr, Math.max(3, Math.round(w / 6)), tMin, r, 8, 0.8 * k);
    ctx.globalAlpha = 0.7;
    hatchFacet(ctx, L, M, big ? 3 : 1, 0.32, r, 11, 0.7 * k);
    ctx.globalAlpha = 1;

    ctx.lineWidth = 1.35 * k;
    ctx.beginPath(); ctx.moveTo(L[4][0], L[4][1]);
    for (let i = 3; i >= 0; i--) ctx.lineTo(L[i][0], L[i][1]);
    for (let i = 1; i <= 4; i++) ctx.lineTo(Rr[i][0], Rr[i][1]);
    ctx.stroke();
    ctx.lineWidth = 1.0 * k;
    ctx.beginPath(); ctx.moveTo(M[0][0], M[0][1]); for (let i = 1; i <= 3; i++) ctx.lineTo(M[i][0], M[i][1]); ctx.stroke();
    if (N) { ctx.lineWidth = 0.8 * k; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(N[0][0], N[0][1]); for (let i = 1; i <= 3; i++) ctx.lineTo(N[i][0], N[i][1]); ctx.stroke(); ctx.globalAlpha = 1; }
    if (tall) {                                    // граница снега: зубцы поперёк вершины
      const a = polyAt(L, 0.3), b = polyAt(Rr, 0.3);
      ctx.lineWidth = 0.8 * k; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.moveTo(a[0], a[1]);
      for (let i = 1; i <= 6; i++) { const u = i / 6; ctx.lineTo(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + (i % 2 ? 1 : -1) * h * 0.035 * (0.6 + R(i + 9) * 0.8)); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  function drawMountain(ctx, it, th, k) {
    const { x, y, w, h, r } = it;
    if (it.s > 0.3 && r[10] > 0.3) {
      const side = r[9] < 0.5 ? -1 : 1, sc = 0.5 + 0.22 * r[8];
      drawPeak(ctx, { x: x + side * w * 0.38, y: y - h * 0.04, w: w * sc, h: h * sc, r: r.slice().reverse(), s: it.s }, th, k);
    }
    drawPeak(ctx, it, th, k);
  }

  function drawTree(ctx, it, th, k) {
    const { x, y, w, h } = it;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y - h);
    ctx.quadraticCurveTo(x + w * 0.85, y - h * 0.4, x, y - h * 0.1);
    ctx.quadraticCurveTo(x - w * 0.85, y - h * 0.4, x, y - h);
    ctx.fillStyle = rgb(th.paper); ctx.fill();
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1.0 * k; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - h * 0.1); ctx.lineTo(x, y + h * 0.05); ctx.stroke();
    ctx.lineWidth = 0.7 * k; ctx.beginPath();
    for (let j = 0; j < 3; j++) { const yy = y - h * (0.75 - j * 0.2); ctx.moveTo(x + w * 0.08, yy); ctx.lineTo(x + w * (0.5 - j * 0.1), yy + h * 0.1); }
    ctx.stroke();
  }

  function drawConifer(ctx, it, th, k) {
    const { x, y, w, h } = it;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - h * 0.12); ctx.lineTo(x - w, y - h * 0.12); ctx.closePath();
    ctx.fillStyle = rgb(th.paper); ctx.fill(); ctx.strokeStyle = th.ink; ctx.lineWidth = 1.0 * k; ctx.stroke();
    ctx.lineWidth = 0.7 * k; ctx.beginPath(); ctx.moveTo(x, y - h * 0.12); ctx.lineTo(x, y + h * 0.05);
    ctx.moveTo(x, y - h * 0.65); ctx.lineTo(x + w * 0.45, y - h * 0.35); ctx.moveTo(x, y - h * 0.45); ctx.lineTo(x + w * 0.65, y - h * 0.22); ctx.stroke();
  }
  function drawJungle(ctx, it, th, k) {
    const { x, y, w, h } = it;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(x - w, y - h * 0.45); ctx.bezierCurveTo(x - w * 1.1, y - h * 1.0, x - w * 0.2, y - h * 1.1, x, y - h * 0.95);
    ctx.bezierCurveTo(x + w * 0.3, y - h * 1.15, x + w * 1.15, y - h * 0.95, x + w, y - h * 0.45);
    ctx.quadraticCurveTo(x, y - h * 0.3, x - w, y - h * 0.45);
    ctx.fillStyle = rgb(th.paper); ctx.fill(); ctx.strokeStyle = th.ink; ctx.lineWidth = 1.0 * k; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - h * 0.4); ctx.lineTo(x, y + h * 0.05);
    ctx.moveTo(x - w * 0.4, y - h * 0.65); ctx.lineTo(x - w * 0.1, y - h * 0.55); ctx.moveTo(x + w * 0.2, y - h * 0.75); ctx.lineTo(x + w * 0.5, y - h * 0.6); ctx.stroke();
  }
  function drawAcacia(ctx, it, th, k) {
    const { x, y, w, h } = it;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = th.ink; ctx.lineWidth = 1.0 * k;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - w * 0.05, y - h * 0.5, x, y - h * 0.75); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - w, y - h * 0.8); ctx.quadraticCurveTo(x, y - h * 1.25, x + w, y - h * 0.8); ctx.stroke();
  }
  function drawTuft(ctx, it, th, k) {
    const { x, y, w, h } = it;
    ctx.lineCap = 'round'; ctx.strokeStyle = th.ink; ctx.lineWidth = 0.8 * k; ctx.beginPath();
    ctx.moveTo(x - w * 0.5, y); ctx.lineTo(x - w * 0.55, y - h * 0.9); ctx.moveTo(x, y); ctx.lineTo(x, y - h * 1.2); ctx.moveTo(x + w * 0.5, y); ctx.lineTo(x + w * 0.6, y - h * 0.8); ctx.stroke();
  }
  function drawDune(ctx, it, th, k) {
    const { x, y, w, h } = it;
    ctx.lineCap = 'round'; ctx.strokeStyle = th.ink; ctx.lineWidth = 0.8 * k;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.3, y - h * 1.6, x + w * 0.2, y - h * 0.2); ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.9, x + w, y); ctx.stroke();
    ctx.lineWidth = 0.5 * k; ctx.beginPath(); ctx.moveTo(x - w * 0.2, y + h * 0.5); ctx.lineTo(x + w * 0.6, y + h * 0.5); ctx.stroke();
  }
  function drawIce(ctx, it, th, k) {
    const { x, y, w, h } = it;
    ctx.lineCap = 'round'; ctx.strokeStyle = th.ink; ctx.lineWidth = 0.7 * k; ctx.beginPath();
    ctx.moveTo(x - w * 0.6, y); ctx.lineTo(x + w * 0.6, y - h * 0.3); ctx.moveTo(x - w * 0.2, y + h * 0.7); ctx.lineTo(x + w * 0.4, y + h * 0.4);
    ctx.moveTo(x - w * 0.1, y - h * 0.9); ctx.lineTo(x + w * 0.1, y + h * 0.1); ctx.stroke();
  }

  const VEG = { t: drawTree, c: drawConifer, j: drawJungle, a: drawAcacia, u: drawTuft, d: drawDune, i: drawIce, s: drawSwamp };
  function drawSwamp(ctx, it, th, k) {
    const { x, y, w, h } = it;
    ctx.lineCap = 'round'; ctx.strokeStyle = th.ink; ctx.lineWidth = 0.7 * k; ctx.beginPath();
    ctx.moveTo(x - w * 0.9, y + h * 0.3); ctx.lineTo(x + w * 0.3, y + h * 0.3); ctx.moveTo(x - w * 0.4, y + h * 0.8); ctx.lineTo(x + w * 0.9, y + h * 0.8);
    ctx.moveTo(x - w * 0.5, y); ctx.lineTo(x - w * 0.55, y - h * 1.3); ctx.moveTo(x - w * 0.25, y); ctx.lineTo(x - w * 0.2, y - h * 1.6); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.1, y - h * 1.2);
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x - w * 0.2, y - h * 1.65, w * 0.09, h * 0.4, 0, 0, 6.3); ctx.fillStyle = th.ink; ctx.fill();
  }

  function drawHill(ctx, it, th, k) {
    const { x, y, w, h, r } = it, hw = w / 2;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - hw, y);
    ctx.quadraticCurveTo(x - hw * 0.1, y - h * 2.1, x + hw, y);
    ctx.fillStyle = rgb(th.paper); ctx.fill();
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1.2 * k; ctx.stroke();
    ctx.lineWidth = 0.8 * k;
    const n = 2 + Math.floor(r[4] * 2);
    for (let j = 0; j < n; j++) {
      const t = 0.55 + j * 0.13;
      const sx = x + hw * (t - 0.1), sy = y - h * (1.0 - Math.pow(t, 2) * 0.9);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + w * 0.06, y - h * 0.08); ctx.stroke();
    }
  }

  // Вулкан: компактный конус с вогнутыми склонами и кратером. Действующий — с дымом и искрами у кратера, спящий — без.
  function drawVolcano(ctx, it, th, k) {
    const { x, y, w, h } = it, hw = w / 2, cr = w * 0.13, rimY = y - h;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const body = new Path2D();
    body.moveTo(x - hw, y);
    body.quadraticCurveTo(x - hw * 0.4, y - h * 0.12, x - cr, rimY);
    body.ellipse(x, rimY, cr, cr * 0.34, 0, Math.PI, 2 * Math.PI);
    body.quadraticCurveTo(x + hw * 0.4, y - h * 0.12, x + hw, y);
    body.quadraticCurveTo(x, y + h * 0.1, x - hw, y);
    body.closePath();
    ctx.fillStyle = rgb(th.paper); ctx.fill(body);
    ctx.save(); ctx.clip(body);
    ctx.fillStyle = shadeCol(th, 0.2); ctx.fillRect(x + cr * 0.2, rimY - 4, hw + 4, h + 10);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 0.8 * k; ctx.globalAlpha = 0.85;
    for (let j = 0; j < 7; j++) {            // несколько штрихов по тёмному склону
      const u = 0.15 + 0.8 * (j + 0.5) / 7, t0 = 0.3 + 0.15 * ((j * 5) % 3), sx = x + cr * u, sy = rimY + cr * 0.3, ex = x + hw * u, ey = y;
      ctx.beginPath(); ctx.moveTo(sx + (ex - sx) * t0, sy + (ey - sy) * t0); ctx.lineTo(sx + (ex - sx) * 0.95, sy + (ey - sy) * 0.95); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.restore();
    ctx.fillStyle = shadeCol(th, it.active ? 0.55 : 0.3);
    ctx.beginPath(); ctx.ellipse(x, rimY, cr * 0.9, cr * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1.25 * k; ctx.stroke(body);
    ctx.lineWidth = 1 * k; ctx.beginPath(); ctx.ellipse(x, rimY, cr, cr * 0.34, 0, 0, Math.PI * 2); ctx.stroke();
    if (it.active) {                         // значок действующего: искры над кратером и тонкая струйка дыма
      ctx.lineWidth = 1 * k;
      for (const a of [-0.9, 0, 0.9]) {
        const ca = Math.sin(a), co = -Math.cos(a);
        ctx.beginPath(); ctx.moveTo(x + ca * cr * 1.15, rimY + co * cr * 0.55 - cr * 0.1); ctx.lineTo(x + ca * cr * 2.1, rimY + co * cr * 1.5 - cr * 0.1); ctx.stroke();
      }
      ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.moveTo(x + cr * 0.2, rimY - cr * 2);
      ctx.bezierCurveTo(x - cr * 1.2, rimY - h * 0.55, x + cr * 1.6, rimY - h * 0.75, x + cr * 0.3, rimY - h * 1.05); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  Object.assign(R, { placeFeatures, polyAt, shadeCol, hatchFacet, drawPeak, drawMountain, drawTree, drawConifer, drawJungle, drawAcacia, drawTuft, drawDune, drawIce, VEG, drawSwamp, drawHill, drawVolcano });
})(window.FM);
