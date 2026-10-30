// Жизнь и ресурсы дна, а также названия подводных структур. Опирается на модель рельефа дна (seafloor.js) и климат мира.
// Всё размещается по условиям среды, а не случайно:
//   коралловые постройки — тёплая (≥ порога) прозрачная вода глубже 0, но мельче ~60 м, вдали от мутных устьев рек: береговые рифы у самого берега,
//     барьерные — на внешнем краю широкого тёплого шельфа с лагуной за ними, атоллы — на оседающих вулканах горячих точек (из seafloor.js);
//   ламинария — прохладные мелководья каменистых берегов (чем холоднее течение, тем гуще); морская трава — спокойные мелководья лагун;
//   богатые банки — апвеллинг у берегов (холодное течение) и субполярный фронт на шельфе; сообщества — вокруг гидротерм и холодных просачиваний;
//   нефть и газ — осадочные бассейны пассивных окраин с мощным шельфом и дельтами; гидраты — склоны 500–2500 м у холодных просачиваний;
//   конкреции — абиссальные равнины старой коры (> 4200 м) вдали от суши; сульфиды — гидротермальные поля хребтов и островных дуг;
//   кобальтовые корки — склоны подводных гор 800–2500 м; фосфориты — зоны апвеллинга на внешнем шельфе; россыпи — шельф у устьев крупных рек.
(function (FM) {
  'use strict';
  const { mulberry32, hashString, makeNoise, fbm, clamp, smooth } = FM;

  FM.SEABED_RES = {
    oil:      { label: 'Нефть', col: '#2a2a2e', why: 'осадочный бассейн пассивной окраины с мощным шельфом и дельтами рек' },
    gas:      { label: 'Природный газ', col: '#5f7fa8', why: 'глубокие части осадочных бассейнов, склон шельфа' },
    hydrate:  { label: 'Газовые гидраты', col: '#9fd4dc', why: 'склон 500–2500 м у холодных просачиваний, низкие температуры и высокое давление' },
    nodules:  { label: 'Железомарганцевые конкреции', col: '#7a5a3a', why: 'абиссальные равнины старой коры, очень медленное осадконакопление' },
    sulfide:  { label: 'Сульфидные руды (медь, цинк, золото)', col: '#c9a23a', why: 'гидротермальные поля срединных хребтов и островных дуг' },
    crust:    { label: 'Кобальтовые корки', col: '#a45a8a', why: 'склоны подводных гор и гайотов, омываемые течениями' },
    phosph:   { label: 'Фосфориты', col: '#d8d2a0', why: 'внешний шельф зон апвеллинга: отмершая биомасса' },
    placer:   { label: 'Морские россыпи (олово, золото, самоцветы)', col: '#d49a3c', why: 'шельф у устьев крупных рек: тяжёлые минералы сносятся с гор' }
  };

  FM.seafloorLife = function (map, sf) {
    const { W, H, h, temp } = map, N = W * H, cur = map.current;
    const { water, depth, dLand, shW, actN, age, cones, ridges, trenches, vents, plateaus } = sf;
    const { isW, idx, inb, tangent, plen, chamfer } = sf.helpers, sc = sf.sc, sq = Math.sqrt(sc);
    const rnd = mulberry32(hashString(map.seed + '|sflife')), nz = makeNoise(mulberry32(hashString(map.seed + '|sfl')));
    const ice = FM.polarIce(map), kmCell = sf.kmCell;
    const WARM = 0.8, ok = (i) => water[i] && !ice[i];

    // ---------- мутность: расстояние до устьев крупных рек ----------
    const mouths = sf.mouths || [];
    let accMax = 1e-6; for (const m of mouths) accMax = Math.max(accMax, m.acc);
    const ms = [], ml = []; mouths.forEach((m, k) => { const i = idx(m.x, m.y); ms.push(i); ml.push(k); });
    const dM = ms.length ? chamfer(W, H, ms, ml) : null;
    const turb = (i) => { if (!dM) return 0; const m = mouths[dM.src[i]], a = m ? m.acc / accMax : 0; return Math.exp(-dM.d[i] / ((3 + 14 * Math.sqrt(a)) * sc)); };
    const gradL = (x, y) => { const g = (xx, yy) => dLand[clamp(Math.round(yy), 0, H - 1) * W + clamp(Math.round(xx), 0, W - 1)]; const gx = g(x + 1, y) - g(x - 1, y), gy = g(x, y + 1) - g(x, y - 1), l = Math.hypot(gx, gy) || 1; return [gx / l, gy / l]; };
    const dep = (i) => sf.depth[i];
    const cold = (i) => cur ? -cur[i] : 0;                                   // >0 — холодное течение
    const scan = (step, jit, fn) => { const out = []; for (let y = 1; y < H - 1; y += step) for (let x = 1; x < W - 1; x += step) { const px = x + (rnd() - 0.5) * jit, py = y + (rnd() - 0.5) * jit; if (!inb(Math.round(px), Math.round(py))) continue; const r = fn(px, py, idx(px, py)); if (r) out.push(r); } return out; };

    // ---------- кораллы ----------
    const reefs = { fringing: [], barrier: [], patch: [], lagoon: [] };
    const warmReef = (i) => ok(i) && temp[i] >= WARM && dep(i) < 70 && turb(i) < 0.28;
    // береговые рифы: узкая полоса за линией прибоя
    reefs.fringing = scan(0.9, 0.9, (x, y, i) => {
      if (!warmReef(i) || dLand[i] < 1.2 || dLand[i] > 2.8 + 0.4 * fbm(nz, x * 0.1, y * 0.1, 2)) return null;
      if (rnd() < 0.18 + 0.4 * (1 - smooth(0.8, 0.95, temp[i]))) return null;
      const n = gradL(x, y); return { x, y, a: Math.atan2(n[0], -n[1]) };
    });
    // барьерные рифы: внешний край широкого тёплого шельфа, с проходами
    {
      const g = new Float32Array(N); for (let i = 0; i < N; i++) g[i] = water[i] ? dLand[i] - 0.78 * shW[i] : -1;
      for (const l of FM.contours(g, W, H, 0)) {
        let run = []; const flush = () => { if (run.length >= 9) reefs.barrier.push(run.slice()); run = []; };
        let gap = 0;
        for (const p of l) {
          const x = Math.round(p[0]), y = Math.round(p[1]); if (!inb(x, y)) { flush(); continue; } const i = idx(x, y);
          const good = ok(i) && temp[i] >= WARM + 0.01 && shW[i] > 6.5 * sc && turb(i) < 0.2 && dLand[i] > 3.5 && dep(i) < 130 && actN[i] < 0.5;
          if (good) { if (gap > 0) gap--; if (gap === 0 && rnd() < 0.035) { gap = 3 + Math.floor(rnd() * 3); flush(); } if (gap === 0) run.push(p); else flush(); }
          else flush();
        }
        flush();
      }
      // лагуна за барьерным рифом: мелководье, зарастающее морской травой
      for (const line of reefs.barrier) for (let s = 0; s < line.length; s += 4) {
        const p = line[s], n = gradL(p[0], p[1]);
        for (const k of [0.35, 0.6]) { const q = [p[0] - n[0] * shW[idx(p[0], p[1])] * k * 0.8, p[1] - n[1] * shW[idx(p[0], p[1])] * k * 0.8]; if (isW(q[0], q[1]) && rnd() < 0.7) reefs.lagoon.push({ x: q[0] + (rnd() - 0.5), y: q[1] + (rnd() - 0.5) }); }
      }
    }
    // пятнистые рифы на тёплых мелких банках вдали от берега (и вокруг атоллов)
    reefs.patch = scan(2.2, 2, (x, y, i) => {
      if (!warmReef(i) || dep(i) > 45 || dLand[i] < 3.5 || fbm(nz, x * 0.4 + 11, y * 0.4, 2) < 0.12) return null;
      return { x, y, r: 0.5 + rnd() * 0.7 };
    });
    // атоллы из модели гор: кольцо рифа + лагуна
    reefs.atolls = cones.filter(c => c.kind === 'atoll').map(c => ({ x: c.x, y: c.y, r: Math.max(1.1, c.r * 1.05) }));

    // ---------- ламинария и морская трава ----------
    const kelp = scan(0.8, 0.8, (x, y, i) => {
      if (!ok(i) || dep(i) > 50 || dLand[i] > 4.2 || dLand[i] < 0.8) return null;
      const t = temp[i], c = cold(i); if (t < 0.3 || t > 0.66 - 0.05 * Math.min(1, Math.max(0, c * 4)) || turb(i) > 0.4) return null;
      const dens = 0.3 + 0.6 * smooth(0, 0.2, c) + 0.3 * fbm(nz, x * 0.3 + 3, y * 0.3, 2); if (rnd() > dens * 0.5) return null;
      return { x, y, s: 0.8 + rnd() * 0.5 };
    });
    const grass = reefs.lagoon.concat(scan(1.4, 1.2, (x, y, i) => {
      if (!ok(i) || dep(i) > 18 || dLand[i] < 0.8 || dLand[i] > 3.2 || temp[i] < 0.48 || turb(i) > 0.3) return null;
      return fbm(nz, x * 0.25 + 31, y * 0.25, 2) > 0.18 && rnd() < 0.55 ? { x, y } : null;
    }));

    // ---------- богатые банки: апвеллинг и субполярный фронт на шельфе ----------
    const banks = [];
    {
      const cand = scan(2, 2, (x, y, i) => {
        if (!ok(i) || dep(i) < 25 || dep(i) > 450 || dLand[i] > shW[i] * 1.3 || sf.area[sf.comp[0] >= 0 ? 0 : 0] < 0) return null;
        const c = cold(i), front = Math.abs(temp[i] - 0.34) < 0.05;
        const sc2 = Math.max(c * 3, front ? 0.6 : 0) + 0.3 * smooth(6, 16, shW[i] / sc) - 0.3 * actN[i];
        return sc2 > 0.55 ? { x, y, s: sc2 } : null;
      });
      cand.sort((a, b) => b.s - a.s);
      for (const c of cand) { if (banks.length >= 14) break; if (banks.every(b => Math.hypot(b.x - c.x, b.y - c.y) > 14 * sc)) banks.push({ x: c.x, y: c.y, r: (3 + 3 * rnd()) * sq, a: rnd() * 3.14, s: c.s }); }
    }

    // ---------- ресурсы ----------
    const res = [], far = (k, x, y, d) => res.every(r => r.k !== k || Math.hypot(r.x - x, r.y - y) > d);
    const add = (k, x, y, extra) => { const i = idx(x, y), a = 0.5 + 1.5 * rnd(), d = Math.round(dep(i)); res.push(Object.assign({ k, x, y, amt: +a.toFixed(2), depth: d, acc: d < 200 ? 1 : d < 1000 ? 2 : d < 3000 ? 3 : 4 }, extra || {})); };
    // нефть и газ: пассивная окраина (мало активных границ), широкий шельф, дельты рек
    {
      const cand = scan(2, 2, (x, y, i) => {
        if (!ok(i) || dep(i) < 20 || dep(i) > 2600 || dLand[i] > shW[i] * 2.2 || actN[i] > 0.35) return null;
        const ar = sf.area[sf.comp[0] >= 0 ? 0 : 0]; const near = turb(i), wide = smooth(5, 15, shW[i] / sc);
        const s = 0.6 * wide + 0.8 * near + 0.25 * fbm(nz, x * 0.12 + 50, y * 0.12, 2); return s > 0.42 ? { x, y, s } : null;
      });
      cand.sort((a, b) => b.s - a.s);
      for (const c of cand) { if (res.length >= 14) break; if (!far('oil', c.x, c.y, 13 * sc) || !far('gas', c.x, c.y, 13 * sc)) continue; const i = idx(c.x, c.y); add(dep(i) > 700 || rnd() < 0.35 ? 'gas' : 'oil', c.x, c.y, { r: (2.2 + 1.8 * c.s) * sq }); }
    }
    // гидраты: у холодных просачиваний на склоне
    for (const v of vents) if (v.type === 'cold') { const q = [v.x + (rnd() - 0.5) * 3, v.y + (rnd() - 0.5) * 3]; if (isW(q[0], q[1]) && dep(idx(q[0], q[1])) > 500 && dep(idx(q[0], q[1])) < 4200) add('hydrate', q[0], q[1], { r: 2 * sq }); }
    {                                                                         // и на пассивных склонах рядом с нефтяными бассейнами
      const cand = scan(3, 3, (x, y, i) => ok(i) && dep(i) > 700 && dep(i) < 2600 && dLand[i] > shW[i] * 1.1 && dLand[i] < shW[i] * 3 && actN[i] < 0.4 && temp[i] < 0.9 && rnd() < 0.05 ? { x, y } : null);
      for (const c of cand) if (res.filter(r => r.k === 'hydrate').length < 9 && far('hydrate', c.x, c.y, 16 * sc)) add('hydrate', c.x, c.y, { r: 1.8 * sq });
    }
    // конкреции: абиссальные равнины
    {
      const cand = scan(4, 4, (x, y, i) => ok(i) && dep(i) > 4200 && dep(i) < 5900 && age[i] > 45 && dLand[i] > 22 * sc && (!sf.dR || sf.dR[i] > 9 * sc) && (!sf.dT || sf.dT[i] > 12 * sc) ? { x, y, s: fbm(nz, x * 0.05 + 70, y * 0.05, 2) } : null);
      cand.sort((a, b) => b.s - a.s);
      for (const c of cand) { if (res.filter(r => r.k === 'nodules').length >= 8) break; if (far('nodules', c.x, c.y, 22 * sc)) add('nodules', c.x, c.y, { r: (4 + 3 * rnd()) * sq }); }
    }
    // сульфиды: гидротермы хребтов и дуг
    for (const v of vents) if (v.type === 'hot' && rnd() < 0.55 && dep(idx(v.x, v.y)) > 800 && far('sulfide', v.x, v.y, 10 * sc)) add('sulfide', v.x, v.y, { r: 1.2 * sq });
    for (const c of cones) if (c.kind === 'arc' && dep(idx(c.x, c.y)) > 900 && rnd() < 0.08 && far('sulfide', c.x, c.y, 10 * sc)) add('sulfide', c.x, c.y, { r: 1.1 * sq });
    // кобальтовые корки: гайоты и древние конусы, склоны 800–2500 м
    for (const c of cones) if ((c.kind === 'guyot' || c.kind === 'cone') && dep(idx(c.x, c.y)) > 1800 && c.summit > 300 && c.summit < 2300 && rnd() < 0.3 && far('crust', c.x, c.y, 9 * sc)) add('crust', c.x, c.y, { r: 1.3 * sq, depth: Math.round(c.summit + 600) });
    // фосфориты: край шельфа в зонах апвеллинга
    for (const b of banks) if (b.s > 0.7 && temp[idx(b.x, b.y)] > 0.45) { const i = idx(b.x, b.y); if (far('phosph', b.x, b.y, 14 * sc)) add('phosph', b.x, b.y, { r: 1.8 * sq, depth: Math.max(80, Math.round(dep(i))) }); }
    // россыпи: шельф у устьев самых крупных рек
    mouths.slice().sort((a, b) => b.acc - a.acc).slice(0, 7).forEach(m => { const g = gradL(m.x, m.y), x = m.x + g[0] * 2.5, y = m.y + g[1] * 2.5; if (isW(x, y)) add('placer', x, y, { r: 1.6 * sq, depth: Math.round(dep(idx(x, y))) }); });

    // ---------- названия структур ----------
    const used = new Set(); const names = [];
    const ru = FM.uiLang !== 'en';
    const nm = (kind) => { const race = ['human', 'elf', 'dwarf'][Math.floor(rnd() * 3)]; const base = FM.cityName(rnd, used, race); return ru ? { ridge: 'Хребет ', trench: 'Жёлоб ', plateau: 'Плато ', plain: 'Равнина ', chain: 'Цепь гор ', fault: 'Разлом ', canyon: 'Каньон ', bank: 'Банка ', reef: 'Риф ' }[kind] + base : { ridge: base + ' Ridge', trench: base + ' Trench', plateau: base + ' Plateau', plain: base + ' Plain', chain: base + ' Seamounts', fault: base + ' Fracture Zone', canyon: base + ' Canyon', bank: base + ' Bank', reef: base + ' Reef' }[kind]; };
    const join = (secs) => { const out = []; let cur2 = null; for (const s of secs) { if (cur2 && Math.hypot(cur2[cur2.length - 1][0] - s[0][0], cur2[cur2.length - 1][1] - s[0][1]) < 6) cur2 = cur2.concat(s); else { if (cur2) out.push(cur2); cur2 = s.slice(); } } if (cur2) out.push(cur2); return out; };
    const lab = (kind, pts, minLen) => { if (!pts || pts.length < 3 || plen(pts) < minLen) return; names.push({ kind, text: nm(kind), pts }); };
    const rl = join(ridges.map(r => r.pts)).sort((a, b) => plen(b) - plen(a)); for (const p of rl.slice(0, 4)) lab('ridge', p, 26 * sc);
    const tl = trenches.map(t => t.pts).sort((a, b) => plen(b) - plen(a)); for (const p of tl.slice(0, 3)) lab('trench', p, 24 * sc);
    for (const p of plateaus) lab('plateau', [[p.x - Math.cos(p.a) * p.rx * 0.9, p.y - Math.sin(p.a) * p.rx * 0.9], [p.x, p.y], [p.x + Math.cos(p.a) * p.rx * 0.9, p.y + Math.sin(p.a) * p.rx * 0.9]], 14 * sc);
    for (const hs of sf.hotspots) if (hs.track && hs.track.length >= 6) { const t = hs.track; lab('chain', t.slice(1), 24 * sc); }
    const fzl = sf.fz.map(f => f.pts).sort((a, b) => plen(b) - plen(a)); for (const p of fzl.slice(0, 2)) lab('fault', p, 24 * sc);
    for (const c of sf.canyons.slice(0, 2)) lab('canyon', c.pts, 14 * sc);
    // абиссальные равнины: самые глубокие и ровные участки
    {
      const B = Math.round(16 * sc), cells = [];
      for (let by = 0; by + B < H; by += B) for (let bx = 0; bx + B < W; bx += B) {
        let m = 0, m2 = 0, n = 0, bad = false;
        for (let y = by; y < by + B; y += 2) for (let x = bx; x < bx + B; x += 2) { const i = y * W + x; if (!water[i] || dLand[i] < 14 * sc) { bad = true; break; } m += depth[i]; m2 += depth[i] * depth[i]; n++; }
        if (bad || !n) continue; const mu = m / n, sd = Math.sqrt(Math.max(0, m2 / n - mu * mu)); if (mu > 4300) cells.push({ x: bx + B / 2, y: by + B / 2, mu, sd });
      }
      cells.sort((a, b) => a.sd - b.sd);
      const pl = []; for (const c of cells) { if (pl.length >= 2) break; if (pl.every(q => Math.hypot(q.x - c.x, q.y - c.y) > 60 * sc)) pl.push(c); }
      for (const c of pl) lab('plain', [[c.x - 7 * sc, c.y], [c.x, c.y], [c.x + 7 * sc, c.y]], 12 * sc);
    }
    sf.reefs = reefs; sf.kelp = kelp; sf.grass = grass; sf.banks = banks; sf.res = res; sf.labels = names;
    sf.stats = { fringing: reefs.fringing.length, barrier: reefs.barrier.length, patch: reefs.patch.length, atolls: reefs.atolls.length, kelp: kelp.length, grass: grass.length, banks: banks.length, res: res.length };
  };
})(window.FM);
