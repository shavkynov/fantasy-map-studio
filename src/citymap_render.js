// Рисование карты города: слегка наклонённая камера, подписи улиц и районов (FM.renderCity).
(function (FM) {
  'use strict';
  const { CW, CH, CX, CY, U, METERS, SPEC, bil, chaikin, segDist, obbOverlap, mkObb } = FM.CM;
  const { mulberry32, hashString, makeNoise, fbm, clamp } = FM;

  // ---------- рисование (слегка наклонённая камера: стены и крыши выдавлены вверх по экрану) ----------
  const TYPE_NAME = { capital: 'Столица', city: 'Город', town: 'Городок', village: 'Деревня', port: 'Порт', fortress: 'Крепость', mine: 'Рудник', ruin: 'Руины' };
  const LX = -0.55, LY = -0.6;                       // направление на свет (сверху-слева)
  const corners = (b) => [[-b.hw, -b.hh], [b.hw, -b.hh], [b.hw, b.hh], [-b.hw, b.hh]].map(([u, v]) => [b.x + b.c * u - b.s * v, b.y + b.s * u + b.c * v]);

  // ---------- подписи улиц и районов ----------
  const STREET_RU = ['Кузнечная', 'Гончарная', 'Ткацкая', 'Мельничная', 'Сапожная', 'Рыбная', 'Садовая', 'Угольная', 'Каменная', 'Липовая', 'Пекарская', 'Кожевенная', 'Монетная', 'Бондарная', 'Колокольная', 'Винная', 'Овчинная', 'Ключевая'];
  const STREET_EN = ['Smith', 'Potter', 'Weaver', 'Miller', 'Cobbler', 'Fisher', 'Garden', 'Coal', 'Stone', 'Linden', 'Baker', 'Tanner', 'Mint', 'Cooper', 'Bell', 'Vintner', 'Fleece', 'Spring'];
  function drawCityLabels(ctx, plan, ink, paperCol) {
    const ru = FM.uiLang !== 'en', rand = mulberry32(hashString(plan.key + '|labels')), used = new Set(), boxes = [];
    const sName = (kind, i) => { if (kind) return ru ? kind[0] : kind[1]; let t, g = 0; do { t = Math.floor(rand() * STREET_RU.length); } while (used.has(t) && ++g < 30); used.add(t); return ru ? STREET_RU[t] + '\u2002ул.' : STREET_EN[t] + '\u2002St.'; };
    const bl = plan.buildings || [], near = (x, y, f, d) => bl.some(b => f(b) && Math.hypot(b.x - x, b.y - y) < d);
    ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const put = (pts, text, f, spacing, italic, free) => {
      ctx.font = `${italic ? 'italic ' : ''}${f}px Georgia, "Times New Roman", serif`;
      let w0 = [...text].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + spacing * (text.length - 1), len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (!free && w0 > len * 0.92) return false;
      if (pts[pts.length - 1][0] < pts[0][0]) pts = pts.slice().reverse();
      const mid = pts[Math.floor(pts.length / 2)], bx = { x: mid[0] - w0 / 2, y: mid[1] - f, w: w0, h: f * 2 };
      if (boxes.some(q => bx.x < q.x + q.w && bx.x + bx.w > q.x && bx.y < q.y + q.h && bx.y + bx.h > q.y)) return false;
      ctx.fillStyle = ink; ctx.strokeStyle = paperCol; ctx.lineWidth = f * 0.3;
      FM.textOnPath(ctx, pts, text, f, spacing, 1, null); boxes.push(bx); return true;
    };
    // районы (рисуем первыми, чтобы улицы не перекрывали их подписи)
    const cl = (kind) => bl.filter(b => b.kind === kind);
    const district = (text, x, y) => { const f = 16, sp = f * 0.28; ctx.font = `${f}px Georgia, "Times New Roman", serif`; const w = [...text].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + sp * (text.length - 1) + 2; put([[x - w / 2, y], [x + w / 2, y]], text, f, sp, false, true); };
    const cx0 = plan.plaza ? plan.plaza.x : CW / 2, cy0 = plan.plaza ? plan.plaza.y : CH / 2;
    if (plan.keep) district(ru ? 'ЦИТАДЕЛЬ' : 'CITADEL', plan.keep.x, plan.keep.y + plan.keep.r + 16);
    const tp = cl('temple'); if (tp.length) { const x = tp.reduce((a, b) => a + b.x, 0) / tp.length, y = tp.reduce((a, b) => a + b.y, 0) / tp.length; district(ru ? 'ХРАМОВЫЙ КВАРТАЛ' : 'TEMPLE QUARTER', x, y - 26); }
    if (plan.plaza && plan.plaza.r >= 20) district(ru ? 'РЫНОЧНАЯ ПЛОЩАДЬ' : 'MARKET SQUARE', plan.plaza.x, plan.plaza.y - plan.plaza.r - 12);
    const qs = (plan.streets || []).filter(s => s.quay); if (qs.length) { const p = qs[0].pts[Math.floor(qs[0].pts.length / 2)]; district(ru ? 'ГАВАНЬ' : 'HARBOUR', p[0], p[1] + 22); }
    const out = bl.filter(b => Math.hypot(b.x - cx0, b.y - cy0) > plan.R * 0.82 && b.kind === 'house');
    if (out.length > 12) { const x = out.reduce((a, b) => a + b.x, 0) / out.length, y = out.reduce((a, b) => a + b.y, 0) / out.length; if (Math.hypot(x - cx0, y - cy0) > plan.R * 0.5) district(ru ? 'ПОСАД' : 'SUBURB', x, y); }
    const wk = cl('workshop').concat(cl('smelter')); if (wk.length > 5) { const x = wk.reduce((a, b) => a + b.x, 0) / wk.length, y = wk.reduce((a, b) => a + b.y, 0) / wk.length; district(ru ? 'РЕМЕСЛЕННЫЙ КВАРТАЛ' : 'CRAFTSMEN', x, y); }
    // улицы: самые длинные
    const len = (s) => { let l = 0; for (let i = 1; i < s.pts.length; i++) l += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]); return l; };
    const ss = (plan.streets || []).filter(s => !s.outer && s.pts.length >= 3).map(s => ({ s, l: len(s) })).filter(o => o.l > 85).sort((a, b) => b.l - a.l).slice(0, 9);
    ss.forEach(({ s, l }, i) => {
      const m = s.pts[Math.floor(s.pts.length / 2)]; let nm;
      if (s.quay) nm = sName(ru ? ['Набережная', 'Quay'] : ['Набережная', 'Quay']);
      else if (plan.plaza && Math.hypot(m[0] - plan.plaza.x, m[1] - plan.plaza.y) < plan.plaza.r + 30) nm = sName(ru ? ['Рыночная ул.', 'Market St.'] : ['Рыночная ул.', 'Market St.']);
      else if (plan.keep && Math.hypot(m[0] - plan.keep.x, m[1] - plan.keep.y) < plan.keep.r + 40) nm = sName(['Замковая ул.', 'Castle St.']);
      else if (near(m[0], m[1], b => b.kind === 'temple', 40)) nm = sName(['Храмовая ул.', 'Temple St.']);
      else if (s.main && i === 0) nm = sName(['Главная ул.', 'High St.']);
      else nm = sName(null);
      if (used.has(nm)) nm = sName(null); used.add(nm);
      put(s.pts, nm.replace(' ', '\u2002'), 14, 1.4, true);
    });
    ctx.restore();
  }

  // ---------- цветной стиль: палитра по биому, цветная земля ----------
  const BIOME_GROUND = { 1: [222, 228, 230], 2: [186, 188, 150], 3: [148, 164, 108], 4: [138, 164, 92], 5: [188, 184, 112], 6: [222, 198, 142], 7: [196, 184, 104], 8: [108, 148, 78], 9: [128, 148, 98], 10: [170, 160, 140] };
  const rgbS = (c, k) => `rgb(${Math.round(c[0] * (k || 1))},${Math.round(c[1] * (k || 1))},${Math.round(c[2] * (k || 1))})`;
  function cityPalette(biome) {
    const g = BIOME_GROUND[biome] || BIOME_GROUND[5], dry = biome === 6 || biome === 7 || biome === 5;
    const ice = biome === 1, rock = biome === 10;
    return {
      tintLo: ice ? [206, 220, 232] : dry ? [150, 150, 88] : [100, 148, 70], tintHi: ice ? [244, 247, 250] : rock ? [150, 140, 126] : dry ? [176, 146, 98] : [150, 142, 98], tintA: ice ? 110 : 105,
      ground: g, ink: '#3a2c20', inkRGB: [58, 44, 32], shade: 'rgba(52,36,56,0.27)',
      wall: '#efe4c6', stone: '#cdc2aa', stoneTop: '#e3dac4', cone: '#9a4a38', wood: '#b49a6c', straw: '#dcc36a',
      roofs: [[178, 78, 56], [196, 98, 64], [164, 64, 48], [150, 88, 66], [188, 110, 74]], civic: [[104, 120, 138], [122, 106, 130], [96, 128, 120]],
      street: dry ? '#e9d9ae' : '#e4d6ac', dirt: dry ? '#d6c08c' : '#cdbb8c', plaza: '#ecdcb2', sand: 'rgba(232,214,160,0.95)',
      water: [122, 176, 202], leaf: [[88, 130, 62], [104, 142, 68], [76, 118, 64], [118, 150, 72]],
      field: { plow: 'rgb(158,118,74)', wheat: 'rgb(218,192,92)', vineyard: 'rgb(132,148,70)', orchard: 'rgb(138,168,84)', pasture: 'rgb(150,178,92)' }
    };
  }
  const groundCache = new Map();
  function cityGround(PAL, plan, sc) {
    const k = plan.key + '|' + plan.biome + '|' + sc; if (groundCache.has(k)) return groundCache.get(k);
    if (groundCache.size > 8) groundCache.clear();
    const noise = makeNoise(mulberry32(hashString(plan.key + '|ground'))), w = CW / 2.5, h = CH / 2.5, lo = FM.makeCanvas(w, h), lc = lo.getContext('2d'), img = lc.createImageData(w, h), g = PAL.ground;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = fbm(noise, x * 0.04, y * 0.04, 3) * 0.5 + fbm(noise, x * 0.2 + 50, y * 0.2, 2) * 0.16, m = fbm(noise, x * 0.018 + 99, y * 0.018, 2), v = 1 + n * 0.2, o = (y * w + x) * 4;
      img.data[o] = clamp(g[0] * v + m * 22, 0, 255); img.data[o + 1] = clamp(g[1] * v - m * 6, 0, 255); img.data[o + 2] = clamp(g[2] * v - m * 16, 0, 255); img.data[o + 3] = 255;
    }
    lc.putImageData(img, 0, 0);
    const cv = FM.makeCanvas(Math.round(CW * sc), Math.round(CH * sc)), c = cv.getContext('2d'); c.imageSmoothingEnabled = true; c.drawImage(lo, 0, 0, cv.width, cv.height);
    const r = mulberry32(hashString(plan.key + '|tufts')); c.setTransform(sc, 0, 0, sc, 0, 0);
    for (let i = 0; i < 900; i++) {                                  // мазки кистью: короткие штрихи светлее/темнее земли, направление по полю
      const x = r() * CW, y = r() * CH, a2 = fbm(noise, x * 0.006 + 7, y * 0.006, 2) * 6.28, L = 6 + r() * 12, lt = r() < 0.5;
      c.strokeStyle = lt ? 'rgba(255,248,205,0.09)' : 'rgba(40,64,30,0.07)'; c.lineWidth = 1.2 + r() * 2.2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a2) * L, y + Math.sin(a2) * L); c.stroke();
    }
    for (let i = 0; i < 1400; i++) { const x = r() * CW, y = r() * CH; c.fillStyle = r() < 0.5 ? 'rgba(40,70,30,0.10)' : 'rgba(255,250,200,0.10)'; c.fillRect(x, y, 1.6, 1.1); }
    groundCache.set(k, cv); return cv;
  }

  FM.renderCity = function (plan, opts) {
    opts = opts || {};
    const th = (FM.THEMES[opts.theme] && !FM.THEMES[opts.theme].game ? FM.THEMES[opts.theme] : FM.THEMES.sepia), sc = opts.scale || 1;
    const isCol = !!(FM.THEMES[opts.theme] && FM.THEMES[opts.theme].game), PAL = isCol ? cityPalette(plan.biome) : null;
    const cv = FM.makeCanvas(CW * sc, CH * sc), ctx = cv.getContext('2d');
    const T = opts.tilt || 0, Z = opts.zoom || 1, VX = opts.x || 0, VY = opts.y || 0;   // T: 0 — вид строго сверху, 1 — наклонная камера
    {                                                                // подложка (земля/бумага) едет вместе с камерой; при сильном зуме берётся вдвое подробнее
      const gs = sc * (Z > 1.5 ? 2 : 1), base = PAL ? cityGround(PAL, plan, gs) : FM.getPaper(CW * gs, CH * gs, th, 'city|' + plan.key);
      ctx.drawImage(base, VX * gs, VY * gs, base.width / Z, base.height / Z, 0, 0, cv.width, cv.height);
    }
    ctx.setTransform(sc * Z, 0, 0, sc * Z, -VX * sc * Z, -VY * sc * Z);
    const iRGB = PAL ? PAL.inkRGB : th.inkRGB, ink = PAL ? PAL.ink : th.ink, inkA = (a) => `rgba(${iRGB[0]},${iRGB[1]},${iRGB[2]},${a})`, pap = PAL ? PAL.wall : `rgb(${th.paper[0] + 8},${th.paper[1] + 8},${th.paper[2] + 6})`;
    const waterRGB = PAL ? PAL.water : th.waterNear, stone = PAL ? PAL.stone : pap, stoneTop = PAL ? PAL.stoneTop : pap, coneCol = PAL ? PAL.cone : pap, leafFill = PAL ? PAL.wood : pap;
    const hash01 = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
    const roofOf = (b) => { if (!PAL) return pap; const civ = b.kind === 'temple' || b.kind === 'manor', L = civ ? PAL.civic : PAL.roofs, c = L[Math.floor(hash01(b.x, b.y) * L.length) % L.length], k = 0.93 + 0.14 * hash01(b.y, b.x); return rgbS(c, k); };
    const crownOf = (x, y) => { const L = PAL.leaf, c = L[Math.floor(hash01(x, y) * L.length) % L.length]; return rgbS(c, 0.92 + 0.16 * hash01(y, x)); };
    const rr = mulberry32(hashString(plan.key + '|draw|' + plan.variant));
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const path = (pts, close) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (close) ctx.closePath(); };
    const path2 = (c, pts) => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke(); };
    const poly = (pts, fill, line, lw) => { path(pts, true); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (line) { ctx.strokeStyle = line; ctx.lineWidth = lw || 1; ctx.stroke(); } };
    const shade = PAL ? PAL.shade : th.shade;
    const lit = (nx, ny) => nx * LX + ny * LY > 0;

    // ----- земля: поля (участки четырёхугольниками, борозды по радиусу или вдоль кольца) -----
    const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (const fd of plan.fields) {
      let [A, B, C, D] = fd.pts; const c = [fd.cx, fd.cy]; [A, B, C, D] = [A, B, C, D].map(p => lerp(p, c, 0.025));
      const lAB = Math.hypot(B[0] - A[0], B[1] - A[1]), lAD = Math.hypot(D[0] - A[0], D[1] - A[1]), rad = fd.dir === 'rad';
      path([A, B, C, D], true);
      if (PAL) { ctx.fillStyle = PAL.field[fd.kind] || PAL.field.plow; ctx.fill(); ctx.globalAlpha = 0.5; } else { ctx.fillStyle = inkA(fd.kind === 'pasture' ? 0.05 : fd.kind === 'orchard' ? 0.07 : 0.09); ctx.fill(); }
      ctx.strokeStyle = inkA(0.7); ctx.lineWidth = 1; ctx.stroke();
      const furrows = (sp) => { const n = Math.floor((rad ? lAB : lAD) / sp); ctx.beginPath(); for (let i = 1; i < n; i++) { const t = i / n, p0 = rad ? lerp(A, B, t) : lerp(A, D, t), p1 = rad ? lerp(D, C, t) : lerp(B, C, t); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); } ctx.stroke(); };
      if (fd.kind === 'plow') { ctx.strokeStyle = inkA(0.65); ctx.lineWidth = 0.8; furrows(5); }
      else if (fd.kind === 'wheat') { ctx.strokeStyle = inkA(0.5); ctx.lineWidth = 0.8; furrows(8); ctx.setLineDash([1, 3]); ctx.lineWidth = 2.2; ctx.strokeStyle = inkA(0.6); furrows(4); ctx.setLineDash([]); }
      else if (fd.kind === 'vineyard') { ctx.setLineDash([1.5, 3.5]); ctx.lineWidth = 2.6; ctx.strokeStyle = ink; furrows(7); ctx.setLineDash([]); }
      else if (fd.kind === 'orchard') {
        ctx.globalAlpha = 1; const nu = Math.max(2, Math.floor(lAB / 14)), nv = Math.max(2, Math.floor(lAD / 14));
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const p = lerp(lerp(A, B, (i + 0.5) / nu), lerp(D, C, (i + 0.5) / nu), (j + 0.5) / nv); ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 6.28); ctx.fillStyle = PAL ? crownOf(p[0], p[1]) : pap; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 0.9; ctx.stroke(); ctx.beginPath(); ctx.arc(p[0] + 1, p[1] + 1, 1.4, 0, 6.28); ctx.stroke(); }
      } else {
        ctx.globalAlpha = 1; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.4; ctx.strokeStyle = ink; path([lerp(A, c, 0.08), lerp(B, c, 0.08), lerp(C, c, 0.08), lerp(D, c, 0.08)], true); ctx.stroke(); ctx.setLineDash([]);
        const ns = Math.max(3, Math.round(lAB * lAD / 900)); for (let i = 0; i < ns; i++) { const p = lerp(lerp(A, B, 0.15 + rr() * 0.7), lerp(D, C, 0.15 + rr() * 0.7), 0.15 + rr() * 0.7); ctx.beginPath(); ctx.ellipse(p[0], p[1], 3.4, 2.4, 0, 0, 6.28); ctx.fillStyle = pap; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 0.9; ctx.stroke(); ctx.beginPath(); ctx.arc(p[0] + 3.6, p[1] - 0.6, 1.1, 0, 6.28); ctx.fillStyle = ink; ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    // ----- земля: декор окрестностей -----
    for (const d of plan.deco) {
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a || 0); ctx.strokeStyle = ink; ctx.lineWidth = 1;
      if (d.k === 'fence' || d.k === 'graveyard') {
        ctx.setLineDash([3, 4]); ctx.lineWidth = 1.1; ctx.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h); ctx.setLineDash([]); ctx.fillStyle = inkA(0.05); ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      } else if (d.k === 'garden') {
        ctx.fillStyle = PAL ? 'rgba(110,150,60,0.6)' : inkA(0.07); ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h); ctx.lineWidth = 2; ctx.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h);
        ctx.lineWidth = 0.8; ctx.beginPath(); for (let x = -d.w / 2 + 8; x < d.w / 2 - 6; x += 8) { ctx.moveTo(x, d.h / 2 - 22); ctx.lineTo(x, d.h / 2 - 3); } ctx.stroke();
      } else if (d.k === 'parade') {
        ctx.fillStyle = PAL ? 'rgba(214,190,130,0.8)' : inkA(0.13); ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h); ctx.lineWidth = 1.2; ctx.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h);
        ctx.lineWidth = 0.8; ctx.beginPath(); for (let x = -d.w / 2 + 6; x < d.w / 2; x += 6) { ctx.moveTo(x, -d.h / 2 + 4); ctx.lineTo(x - 3, d.h / 2 - 4); } ctx.stroke();
      } else if (d.k === 'quarry') {
        for (let i = 0; i < 4; i++) { const r = 26 - i * 6; ctx.beginPath(); for (let j = 0; j <= 12; j++) { const a = j / 12 * 6.28, q = r * (0.85 + 0.2 * Math.sin(j * 2.3 + i)); const x = Math.cos(a) * q * 1.2, y = Math.sin(a) * q * 0.8; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.fillStyle = inkA(0.1 + i * 0.07); ctx.fill(); ctx.lineWidth = 1.1; ctx.stroke(); }
      } else if (d.k === 'adit') {                        // штольня: насыпь, вход с крепью, рельсы
        ctx.beginPath(); ctx.ellipse(0, 0, 24, 13, 0, Math.PI, 2 * Math.PI); ctx.lineTo(24, 0); ctx.closePath(); ctx.fillStyle = pap; ctx.fill(); ctx.lineWidth = 1.4; ctx.stroke();
        ctx.fillStyle = shade; ctx.beginPath(); ctx.ellipse(0, 0, 24, 13, 0, Math.PI * 1.55, 2 * Math.PI); ctx.lineTo(24, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-6, -7); ctx.quadraticCurveTo(0, -12, 6, -7); ctx.lineTo(6, 0); ctx.closePath(); ctx.fill();
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3, 2); ctx.lineTo(-9, 26); ctx.moveTo(3, 2); ctx.lineTo(9, 26); ctx.stroke();
        for (let y = 6; y < 26; y += 5) { ctx.beginPath(); ctx.moveTo(-6 - y * 0.05, y); ctx.lineTo(6 + y * 0.05, y); ctx.stroke(); }
      } else if (d.k === 'spoil') {
        ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * 0.55, 0, Math.PI, 2 * Math.PI); ctx.lineTo(d.r, 0); ctx.closePath(); ctx.fillStyle = pap; ctx.fill(); ctx.stroke();
        ctx.fillStyle = shade; ctx.fill(); ctx.lineWidth = 0.7; ctx.beginPath(); for (let i = 1; i < 4; i++) { ctx.moveTo(d.r * 0.2 * i, -2); ctx.lineTo(d.r * 0.25 * i, -d.r * 0.4); } ctx.stroke();
      } else if (d.k === 'net') {
        ctx.lineWidth = 0.8; ctx.globalAlpha = 0.8; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(0, i * 5, 12, -1, 1); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(-6, 14); ctx.stroke(); ctx.globalAlpha = 1;
      } else if (d.k === 'rubble') {
        ctx.lineWidth = 2.2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(-d.w / 2, 0); ctx.lineTo(d.w / 2, 0); ctx.stroke(); ctx.setLineDash([]);
      } else if (d.k === 'wheel') {
        ctx.fillStyle = pap; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.ellipse(0, 0, 3, 8, 0, 0, 6.28); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    // ----- земля: рельеф -----
    for (const h of plan.hills) {                      // холм/скальный выход: неровное пятно с горизонталями и штрихами склона (вид сверху, без конусов)
      const hs = Math.sin(h.x * 12.9898 + h.y * 78.233) * 43758.5453, hr = (i) => { const v = Math.sin(hs + i * 91.7) * 43758.5453; return v - Math.floor(v); };
      const blob = (k, sx) => { const n = 14, pts = []; for (let i = 0; i < n; i++) { const t = i / n * 6.283, rr = h.r * k * (0.82 + 0.3 * hr(i)) * (h.peak ? 1 : 1.25); pts.push([Math.cos(t) * rr * sx, Math.sin(t) * rr * sx * 0.78]); } return chaikin(pts, 2, true); };
      ctx.save(); ctx.translate(h.x, h.y); ctx.strokeStyle = ink; ctx.lineJoin = 'round';
      const o = blob(1, 1), m = blob(0.62, 1), c = blob(0.28, 1);
      path(o, true); ctx.fillStyle = PAL ? (h.peak ? 'rgba(130,108,80,0.3)' : 'rgba(130,112,84,0.16)') : inkA(h.peak ? 0.1 : 0.05); ctx.fill(); ctx.lineWidth = h.peak ? 1.5 : 1.1; ctx.stroke();
      path(m, true); ctx.lineWidth = 0.9; ctx.stroke();
      if (h.peak) { path(c, true); ctx.lineWidth = 0.8; ctx.stroke(); }
      ctx.lineWidth = 0.7; ctx.beginPath();            // штрихи по склону, направленные от вершины, на юго-восточной стороне
      for (let i = 0; i < o.length; i++) { const q = o[i]; if (q[0] * 0.5 + q[1] * 0.85 < 0) continue; if (i % 2) continue; const k = h.peak ? 0.72 : 0.78; ctx.moveTo(q[0] * k, q[1] * k); ctx.lineTo(q[0] * 0.97, q[1] * 0.97); }
      ctx.stroke(); ctx.restore();
    }
    // ----- рельеф: отмывка и горизонтали по высотам мира; контраст подстраивается под размах высот именно этого города -----
    {
      const { f, hf, GW, GH, GS } = plan.field, N0 = GW * GH;
      const hs = Float32Array.from(hf);                                      // слегка сглаженные высоты: горизонтали без дрожи
      for (let it = 0; it < (PAL ? 14 : 7); it++) { const t = Float32Array.from(hs); for (let j2 = 1; j2 < GH - 1; j2++) for (let i2 = 1; i2 < GW - 1; i2++) { const k0 = j2 * GW + i2; hs[k0] = (t[k0] * 4 + t[k0 - 1] + t[k0 + 1] + t[k0 - GW] + t[k0 + GW]) / 8; } }
      let lo = Infinity, hi = -Infinity; for (let k0 = 0; k0 < N0; k0++) if (f[k0] > 0.01) { if (hs[k0] < lo) lo = hs[k0]; if (hs[k0] > hi) hi = hs[k0]; }
      const range = hi - lo;
      plan.relief = { lo, hi, range };
      if (range > 0.012) {
        const sh = new Float32Array(N0), mags = [];
        for (let j2 = 1; j2 < GH - 1; j2++) for (let i2 = 1; i2 < GW - 1; i2++) {
          const dx = (hs[j2 * GW + i2 + 1] - hs[j2 * GW + i2 - 1]) / (2 * GS), dy = (hs[(j2 + 1) * GW + i2] - hs[(j2 - 1) * GW + i2]) / (2 * GS);
          const v = 0.5 * dx + 0.6 * dy; sh[j2 * GW + i2] = v; mags.push(Math.abs(v));
        }
        mags.sort((a, b) => a - b); const p90 = mags[Math.floor(mags.length * 0.9)] || 1e-6;
        const amp = clamp(range / 0.12, 0.35, 1) / Math.max(p90, 1e-6) * 0.7;      // ровное место — еле заметно, холмистое — отчётливо
        if (PAL) {                                                           // цвет по высоте: низины зеленее, возвышенности охристые и каменистые
          const tc = FM.makeCanvas(GW, GH), tcx = tc.getContext('2d'), ti = tcx.createImageData(GW, GH);
          for (let k0 = 0; k0 < N0; k0++) { const t = clamp((hs[k0] - lo) / range, 0, 1), st = clamp(Math.abs(sh[k0]) * amp * 0.6, 0, 1), o = k0 * 4;
            const tl = PAL.tintLo, th2 = PAL.tintHi, d = 1 - 0.14 * st; for (let q = 0; q < 3; q++) ti.data[o + q] = (tl[q] + (th2[q] - tl[q]) * t) * d; ti.data[o + 3] = f[k0] > 0 ? PAL.tintA * (0.4 + 0.6 * t) : 0; }
          tcx.putImageData(ti, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(tc, 0, 0, GW, GH, -GS / 2, -GS / 2, GW * GS, GH * GS);
        }
        const mk = FM.makeCanvas(GW, GH), mc = mk.getContext('2d'), img = mc.createImageData(GW, GH);
        for (let k0 = 0; k0 < N0; k0++) { const v = clamp(sh[k0] * amp, -1, 1); img.data[k0 * 4] = v > 0 ? 255 : iRGB[0]; img.data[k0 * 4 + 1] = v > 0 ? 255 : iRGB[1]; img.data[k0 * 4 + 2] = v > 0 ? 245 : iRGB[2]; img.data[k0 * 4 + 3] = f[k0] > 0 ? Math.abs(v) * (v > 0 ? 80 : 100) : 0; }
        mc.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(mk, 0, 0, GW, GH, -GS / 2, -GS / 2, GW * GS, GH * GS);
        // горизонтали: шаг по типичному уклону (линии ~55 px друг от друга), каждая пятая — основная
        const med = mags[Math.floor(mags.length * 0.6)] || 1e-6, step = Math.max(range / 36, clamp(med * 58, 0.0025, range / 4)), n = Math.min(40, Math.floor(range / step));
        ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (let k0 = 1; k0 <= n; k0++) {
          const lv = lo + k0 * step, main = k0 % 5 === 0;
          ctx.strokeStyle = inkA(main ? 0.55 : 0.32); ctx.lineWidth = main ? 1.3 : 0.8; ctx.setLineDash(main ? [] : [7, 4]);
          const shifted = new Float32Array(N0); for (let q = 0; q < N0; q++) shifted[q] = hs[q] - lv;
          for (const l of FM.contours(shifted, GW, GH, 0)) {
            const q = chaikin(l.map(p => [p[0] * GS, p[1] * GS]), 2, false); if (q.length < 8) continue;
            ctx.beginPath(); q.forEach((p, ii) => ii ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
          }
        }
        ctx.setLineDash([]); ctx.restore();
      }
    }
    // ----- парки: газон, живая изгородь по краю, дорожки по диагоналям, пруд (деревья рисуются вместе с остальными) -----
    for (const pk of plan.parks || []) {
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pk.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
      ctx.fillStyle = PAL ? 'rgba(98,148,62,0.8)' : inkA(0.16); ctx.fill(); ctx.strokeStyle = PAL ? 'rgba(48,86,36,0.8)' : inkA(0.7); ctx.lineWidth = 1.6; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.clip();
      ctx.fillStyle = PAL ? 'rgba(40,84,34,0.35)' : inkA(0.35); for (let gy = pk.y - 120; gy < pk.y + 120; gy += 7) for (let gx = pk.x - 120; gx < pk.x + 120; gx += 7) { const jx = gx + ((gy * 7.3) % 5), jy = gy + ((gx * 3.1) % 4); ctx.fillRect(jx, jy, 1.1, 1.1); }
      const R0 = Math.sqrt(pk.A);
      for (const sgn of [1, -1]) {
        ctx.beginPath(); ctx.moveTo(pk.x - R0, pk.y - sgn * R0); ctx.lineTo(pk.x + R0, pk.y + sgn * R0);
        ctx.strokeStyle = inkA(0.55); ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = PAL ? PAL.street : pap; ctx.lineWidth = 4.2; ctx.stroke();
      }
      if (pk.pr) {
        ctx.beginPath(); ctx.ellipse(pk.x, pk.y, pk.pr, pk.pr / 1.4, 0, 0, 6.2832);
        ctx.fillStyle = pap; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = `rgb(${waterRGB[0]},${waterRGB[1]},${waterRGB[2]})`; ctx.fill(); ctx.lineWidth = 1.2; ctx.stroke();
        ctx.strokeStyle = inkA(0.4); ctx.lineWidth = 0.7; ctx.beginPath(); for (let yy = -pk.pr / 1.4 + 4; yy < pk.pr / 1.4 - 2; yy += 4) { const hw = pk.pr * Math.sqrt(Math.max(0, 1 - (yy * 1.4 / pk.pr) ** 2)) - 3; ctx.moveTo(pk.x - hw, pk.y + yy); ctx.lineTo(pk.x + hw, pk.y + yy); } ctx.stroke();
      }
      ctx.restore();
    }
    // ----- улицы, площадь, мосты -----
    {                                                  // улицы: кромки и тон собираются слоями, поэтому пересечения сливаются без наложения
      const T1 = ctx.getTransform(), L = () => { const l = FM.makeCanvas(cv.width, cv.height), x = l.getContext('2d'); x.setTransform(T1); x.lineJoin = 'round'; x.lineCap = 'round'; return [l, x]; };
      const [kl, kx] = L(), [tl, tx] = L();
      for (const s of plan.streets) { kx.strokeStyle = inkA(s.outer ? 0.6 : s.lane ? 0.55 : 0.8); kx.lineWidth = s.w + 2; if (s.outer) kx.setLineDash([9, 5]); path2(kx, s.pts); kx.setLineDash([]); }
      kx.globalCompositeOperation = 'destination-out';
      for (const s of plan.streets) { kx.lineWidth = s.w; kx.strokeStyle = '#000'; path2(kx, s.pts); }
      for (const s of plan.streets) { tx.strokeStyle = PAL ? (s.outer || s.lane ? PAL.dirt : PAL.street) : ink; tx.lineWidth = s.w; path2(tx, s.pts); }
      const [xl, xx] = L(); xx.lineCap = 'butt';             // текстура мостовой: ряды кладки поперёк улицы; грунтовые дороги и переулки — россыпь камешков
      let sd = 12345; const rr = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
      for (const s of plan.streets) {
        const P = s.pts, dirt = s.outer || s.lane; let carry = 0, k = 0; xx.strokeStyle = ink;
        for (let i = 0; i < P.length - 1; i++) {
          const a = P[i], b = P[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-6) continue;
          const tx2 = (b[0] - a[0]) / l, ty2 = (b[1] - a[1]) / l, nx2 = -ty2, ny2 = tx2;
          for (let t = carry; t < l; t += dirt ? 5 : 3.6, carry = t - l + (dirt ? 5 : 3.6)) {
            const x = a[0] + tx2 * t, y = a[1] + ty2 * t;
            if (dirt) { for (let m = 0; m < 2; m++) { const o = (rr() - 0.5) * (s.w - 1.5); xx.fillStyle = ink; xx.beginPath(); xx.arc(x + nx2 * o, y + ny2 * o, 0.45 + rr() * 0.4, 0, 6.28); xx.fill(); } continue; }
            const half = s.w * 0.5 - 1.1, st = (k++ % 2) ? 0.5 : 0, n = Math.max(2, Math.round(s.w / 3.4));   // «кирпичная» кладка: ряды камней со сдвигом
            xx.lineWidth = 0.55; xx.beginPath(); xx.moveTo(x + nx2 * -half, y + ny2 * -half); xx.lineTo(x + nx2 * half, y + ny2 * half); xx.stroke();
            xx.lineWidth = 0.45; xx.beginPath(); for (let m = 0; m < n; m++) { const o = -half + (m + st) * (2 * half / n) + 0.0; if (o > half || o < -half) continue; xx.moveTo(x + nx2 * o, y + ny2 * o); xx.lineTo(x + nx2 * o + tx2 * 3.6, y + ny2 * o + ty2 * 3.6); } xx.stroke();
          }
        }
      }
      const polyF = (c, pts) => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); };
      kx.globalCompositeOperation = 'source-over';        // площади — тот же слой: кромка площади прерывается входящими улицами
      for (const pz of plan.plazas) { kx.strokeStyle = inkA(0.8); kx.lineWidth = 2; polyF(kx, pz.pts); kx.stroke(); }
      kx.globalCompositeOperation = 'destination-out';
      for (const s of plan.streets) { kx.lineWidth = s.w; kx.strokeStyle = '#000'; path2(kx, s.pts); }
      for (const pz of plan.plazas) { kx.fillStyle = '#000'; polyF(kx, pz.pts); kx.fill(); tx.fillStyle = PAL ? PAL.plaza : ink; polyF(tx, pz.pts); tx.fill(); }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = PAL ? 1 : 0.2; ctx.drawImage(tl, 0, 0); ctx.globalAlpha = PAL ? 0.2 : 0.5; ctx.drawImage(xl, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(kl, 0, 0); ctx.restore();
    }
    if (plan.buildings.length) {                       // кварталы: общая заливка под застройкой (одним контуром, без наложения)
      ctx.beginPath();
      for (const b of plan.buildings) { if (b.kind === 'temple') continue; const hw = b.hw + 1.8, hh = b.hh + 1.8; ctx.moveTo(b.x + b.c * hw - b.s * hh, b.y + b.s * hw + b.c * hh); ctx.lineTo(b.x - b.c * hw - b.s * hh, b.y - b.s * hw + b.c * hh); ctx.lineTo(b.x - b.c * hw + b.s * hh, b.y - b.s * hw - b.c * hh); ctx.lineTo(b.x + b.c * hw + b.s * hh, b.y + b.s * hw - b.c * hh); ctx.closePath(); }
      ctx.fillStyle = PAL ? 'rgba(176,146,98,0.42)' : inkA(0.15); ctx.fill(); ctx.strokeStyle = inkA(PAL ? 0.28 : 0.35); ctx.lineWidth = 0.8; ctx.stroke();
    }
    // ----- вода: водоём, русла и береговая линия собираются слоями, чтобы реки вливались в водоёмы без швов -----
    const { f, GW, GH, GS } = plan.field;
    let seaCv = null, coast = [];
    {
      const mk = FM.makeCanvas(GW, GH), mc = mk.getContext('2d'), img = mc.createImageData(GW, GH);
      let any = false;
      for (let i = 0; i < GW * GH; i++) { const a = clamp(0.5 - f[i] * 38, 0, 1); if (a > 0) any = true; img.data[i * 4 + 3] = a * 255; }
      mc.putImageData(img, 0, 0);
      if (any) {
        const wc = FM.makeCanvas(CW, CH), w = wc.getContext('2d');
        w.fillStyle = `rgb(${waterRGB[0]},${waterRGB[1]},${waterRGB[2]})`; w.fillRect(0, 0, CW, CH);
        w.strokeStyle = PAL ? 'rgba(255,255,255,0.12)' : inkA(0.35); w.lineWidth = 0.9; w.beginPath(); for (let y = 4; y < CH; y += 7) { w.moveTo(0, y); w.lineTo(CW, y); } w.stroke();
        w.globalCompositeOperation = 'destination-in'; w.imageSmoothingEnabled = true; w.drawImage(mk, 0, 0, GW, GH, -GS / 2, -GS / 2, GW * GS, GH * GS);
        if (PAL) {                                                  // глубина: светлое мелководье у берега → насыщенная синева вдали
          const dk = FM.makeCanvas(GW, GH), dx2 = dk.getContext('2d'), di = dx2.createImageData(GW, GH), sh = [176, 220, 224], dp = [waterRGB[0] * 0.78, waterRGB[1] * 0.84, waterRGB[2] * 0.95];
          for (let i = 0; i < GW * GH; i++) { const t = Math.pow(clamp(-f[i] / 0.075, 0, 1), 0.65); for (let q = 0; q < 3; q++) di.data[i * 4 + q] = sh[q] + (dp[q] - sh[q]) * t; di.data[i * 4 + 3] = 255; }
          dx2.putImageData(di, 0, 0); w.globalCompositeOperation = 'source-atop'; w.drawImage(dk, 0, 0, GW, GH, -GS / 2, -GS / 2, GW * GS, GH * GS);
        }
        seaCv = wc; coast = FM.contours(f, GW, GH, 0).map(l => chaikin(l.map(p => [p[0] * GS, p[1] * GS]), 2, false));
      }
    }
    {
      const waterCol = `rgb(${waterRGB[0]},${waterRGB[1]},${waterRGB[2]})`, T0 = ctx.getTransform();
      const segs = (c, extra, col) => { c.strokeStyle = col; c.lineCap = 'round'; for (const r of plan.rivers) for (let i = 0; i < r.pts.length - 1; i++) { c.lineWidth = (r.ws[i] + r.ws[i + 1]) / 2 + extra; c.beginPath(); c.moveTo(r.pts[i][0], r.pts[i][1]); c.lineTo(r.pts[i + 1][0], r.pts[i + 1][1]); c.stroke(); } };
      const offset = (r, side, k) => r.pts.map((p, i) => { const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, d = Math.max(0.5, r.ws[i] / 2 - k); return [p[0] - (b[1] - a[1]) / l * side * d, p[1] + (b[0] - a[0]) / l * side * d]; });
      segs(ctx, 0, waterCol);                                       // 1. вода русел
      if (PAL && coast.length) { ctx.strokeStyle = PAL.sand; ctx.lineWidth = 15; for (const l of coast) { ctx.beginPath(); l.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); } }   // песчаный пляж под водоёмом
      if (seaCv) ctx.drawImage(seaCv, 0, 0);                        // 2. водоём поверх: русла вливаются в него
      const mkLayer = () => { const l = FM.makeCanvas(cv.width, cv.height), x = l.getContext('2d'); x.setTransform(T0); x.lineJoin = 'round'; x.lineCap = 'round'; return [l, x]; };
      const [lc, lx] = mkLayer(), [cl, cx2] = mkLayer();
      segs(lx, 2.6, ink);                                           // 3. берега русел: контур, затем вырезаем воду
      lx.globalCompositeOperation = 'destination-out'; segs(lx, 0, '#000'); lx.globalCompositeOperation = 'source-over';
      for (const r of plan.rivers) for (const side of [-1, 1]) {    // штриховка у берегов, обозначающая течение
        const p1 = offset(r, side, 2.6), p2 = offset(r, side, 6);
        lx.strokeStyle = inkA(0.1); lx.lineWidth = 3; lx.beginPath(); p1.forEach((p, i) => i ? lx.lineTo(p[0], p[1]) : lx.moveTo(p[0], p[1])); lx.stroke();
        lx.strokeStyle = inkA(0.55); lx.lineWidth = 0.8; lx.setLineDash([13, 9]); lx.lineDashOffset = side > 0 ? 0 : 11; lx.beginPath(); p1.forEach((p, i) => i ? lx.lineTo(p[0], p[1]) : lx.moveTo(p[0], p[1])); lx.stroke();
        if (Math.max(...r.ws) > 12) { lx.strokeStyle = inkA(0.35); lx.lineWidth = 0.7; lx.setLineDash([5, 15]); lx.lineDashOffset = side > 0 ? 3 : 10; lx.beginPath(); p2.forEach((p, i) => i ? lx.lineTo(p[0], p[1]) : lx.moveTo(p[0], p[1])); lx.stroke(); }
        lx.setLineDash([]);
      }
      if (seaCv) { lx.globalCompositeOperation = 'destination-out'; lx.drawImage(seaCv, 0, 0); lx.globalCompositeOperation = 'source-over'; }   // в водоёме берега русла исчезают
      if (seaCv) {                                                  // береговые штрихи: параллельные берегу линии в воде, ослабевающие вглубь
        cx2.lineJoin = 'round'; cx2.lineCap = 'round';
        [[-0.008, 0.8, 1.4, [16, 5]], [-0.02, 0.6, 1.2, [10, 7]], [-0.04, 0.42, 1.0, [6, 9]], [-0.07, 0.28, 0.9, [3, 11]]].forEach(([lv, al, lw, dash]) => {
          cx2.strokeStyle = PAL ? `rgba(255,255,255,${al * 0.5})` : inkA(al); cx2.lineWidth = lw; cx2.setLineDash(dash);
          for (const l of FM.contours(f, GW, GH, lv)) { const q = chaikin(l.map(p => [p[0] * GS, p[1] * GS]), 2, false); if (q.length < 6) continue; cx2.beginPath(); q.forEach((p, i) => i ? cx2.lineTo(p[0], p[1]) : cx2.moveTo(p[0], p[1])); cx2.stroke(); }
        });
        cx2.setLineDash([]);
      }
      cx2.strokeStyle = PAL ? 'rgba(58,44,32,0.72)' : ink; cx2.lineWidth = PAL ? 1.5 : 2.2;                   // 4. береговая линия водоёма, в устьях разорванная руслом
      for (const l of coast) { cx2.beginPath(); l.forEach((p, i) => i ? cx2.lineTo(p[0], p[1]) : cx2.moveTo(p[0], p[1])); cx2.stroke(); }
      cx2.globalCompositeOperation = 'destination-out'; segs(cx2, 1, '#000');
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lc, 0, 0); ctx.drawImage(cl, 0, 0); ctx.setTransform(T0);
    }
    for (const b of plan.bridges) {                    // мост: ровный настил, перила и опоры по краям — симметрично относительно оси реки
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
      const L = b.len / 2, Wd = b.w / 2;
      ctx.fillStyle = PAL ? PAL.wood : pap; ctx.fillRect(-L, -Wd, b.len, b.w);
      ctx.strokeStyle = ink; ctx.lineCap = 'butt'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-L, -Wd); ctx.lineTo(L, -Wd); ctx.moveTo(-L, Wd); ctx.lineTo(L, Wd); ctx.stroke();
      ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(-L, -Wd - 1.5); ctx.lineTo(-L, Wd + 1.5); ctx.moveTo(L, -Wd - 1.5); ctx.lineTo(L, Wd + 1.5); ctx.stroke();
      ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.stroke();
      ctx.restore();
    }
    for (const p of plan.piers) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = PAL ? PAL.wood : pap; ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
      ctx.fillRect(0, -3.5, p.len, 7); ctx.strokeRect(0, -3.5, p.len, 7); ctx.beginPath(); for (let x = 5; x < p.len; x += 5) { ctx.moveTo(x, -3.5); ctx.lineTo(x, 3.5); } ctx.stroke();
      ctx.fillStyle = ink; for (const y of [-3.5, 3.5]) { ctx.beginPath(); ctx.arc(p.len, y, 1.3, 0, 6.28); ctx.fill(); } ctx.restore();
    }
    for (const b of plan.boats) {
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = pap; ctx.strokeStyle = ink; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(-b.l / 2, 0); ctx.quadraticCurveTo(0, 5.5, b.l / 2, 0); ctx.quadraticCurveTo(0, -5.5, -b.l / 2, 0); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-b.l / 2 + 2, 0); ctx.lineTo(b.l / 2 - 2, 0); ctx.stroke(); ctx.restore();
    }

    // ----- объёмные объекты, отсортированные по глубине -----
    const items = [];
    const add = (y, fn) => items.push({ y, fn });

    const cyl = (x, y, r, h, cone, flag) => {
      h *= T; cone = T < 0.25 ? 0 : cone * T; const ry = r * (0.45 + 0.55 * (1 - T));
      ctx.beginPath(); ctx.moveTo(x - r, y - h); ctx.lineTo(x - r, y); ctx.ellipse(x, y, r, ry, 0, Math.PI, 0, true); ctx.lineTo(x + r, y - h); ctx.closePath();
      ctx.fillStyle = stone; ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = shade; ctx.fillRect(x + r * 0.15, y - h - 2, r, h + ry + 4);
      ctx.strokeStyle = ink; ctx.globalAlpha = 0.6; ctx.lineWidth = 0.7; ctx.beginPath(); for (let t = 0.2; t < 1; t += 0.2) { ctx.moveTo(x - r, y - h * t); ctx.lineTo(x + r, y - h * t); } ctx.stroke(); ctx.restore();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x - r, y - h); ctx.lineTo(x - r, y); ctx.ellipse(x, y, r, ry, 0, Math.PI, 0, true); ctx.lineTo(x + r, y - h); ctx.stroke();
      if (cone) {
        ctx.beginPath(); ctx.moveTo(x - r * 1.15, y - h); ctx.lineTo(x, y - h - cone); ctx.lineTo(x + r * 1.15, y - h); ctx.ellipse(x, y - h, r * 1.15, ry * 1.15, 0, 0, Math.PI, false); ctx.closePath();
        ctx.fillStyle = coneCol; ctx.fill(); ctx.save(); ctx.clip(); ctx.fillStyle = shade; ctx.fillRect(x, y - h - cone, r * 1.3, cone + ry * 1.3); ctx.restore(); ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.stroke();
        if (flag) { ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - h - cone); ctx.lineTo(x, y - h - cone - 8); ctx.lineTo(x + 7, y - h - cone - 6); ctx.lineTo(x, y - h - cone - 4); ctx.stroke(); }
      } else { ctx.beginPath(); ctx.ellipse(x, y - h, r, ry, 0, 0, 6.28); ctx.fillStyle = stoneTop; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.stroke(); ctx.lineWidth = 0.9; ctx.beginPath(); for (let a = 0; a < 6.28; a += 0.8) ctx.arc(x + Math.cos(a) * r * 0.82, y - h + Math.sin(a) * ry * 0.82, 0.6, 0, 6.28); ctx.stroke(); }
    };
    const box = (b, flat) => {
      const P = corners(b), H = (b.ruin ? b.hz * 0.45 : b.hz) * T, up = (p, k) => [p[0], p[1] - (k == null ? H : k)];
      const civ = b.kind === 'keep' || b.kind === 'gatehouse' || b.kind === 'temple' || b.kind === 'tower' || b.ruin, wallC = PAL && civ ? PAL.stone : pap, roofC = roofOf(b);
      if (T < 0.5 && !b.ruin) poly(P.map(p => [p[0] + 2.4, p[1] + 2.8]), inkA(0.17 * (1 - T * 2)), null);
      ctx.setLineDash(b.ruin ? [5, 3] : []);
      for (let i = 0; i < 4; i++) {
        const A = P[i], B = P[(i + 1) % 4], dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1, nx = dy / l, ny = -dx / l;
        if (ny <= 0.02 || H < 0.6) continue;
        poly([A, B, up(B), up(A)], wallC, ink, 1);
        if (!lit(nx, ny)) {
          poly([A, B, up(B), up(A)], shade, null);
          if (!b.ruin) { ctx.strokeStyle = ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.6; ctx.beginPath(); for (let t = 0.15; t < 1; t += 0.2) { ctx.moveTo(A[0] + dx * t, A[1] + dy * t); ctx.lineTo(A[0] + dx * t, A[1] + dy * t - H * 0.9); } ctx.stroke(); ctx.globalAlpha = 1; }
        } else if (!b.ruin && l > 12 && H > 4) {          // окошки на освещённой стене
          ctx.fillStyle = ink; for (const t of [0.3, 0.7]) ctx.fillRect(A[0] + dx * t - 0.9, A[1] + dy * t - H * 0.7, 1.8, H * 0.38);
        }
      }
      if (b.ruin) { poly(P.map(p => up(p)), null, ink, 1); ctx.setLineDash([]); return; }
      ctx.setLineDash([]);
      if (flat) {
        poly(P.map(p => up(p)), stoneTop, ink, 1.3);
        ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 0; i < 4; i++) { const A = up(P[i]), B = up(P[(i + 1) % 4]), l = Math.hypot(B[0] - A[0], B[1] - A[1]); for (let t = 3; t < l; t += 6) { ctx.moveTo(A[0] + (B[0] - A[0]) * t / l, A[1] + (B[1] - A[1]) * t / l); ctx.lineTo(A[0] + (B[0] - A[0]) * t / l, A[1] + (B[1] - A[1]) * t / l - 2.2); } }
        ctx.stroke(); return;
      }
      const e = [P[0], P[1], P[2], P[3]].map(p => up(p)), rh = b.rh * T;
      const R0 = [b.x - b.c * b.hw, b.y - b.s * b.hw - H - rh], R1 = [b.x + b.c * b.hw, b.y + b.s * b.hw - H - rh];
      const faces = [{ pts: [e[0], e[1], R1, R0], n: [b.s, -b.c], e0: e[0], e1: e[1], r0: R0, r1: R1 }, { pts: [R0, R1, e[2], e[3]], n: [-b.s, b.c], e0: e[3], e1: e[2], r0: R0, r1: R1 }];
      for (const fc of faces) {
        poly(fc.pts, roofC, ink, 1.1);
        if (!lit(fc.n[0], fc.n[1])) {
          poly(fc.pts, shade, null);
          ctx.strokeStyle = ink; ctx.globalAlpha = 0.6; ctx.lineWidth = 0.6; ctx.beginPath();
          for (let t = 0.3; t < 1; t += 0.3) ctx.moveTo(fc.e0[0] + (fc.r0[0] - fc.e0[0]) * t, fc.e0[1] + (fc.r0[1] - fc.e0[1]) * t), ctx.lineTo(fc.e1[0] + (fc.r1[0] - fc.e1[0]) * t, fc.e1[1] + (fc.r1[1] - fc.e1[1]) * t);
          ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
      ctx.strokeStyle = ink; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(R0[0], R0[1]); ctx.lineTo(R1[0], R1[1]); ctx.stroke();
      if (b.chimney) { ctx.fillStyle = stone; ctx.fillRect(R0[0] + (R1[0] - R0[0]) * 0.7 - 2.5, R0[1] + (R1[1] - R0[1]) * 0.7 - 9, 5, 9); ctx.strokeRect(R0[0] + (R1[0] - R0[0]) * 0.7 - 2.5, R0[1] + (R1[1] - R0[1]) * 0.7 - 9, 5, 9); }
    };
    const smoke = (x, y) => { ctx.strokeStyle = inkA(0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x - 6, y - 8, x + 8, y - 14, x - 2, y - 24); ctx.bezierCurveTo(x - 8, y - 30, x + 4, y - 34, x, y - 40); ctx.stroke(); };
    const bY = (b) => Math.max(...corners(b).map(p => p[1]));

    for (const b of plan.buildings) {
      if (b.kind === 'temple') {
        add(bY(b), () => {
          const tr = mkObb(b.x, b.y, b.hh * 2.9, b.hh * 0.95, b.a + Math.PI / 2, 'temple'); tr.hz = b.hz * 0.95; tr.rh = b.rh * 0.8;
          box(b); box(tr);
          const tx = b.x + b.c * (b.hw - b.hh * 0.6), ty = b.y + b.s * (b.hw - b.hh * 0.6); cyl(tx, ty, b.hh * 0.4, b.hz + 14, 15, true);
        });
      } else add(bY(b), () => { box(b); if (b.chimney) smoke(b.x, b.y - b.hz * T - 8); });
    }
    for (const c of plan.custom) {
      const t = FM.CITY_TEMPLATES[c.t]; if (!t) continue; const k = c.k || 1;
      if (c.t === 'tree') add(c.y, () => tree(c.x, c.y, 6 * k));
      else if (c.t === 'tower') add(c.y, () => cyl(c.x, c.y, 7 * k, 28 * k, 14 * k, false));
      else if (c.t === 'well') add(c.y, () => { ctx.beginPath(); ctx.ellipse(c.x, c.y - 2, 5 * k, 3 * k, 0, 0, 6.28); ctx.fillStyle = pap; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.stroke(); ctx.beginPath(); ctx.ellipse(c.x, c.y - 2, 2.6 * k, 1.4 * k, 0, 0, 6.28); ctx.fillStyle = ink; ctx.fill(); });
      else {
        const b = mkObb(c.x, c.y, Math.max(t.w, t.h) * k, Math.min(t.w, t.h) * k, c.a || 0, c.t);
        b.hz = c.t === 'temple' ? 13 : c.t === 'manor' ? 9 : c.t === 'stall' ? 3.5 : 6.5; b.rh = Math.min(b.hh * 0.9, 3 + b.hh * 0.4);
        if (c.t === 'temple') add(bY(b), () => { const tr = mkObb(b.x, b.y, b.hh * 2.9, b.hh * 0.95, b.a + Math.PI / 2); tr.hz = 12; tr.rh = 5; box(b); box(tr); cyl(b.x + b.c * (b.hw - b.hh * 0.6), b.y + b.s * (b.hw - b.hh * 0.6), b.hh * 0.4, 27, 15, true); });
        else add(bY(b), () => box(b));
      }
    }
    for (const s of plan.stalls) { const b = mkObb(s.x, s.y, 9, 6, s.a); b.hz = 3.5; b.rh = 2.2; add(bY(b), () => box(b)); }
    function tree(x, y, r) {
      ctx.fillStyle = inkA(0.12); ctx.beginPath(); ctx.ellipse(x + r * 0.5, y + 1, r * 0.9, r * 0.35, 0, 0, 6.28); ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - r * 0.9 * T); ctx.stroke();
      const cy = y - r * (0.25 + 1.15 * T); ctx.beginPath();
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28, a2 = (i + 1) / 7 * 6.28; ctx.arc(x + Math.cos((a + a2) / 2) * r * 0.45, cy + Math.sin((a + a2) / 2) * r * 0.45, r * 0.62, a - 1.6, a2 - 1.6); }
      ctx.closePath(); ctx.fillStyle = PAL ? crownOf(x, y) : pap; ctx.fill(); ctx.lineWidth = 0.9; ctx.stroke();
      ctx.save(); ctx.clip(); ctx.fillStyle = shade; ctx.beginPath(); ctx.arc(x + r * 0.55, cy + r * 0.5, r * 0.95, 0, 6.28); ctx.fill(); ctx.restore();
    }
    for (const t of plan.trees) add(t.y, () => tree(t.x, t.y, t.r));
    for (const s of plan.stand) {
      if (s.k === 'windmill') add(s.y, () => {
        cyl(s.x, s.y, 6.5, 18, 8, false); const hx = s.x, hy = s.y - 20 * T;
        ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.fillStyle = pap;
        for (let i = 0; i < 4; i++) { const a = s.a + i * Math.PI / 2 + 0.4, ex = hx + Math.cos(a) * 22, ey = hy + Math.sin(a) * 22; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke(); const nx = -Math.sin(a) * 5, ny = Math.cos(a) * 5, mx = hx + Math.cos(a) * 9, my = hy + Math.sin(a) * 9; poly([[mx, my], [ex, ey], [ex + nx, ey + ny], [mx + nx, my + ny]], pap, ink, 0.9); }
      });
      else if (s.k === 'haystack') add(s.y, () => { ctx.beginPath(); ctx.moveTo(s.x - 5, s.y); ctx.quadraticCurveTo(s.x - 5, s.y - 10, s.x, s.y - 10); ctx.quadraticCurveTo(s.x + 5, s.y - 10, s.x + 5, s.y); ctx.closePath(); ctx.fillStyle = PAL ? PAL.straw : pap; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1.1; ctx.stroke(); ctx.fillStyle = shade; ctx.fillRect(s.x, s.y - 9, 5, 9); });
      else if (s.k === 'cart') add(s.y, () => { const b = mkObb(s.x, s.y, 9, 5.5, 0.3); b.hz = 2.5; b.rh = 0; box(b, true); });
      else if (s.k === 'crane') add(s.y, () => { ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x, s.y - 26); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 26); ctx.lineTo(s.x + 16, s.y - 20); ctx.moveTo(s.x + 16, s.y - 20); ctx.lineTo(s.x + 16, s.y - 8); ctx.stroke(); });
      else if (s.k === 'smoke') add(s.y + 30, () => smoke(s.x, s.y));
      else if (s.k === 'logs') add(s.y, () => { for (let i = 0; i < 6; i++) { const x = s.x + (i % 3) * 5.5 - (i > 2 ? 2.7 : 0), y = s.y - (i > 2 ? 4.5 : 0); ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.28); ctx.fillStyle = leafFill; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 0.9; ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 1, 0, 6.28); ctx.stroke(); } });
      else if (s.k === 'fountain') add(s.y, () => { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fillStyle = stone; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1.4; ctx.stroke(); ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.6, 0, 6.28); ctx.fillStyle = `rgb(${waterRGB[0]},${waterRGB[1]},${waterRGB[2]})`; ctx.fill(); ctx.lineWidth = 0.9; ctx.stroke(); });
      else if (s.k === 'watch') add(s.y, () => cyl(s.x, s.y, 6, 30, 0, false));
      else if (s.k === 'tent') add(s.y, () => { poly([[s.x - 9, s.y], [s.x, s.y - 14], [s.x + 9, s.y]], pap, ink, 1.2); poly([[s.x, s.y - 14], [s.x + 9, s.y], [s.x + 1, s.y]], shade, null); ctx.beginPath(); ctx.moveTo(s.x, s.y - 14); ctx.lineTo(s.x, s.y); ctx.stroke(); });
      else if (s.k === 'cross') add(s.y, () => { ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - 7); ctx.moveTo(s.x - 2.4, s.y - 5); ctx.lineTo(s.x + 2.4, s.y - 5); ctx.stroke(); });
    }
    // стена, башни, ворота, замок
    const wallSeg = (a, b, H0, outward) => {
      let H = H0;
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, n = [dy / l, -dx / l], sg = (n[0] * outward[0] + n[1] * outward[1]) >= 0 ? 1 : -1, fn = [n[0] * sg, n[1] * sg];
      add(Math.max(a[1], b[1]), () => {
        if (T < 0.25) { ctx.lineCap = 'butt'; for (const [col, lw] of [[ink, 6.5], [stoneTop, 3.3]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } return; }
        H = H * T;
        const q = [a, b, [b[0], b[1] - H], [a[0], a[1] - H]];
        poly(q, stone, ink, 1.1); if (!lit(fn[0], fn[1])) poly(q, shade, null);
        ctx.strokeStyle = ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.6; ctx.beginPath(); for (let t = 0.12; t < 1; t += 0.12) { ctx.moveTo(a[0] + dx * t, a[1] + dy * t); ctx.lineTo(a[0] + dx * t, a[1] + dy * t - H); } ctx.stroke(); ctx.globalAlpha = 1;
        ctx.lineWidth = 3.6; ctx.strokeStyle = ink; ctx.beginPath(); ctx.moveTo(a[0], a[1] - H); ctx.lineTo(b[0], b[1] - H); ctx.stroke(); ctx.lineWidth = 1.8; ctx.strokeStyle = stoneTop; ctx.stroke();
        ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath(); for (let t = 2; t < l; t += 5) { const x = a[0] + dx * t / l, y = a[1] + dy * t / l - H; ctx.moveTo(x, y - 1.6); ctx.lineTo(x, y - 3.4); } ctx.stroke();
      });
    };
    if (plan.walled && plan.wallPoly) {                // куртины — прямые, башни в вершинах и по краям ворот, ворота — в середине куртины, река проходит через водные ворота
      const { V, curtains } = plan.wallPoly, HW = 14, N = V.length;
      curtains.forEach((c) => {
        if (c.skip) return;
        const a = c.a, b = c.b, L = c.L, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, P = (t) => [a.x + ux * t, a.y + uy * t], out = [(a.x + b.x) / 2 - CX, (a.y + b.y) / 2 - CY];
        const cuts = []; if (c.gate) cuts.push([L / 2 - 14, L / 2 + 14, 0]); if (c.cross) cuts.push([c.cross.t0, c.cross.t1, 6]);
        cuts.sort((p, q) => p[0] - q[0]);
        let t = 0; for (const [c0, c1] of cuts) { if (c0 > t + 1) wallSeg(P(t), P(c0), HW, out); t = Math.max(t, c1); }
        if (L > t + 1) wallSeg(P(t), P(L), HW, out);
        for (const [c0, c1, rr0] of cuts) { if (rr0) for (const tt of [c0, c1]) { const p = P(tt); add(p[1] + 3, () => cyl(p[0], p[1], rr0, 28, 14, false)); } }
        if (c.gate) {                                   // одни ворота — одна надвратная башня с проездом (а не две башни)
          const m = P(L / 2), ga = Math.atan2(uy, ux), gb = mkObb(m[0], m[1], 30, 18, ga, 'gatehouse'); gb.hz = 26; gb.rh = 0;
          add(m[1] + 12, () => { box(gb, true); const q = mkObb(m[0], m[1], 9, 20, ga, 'x'), P4 = corners(q); poly(P4.map(p => [p[0], p[1] - gb.hz * T]), pap, ink, 1); ctx.strokeStyle = ink; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(m[0] - uy * 0, m[1] - gb.hz * T); ctx.stroke(); });
        }
      });
      V.forEach((v, i) => { const pv = curtains[(i + N - 1) % N]; if (curtains[i].skip && pv.skip) return; add(v.y + 2, () => cyl(v.x, v.y, 8.5, 26, 13, false)); });
    }
    if (plan.keep) {
      const k = plan.keep, r = k.r, c = Math.cos(k.a), s = Math.sin(k.a);
      const C = [[-r, -r * 0.8], [r, -r * 0.8], [r, r * 0.8], [-r, r * 0.8]].map(([u, v]) => [k.x + c * u - s * v, k.y + s * u + c * v]);
      for (let i = 0; i < 4; i++) wallSeg(C[i], C[(i + 1) % 4], 15, [(C[i][0] + C[(i + 1) % 4][0]) / 2 - k.x, (C[i][1] + C[(i + 1) % 4][1]) / 2 - k.y]);
      for (const p of C) add(p[1] + 2, () => cyl(p[0], p[1], 9, 26, 13, false));
      const kb = mkObb(k.x, k.y, r * 0.8, r * 0.7, k.a, 'keep'); kb.hz = 24; kb.rh = 0; add(bY(kb) + 1, () => { box(kb, true); for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cyl(k.x + c * u * r * 0.4 - s * v * r * 0.35, k.y + s * u * r * 0.4 + c * v * r * 0.35, 4.5, 31, 8, v > 0 && u > 0); });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) { if (it.y < VY - 60 || it.y > VY + CH / Z + 140) continue; ctx.save(); it.fn(); ctx.restore(); }
    // подписи улиц и районов — только при приближении (плавно проявляются между 1.4× и 1.8×); при экспорте (labels:true) — всегда
    const la = opts.labels === true ? 1 : opts.labels === false ? 0 : clamp((Z - 1.4) / 0.4, 0, 1);
    if (la > 0 && !plan.ruin) { ctx.save(); ctx.globalAlpha = la; try { drawCityLabels(ctx, plan, ink, pap); } catch (e) { console.error(e); } ctx.restore(); }

    // ----- рамка, табличка, масштаб, компас (в экранных координатах) -----
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    const fr = 14;
    if (th.frame) { ctx.strokeStyle = ink; ctx.lineWidth = 2.4; ctx.strokeRect(fr, fr, CW - 2 * fr, CH - 2 * fr); ctx.lineWidth = 0.9; ctx.strokeRect(fr + 6, fr + 6, CW - 2 * fr - 12, CH - 2 * fr - 12); }
    ctx.fillStyle = pap; ctx.strokeStyle = ink; ctx.lineWidth = 1.6; ctx.fillRect(40, 40, 330, 82); ctx.strokeRect(40, 40, 330, 82); ctx.lineWidth = 0.7; ctx.strokeRect(45, 45, 320, 72);
    ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.font = 'bold 34px Georgia, "Times New Roman", serif'; ctx.fillText(plan.name, 58, 86, 296);
    ctx.font = 'italic 17px Georgia, serif'; ctx.fillText(TYPE_NAME[plan.type] || '', 58, 108);
    const mNice = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000].find(v => v / METERS * Z >= 80) || 5000, bar = mNice / METERS * Z;
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(60, CH - 52); ctx.lineTo(60 + bar, CH - 52); ctx.moveTo(60, CH - 58); ctx.lineTo(60, CH - 46); ctx.moveTo(60 + bar, CH - 58); ctx.lineTo(60 + bar, CH - 46); ctx.stroke();
    ctx.font = '15px Georgia, serif'; ctx.fillText(mNice >= 1000 ? (mNice / 1000) + ' км' : mNice + ' м', 60 + bar + 10, CH - 47);
    ctx.save(); ctx.translate(CW - 80, CH - 90); ctx.lineWidth = 1.6; ctx.fillStyle = ink;
    ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(8, 0); ctx.lineTo(0, -6); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 28); ctx.lineTo(0, -6); ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.stroke(); ctx.font = 'bold 16px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('С', 0, -36); ctx.restore();
    if (th.vignette) { const g = ctx.createRadialGradient(CX, CY, CH * 0.5, CX, CY, CW * 0.62); g.addColorStop(0, 'rgba(60,45,30,0)'); g.addColorStop(1, PAL ? 'rgba(70,55,35,0.13)' : 'rgba(60,45,30,0.28)'); ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH); }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = FM.getGrain(ctx, th); ctx.fillRect(0, 0, cv.width, cv.height); ctx.globalCompositeOperation = 'source-over';
    return cv;
  };
  FM.CITY_SIZE = { W: CW, H: CH };
})(window.FM);
