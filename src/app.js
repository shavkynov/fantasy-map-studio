(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const S = 3.75;
  { const v = document.getElementById('ver'); if (v) v.textContent = ' v' + FM.VERSION; }                       // пикселей холста на клетку сетки

  const state = {
    seed: '', plateCount: 9, land: 34, epochs: 2, continents: 2, islands: 3, catCfg: FM.defaultCatCfg(), catManual: [], landEdits: [], landPending: [], landUndo: [], landTool: 'add', landSize: 40, landRough: 65, catTool: 'meteor', catSize: 50, worldScale: 1.5, sizeSel: 0,
    view: 'map', theme: 'sepia', lang: 'ru',
    layers: { rivers: true, forests: true, roads: true, currents: false, tides: false, ice: true, seas: true, routes: true, sbGeo: true, sbBio: true, sbRes: true, sbNames: true },
    plates: null,                       // отредактированные плиты (null = из seed)
    cam: { z: 1, x: 0, y: 0 }, zoomImg: null, map: null, base: null, heightImg: null, renderMs: 0,
    pol: null,                          // политика: государства, границы-барьеры, ручные правки
    tool: 'view', stick: 0.85, brushR: 6, activeId: 0,
    draft: [], draftSegs: [], previewPath: null, brushPos: null,
    ctool: 'city', selCity: null, roadDraft: [], roadSegs: [], roadPreview: null, showRes: true, citySalt: 0,
    resCfg: FM.defaultResCfg()
  };

  function randomSeed() {
    const syl = ['ar', 'el', 'dor', 'mir', 'tal', 'von', 'keth', 'is', 'or', 'an', 'gra', 'lun', 'bar', 'fen', 'sa'];
    let s = '';
    for (let i = 0; i < 3; i++) s += syl[Math.floor(Math.random() * syl.length)];
    return s + '-' + Math.floor(Math.random() * 900 + 100);
  }
  function busy(on) { $('busy').classList.toggle('on', on); }

  // ---------- политика ----------
  function newPol() {
    const N = state.map.W * state.map.H;
    return { states: [], barriers: [], overrides: new Uint8Array(N), owner: new Uint8Array(N), version: 0, cities: [], roads: [], rv: 0, resCfg: state.resCfg };
  }
  function nextId() {
    const used = new Set(state.pol.states.map(s => s.id));
    for (let i = 1; i < 255; i++) if (!used.has(i)) return i;
    return 255;
  }
  function routeAll(pts, stick) {
    let path = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = FM.route(state.map, pts[i], pts[i + 1], stick);
      path = path.concat(path.length ? seg.slice(1) : seg);
    }
    return path;
  }
  function usedNames() {
    const u = new Set();
    for (const s of state.pol.states) { u.add(s.name); if (s.capName) u.add(s.capName); }
    for (const c of state.pol.cities) u.add(c.name);
    return u;
  }
  function ensureCapNames() {
    const used = usedNames();
    for (const s of state.pol.states) { if (!s.race) s.race = 'human'; if (!s.type) s.type = 'kingdom'; if (!s.capName) s.capName = FM.cityName(Math.random, used, s.race); if (!s.culture) s.culture = 'realistic'; }
  }
  function routeAllRoad(pts) {
    let path = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = FM.routeRoad(state.map, state.pol, pts[i], pts[i + 1]);
      path = path.concat(path.length ? seg.slice(1) : seg);
    }
    return path;
  }
  function syncPol() {            // после пересчёта рельефа: подогнать столицы и границы к новой суше
    const pol = state.pol, map = state.map;
    pol.states = pol.states.filter(s => {
      const i = FM.snapLand(map, s.capital.x, s.capital.y, 15);
      if (i < 0) return false;
      s.capital = { x: i % map.W, y: (i / map.W) | 0 }; return true;
    });
    for (const b of pol.barriers) b.path = routeAll(b.pts, b.stick);
    pol.cities = pol.cities.filter(c => {
      const i = FM.snapLand(map, c.x, c.y, 10); if (i < 0) return false;
      c.x = i % map.W; c.y = (i / map.W) | 0; return true;
    });
  }
  function growNow() {
    const pol = state.pol, W = state.map.W;
    pol.owner = FM.growStates(state.map, pol);
    pol.version++;
    for (const c of pol.cities) c.stateId = pol.owner[Math.round(c.y) * W + Math.round(c.x)] || 0;
  }
  function politicsChanged() {
    growNow(); rebuildBase(); draw(); renderList(); updateStats();
  }

  // ---------- генерация ----------
  // индикатор хода генерации: этап → (вес, ключ перевода, русская фраза); полоса — по накопленным весам, фразы-«присказки» крутятся CSS-анимацией (она идёт и когда основной поток занят)
  const GEN_STAGES = { probe: [14, 'gen.probe', 'Подбираем раскладку материков'], plates: [12, 'gen.plates', 'Укладываем тектонические плиты'], base: [3, 'gen.base', 'Набрасываем щебень'], orogeny: [12, 'gen.orogeny', 'Сталкиваем плиты, поднимаем горы'], height: [4, 'gen.height', 'Лепим рельеф'], coast: [10, 'gen.coast', 'Обгрызаем берега'], sea: [2, 'gen.sea', 'Наливаем океаны'], islands: [1, 'gen.islands', 'Рассыпаем острова'], hotspots: [2, 'gen.hotspots', 'Будим вулканы'], inlets: [3, 'gen.inlets', 'Рубим фьорды, роняем метеориты'], climate: [5, 'gen.climate', 'Раздаём ветра и дожди'], rivers: [3, 'gen.rivers', 'Направляем реки к морю'], seabed: [3, 'gen.seabed', 'Роем океанское дно'] };
  const GEN_FLAVOR = [['gen.f1', 'Набрасываем щебень'], ['gen.f2', 'Укладываем тектонические плиты'], ['gen.f3', 'До седьмого дня далеко'], ['gen.f4', 'Уговариваем континенты не толкаться'], ['gen.f5', 'Спорим с геологами о возрасте гор'], ['gen.f6', 'Подкручиваем ветра'], ['gen.f7', 'Расставляем вулканы по росту'], ['gen.f8', 'Выравниваем горизонт'], ['gen.f9', 'Считаем острова: вроде стало на один больше']];
  const genUi = (() => {
    const GEN_SUM = Object.values(GEN_STAGES).reduce((a, v) => a + v[0], 0); let frac = 0;
    const set = (f, text) => { frac = Math.max(frac, f); $('genBar').style.transform = 'scaleX(' + frac.toFixed(3) + ')'; $('genPct').textContent = Math.round(frac * 100) + '%'; if (text) $('genPhrase').textContent = text; };
    const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    return {
      show() {
        frac = 0; const box = $('genFlavor'); box.innerHTML = '';
        const order = GEN_FLAVOR.slice(); for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
        order.forEach((f, i) => { const sp = document.createElement('span'); sp.textContent = FM.t(f[0], f[1]) + '…'; sp.style.animationDelay = (i * 3) + 's'; box.appendChild(sp); });
        box.style.setProperty('--n', order.length); box.style.setProperty('--cycle', (order.length * 3) + 's');
        set(0, FM.t('gen.start', 'Готовим планету')); $('gen').classList.add('on');
      },
      hide() { $('gen').classList.remove('on'); },
      async stage(name, tr) {
        const st = GEN_STAGES[name]; if (!st) return;
        let before = 0; for (const k in GEN_STAGES) { if (k === name) break; before += GEN_STAGES[k][0]; }
        set(before / GEN_SUM * 0.8, FM.t(st[1], st[2]) + (tr > 0 ? ' · ' + FM.t('gen.retry', 'пробуем другую раскладку') + ' ' + (tr + 1) : '') + '…'); await paint();
      },
      async showPatch() { this.show(); set(0.35, FM.T('Пересчитываем затронутое') + '…'); await paint(); },
      async stageDraw() { set(0.83, FM.t('gen.draw', 'Рисуем карту пером') + '…'); await paint(); }
    };
  })();
  function regenerate(opts) {
    opts = opts || {};
    genUi.show();
    setTimeout(async () => {
      const gp = {
        seed: state.seed, plateCount: state.plateCount, landRatio: state.land / 100,
        epochs: state.epochs, continents: state.continents, islands: state.islands, catManual: state.catManual, landEdits: state.landEdits, catastrophes: (Object.values(state.catCfg || {}).some(v => v > 0)) ? state.catCfg : null, W: Math.round(480 * state.worldScale), H: Math.round(320 * state.worldScale), plates: opts.keepPlates ? state.plates : null
      };
      let map;
      try { map = await FM.generateAsync(gp, genUi.stage); } catch (e) { genUi.hide(); throw e; }
      await genUi.stageDraw();
      state.landUndo = [];
      if (state.landEdits.some(e => e.local)) {   // точечные правки суши повторяются поверх свежей карты (пачками, как применялись)
        const byB = new Map(); state.landEdits.forEach((e, i) => { if (e.local) { const g = byB.get(e.b || 1) || { base: i, list: [] }; g.list.push(e); byB.set(e.b || 1, g); } });
        for (const g of byB.values()) { const r = FM.patchMap(map, g.list, g.base); if (r && r.map) map = r.map; }
      }
      state.map = map;
      state.plates = map.plates.map(p => ({ x: p.x, y: p.y, type: p.type, weight: p.weight }));
      let hadAuto = false;
      if (!opts.keepPlates || !state.pol || state.pol.owner.length !== map.W * map.H) state.pol = newPol();
      else if (!opts.loading) { hadAuto = state.pol.roads.some(r => !r.manual); syncPol(); }
      state.draft = []; state.draftSegs = []; state.previewPath = null; state.roadDraft = []; state.roadSegs = []; state.roadPreview = null; state.selCity = null;
      ensureCapNames();
      if (state.pol.states.length) growNow();
      if (!opts.loading && (state.pol.roads.length || hadAuto)) {
        const man = state.pol.roads.filter(r => r.manual);
        for (const r of man) r.path = routeAllRoad(r.pts);
        state.pol.roads = man.concat(hadAuto ? FM.buildRoads(map, state.pol) : []);
        state.pol.rv++;
      }
      rebuildBase(); draw(); renderList(); updateStats();
      genUi.hide();
      if (opts.done) opts.done(map);
    }, 20);
  }

  const raceOfCell = (i) => { const st = state.pol && state.pol.states.find(q => q.id === state.pol.owner[i]); return (st && st.race) || 'human'; };
  // имена детерминированы по seed + расе: смена письменности (ru/en) даёт те же имена в другой записи; вручную заданные имена городов не трогаются
  function renameAll() {
    const pol = state.pol; if (!pol) return;
    const used = new Set();
    for (const s of pol.states) {
      const rand = FM.mulberry32(FM.hashString(state.seed + '|n|' + s.id + '|' + (s.race || 'human')));
      s.name = FM.stateName(rand, used, s.race); s.capName = FM.cityName(rand, used, s.race);
      for (const c of pol.cities) if (c.stateId === s.id && !c.manual) c.name = FM.cityName(rand, used, s.race);
    }
    const r0 = FM.mulberry32(FM.hashString(state.seed + '|n|0'));
    for (const c of pol.cities) if (!c.stateId && !c.manual) c.name = FM.cityName(r0, used, 'human');
    pol.version++; pol.rv++; rebuildBase(); draw(); renderList(); updateStats();
  }
  function renameState(s) {
    const pol = state.pol, used = usedNames(), rand = FM.mulberry32(FM.hashString(state.seed + '|n|' + s.id + '|' + s.race));
    used.delete(s.name); used.delete(s.capName);
    s.name = FM.stateName(rand, used, s.race); s.capName = FM.cityName(rand, used, s.race);
    for (const c of pol.cities) if (c.stateId === s.id && !c.manual) c.name = FM.cityName(rand, used, s.race);
    pol.version++; pol.rv++; rebuildBase(); draw(); renderList(); updateStats();
  }

  function refreshLegend() {
    const win = $('legendWin'); if (!win || !win.classList.contains('on') || !state.map) return;
    const body = $('legendBody'); body.innerHTML = '';
    body.appendChild(FM.legendCanvas(state.map, { theme: state.theme, political: state.pol, layers: state.layers, seabed: state.view === 'seabed' }));
  }
  function rebuildBase() {
    const t0 = performance.now();
    state.base = FM.renderMap(state.map, { S, theme: state.theme, layers: state.layers, political: state.pol, seabed: state.view === 'seabed', tideF: tideNow() });
    state.heightImg = null; state.zoomImg = null;
    state.renderMs = performance.now() - t0;
    if (cv.width !== state.base.width) { cv.width = state.base.width; cv.height = state.base.height; }
    if (state.cam.z > 1) scheduleZoom(0);
    refreshLegend();
    catPanelSync();
  }

  // переход «карта ↔ дно»: пересборка основы и плавное проявление (суша темнеет, дно проступает)
  function switchSeabed() {
    document.body.classList.toggle('plates-view', false); document.body.classList.toggle('states-view', false); document.body.classList.toggle('cities-view', false); document.body.classList.toggle('cat-view', false);
    cv.style.cursor = 'default'; showCityEd();
    const prev = document.createElement('canvas'); prev.width = cv.width; prev.height = cv.height; prev.getContext('2d').drawImage(cv, 0, 0);
    busy(true);
    setTimeout(() => {
      rebuildBase(); busy(false);
      const t0 = performance.now(), D = 520;
      const step = (now) => {
        const t = Math.min(1, (now - t0) / D); draw();
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1 - t * t * (3 - 2 * t); ctx.drawImage(prev, 0, 0); ctx.globalAlpha = 1;
        if (t < 1) requestAnimationFrame(step); else draw();
      };
      requestAnimationFrame(step);
    }, 20);
  }

  // ---------- масштаб и панорама ----------
  // cam: z — масштаб, (x, y) — левый верхний угол видимой области в мировых (опорных) пикселях.
  // Канвас всегда одного размера; при z>1 карта перерисовывается в нужном масштабе только для видимой области.
  const ZMAX = 10;
  let zoomTimer = 0;
  function clampCam() {
    const c = state.cam, ww = cv.width / c.z, hh = cv.height / c.z;
    c.x = Math.max(0, Math.min(cv.width - ww, c.x)); c.y = Math.max(0, Math.min(cv.height - hh, c.y));
    if (c.z <= 1) { c.z = 1; c.x = 0; c.y = 0; }
  }
  function scheduleZoom(delay) {
    clearTimeout(zoomTimer);
    if (state.cam.z <= 1) { state.zoomImg = null; return; }
    zoomTimer = setTimeout(() => {
      if (!state.map) return;
      const c = state.cam, t0 = performance.now();
      c.x = Math.round(c.x * c.z) / c.z; c.y = Math.round(c.y * c.z) / c.z;   // привязка к целым экранным пикселям
      const img = FM.renderMap(state.map, { theme: state.theme, layers: state.layers, political: state.pol, seabed: state.view === 'seabed', tideF: tideNow(), zoom: c.z,
        view: { x: Math.round(c.x * c.z), y: Math.round(c.y * c.z), w: cv.width, h: cv.height } });
      img.cam = { z: c.z, x: Math.round(c.x * c.z) / c.z, y: Math.round(c.y * c.z) / c.z };
      state.zoomImg = img; state.zoomMs = performance.now() - t0; draw();
    }, delay);
  }
  function setZoom(z, ax, ay) {          // ax, ay — мировая точка, которая остаётся под курсором
    const c = state.cam; z = Math.max(1, Math.min(ZMAX, z));
    if (ax === undefined) { ax = c.x + cv.width / c.z / 2; ay = c.y + cv.height / c.z / 2; }
    const fx = (ax - c.x) * c.z, fy = (ay - c.y) * c.z;        // экранная позиция точки
    c.z = z; c.x = ax - fx / z; c.y = ay - fy / z; clampCam();
    updateZoomUi(); draw(); scheduleZoom(140);
  }
  // ---------- полосы прокрутки и миникарта мира (видны при приближении) ----------
  function updateMapBars() {
    const c = state.cam, on = c.z > 1.001, hb = $('mapSbH'), vb = $('mapSbV'), mini = $('mapMini');
    for (const el of [hb, vb, mini]) el.style.display = on ? 'block' : 'none';
    if (!on || !state.base) return;
    const st = $('stage').getBoundingClientRect(), r = cv.getBoundingClientRect();
    hb.style.left = (r.left - st.left + 8) + 'px'; hb.style.width = (r.width - 30) + 'px'; hb.style.top = (r.bottom - st.top - 19) + 'px';
    vb.style.top = (r.top - st.top + 8) + 'px'; vb.style.height = (r.height - 30) + 'px'; vb.style.left = (r.right - st.left - 19) + 'px';
    mini.style.left = (r.right - st.left - 168 - 30) + 'px'; mini.style.top = (r.top - st.top + 12) + 'px';
    const th = hb.firstElementChild, tv = vb.firstElementChild;
    th.style.left = (c.x / cv.width * 100) + '%'; th.style.width = (100 / c.z) + '%';
    tv.style.top = (c.y / cv.height * 100) + '%'; tv.style.height = (100 / c.z) + '%';
    const mc = mini.getContext('2d'); mc.clearRect(0, 0, mini.width, mini.height); mc.drawImage(state.base, 0, 0, mini.width, mini.height);
    mc.strokeStyle = '#b3261e'; mc.lineWidth = 2; mc.strokeRect(c.x / cv.width * mini.width, c.y / cv.height * mini.height, mini.width / c.z, mini.height / c.z);
  }
  function mapPan(dx, dy) { const c = state.cam; c.x += dx / c.z; c.y += dy / c.z; clampCam(); draw(); scheduleZoom(140); }
  function mapSbDrag(id, axis) {
    const bar = $(id), thumb = bar.firstElementChild;
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); const r = bar.getBoundingClientRect(), size = axis === 'x' ? cv.width : cv.height, len = axis === 'x' ? r.width : r.height, c = state.cam;
      const pos = (ev) => (axis === 'x' ? ev.clientX - r.left : ev.clientY - r.top) / len * size;
      const grab = e.target === thumb ? pos(e) - c[axis] : size / c.z / 2;
      const move = (ev) => { c[axis] = pos(ev) - grab; clampCam(); draw(); scheduleZoom(140); };
      move(e); bar.setPointerCapture(e.pointerId); bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', move), { once: true });
    });
  }
  mapSbDrag('mapSbH', 'x'); mapSbDrag('mapSbV', 'y');
  $('mapMini').addEventListener('pointerdown', (e) => {
    const mini = $('mapMini'), go = (ev) => { const r = mini.getBoundingClientRect(), c = state.cam; c.x = (ev.clientX - r.left) / r.width * cv.width - cv.width / c.z / 2; c.y = (ev.clientY - r.top) / r.height * cv.height - cv.height / c.z / 2; clampCam(); draw(); scheduleZoom(140); };
    e.preventDefault(); e.stopPropagation(); go(e); mini.setPointerCapture(e.pointerId); mini.onpointermove = go; mini.onpointerup = () => { mini.onpointermove = null; mini.onpointerup = null; };
  });
  window.addEventListener('resize', updateMapBars);
  function updateZoomUi() { const e = $('zoomVal'); if (e) e.textContent = Math.round(state.cam.z * 100) + '%'; }

  // число отдельных массивов суши (4-связных, ≥3% всей суши) — то же определение, по которому генератор подбирает раскладку плит под заданное число материков
  function countMassifs(m) {
    const W = m.W, H = m.H, N = W * H, h = m.h, lab = new Uint8Array(N), st = new Int32Array(N); let landN = 0; const sz = [];
    for (let i = 0; i < N; i++) if (h[i] > 0) landN++;
    for (let s0 = 0; s0 < N; s0++) {
      if (lab[s0] || h[s0] <= 0) continue; let sp = 0, n = 0; st[sp++] = s0; lab[s0] = 1;
      while (sp) { const i = st[--sp]; n++; const x = i % W; if (x > 0 && !lab[i - 1] && h[i - 1] > 0) { lab[i - 1] = 1; st[sp++] = i - 1; } if (x < W - 1 && !lab[i + 1] && h[i + 1] > 0) { lab[i + 1] = 1; st[sp++] = i + 1; } if (i >= W && !lab[i - W] && h[i - W] > 0) { lab[i - W] = 1; st[sp++] = i - W; } if (i < N - W && !lab[i + W] && h[i + W] > 0) { lab[i + W] = 1; st[sp++] = i + W; } }
      sz.push(n);
    }
    return sz.filter(n => n >= 0.03 * landN).length;
  }

  function updateStats() {
    const m = state.map; if (!m) return;
    if (m._massifs == null) m._massifs = countMassifs(m);
    const want = state.continents > 0 ? FM.T(' (задано {0})', state.continents) : '';
    $('stats').textContent =
      FM.T('Суша: {0}%   Материков: {1}{2}   Плит: {3}   Государств: {4}', (m.landFraction * 100).toFixed(1), m._massifs, want, m.plates.length, state.pol.states.length) + '\n' +
      FM.T('Городов: {0}   Дорог: {1}', state.pol.cities.length + state.pol.states.length, state.pol.roads.length) + '\n' + FM.T('Генерация: {0} мс   Отрисовка: {1} мс', m.genMs.toFixed(0), state.renderMs.toFixed(0));
  }

  function ui() {
    return {
      tool: state.tool, activeId: state.activeId, radius: state.brushR,
      draft: state.draft, draftPath: state.draftSegs.flat(), previewPath: state.previewPath, brushPos: state.brushPos,
      showRes: state.showRes, selCity: state.selCity, roadDraft: state.roadDraft, roadPath: state.roadSegs.flat(), roadPreview: state.roadPreview
    };
  }

  function draw() {
    if (!state.base) return;
    const c = state.cam, zi = state.zoomImg;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (state.view !== 'height' && c.z > 1 && zi && zi.cam.z === c.z && Math.abs(zi.cam.x - c.x) < 1e-6 && Math.abs(zi.cam.y - c.y) < 1e-6) {
      ctx.drawImage(zi, 0, 0);                    // чёткая перерисовка в текущем масштабе
      ctx.setTransform(c.z, 0, 0, c.z, -c.x * c.z, -c.y * c.z);
    } else {
      ctx.setTransform(c.z, 0, 0, c.z, -c.x * c.z, -c.y * c.z);   // временно растягиваем готовую картинку
      if (state.view === 'height') {
        if (!state.heightImg) state.heightImg = FM.renderHeight(state.map, S);
        ctx.drawImage(state.heightImg, 0, 0);
      } else ctx.drawImage(state.base, 0, 0);
    }
    if (state.view !== 'height') {
      if (state.view === 'plates') FM.drawOverlay(ctx, state.map, state.plates, S, plateDrag ? plateDrag.i : -1);
      if (state.view === 'states') FM.drawPoliticsOverlay(ctx, state.map, state.pol, S, ui());
      if (state.view === 'cities') FM.drawCitiesOverlay(ctx, state.map, state.pol, S, ui());
      if (state.view === 'land') drawLandOverlay(ctx, S);
      if (state.view === 'cat' && catDrag) { ctx.save(); ctx.strokeStyle = '#ff7a2f'; ctx.fillStyle = '#ff7a2f'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(catDrag.x1 * S, catDrag.y1 * S); ctx.lineTo(catDrag.x2 * S, catDrag.y2 * S); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(catDrag.x1 * S, catDrag.y1 * S, 4, 0, 7); ctx.fill(); ctx.restore(); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    updateMapBars();
  }

  // ---------- интерактив ----------
  function pointer(e) {
    const r = cv.getBoundingClientRect();
    const c = state.cam;
    return { x: c.x + (e.clientX - r.left) * cv.width / r.width / c.z, y: c.y + (e.clientY - r.top) * cv.height / r.height / c.z };
  }
  const cellOf = (p) => ({ x: p.x / S, y: p.y / S });

  // --- плиты ---
  let plateDrag = null;
  function plateHit(p) {
    const hs = FM.plateHandles(state.plates, S), R = 15;
    for (let i = hs.length - 1; i >= 0; i--) if (Math.hypot(p.x - hs[i].cx, p.y - hs[i].cy) < R) return { i, part: 'center' };
    return null;
  }

  // --- государства ---
  let capDrag = null, painting = false, previewBusy = false;
  function capitalHit(p) {
    for (let i = state.pol.states.length - 1; i >= 0; i--) {
      const s = state.pol.states[i];
      if (Math.hypot(p.x - s.capital.x * S, p.y - s.capital.y * S) < 14) return s;
    }
    return null;
  }
  function waypointCell(p) {
    const c = cellOf(p), m = state.map;
    let i = FM.snapLand(m, c.x, c.y, 12);
    if (i < 0) i = Math.max(0, Math.min(m.H - 1, Math.round(c.y))) * m.W + Math.max(0, Math.min(m.W - 1, Math.round(c.x)));
    return i;
  }
  function addState(x, y, name, power) {
    const used = new Set(state.pol.states.map(s => s.name));
    const st = {
      id: nextId(), race: FM.raceAt(state.map, x, y, Math.random), name: '',
      capital: { x: Math.round(x), y: Math.round(y) }, power: power || 1, culture: 'realistic'
    };
    st.name = name || FM.stateName(Math.random, used, st.race);
    st.type = FM.assignStateTypes(state.map, [st])[0]; st.culture = (FM.STATE_TYPES[st.type] || {}).culture || 'realistic';
    state.pol.states.push(st); state.activeId = st.id; ensureCapNames(); return st;
  }
  function finishBorder() {
    const d = state.draft.filter((c, i) => i === 0 || c !== state.draft[i - 1]);
    if (d.length >= 2) {
      const path = state.draftSegs.flat();
      state.pol.barriers.push({ pts: d, stick: state.stick, path });
    }
    state.draft = []; state.draftSegs = []; state.previewPath = null;
    politicsChanged();
  }
  function paint(p, erase) {
    const m = state.map, c = cellOf(p), R = state.brushR, pol = state.pol;
    for (let y = Math.max(0, Math.floor(c.y - R)); y <= Math.min(m.H - 1, Math.ceil(c.y + R)); y++)
      for (let x = Math.max(0, Math.floor(c.x - R)); x <= Math.min(m.W - 1, Math.ceil(c.x + R)); x++) {
        if ((x - c.x) ** 2 + (y - c.y) ** 2 > R * R) continue;
        const i = y * m.W + x; if (m.h[i] <= 0) continue;
        if (erase) pol.overrides[i] = 0; else { pol.overrides[i] = state.activeId; pol.owner[i] = state.activeId; }
      }
    pol.version++;
  }

  // --- навигация: колесо — масштаб; средняя кнопка, пробел+ЛКМ или ЛКМ в виде «Карта» — перетаскивание ---
  let spaceDown = false, pan = null;
  window.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test((e.target.tagName || ''))) return;
    if (e.code === 'Space') { spaceDown = true; e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') setZoom(state.cam.z * 1.5);
    else if (e.key === '-' || e.key === '_') setZoom(state.cam.z / 1.5);
    else if (e.key === '0') setZoom(1);
    else if (state.cam.z > 1 && !document.getElementById('cityModal').classList.contains('on') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', 'A', 'D', 'W', 'S'].includes(e.key)) {
      const k = e.key; mapPan(/Left|^[aA]$/.test(k) ? -90 : /Right|^[dD]$/.test(k) ? 90 : 0, /Up|^[wW]$/.test(k) ? -90 : /Down|^[sS]$/.test(k) ? 90 : 0); e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pointer(e); setZoom(state.cam.z * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });
  cv.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || (e.button === 0 && (spaceDown || (state.view === 'map' && state.cam.z > 1)))) {
      e.stopImmediatePropagation(); e.preventDefault();
      pan = { sx: e.clientX, sy: e.clientY, cx: state.cam.x, cy: state.cam.y }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing';
    }
  }, true);
  cv.addEventListener('pointermove', (e) => {
    if (!pan) return;
    e.stopImmediatePropagation();
    const r = cv.getBoundingClientRect(), c = state.cam;
    c.x = pan.cx - (e.clientX - pan.sx) * cv.width / r.width / c.z; c.y = pan.cy - (e.clientY - pan.sy) * cv.height / r.height / c.z;
    clampCam(); draw(); scheduleZoom(140);
  }, true);
  cv.addEventListener('pointerup', (e) => {
    if (!pan) return;
    e.stopImmediatePropagation(); pan = null; cv.releasePointerCapture(e.pointerId); cv.style.cursor = state.view === 'map' ? 'default' : 'crosshair';
  }, true);

  cv.addEventListener('pointerdown', (e) => {
    const p = pointer(e);
    if (state.view === 'plates') {
      const h = plateHit(p); if (!h) return;
      plateDrag = h; cv.setPointerCapture(e.pointerId); draw();
    } else if (state.view === 'cities' && e.button === 0) {
      if (state.ctool === 'city') {
        const hit = cityHit(p);
        if (hit) { state.selCity = hit.key; cityDrag = hit; cv.setPointerCapture(e.pointerId); showCityEd(); draw(); }
        else {
          const i = FM.snapLand(state.map, p.x / S, p.y / S, 3); if (i < 0) return;
          const c = { id: state.pol.cities.reduce((m, q) => Math.max(m, q.id), 0) + 1, name: FM.cityName(Math.random, usedNames(), raceOfCell(i)), x: i % state.map.W, y: (i / state.map.W) | 0, type: 'village', rank: 9, stateId: 0, manual: true };
          c.stateId = state.pol.owner[i] || 0;
          state.pol.cities.push(c); state.selCity = 'c' + c.id; showCityEd(); citiesChanged();
        }
      } else {
        const i = waypointCell(p);
        if (state.roadDraft.length) state.roadSegs.push(FM.routeRoad(state.map, state.pol, state.roadDraft[state.roadDraft.length - 1], i));
        state.roadDraft.push(i); state.roadPreview = null; draw();
      }
    } else if (state.view === 'states' && e.button === 0) {
      if (state.tool === 'view') {
        const c = cellOf(p), cx = Math.round(c.x), cy = Math.round(c.y), o = (cx >= 0 && cy >= 0 && cx < state.map.W && cy < state.map.H) ? state.pol.owner[cy * state.map.W + cx] : 0, hit = capitalHit(p);
        const id = hit ? hit.id : o;
        if (id) { state.activeId = id; renderList(); showStateCard(); draw(); }
      } else if (state.tool === 'capital') {
        const hit = capitalHit(p);
        if (hit) { capDrag = hit; state.activeId = hit.id; cv.setPointerCapture(e.pointerId); renderList(); draw(); }
        else {
          const i = FM.snapLand(state.map, p.x / S, p.y / S, 3);
          if (i < 0) return;
          addState(i % state.map.W, (i / state.map.W) | 0); politicsChanged();
        }
      } else if (state.tool === 'border') {
        const i = waypointCell(p);
        if (state.draft.length) state.draftSegs.push(FM.route(state.map, state.draft[state.draft.length - 1], i, state.stick));
        state.draft.push(i); state.previewPath = null; draw();
      } else if (state.tool === 'brush') {
        if (!state.activeId) return;
        painting = true; cv.setPointerCapture(e.pointerId); paint(p, e.shiftKey); draw();
      }
    }
  });

  cv.addEventListener('pointermove', (e) => {
    const p = pointer(e);
    if (state.view === 'plates') {
      if (!plateDrag) { cv.style.cursor = plateHit(p) ? 'grab' : 'default'; return; }
      const pl = state.plates[plateDrag.i];
      pl.x = Math.max(4, Math.min(state.map.W - 4, p.x / S));
      pl.y = Math.max(4, Math.min(state.map.H - 4, p.y / S));
      draw();
    } else if (state.view === 'cities') {
      if (state.ctool === 'city') {
        if (cityDrag) {
          const i = FM.snapLand(state.map, p.x / S, p.y / S, 4);
          if (i >= 0) setCityPos(cityDrag.key, i % state.map.W, (i / state.map.W) | 0);
          draw();
        } else cv.style.cursor = cityHit(p) ? 'grab' : 'crosshair';
      } else {
        cv.style.cursor = 'crosshair'; state.brushPos = p;
        if (state.roadDraft.length && !previewBusy) {
          previewBusy = true;
          requestAnimationFrame(() => {
            if (state.roadDraft.length) state.roadPreview = FM.routeRoad(state.map, state.pol, state.roadDraft[state.roadDraft.length - 1], waypointCell(state.brushPos));
            previewBusy = false; draw();
          });
        }
      }
    } else if (state.view === 'states') {
      state.brushPos = p;
      if (state.tool === 'capital') {
        if (capDrag) {
          const i = FM.snapLand(state.map, p.x / S, p.y / S, 4);
          if (i >= 0) capDrag.capital = { x: i % state.map.W, y: (i / state.map.W) | 0 };
        } else cv.style.cursor = capitalHit(p) ? 'grab' : 'crosshair';
        draw();
      } else if (state.tool === 'border') {
        cv.style.cursor = 'crosshair';
        if (state.draft.length && !previewBusy) {
          previewBusy = true;
          requestAnimationFrame(() => {
            if (state.draft.length) state.previewPath = FM.route(state.map, state.draft[state.draft.length - 1], waypointCell(state.brushPos), state.stick);
            previewBusy = false; draw();
          });
        }
      } else if (state.tool === 'brush') {
        cv.style.cursor = 'none';
        if (painting) paint(p, e.shiftKey);
        draw();
      }
    }
  });

  cv.addEventListener('pointerup', (e) => {
    if (plateDrag) {
      plateDrag = null; cv.releasePointerCapture(e.pointerId);
      regenerate({ keepPlates: true });
    } else if (cityDrag) {
      const wasCap = cityDrag.capital; cityDrag = null; cv.releasePointerCapture(e.pointerId);
      if (wasCap) politicsChanged(); else citiesChanged();
    } else if (capDrag) {
      capDrag = null; cv.releasePointerCapture(e.pointerId); politicsChanged();
    } else if (painting) {
      painting = false; cv.releasePointerCapture(e.pointerId); politicsChanged();
    }
  });

  // --- катастрофы после генерации: клик по карте (раскол — протягиванием) добавляет событие и пересчитывает карту ---
  let catDrag = null;
  const CAT_HELP = {
    get meteor() { return FM.T('Клик по суше — падение метеорита: кратер с валом, у больших — горка в центре; часть кратеров с озером. Размер — ползунком.'); },
    get rift() { return FM.T('Протяните от точки на суше в нужную сторону. От берега — длинный залив (очень длинный — сквозной пролив), из глубины суши — рифтовая долина с цепью озёр. Длина — по протяжке.'); },
    get canyon() { return FM.T('Клик на высоком месте — каньон потечёт вниз по склону к морю; реки пойдут по его дну.'); },
    get caldera() { return FM.T('Клик рядом с вулканом — он взрывается: круглая котловина (часто с озером), вулкан гаснет. Вдали от вулканов — просто кальдера в точке клика.'); },
    get subsidence() { return FM.T('Клик по суше у берега — овальный провал: круглый залив или внутреннее море. Размер — ползунком.'); }
  };
  const CAT_RU = { get meteor() { return FM.T('метеорит'); }, get rift() { return FM.T('раскол'); }, get canyon() { return FM.T('каньон'); }, get caldera() { return FM.T('кальдера'); }, get subsidence() { return FM.T('провал'); } };
  function catPanelSync() {
    [...$('catToolSeg').children].forEach(x => x.classList.toggle('on', x.dataset.ct === state.catTool));
    $('catHelp').textContent = CAT_HELP[state.catTool]; $('catSizeV').textContent = state.catSize;
    { const fixed = state.catTool === 'rift' || state.catTool === 'canyon'; $('catSize').disabled = fixed; $('catSize').style.opacity = fixed ? 0.4 : 1; $('catSize').title = fixed ? FM.T('Для этого вида размер не задаётся: длина раскола — по протяжке, каньон идёт вниз по склону.') : ''; }
    const n = (state.catManual || []).length;
    $('catList').textContent = n ? FM.T('Добавлено вручную: {0} ({1})', n, state.catManual.map(m => CAT_RU[m.kind]).join(', ')) : FM.T('Вручную ничего не добавлено.');
    $('catUndo').disabled = !n; $('catClear').disabled = !n;
  }
  function catApply(m) {
    state.catManual.push(m); const idx = state.catManual.length - 1; $('catMsg').textContent = '';
    regenerate({ keepPlates: true, done: (map) => {
      if (!(map.catastrophes || []).some(e => e.m === idx)) { state.catManual.pop(); $('catMsg').textContent = FM.T('Здесь не получилось: {0} требует подходящего места (суша{1}).', CAT_RU[m.kind], m.kind === 'subsidence' ? FM.T(', ближе к берегу') : m.kind === 'canyon' ? FM.T(', кликните выше по склону и дальше от берега: каньону нужен спуск к морю') : ''); }
      catPanelSync();
    } });
  }
  cv.addEventListener('pointerdown', (e) => {
    if (state.view !== 'cat' || e.button !== 0 || e.defaultPrevented || pan) return;
    const c = cellOf(pointer(e)); catDrag = { x1: c.x, y1: c.y, x2: c.x, y2: c.y }; cv.setPointerCapture(e.pointerId); draw();
  });
  cv.addEventListener('pointermove', (e) => { if (!catDrag) return; const c = cellOf(pointer(e)); catDrag.x2 = c.x; catDrag.y2 = c.y; if (state.catTool === 'rift') draw(); });
  cv.addEventListener('pointerup', (e) => {
    if (!catDrag) return; const d = catDrag; catDrag = null; try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* ok */ } draw();
    const m = { kind: state.catTool, x: Math.round(d.x1), y: Math.round(d.y1), size: state.catSize / 100 };
    if (state.catTool === 'rift') { if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 4) { $('catMsg').textContent = FM.T('Раскол: протяните линию от точки в нужную сторону.'); return; } m.x2 = Math.round(d.x2); m.y2 = Math.round(d.y2); }
    catApply(m);
  });
  // ---------- правка суши (вид «Суша») ----------
  let landDrag = null, landHover = null;
  const landMode = () => (state.landShift ? (state.landTool === 'add' ? 'del' : 'add') : state.landTool);   // Shift — обратное действие
  const landR = () => state.map.W * (0.005 + 0.0007 * state.landSize);   // радиус кисти в клетках
  function drawLandOverlay(ctx, S) {
    if (!state.map) return; const add = (landDrag ? landDrag.mode : landMode()) === 'add', col = add ? '60,170,90' : '210,80,60', r = landR() * S;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const e of state.landPending) {
      const c2 = e.mode === 'add' ? '60,170,90' : '210,80,60'; ctx.strokeStyle = `rgba(${c2},0.28)`; ctx.lineWidth = 2 * e.r * S * 0.85; ctx.beginPath(); e.pts.forEach((p, i) => i ? ctx.lineTo(p[0] * S, p[1] * S) : ctx.moveTo(p[0] * S, p[1] * S)); if (e.pts.length === 1) ctx.lineTo(e.pts[0][0] * S + 0.01, e.pts[0][1] * S); ctx.stroke();
      ctx.strokeStyle = `rgba(${c2},0.95)`; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath(); e.pts.forEach((p, i) => i ? ctx.lineTo(p[0] * S, p[1] * S) : ctx.moveTo(p[0] * S, p[1] * S)); ctx.stroke(); ctx.setLineDash([]);
    }
    if (landDrag && landDrag.pts.length) {
      ctx.strokeStyle = `rgba(${col},0.22)`; ctx.lineWidth = 2 * r * 0.85; ctx.beginPath(); landDrag.pts.forEach((p, i) => i ? ctx.lineTo(p[0] * S, p[1] * S) : ctx.moveTo(p[0] * S, p[1] * S)); if (landDrag.pts.length === 1) ctx.lineTo(landDrag.pts[0][0] * S + 0.01, landDrag.pts[0][1] * S); ctx.stroke();
      ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath(); landDrag.pts.forEach((p, i) => i ? ctx.lineTo(p[0] * S, p[1] * S) : ctx.moveTo(p[0] * S, p[1] * S)); ctx.stroke(); ctx.setLineDash([]);
    }
    const hp = landDrag ? landDrag.pts[landDrag.pts.length - 1] : landHover;
    if (hp) { ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hp[0] * S, hp[1] * S, r, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
  function landPanelSync() {
    [...$('landToolSeg').children].forEach(x => x.classList.toggle('on', x.dataset.lt === state.landTool));
    const rw = state.landRough < 34 ? 'плавный' : state.landRough < 67 ? 'умеренный' : 'рваный';
    $('landSize').value = state.landSize; $('landSizeV').textContent = state.map ? FM.T('радиус {0} кл.', Math.round(landR())) : state.landSize;
    $('landRough').value = state.landRough; $('landRoughV').textContent = FM.T(rw);
    const n = (state.landEdits || []).length, q = state.landPending.length, box = $('landList');
    box.classList.toggle('on', q > 0);
    box.textContent = q ? FM.T('Мазков в очереди: {0}. Нажмите «Применить», чтобы пересчитать карту.', q) + (n ? ' ' + FM.T('Уже применено: {0}', n) : '') : n ? FM.T('Применено мазков: {0}', n) : FM.T('Нарисуйте мазок: он появится как цветной след, карта пока не изменится.');
    $('landApply').textContent = FM.T('Применить') + (q ? ' (' + q + ')' : '');
    $('landUndo').disabled = !n && !q; $('landClear').disabled = !n && !q; $('landApply').disabled = !q; $('landReset').disabled = !q;
  }
  function landPush(pts, mode) {   // мазок попадает в очередь; карта не пересчитывается до «Применить»
    const R = landR();
    const out = [pts[0]]; for (let k = 1; k < pts.length; k++) { const q = out[out.length - 1]; if (Math.hypot(pts[k][0] - q[0], pts[k][1] - q[1]) >= R * 0.25) out.push(pts[k]); }   // прореживание пути
    if (out.length > 1 && (out[out.length - 1] !== pts[pts.length - 1])) out.push(pts[pts.length - 1]);
    state.landPending.push({ mode: mode || landMode(), pts: out.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), r: Math.round(R * 10) / 10, rough: state.landRough / 100 });
    landPanelSync(); draw();
  }
  // Применить очередь: пересчитывается только зона правки (FM.patchMap), остальные поля, государства, города и дороги вне неё остаются прежними
  async function landCommit() {
    if (!state.landPending.length || !state.map) return;
    const edits = state.landPending.map(e => Object.assign({}, e, { local: true, b: state.landEdits.reduce((m, q) => Math.max(m, q.b || 0), 0) + 1 })), base = state.landEdits.length;
    await genUi.showPatch();
    const snap = { map: state.map, pol: state.pol ? clonePol(state.pol) : null, edits: state.landEdits.slice() };
    let res = null; try { res = FM.patchMap(state.map, edits, base); } catch (e) { genUi.hide(); throw e; }
    if (!res) {   // у карты нет сохранённого состояния — полный пересчёт, правки применятся внутри генерации
      state.landEdits.push(...edits.map(e => Object.assign({}, e, { local: false }))); state.landPending = [];
      genUi.hide(); regenerate({ keepPlates: true, done: landPanelSync }); return;
    }
    state.landEdits.push(...edits); state.landPending = [];
    state.landUndo.push(snap); if (state.landUndo.length > 3) state.landUndo.shift();
    if (!res.same) { state.map = res.map; state.landRegion = res.region; patchPol(res); }
    state.draft = []; state.draftSegs = []; state.previewPath = null;
    rebuildBase(); draw(); renderList(); updateStats(); landPanelSync();
    genUi.hide();
  }
  // копия политики для отмены (кэши с ключами «_…» — холсты — не копируются)
  function clonePol(pol) {
    const o = {};
    for (const k of Object.keys(pol)) { if (k[0] === '_') continue; const v = pol[k]; o[k] = ArrayBuffer.isView(v) ? v.slice() : Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v; }
    return o;
  }
  // государства, города, дороги и границы: вне зоны правки не трогаем; внутри — подгоняем к новой суше
  function patchPol(res) {
    const pol = state.pol, map = state.map, W = map.W, R = res.region; if (!pol) return;
    const inR = (i) => R[i] === 1, touches = (path) => !!path && path.some(inR);
    const hadAuto = pol.roads.some(r => !r.manual);
    pol.states = pol.states.filter(s => { const i = s.capital.y * W + s.capital.x; if (!inR(i)) return true; const j = FM.snapLand(map, s.capital.x, s.capital.y, 15); if (j < 0) return false; s.capital = { x: j % W, y: (j / W) | 0 }; return true; });
    pol.cities = pol.cities.filter(c => { const i = Math.round(c.y) * W + Math.round(c.x); if (!inR(i)) return true; const j = FM.snapLand(map, c.x, c.y, 10); if (j < 0) return false; c.x = j % W; c.y = (j / W) | 0; return true; });
    for (const b of pol.barriers) if (touches(b.path)) b.path = routeAll(b.pts, b.stick);
    const oldOwner = pol.owner; ensureCapNames();
    if (pol.states.length) { growNow(); for (let i = 0; i < oldOwner.length; i++) if (!R[i] && oldOwner[i] !== pol.owner[i]) pol.owner[i] = oldOwner[i]; for (const c of pol.cities) c.stateId = pol.owner[Math.round(c.y) * W + Math.round(c.x)] || 0; pol.version++; }
    for (const r of pol.roads) if (r.manual && touches(r.path)) r.path = routeAllRoad(r.pts);
    if (hadAuto) {
      const keep = pol.roads.filter(r => r.manual || !touches(r.path));
      const fresh = FM.buildRoads(map, Object.assign({}, pol, { roads: pol.roads.filter(r => r.manual) })).filter(r => touches(r.path));
      pol.roads = keep.concat(fresh);
    }
    pol.rv++;
  }
  window.addEventListener('keydown', (e) => {   // горячие клавиши вида «Суша»
    if (e.key === 'Shift' && !state.landShift) { state.landShift = true; if (state.view === 'land') draw(); }
    if (state.view !== 'land' || !state.map || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName || '') && e.target.type !== 'range') return;
    if (e.key === '[' || e.key === ']') { state.landSize = Math.max(1, Math.min(100, state.landSize + (e.key === ']' ? 4 : -4))); landPanelSync(); draw(); }
    else if (e.key === 'Enter') { landCommit(); }
    else if (e.key === 'Escape') { state.landPending = []; landPanelSync(); draw(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')) { e.preventDefault(); landUndoLast(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift' && state.landShift) { state.landShift = false; if (state.view === 'land') draw(); } });
  function landUndoLast() {
    if (state.landPending.length) { state.landPending.pop(); landPanelSync(); draw(); return; }
    if (!state.landEdits.length) return;
    const snap = state.landUndo.pop();
    if (snap) { const v = state.pol ? state.pol.version : 0, rv = state.pol ? state.pol.rv : 0; state.map = snap.map; state.pol = snap.pol; if (state.pol) { state.pol.version = v + 1; state.pol.rv = rv + 1; } state.landEdits = snap.edits; rebuildBase(); draw(); renderList(); updateStats(); landPanelSync(); return; }
    const b = state.landEdits.reduce((m, q) => Math.max(m, q.b || 0), 0); state.landEdits = state.landEdits.filter(q => !q.b || q.b !== b);   // снимка нет: полный пересчёт без последней пачки
    regenerate({ keepPlates: true, done: landPanelSync });
  }
  cv.addEventListener('pointerdown', (e) => {
    if (state.view !== 'land' || e.button !== 0 || e.defaultPrevented || pan || !state.map) return;
    const c = cellOf(pointer(e)); landDrag = { pts: [[c.x, c.y]], mode: landMode() }; cv.setPointerCapture(e.pointerId); draw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (state.view !== 'land' || !state.map) return; const c = cellOf(pointer(e));
    if (landDrag) { const q = landDrag.pts[landDrag.pts.length - 1]; if (Math.hypot(c.x - q[0], c.y - q[1]) >= Math.max(1, landR() * 0.12) && landDrag.pts.length < 600) landDrag.pts.push([c.x, c.y]); } else landHover = [c.x, c.y];
    draw();
  });
  cv.addEventListener('pointerup', (e) => {
    if (!landDrag) return; const d = landDrag; landDrag = null; try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* ok */ }
    landHover = null; landPush(d.pts, d.mode);
  });
  cv.addEventListener('pointerleave', () => { if (state.view === 'land') { landHover = null; draw(); } if (state.view === 'states') { state.brushPos = null; draw(); } });

  cv.addEventListener('dblclick', (e) => {
    if (state.view === 'cities' && state.ctool === 'city') { const hit = cityHit(pointer(e)); if (hit) { state.selCity = hit.key; showCityEd(); openCityMap(hit.key); } return; }
    if (state.view === 'cities' && state.ctool === 'road') { if (state.roadDraft.length) finishRoad(); return; }
    if (state.view === 'states' && state.tool === 'border') { if (state.draft.length) finishBorder(); return; }
    if (state.view !== 'plates') return;
    const h = plateHit(pointer(e)); if (!h) return;
    const pl = state.plates[h.i];
    pl.type = pl.type === 'continental' ? 'oceanic' : 'continental';
    regenerate({ keepPlates: true });
  });

  cv.addEventListener('contextmenu', (e) => {
    if (state.view === 'cities') {
      e.preventDefault();
      const p = pointer(e);
      if (state.ctool === 'city') {
        const hit = cityHit(p);
        if (hit && !hit.capital) { state.pol.cities = state.pol.cities.filter(c => 'c' + c.id !== hit.key); if (state.selCity === hit.key) state.selCity = null; showCityEd(); citiesChanged(); }
      } else {
        if (state.roadDraft.length) { state.roadDraft = []; state.roadSegs = []; state.roadPreview = null; draw(); return; }
        const c = cellOf(p), W = state.map.W;
        const idx = state.pol.roads.findIndex(r => r.path.some(i => Math.hypot((i % W) - c.x, ((i / W) | 0) - c.y) < 3));
        if (idx >= 0) { state.pol.roads.splice(idx, 1); citiesChanged(); }
      }
      return;
    }
    if (state.view !== 'states') return;
    e.preventDefault();
    const p = pointer(e);
    if (state.tool === 'capital') {
      const hit = capitalHit(p); if (hit) removeState(hit.id);
    } else if (state.tool === 'border') {
      if (state.draft.length) { state.draft = []; state.draftSegs = []; state.previewPath = null; draw(); return; }
      const c = cellOf(p), W = state.map.W;
      const idx = state.pol.barriers.findIndex(b => b.path.some(i => Math.hypot((i % W) - c.x, ((i / W) | 0) - c.y) < 3));
      if (idx >= 0) { state.pol.barriers.splice(idx, 1); politicsChanged(); }
    }
  });

  window.addEventListener('keydown', (e) => {
    if (state.view === 'cities' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      if (e.key === 'Enter' && state.roadDraft.length) finishRoad();
      else if (e.key === 'Escape') { state.roadDraft = []; state.roadSegs = []; state.roadPreview = null; draw(); }
      else if (e.key === 'Backspace' && state.roadDraft.length) { state.roadDraft.pop(); state.roadSegs.pop(); state.roadPreview = null; draw(); e.preventDefault(); }
      return;
    }
    if (state.view !== 'states' || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'Enter' && state.draft.length) finishBorder();
    else if (e.key === 'Escape') { state.draft = []; state.draftSegs = []; state.previewPath = null; draw(); }
    else if (e.key === 'Backspace' && state.draft.length) { state.draft.pop(); state.draftSegs.pop(); state.previewPath = null; draw(); e.preventDefault(); }
  });

  // ---------- города и дороги ----------
  let cityDrag = null;
  function cityHit(p) {
    const list = FM.allCities(state.pol);
    for (let i = list.length - 1; i >= 0; i--) if (Math.hypot(p.x - list[i].x * S, p.y - list[i].y * S) < 13) return list[i];
    return null;
  }
  function setCityPos(key, x, y) {
    if (key[0] === 's') { const st = state.pol.states.find(q => 's' + q.id === key); if (st) st.capital = { x, y }; }
    else { const c = state.pol.cities.find(q => 'c' + q.id === key); if (c) { c.x = x; c.y = y; c.manual = true; } }
  }
  function citiesChanged() {
    state.pol.rv++; rebuildBase(); draw(); updateStats(); showCityEd();
  }
  function finishRoad() {
    const pts = state.roadDraft.filter((c, i) => i === 0 || c !== state.roadDraft[i - 1]);
    if (pts.length >= 2) {
      let path = state.roadSegs.flat(); path = path.filter((c, i) => i === 0 || c !== path[i - 1]);
      state.pol.roads.push({ manual: true, pts, cls: +$('roadCls').value, path });
    }
    state.roadDraft = []; state.roadSegs = []; state.roadPreview = null; citiesChanged();
  }
  // сворачиваемые разделы панели (состояние хранится в localStorage)
  (function foldInit() {
    let st = {}; try { st = JSON.parse(localStorage.getItem('fms-fold') || '{}') || {}; } catch (e) {}
    document.querySelectorAll('#side section').forEach((s, i) => {
      const h = s.querySelector(':scope > .fold-h, :scope > .ptitle'); if (!h) return;
      h.classList.add('fold-h'); const key = s.id || ('s' + i); if (key in st) s.classList.toggle('closed', !!st[key]);
      h.addEventListener('click', () => { s.classList.toggle('closed'); st[key] = s.classList.contains('closed'); try { localStorage.setItem('fms-fold', JSON.stringify(st)); } catch (e) {} });
    });
  })();
  // ---------- карта города ----------
  const cm = { key: null, tool: 'house', rot: null, plan: null, cam: { z: 1, x: 0, y: 0 }, tilt: 0, labels: 0, timer: 0 };
  // ручные правки и вариант планировки города хранятся в localStorage по seed мира; запись привязана к имени и типу города
  const cdStore = () => 'fms-cities-' + state.seed;
  const cdSig = (key) => { const c = state.pol && FM.allCities(state.pol).find(q => q.key === key); return c ? c.name + '|' + c.type : ''; };
  function cityData(key) {
    if (!state.cityData || state.cityDataSeed !== state.seed) {
      state.cityData = {}; state.cityDataSeed = state.seed;
      try { state.cityData = JSON.parse(localStorage.getItem(cdStore()) || '{}') || {}; } catch (e) { state.cityData = {}; }
    }
    const d = state.cityData, sg = cdSig(key);
    if (!d[key] || (d[key].sig && d[key].sig !== sg)) d[key] = { variant: 0, custom: [], sig: sg };
    d[key].sig = sg; return d[key];
  }
  function cityDataSave() { try { localStorage.setItem(cdStore(), JSON.stringify(state.cityData || {})); } catch (e) {} }
  function cmClamp() { const c = cm.cam, W = FM.CITY_SIZE.W, H = FM.CITY_SIZE.H; if (c.z <= 1) { c.z = 1; c.x = 0; c.y = 0; return; } c.x = Math.max(0, Math.min(W - W / c.z, c.x)); c.y = Math.max(0, Math.min(H - H / c.z, c.y)); }
  function cmDraw() {
    if (!cm.plan) return;
    const img = FM.renderCity(cm.plan, { theme: state.theme, scale: 1, tilt: cm.tilt, labels: cm.labels === 1 ? true : cm.labels === 2 ? false : undefined, zoom: cm.cam.z, x: cm.cam.x, y: cm.cam.y });
    const cvc = $('cmCv'); if (cvc.width !== img.width) { cvc.width = img.width; cvc.height = img.height; }
    cvc.getContext('2d').drawImage(img, 0, 0);
    $('cmZoom').textContent = Math.round(cm.cam.z * 100) + '%';
    cmBars();
  }
  // полосы прокрутки и миникарта (видны только при приближении)
  function cmBars() {
    const c = cm.cam, W = FM.CITY_SIZE.W, H = FM.CITY_SIZE.H, on = c.z > 1.001;
    for (const id of ['cmSbH', 'cmSbV']) $(id).classList.toggle('on', on);
    const mini = $('cmMini'); mini.style.display = on ? 'block' : 'none';
    if (!on) return;
    const th = $('cmSbH').firstElementChild, tv = $('cmSbV').firstElementChild;
    th.style.left = (c.x / W * 100) + '%'; th.style.width = (100 / c.z) + '%';
    tv.style.top = (c.y / H * 100) + '%'; tv.style.height = (100 / c.z) + '%';
    if (!cm.miniImg || cm.miniKey !== cm.plan) {
      cm.miniKey = cm.plan; const m = FM.renderCity(cm.plan, { theme: state.theme, scale: 0.12, tilt: 0 }); cm.miniImg = m;
    }
    const mc = mini.getContext('2d'); mc.clearRect(0, 0, mini.width, mini.height); mc.drawImage(cm.miniImg, 0, 0, mini.width, mini.height);
    mc.strokeStyle = '#b3261e'; mc.lineWidth = 2; mc.strokeRect(c.x / W * mini.width, c.y / H * mini.height, mini.width / c.z, mini.height / c.z);
  }
  function cmPan(dx, dy) { cm.cam.x += dx / cm.cam.z; cm.cam.y += dy / cm.cam.z; cmClamp(); cmSchedule(); }
  function sbDrag(id, axis) {
    const bar = $(id), thumb = bar.firstElementChild;
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); const r = bar.getBoundingClientRect(), W = FM.CITY_SIZE[axis === 'x' ? 'W' : 'H'], len = axis === 'x' ? r.width : r.height;
      const pos = (ev) => (axis === 'x' ? ev.clientX - r.left : ev.clientY - r.top) / len * W;
      const t = thumb.getBoundingClientRect(), onThumb = e.target === thumb;
      const grab = onThumb ? pos(e) - cm.cam[axis] : W / cm.cam.z / 2;
      const move = (ev) => { cm.cam[axis] = pos(ev) - grab; cmClamp(); cmSchedule(); };
      move(e); bar.setPointerCapture(e.pointerId);
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
    });
  }
  sbDrag('cmSbH', 'x'); sbDrag('cmSbV', 'y');
  $('cmMini').addEventListener('pointerdown', (e) => {
    const mini = $('cmMini'), go = (ev) => { const r = mini.getBoundingClientRect(), W = FM.CITY_SIZE.W, H = FM.CITY_SIZE.H; cm.cam.x = (ev.clientX - r.left) / r.width * W - W / cm.cam.z / 2; cm.cam.y = (ev.clientY - r.top) / r.height * H - H / cm.cam.z / 2; cmClamp(); cmSchedule(); };
    e.preventDefault(); e.stopPropagation(); go(e); mini.setPointerCapture(e.pointerId); mini.onpointermove = go; mini.onpointerup = () => { mini.onpointermove = null; mini.onpointerup = null; };
  });
  function cmSchedule() { clearTimeout(cm.timer); cm.timer = setTimeout(cmDraw, 16); }
  function cityMapRender() {
    const c = FM.allCities(state.pol).find(q => q.key === cm.key); if (!c) return;
    const d = cityData(cm.key), t0 = performance.now();
    cm.plan = FM.cityPlan(state.map, state.pol, c, { variant: d.variant, custom: d.custom, resCfg: state.resCfg, seed: state.seed });
    cityDataSave(); cmClamp(); cmDraw();
    $('cmTitle').textContent = c.name + FM.T(' · вариант {0} · {1} мс', d.variant + 1, Math.round(performance.now() - t0));
  }
  function openCityMap(key) {
    cm.key = key; cm.rot = null; cm.cam = { z: 1, x: 0, y: 0 };
    const tools = $('cmTools'); tools.innerHTML = '';
    for (const [k, t] of Object.entries(FM.CITY_TEMPLATES)) {
      const b = document.createElement('button'); b.textContent = t.label; b.dataset.k = k; b.classList.toggle('on', k === cm.tool);
      b.onclick = () => { cm.tool = k; [...tools.children].forEach(x => x.classList.toggle('on', x === b)); };
      tools.appendChild(b);
    }
    $('cmTilt').classList.toggle('on', cm.tilt > 0);
    $('cityModal').classList.add('on'); cityMapRender();
  }
  function cmPoint(e) { const cvc = $('cmCv'), r = cvc.getBoundingClientRect(), z = cm.cam.z; return { x: cm.cam.x + (e.clientX - r.left) * cvc.width / r.width / z, y: cm.cam.y + (e.clientY - r.top) * cvc.height / r.height / z }; }
  function cmZoom(z1, p) {
    const c = cm.cam, z0 = c.z; z1 = Math.max(1, Math.min(8, z1));
    if (!p) p = { x: c.x + FM.CITY_SIZE.W / z0 / 2, y: c.y + FM.CITY_SIZE.H / z0 / 2 };
    c.x = p.x - (p.x - c.x) * z0 / z1; c.y = p.y - (p.y - c.y) * z0 / z1; c.z = z1; cmClamp(); cmSchedule();
  }
  $('cmClose').onclick = () => { $('cityModal').classList.remove('on'); cm.key = null; };
  $('cmNew').onclick = () => { cityData(cm.key).variant++; cityMapRender(); };
  $('cmClear').onclick = () => { cityData(cm.key).custom = []; cityMapRender(); };
  $('cmZin').onclick = () => cmZoom(cm.cam.z * 1.5);
  $('cmZout').onclick = () => cmZoom(cm.cam.z / 1.5);
  $('cmLeg').onclick = () => { const l = $('cmLegend'); l.hidden = !l.hidden; $('cmLeg').classList.toggle('on', !l.hidden); };
  $('cmFit').onclick = () => { cm.cam = { z: 1, x: 0, y: 0 }; cmDraw(); };
  $('cmLab').onclick = () => { cm.labels = (cm.labels + 1) % 3; $('cmLab').textContent = FM.T('Подписи: {0}', FM.T(['при зуме', 'всегда', 'нет'][cm.labels])); $('cmLab').classList.toggle('on', cm.labels === 1); cmDraw(); };
  $('cmTilt').onclick = () => { cm.tilt = cm.tilt > 0 ? 0 : 1; $('cmTilt').classList.toggle('on', cm.tilt > 0); cmDraw(); };
  $('cmExport').onclick = () => {
    const c = FM.allCities(state.pol).find(q => q.key === cm.key); if (!c) return;
    const img = FM.renderCity(cm.plan, { theme: state.theme, scale: 2, tilt: cm.tilt, labels: cm.labels !== 2 });
    img.toBlob(async (blob) => {
      const name = `city-${c.name}.png`;
      if (window.api && window.api.savePNG) await window.api.savePNG(await blob.arrayBuffer(), name);
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
    }, 'image/png');
  };
  function cmPlace(e) {
    if (!cm.plan) return; const p = cmPoint(e), d = cityData(cm.key);
    let ang = cm.rot;
    if (ang == null) {                                 // вдоль ближайшей улицы
      let best = 1e9; ang = 0;
      for (const s of cm.plan.streets) for (let i = 0; i < s.pts.length - 1; i++) {
        const a = s.pts[i], b = s.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2));
        const dd = Math.hypot(p.x - a[0] - dx * t, p.y - a[1] - dy * t); if (dd < best) { best = dd; ang = Math.atan2(dy, dx); }
      }
    }
    d.custom.push({ t: cm.tool, x: p.x, y: p.y, a: ang, k: e.shiftKey ? 1.5 : 1 }); cityMapRender();
  }
  // колесо — масштаб, перетаскивание — панорама, короткий клик — поставить объект
  let cmDown = null;
  $('cmCv').addEventListener('wheel', (e) => { e.preventDefault(); cmZoom(cm.cam.z * Math.exp(-e.deltaY * 0.0016), cmPoint(e)); }, { passive: false });
  $('cmCv').addEventListener('pointerdown', (e) => { if (e.button !== 0 && e.button !== 1) return; cmDown = { sx: e.clientX, sy: e.clientY, cx: cm.cam.x, cy: cm.cam.y, moved: false, btn: e.button }; $('cmCv').setPointerCapture(e.pointerId); });
  $('cmCv').addEventListener('pointermove', (e) => {
    if (!cmDown) return; const cvc = $('cmCv'), r = cvc.getBoundingClientRect(), dx = e.clientX - cmDown.sx, dy = e.clientY - cmDown.sy;
    if (!cmDown.moved && Math.hypot(dx, dy) < 5) return; cmDown.moved = true; if (cm.cam.z <= 1) return;
    cm.cam.x = cmDown.cx - dx * cvc.width / r.width / cm.cam.z; cm.cam.y = cmDown.cy - dy * cvc.height / r.height / cm.cam.z; cmClamp(); cmSchedule(); cvc.style.cursor = 'grabbing';
  });
  $('cmCv').addEventListener('pointerup', (e) => {
    if (!cmDown) return; const d = cmDown; cmDown = null; $('cmCv').style.cursor = 'crosshair';
    if (!d.moved && d.btn === 0) cmPlace(e);
  });
  $('cmCv').addEventListener('contextmenu', (e) => {
    e.preventDefault(); if (!cm.plan) return; const p = cmPoint(e), d = cityData(cm.key);
    let bi = -1, bd = 40; d.custom.forEach((c, i) => { const dd = Math.hypot(c.x - p.x, c.y - p.y); if (dd < bd) { bd = dd; bi = i; } });
    if (bi >= 0) { d.custom.splice(bi, 1); cityMapRender(); }
  });
  window.addEventListener('keydown', (e) => {
    if (!cm.key || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName || '')) return;
    if (e.key === 'Escape') $('cmClose').onclick();
    else if (e.key === '+' || e.key === '=') cmZoom(cm.cam.z * 1.5);
    else if (e.key === '-' || e.key === '_') cmZoom(cm.cam.z / 1.5);
    else if (e.key === '0') $('cmFit').onclick();
    else if (e.key === 'l' || e.key === 'L' || e.key === 'д' || e.key === 'Д') $('cmLeg').onclick();
    else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { cmPan(-120, 0); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { cmPan(120, 0); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { cmPan(0, -120); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { cmPan(0, 120); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') cm.rot = cm.rot == null ? 0 : (cm.rot > 3.5 ? null : cm.rot + Math.PI / 4);
  }, true);

  function showCityEd() {
    const box = $('cityEd'); if (!box) return;
    const c = state.selCity && FM.allCities(state.pol).find(q => q.key === state.selCity);
    box.classList.toggle('on', !!c && state.view === 'cities');
    if (!c) return;
    $('cityName').value = c.name; $('cityType').value = c.capital ? 'city' : c.type;
    $('cityType').disabled = !!c.capital; $('cityDel').disabled = !!c.capital;
  }
  const CHELP = {
    get city() { return FM.T('Клик по пустому месту — новая деревня (тип меняется справа). Тяните значок, чтобы перенести. ПКМ — удалить. Расставленные вручную города не пропадают при авто-расстановке.'); },
    get road() { return FM.T('Клики — точки пути, он сам обходит горы и реки (на переправах ставятся мосты). Двойной клик или Enter — готово, Backspace — шаг назад, Esc — отмена. ПКМ по дороге — удалить.'); }
  };
  function setCityTool(t) {
    state.ctool = t; state.roadDraft = []; state.roadSegs = []; state.roadPreview = null;
    [...$('ctoolSeg').children].forEach(x => x.classList.toggle('on', x.dataset.ct === t));
    $('cityHelp').textContent = CHELP[t]; $('roadOpts').style.display = t === 'road' ? 'flex' : 'none';
    cv.style.cursor = 'crosshair'; draw();
  }

  function removeState(id) {
    const pol = state.pol;
    pol.states = pol.states.filter(s => s.id !== id);
    for (let i = 0; i < pol.overrides.length; i++) if (pol.overrides[i] === id) pol.overrides[i] = 0;
    if (state.activeId === id) state.activeId = pol.states.length ? pol.states[0].id : 0;
    politicsChanged();
  }

  // ---------- список государств ----------
  function renderList() {
    setTimeout(showStateCard, 0);
    const box = $('stateList'); if (!box || !state.pol) return;
    box.innerHTML = '';
    for (const s of state.pol.states) {
      const row = document.createElement('div');
      row.className = 'srow' + (s.id === state.activeId ? ' active' : '');
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = FM.stateColor(s.id, 1);
      const name = document.createElement('input'); name.type = 'text'; name.value = s.name;
      name.addEventListener('change', () => { s.name = name.value.trim() || s.name; state.pol.version++; rebuildBase(); draw(); });
      name.addEventListener('click', (e) => e.stopPropagation());
      const pw = document.createElement('input'); pw.type = 'range'; pw.min = 0.5; pw.max = 2; pw.step = 0.1; pw.value = s.power; pw.title = FM.T('Размер/мощность');
      pw.addEventListener('click', (e) => e.stopPropagation());
      pw.addEventListener('change', () => { s.power = +pw.value; politicsChanged(); });
      const del = document.createElement('button'); del.textContent = '×'; del.title = FM.T('Удалить');
      del.addEventListener('click', (e) => { e.stopPropagation(); removeState(s.id); });
      const cs = document.createElement('select'); cs.title = FM.T('Культура: влияет на выбор мест для городов');
      for (const [k, v] of Object.entries(FM.CULTURES)) { const o = document.createElement('option'); o.value = k; o.textContent = v.label; cs.appendChild(o); }
      cs.value = s.culture || 'realistic';
      cs.addEventListener('click', (e) => e.stopPropagation());
      cs.addEventListener('change', () => { s.culture = cs.value; });
      const rs = document.createElement('select'); rs.title = FM.T('Раса: определяет звучание названий государства и его городов');
      for (const [k, v] of Object.entries(FM.RACES)) { const o = document.createElement('option'); o.value = k; o.textContent = v.label; rs.appendChild(o); }
      rs.value = s.race || 'human';
      rs.addEventListener('click', (e) => e.stopPropagation());
      rs.addEventListener('change', () => { s.race = rs.value; renameState(s); });
      const ts = document.createElement('select'); ts.title = FM.T('Тип государства: размер, число городов, культура');
      for (const [k, v] of Object.entries(FM.STATE_TYPES)) { const o = document.createElement('option'); o.value = k; o.textContent = v.label; ts.appendChild(o); }
      ts.value = s.type || 'kingdom';
      ts.addEventListener('click', (e) => e.stopPropagation());
      ts.addEventListener('change', () => { s.type = ts.value; s.culture = FM.STATE_TYPES[s.type].culture; politicsChanged(); });
      row.append(sw, name, del, ts, rs, cs, pw);
      row.addEventListener('click', () => { state.activeId = s.id; renderList(); showStateCard(); draw(); });
      box.appendChild(row);
    }
  }

  const HELP = {
    get view() { return FM.T('Клик по государству — справка о нём (название, тип, раса, столица, города, площадь, ресурсы). Новые столицы создаются инструментом «Столица».'); },
    get capital() { return FM.T('Клик по суше — новая столица. Тяните столицу, чтобы перенести. ПКМ — удалить. Территории вырастают сами и останавливаются на хребтах и реках.'); },
    get border() { return FM.T('Клики — точки границы (путь сам ищет хребты и реки). Двойной клик или Enter — готово, Backspace — шаг назад, Esc/ПКМ — отмена. Граница должна идти от берега до берега или до другой границы. ПКМ по готовой границе — удалить.'); },
    get brush() { return FM.T('Выберите государство в списке и закрашивайте. Shift — стереть правку. Правки кисти сохраняются при пересчёте.'); }
  };
  const BIOME_RU = { get 1() { return FM.T('ледники'); }, get 2() { return FM.T('тундра'); }, get 3() { return FM.T('тайга'); }, get 4() { return FM.T('леса'); }, get 5() { return FM.T('равнины'); }, get 6() { return FM.T('пустыни'); }, get 7() { return FM.T('саванна'); }, get 8() { return FM.T('джунгли'); }, get 9() { return FM.T('болота'); }, get 10() { return FM.T('горы'); } };
  const RES_RU = new Proxy({}, { get: (_, k) => (FM.RESOURCES[k] || {}).label || k });
  const CT_RU = { get capital() { return FM.T('столица'); }, get city() { return FM.T('города'); }, get town() { return FM.T('городки'); }, get village() { return FM.T('деревни'); }, get port() { return FM.T('порты'); }, get fortress() { return FM.T('крепости'); }, get mine() { return FM.T('рудники'); }, get ruin() { return FM.T('руины'); } };
  function showStateCard() {
    const box = $('stateCard'); if (!box) return;
    const s = state.pol && state.pol.states.find(q => q.id === state.activeId);
    if (state.tool !== 'view' || !s) { box.style.display = 'none'; return; }
    const m = state.map, own = state.pol.owner, N = m.W * m.H;
    let cells = 0, land = 0; const bc = {};
    for (let i = 0; i < N; i++) { if (m.h[i] > 0) land++; if (own[i] === s.id) { cells++; const b = m.biome[i]; bc[b] = (bc[b] || 0) + 1; } }
    const biomes = Object.entries(bc).sort((u, v) => v[1] - u[1]).slice(0, 3).map(([b, n]) => `${BIOME_RU[b] || b} ${Math.round(n / Math.max(1, cells) * 100)}%`).join(', ');
    const cities = FM.allCities(state.pol).filter(c => c.stateId === s.id), ct = {};
    cities.forEach(c => ct[c.type] = (ct[c.type] || 0) + 1);
    const cl = Object.entries(ct).map(([t, n]) => `${CT_RU[t] || t}: ${n}`).join(', ') || '—';
    const rs = {}, rk = {};
    try { for (const d of FM.getResources(m, state.seed, state.resCfg).deposits) { const i = Math.round(d.y) * m.W + Math.round(d.x); if (own[i] === s.id) { rs[d.t] = (rs[d.t] || 0) + 1; const q = rk[d.k] || (rk[d.k] = { n: 0, deep: 0 }); q.n++; if (d.acc >= 3) q.deep++; } } } catch (e) {}
    const top = Object.entries(rk).sort((u, v) => v[1].n - u[1].n).slice(0, 8).map(([id, q]) => `${(FM.RES_KINDS[id] || {}).label || id} ${q.n}${q.deep ? FM.T(' (глубокие: {0})', q.deep) : ''}`).join(', ');
    const rl = (Object.entries(rs).map(([t, n]) => `${RES_RU[t]} (${n})`).join(', ') + (top ? FM.T('. Главные: {0}', top) : '')) || FM.T('бедна месторождениями');
    const ty = FM.STATE_TYPES[s.type] || {}, rc = (FM.RACES[s.race] || {}).label || s.race;
    const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    box.innerHTML = `<h4 style="margin:0 0 4px;color:${FM.stateColor(s.id, 1)}">${esc(s.name)}</h4>` +
      `<div><b>${FM.T('Тип')}:</b> ${esc(ty.label || s.type)}</div><div><b>${FM.T('Раса')}:</b> ${esc(rc)}</div><div><b>${FM.T('Столица')}:</b> ${esc(s.capName || '—')}</div>` +
      `<div><b>${FM.T('Поселения')}:</b> ${esc(cl)} ${esc(FM.T('(всего {0})', cities.length))}</div>` +
      `<div><b>${FM.T('Площадь')}:</b> ${esc(FM.T('{0} клеток, {1}% суши', cells, (cells / Math.max(1, land) * 100).toFixed(1)))}</div>` +
      `<div><b>${FM.T('Земли')}:</b> ${esc(biomes || '—')}</div><div><b>${FM.T('Ресурсы')}:</b> ${esc(rl)}</div>`;
    box.style.display = 'block';
  }
  function setTool(t) {
    state.tool = t; state.draft = []; state.draftSegs = []; state.previewPath = null;
    [...$('toolSeg').children].forEach(x => x.classList.toggle('on', x.dataset.tool === t));
    $('toolHelp').textContent = HELP[t]; showStateCard();
    cv.style.cursor = t === 'brush' ? 'none' : 'crosshair'; draw();
  }

  // ---------- сохранение и загрузка мира ----------
  const rleEnc = (arr) => { const o = []; for (let i = 0; i < arr.length;) { let j = i; while (j < arr.length && arr[j] === arr[i]) j++; o.push(arr[i], j - i); i = j; } return o; };
  const rleDec = (o, N) => { const a = new Uint8Array(N); let p = 0; for (let i = 0; i < o.length; i += 2) { a.fill(o[i], p, p + o[i + 1]); p += o[i + 1]; } return a; };
  function worldToJSON() {
    const pol = state.pol, p = {};
    for (const k of Object.keys(pol)) if (k[0] !== '_' && !['owner', 'overrides', 'zone', 'zones', 'version', 'rv'].includes(k)) p[k] = pol[k];
    p.overrides = rleEnc(pol.overrides);
    return JSON.stringify({
      format: 'fantasy-map-studio-world', appVersion: FM.VERSION, saved: new Date().toISOString(),
      params: { seed: state.seed, plateCount: state.plateCount, land: state.land, epochs: state.epochs, continents: state.continents, islands: state.islands, catCfg: state.catCfg, catManual: state.catManual, landEdits: state.landEdits, worldScale: state.worldScale, lang: state.lang },
      planet: planetRead(),
      view: { theme: state.theme, layers: state.layers, resCfg: state.resCfg },
      plates: state.plates, pol: p
    });
  }
  // ---------- раздел «Для календаря»: параметры планеты (на карту не влияют) и выгрузка world-exchange ----------
  function moonRow(m) {
    const row = document.createElement('div'); row.className = 'row moon';
    row.innerHTML = '<input type="text" class="mn" spellcheck="false" placeholder="' + FM.T('Название') + '" style="flex:2;min-width:0"><input type="text" class="mp" inputmode="decimal" placeholder="' + FM.T('период, сут') + '" style="flex:1;min-width:0"><button class="mx" title="' + FM.T('Убрать луну') + '" style="flex:0 0 auto">✕</button>';
    row.querySelector('.mn').value = (m && m.name) || ''; row.querySelector('.mp').value = (m && m.period) || '';
    row.querySelector('.mx').onclick = () => row.remove();
    $('plMoons').appendChild(row);
  }
  function planetRead() {
    return { name: $('plName').value, radius: $('plRadius').value, density: $('plDensity').value, rotation: $('plRot').value, orbit: $('plOrbit').value, tilt: $('plTilt').value,
      moons: [...$('plMoons').querySelectorAll('.moon')].map(r => ({ name: r.querySelector('.mn').value, period: r.querySelector('.mp').value })) };
  }
  function planetWrite(P) {
    P = P || {}; $('plName').value = P.name || ''; $('plRadius').value = P.radius || ''; $('plDensity').value = P.density || ''; $('plRot').value = P.rotation || ''; $('plOrbit').value = P.orbit || ''; $('plTilt').value = P.tilt || '';
    $('plMoons').textContent = ''; (P.moons || []).forEach(moonRow);
  }
  // подбор планеты по seed и параметрам мира (имя мира — пустое: в файл пойдёт seed)
  // множитель приливов от лун из раздела «Для календаря» (Земля = 1)
  function tideNow() { return FM.tideFactor(planetRead().moons.map(m => parseFloat(String(m.period).replace(',', '.')))); }
  let tideTimer = 0;
  function tideRefresh() { if (!state.map || !state.layers.tides) return; clearTimeout(tideTimer); tideTimer = setTimeout(() => { rebuildBase(); draw(); }, 250); }
  function planetAuto() {
    const P = FM.genPlanet(state.seed, { worldScale: state.worldScale }); P.name = ''; planetWrite(P); tideRefresh();
  }
  function calExport() {
    if (!state.map) return;
    const P = planetRead(), cities = state.pol ? FM.allCities(state.pol) : [];
    const data = FM.buildWorldExchange({ name: P.name || state.seed, planet: P, map: state.map, cities });
    const text = JSON.stringify(data, null, 2), fname = `calendar-${state.seed}.json`;
    const info = FM.T('Выгружено: вода {0}%, мест {1}, лун {2}', data.planet && data.planet.water_fraction != null ? Math.round(data.planet.water_fraction * 100) : '—', (data.places || []).length, data.planet && data.planet.moons ? data.planet.moons.length : 0);
    const done = (where) => { $('calInfo').textContent = info + '. ' + FM.T('Сохранено: {0}', where); };
    if (window.api && window.api.saveJSON) window.api.saveJSON(text, fname).then(r => { if (r) done(r); });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = fname; a.click(); done(fname); }
  }

  async function saveWorld() {
    if (!state.map) return;
    const text = worldToJSON(), name = `world-${state.seed}.fmworld`;
    if (window.api && window.api.saveWorld) { const r = await window.api.saveWorld(text, name); if (r) $('worldInfo').textContent = FM.T('Сохранено: {0}', r); }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); $('worldInfo').textContent = FM.T('Сохранено: {0}', name); }
  }
  async function loadWorld() {
    let text = null;
    if (window.api && window.api.openWorld) text = await window.api.openWorld();
    else text = await new Promise(res => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.fmworld,.json'; inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f); }; inp.click(); });
    if (!text) return;
    let d; try { d = JSON.parse(text); } catch (e) { alert(FM.T('Файл не удалось прочитать.')); return; }
    if (!d || d.format !== 'fantasy-map-studio-world') { alert(FM.T('Это не файл мира Fantasy Map Studio.')); return; }
    Object.assign(state, d.params || {}); delete state.genVersion;
    if (d.planet) planetWrite(d.planet); else planetAuto(); state.sizeSel = null;
    state.catManual = (d.params && Array.isArray(d.params.catManual)) ? d.params.catManual : [];
    state.landEdits = (d.params && Array.isArray(d.params.landEdits)) ? d.params.landEdits : []; state.landPending = []; state.landUndo = [];
    state.catCfg = (d.params && d.params.catCfg) ? FM.normCatCfg(d.params.catCfg) : Object.fromEntries(FM.CATASTROPHES.map(k => [k.id, 0]));   // файл без катастроф — прежняя карта   // файл без флага — legacy: прежняя география
    FM.uiLang = state.lang; FM.setUiLang(state.lang); try { localStorage.setItem('fms-ui-lang', state.lang); } catch (e) {}
    if (d.view) { state.theme = d.view.theme || state.theme; Object.assign(state.layers, d.view.layers || {}); state.resCfg = FM.normResCfg(d.view.resCfg); syncViewControls(); }
    const N = Math.round(480 * state.worldScale) * Math.round(320 * state.worldScale);
    const p = d.pol || {};
    state.plates = d.plates || null;
    state.map = null;
    state.pol = Object.assign({ states: [], barriers: [], cities: [], roads: [], version: 0, rv: 0, resCfg: state.resCfg }, p, { overrides: rleDec(p.overrides || [], N), owner: new Uint8Array(N), version: 1, rv: 1 });
    state.pol.resCfg = state.resCfg;
    state.activeId = state.pol.states.length ? state.pol.states[0].id : 0;
    $('setup').classList.remove('on');
    regenerate({ keepPlates: true, loading: true });
    $('worldInfo').textContent = FM.T('Загружен мир «{0}»', state.seed);
  }
  function syncViewControls() {
    [...$('themeSeg').children].forEach(x => x.classList.toggle('on', x.dataset.t === state.theme));
    for (const [id, key] of [['lRivers', 'rivers'], ['lForests', 'forests'], ['lRoads', 'roads'], ['lCurrents', 'currents'], ['lTides', 'tides'], ['lIce', 'ice'], ['lCat', 'cat'], ['lSeas', 'seas'], ['lRoutes', 'routes']]) if ($(id)) $(id).checked = state.layers[key] !== false && !((key === 'currents' || key === 'tides') && !state.layers[key]);
  }

  // число плит по числу материков: «авто» (0) — 9; иначе как минимум столько, сколько нужно генератору для K материков (3 плиты на материк, 4 при K ≥ 4, плюс 3), но не меньше 9
  // размер мира по числу континентов («Авто»): чем больше материков, тем крупнее карта, чтобы они не сжимались в кашу
  const autoScale = (K) => K >= 7 ? 3 : K >= 5 ? 2.5 : K >= 3 ? 2 : 1.5;
  const plateCountFor = (K) => K > 0 ? Math.max(9, K * (K >= 4 ? 4 : 3) + 3) : 9;
  // ---------- панель ----------
  function bind() {
    const seed = $('seed');
    seed.value = state.seed;
    seed.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('setupGo').click(); });
    $('dice').onclick = () => { seed.value = randomSeed(); };
    const sliders = [['continents', 'continentsV', 'continents'], ['islands', 'islandsV', 'islands'], ['land', 'landV', 'land'], ['epochs', 'epochsV', 'epochs']];
    const catRows = {};                                                    // катастрофы в окне создания мира: число событий каждого вида
    const catRv = {}, catLbl = {};
    { const box = $('catSetup'); for (const k of FM.CATASTROPHES) { const lb = document.createElement('label'); lb.title = k.hint; lb.append(k.label + ': ');
        const rv = document.createElement('b'); lb.appendChild(rv); const sl = document.createElement('input'); sl.type = 'range'; sl.min = 0; sl.max = k.max; sl.step = 1; sl.title = k.hint;
        sl.addEventListener('input', () => { rv.textContent = sl.value; }); box.append(lb, sl); catRows[k.id] = sl; catRv[k.id] = rv; catLbl[k.id] = [lb, sl]; } }
    const syncSetup = () => {
      seed.value = state.seed;
      for (const k of FM.CATASTROPHES) { const v = (state.catCfg || {})[k.id] || 0; catRows[k.id].value = v; catRv[k.id].textContent = v; }
      for (const [id, vid, key] of sliders) { $(id).value = state[key]; $(vid).textContent = (id === 'continents' && +$(id).value === 0) ? FM.T('авто') : $(id).value; }
      { const sel = state.sizeSel != null ? state.sizeSel : state.worldScale; [...$('sizeSeg').children].forEach(x => x.classList.toggle('on', +x.dataset.s === sel)); updSizeHint(); }
      $('langSel').value = state.lang;
    };
    for (const [id, vid] of sliders) $(id).addEventListener('input', () => { $(vid).textContent = (id === 'continents' && +$(id).value === 0) ? FM.T('авто') : $(id).value; });
    const updSizeHint = () => {   // подсказка под выбором размера: итоговые клетки и ориентир по времени
      const on = [...$('sizeSeg').children].find(x => x.classList.contains('on')), sel = on ? +on.dataset.s : 1.5, sc = sel > 0 ? sel : autoScale(+$('continents').value);
      $('sizeHint').textContent = (sel > 0 ? '' : FM.T('Авто') + ' → ') + Math.round(480 * sc) + '×' + Math.round(320 * sc) + (sc >= 3 ? FM.T(' — генерация до минуты и больше') : sc >= 2 ? FM.T(' — генерация 5–20 с') : '') + (sel > 0 && sel < autoScale(+$('continents').value) ? FM.T(' · для {0} континентов тесновато, лучше «Авто»', $('continents').value) : '');
    };
    $('sizeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; [...$('sizeSeg').children].forEach(x => x.classList.toggle('on', x === b)); updSizeHint(); });
    $('continents').addEventListener('input', updSizeHint);
    { const ls = $('langSel'); let sv = 'ru'; try { sv = localStorage.getItem('fms-ui-lang') || 'ru'; } catch (e) {}
      if (sv !== 'ru' && sv !== 'en') sv = 'ru'; state.lang = sv; FM.uiLang = sv; FM.setUiLang(sv);
      ls.innerHTML = '<option value="ru">Русский (кириллица)</option><option value="en">English (Latin script)</option>'; ls.value = sv; }
    const resRows = {}, resLbl = [];                                                    // ресурсы в окне создания мира: категория → {чекбокс, ползунок, виды}
    { const box = $('resSetup'), lab = (v) => FM.T(v < 0.55 ? 'очень редко' : v < 0.85 ? 'редко' : v < 1.2 ? 'обычно' : v < 1.7 ? 'обильно' : 'очень обильно');
      for (const k of FM.RES_CATS) {
        const r = FM.RESOURCES[k], kinds = FM.RES_KIND_LIST.filter(q => q.cat === k), wrap = document.createElement('div'), row = document.createElement('div'); row.className = 'resrow';
        const cb = document.createElement('input'); cb.type = 'checkbox'; const nm = document.createElement('span'); nm.className = 'resname'; nm.innerHTML = `<i class="dot" style="background:${r.color}"></i>${r.label} <em class="kn">(${kinds.length})</em>`;
        nm.title = FM.T('Нажмите, чтобы выбрать отдельные виды: {0}', kinds.map(q => q.label).join(', '));
        const sl = document.createElement('input'); sl.type = 'range'; sl.min = 0.3; sl.max = 2.2; sl.step = 0.1; const rv = document.createElement('span'); rv.className = 'rv';
        const list = document.createElement('div'); list.className = 'reskinds'; list.style.display = 'none'; const kc = {};
        const kl = []; for (const q of kinds) { const lb = document.createElement('label'), c2 = document.createElement('input'); c2.type = 'checkbox'; c2.checked = true; lb.title = q.why; lb.append(c2, ' ' + q.label); list.appendChild(lb); kc[q.id] = c2; kl.push([lb, q]); }
        resLbl.push({ k, r, nm, kinds, kl, upd: null });
        nm.addEventListener('click', () => { list.style.display = list.style.display === 'none' ? '' : 'none'; });
        const upd = () => { rv.textContent = lab(+sl.value); sl.disabled = !cb.checked; row.classList.toggle('off', !cb.checked); list.classList.toggle('off', !cb.checked); };
        resLbl[resLbl.length - 1].upd = upd; cb.addEventListener('change', upd); sl.addEventListener('input', upd); row.append(cb, nm, sl, rv); wrap.append(row, list); box.appendChild(wrap); resRows[k] = { cb, sl, upd, kc };
      } }
    const syncRes = () => { const c = FM.normResCfg(state.resCfg); for (const k of FM.RES_CATS) { resRows[k].cb.checked = c.on[k]; resRows[k].sl.value = c.amt[k]; for (const id in resRows[k].kc) resRows[k].kc[id].checked = !c.off[id]; resRows[k].upd(); } };
    const readRes = () => { const c = FM.defaultResCfg(); for (const k of FM.RES_CATS) { c.on[k] = resRows[k].cb.checked; c.amt[k] = +resRows[k].sl.value; for (const id in resRows[k].kc) if (!resRows[k].kc[id].checked) c.off[id] = true; } state.resCfg = c; };
    const openSetup = () => { syncSetup(); syncRes(); $('setupCancel').style.display = state.map ? '' : 'none'; $('setup').classList.add('on'); };
    state.openSetup = openSetup;
    FM.onUiLang = () => {   // динамически созданные подписи: пересобрать под язык интерфейса
      for (const k of FM.CATASTROPHES) { const [lb, sl] = catLbl[k.id]; lb.firstChild.nodeValue = k.label + ': '; lb.title = k.hint; sl.title = k.hint; }
      for (const e of resLbl) { e.nm.innerHTML = `<i class="dot" style="background:${e.r.color}"></i>${e.r.label} <em class="kn">(${e.kinds.length})</em>`; e.nm.title = FM.T('Нажмите, чтобы выбрать отдельные виды: {0}', e.kinds.map(q => q.label).join(', ')); for (const [lb, q] of e.kl) { lb.title = q.why; lb.lastChild.nodeValue = ' ' + q.label; } e.upd(); }
      { const ls = $('langSel'); if (ls && ls.options.length) ls.options[1].textContent = 'English (Latin script)'; }
      if (+$('continents').value === 0) $('continentsV').textContent = FM.T('авто');
      updSizeHint();
      landPanelSync();
      if (state.map && state.pol) { renderList(); updateStats(); catPanelSync(); showStateCard(); }
    };
    $('newWorld').onclick = openSetup;
    $('setupCancel').onclick = () => $('setup').classList.remove('on');
    $('setupGo').onclick = () => {
      state.seed = seed.value.trim() || randomSeed();
      for (const [id, , key] of sliders) state[key] = +$(id).value; readRes();
      state.plateCount = plateCountFor(state.continents);   // число плит выбирать нельзя: оно следует из числа материков
      state.catCfg = Object.fromEntries(FM.CATASTROPHES.map(k => [k.id, +catRows[k.id].value])); state.catManual = []; state.landEdits = []; state.landPending = []; state.landUndo = [];
      const on = [...$('sizeSeg').children].find(x => x.classList.contains('on')); if (on) { state.sizeSel = +on.dataset.s; state.worldScale = state.sizeSel > 0 ? state.sizeSel : autoScale(state.continents); }
      state.lang = FM.uiLang = $('langSel').value; FM.setUiLang(state.lang); try { localStorage.setItem('fms-ui-lang', state.lang); } catch (e) {}
      state.plates = null; state.pol = null; $('setup').classList.remove('on'); planetAuto(); regenerate();
    };
    $('legendBtn').onclick = () => { const w = $('legendWin'), on = !w.classList.contains('on'); w.classList.toggle('on', on); $('legendBtn').classList.toggle('on', on); refreshLegend(); };
    $('legendClose').onclick = () => { $('legendWin').classList.remove('on'); $('legendBtn').classList.remove('on'); };
    { const w = $('legendWin'), hd = w.querySelector('.lh'); let drag = null;      // окно можно перетаскивать за заголовок
      hd.addEventListener('pointerdown', (e) => { if (e.target.tagName === 'BUTTON') return; const r = w.getBoundingClientRect(), pr = w.parentElement.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, px: pr.left, py: pr.top }; hd.setPointerCapture(e.pointerId); });
      hd.addEventListener('pointermove', (e) => { if (!drag) return; w.style.left = (e.clientX - drag.px - drag.dx) + 'px'; w.style.top = (e.clientY - drag.py - drag.dy) + 'px'; w.style.right = 'auto'; });
      hd.addEventListener('pointerup', () => { drag = null; }); }
    $('plAddMoon').onclick = () => { if ($('plMoons').children.length < 8) moonRow(); tideRefresh(); };
    $('plMoons').addEventListener('input', tideRefresh); $('plMoons').addEventListener('click', (e) => { if (e.target.classList.contains('mx')) tideRefresh(); });
    $('calExport').onclick = calExport;
    $('plAuto').onclick = () => { if (state.seed) planetAuto(); };
    if (state.seed) planetAuto();
    $('saveWorld').onclick = () => saveWorld();
    $('loadWorld').onclick = () => loadWorld();
    $('setupLoad').onclick = () => loadWorld();
    $('catToolSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.catTool = b.dataset.ct; $('catMsg').textContent = ''; catPanelSync(); });
    $('catSize').addEventListener('input', () => { state.catSize = +$('catSize').value; $('catSizeV').textContent = state.catSize; });
    $('landToolSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.landTool = b.dataset.lt; landPanelSync(); draw(); });
    $('landSize').addEventListener('input', () => { state.landSize = +$('landSize').value; landPanelSync(); draw(); });
    $('landRough').addEventListener('input', () => { state.landRough = +$('landRough').value; landPanelSync(); });
    $('landApply').onclick = landCommit;
    $('landReset').onclick = () => { state.landPending = []; landPanelSync(); draw(); };
    $('landUndo').onclick = landUndoLast;
    $('landClear').onclick = () => { state.landPending = []; if (state.landEdits.length) { state.landEdits = []; regenerate({ keepPlates: true, done: landPanelSync }); } else { landPanelSync(); draw(); } };
    landPanelSync();
    $('catUndo').onclick = () => { if (state.catManual.length) { state.catManual.pop(); $('catMsg').textContent = ''; regenerate({ keepPlates: true, done: catPanelSync }); } };
    $('catClear').onclick = () => { if (state.catManual.length) { state.catManual = []; $('catMsg').textContent = ''; regenerate({ keepPlates: true, done: catPanelSync }); } };
    $('catRandom').onclick = () => {
      const m = state.map, land = []; for (let i = 0; i < m.h.length; i += 7) if (m.h[i] > 0) land.push(i); if (!land.length) return;
      const k = state.catTool, tries = k === 'rift' ? 1 : 1; void tries;
      const i = land[Math.floor(Math.random() * land.length)], x = i % m.W, y = (i / m.W) | 0, a = Math.random() * Math.PI * 2, L = (0.15 + Math.random() * 0.2) * m.W;
      const ev = { kind: k, x, y, size: Math.random() };
      if (k === 'rift') { ev.x2 = Math.round(x + Math.cos(a) * L); ev.y2 = Math.round(y + Math.sin(a) * L); }
      catApply(ev);
    };

    $('viewSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const wasSea = state.view === 'seabed'; state.view = b.dataset.v;
      [...$('viewSeg').children].forEach(x => x.classList.toggle('on', x === b));
      document.body.classList.toggle('seabed-view', state.view === 'seabed');
      if (wasSea !== (state.view === 'seabed')) { switchSeabed(); return; }
      document.body.classList.toggle('plates-view', state.view === 'plates');
      document.body.classList.toggle('states-view', state.view === 'states');
      document.body.classList.toggle('cities-view', state.view === 'cities');
      document.body.classList.toggle('cat-view', state.view === 'cat');
      document.body.classList.toggle('land-view', state.view === 'land');
      landHover = null;
      cv.style.cursor = state.view === 'states' ? (state.tool === 'brush' ? 'none' : 'crosshair') : state.view === 'cities' || state.view === 'cat' || state.view === 'land' ? 'crosshair' : 'default';
      showCityEd();
      draw();
    });
    for (const [id, key] of [['sbGeo', 'sbGeo'], ['sbBio', 'sbBio'], ['sbRes', 'sbRes'], ['sbNames', 'sbNames']]) {
      $(id).addEventListener('change', (e) => { state.layers[key] = e.target.checked; busy(true); setTimeout(() => { rebuildBase(); draw(); busy(false); }, 10); });
    }
    $('themeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.theme = b.dataset.t;
      [...$('themeSeg').children].forEach(x => x.classList.toggle('on', x === b));
      busy(true); setTimeout(() => { rebuildBase(); draw(); busy(false); }, 10);
    });
    for (const [id, key] of [['lRivers', 'rivers'], ['lForests', 'forests'], ['lRoads', 'roads'], ['lCurrents', 'currents'], ['lTides', 'tides'], ['lIce', 'ice'], ['lCat', 'cat'], ['lSeas', 'seas'], ['lRoutes', 'routes']]) {
      $(id).addEventListener('change', (e) => { state.layers[key] = e.target.checked; busy(true); setTimeout(() => { rebuildBase(); draw(); busy(false); }, 10); });
    }

    // государства
    $('toolSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTool(b.dataset.tool); });
    const stick = $('stick'); stick.value = state.stick * 100; $('stickV').textContent = stick.value;
    stick.addEventListener('input', () => { $('stickV').textContent = stick.value; state.stick = stick.value / 100; });
    const br = $('brushR'); br.value = state.brushR; $('brushV').textContent = br.value;
    br.addEventListener('input', () => { $('brushV').textContent = br.value; state.brushR = +br.value; });
    $('autoStates').onclick = () => {
      busy(true);
      setTimeout(() => {
        const n = Math.max(2, Math.min(14, +$('autoN').value || 6));
        const pol = state.pol;
        pol.states = []; pol.barriers = []; pol.overrides.fill(0);
        for (const s of FM.autoStates(state.map, n, state.seed, [])) pol.states.push({ id: nextId(), name: s.name, race: s.race, type: s.type, capital: s.capital, power: s.power, culture: (FM.STATE_TYPES[s.type] || {}).culture || 'realistic' });
        state.activeId = pol.states.length ? pol.states[0].id : 0;
        pol.cities = []; pol.roads = []; pol.rv++; ensureCapNames();
        growNow();   // тип государства должен соответствовать ресурсам его земель: согласуем и перерастаем (тип меняет мощь), до 4 раз
        for (let it = 0; it < 4 && FM.reconcileStatus(state.map, pol, state.seed, state.resCfg); it++) growNow();
        politicsChanged(); busy(false);
      }, 20);
    };
    $('undoBorder').onclick = () => { if (state.pol.barriers.length) { state.pol.barriers.pop(); politicsChanged(); } };
    $('clearStates').onclick = () => { const p = state.pol; p.states = []; p.barriers = []; p.overrides.fill(0); state.activeId = 0; politicsChanged(); };
    setTool('view');

    // города и дороги
    const dens = $('dens'); $('densV').textContent = dens.value; dens.addEventListener('input', () => { $('densV').textContent = dens.value; });
    const volc = $('volc'); $('volcV').textContent = volc.value; volc.addEventListener('input', () => { $('volcV').textContent = volc.value; });
    $('showRes').addEventListener('change', (e) => { state.showRes = e.target.checked; draw(); });
    $('ctoolSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setCityTool(b.dataset.ct); });
    $('autoCities').onclick = () => {
      if (!state.pol.states.length) { $('cityHelp').textContent = FM.T('Сначала создайте государства (вид «Страны» → Авто-расстановка).'); return; }
      busy(true);
      setTimeout(() => {
        const pol = state.pol; ensureCapNames();
        pol.cities = pol.cities.filter(c => c.manual);   // старые автогорода убираем ДО расстановки, иначе они занимают места
        pol.roads = pol.roads.filter(r => r.manual);
        pol.cities = pol.cities.concat(FM.placeCities(state.map, pol, { seed: state.seed, density: dens.value / 100, volc: volc.value / 100, cfg: state.resCfg, salt: state.citySalt++ }));
        citiesChanged(); busy(false);
      }, 20);
    };
    $('autoRoads').onclick = () => {
      busy(true);
      setTimeout(() => {
        const pol = state.pol; pol.volc = volc.value / 100;
        pol.roads = pol.roads.filter(r => r.manual).concat(FM.buildRoads(state.map, pol));
        citiesChanged(); busy(false);
      }, 20);
    };
    $('clearCities').onclick = () => { state.pol.cities = []; state.selCity = null; citiesChanged(); };
    $('clearRoads').onclick = () => { state.pol.roads = []; citiesChanged(); };
    $('cityName').addEventListener('change', () => {
      const c = state.selCity && FM.allCities(state.pol).find(q => q.key === state.selCity); if (!c) return;
      const v = $('cityName').value.trim() || c.name;
      if (c.capital) c.ref.capName = v; else { const o = state.pol.cities.find(q => 'c' + q.id === c.key); o.name = v; o.manual = true; }
      citiesChanged();
    });
    $('cityType').addEventListener('change', () => {
      const o = state.pol.cities.find(q => 'c' + q.id === state.selCity); if (!o) return;
      o.type = $('cityType').value; o.manual = true; citiesChanged();
    });
    $('cityOpen').onclick = () => { if (state.selCity) openCityMap(state.selCity); };
    $('cityDel').onclick = () => { state.pol.cities = state.pol.cities.filter(q => 'c' + q.id !== state.selCity); state.selCity = null; citiesChanged(); };
    setCityTool('city');

    $('zoomIn').onclick = () => setZoom(state.cam.z * 1.5);
    $('zoomOut').onclick = () => setZoom(state.cam.z / 1.5);
    $('zoomFit').onclick = () => setZoom(1);
    $('export').onclick = () => {
      const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
      out.getContext('2d').drawImage(state.base, 0, 0);
      try { if ($('exLegend') ? $('exLegend').checked : true) FM.drawLegend(out.getContext('2d'), state.map, { theme: state.theme, political: state.pol, layers: state.layers, seabed: state.view === 'seabed', tideF: tideNow() }); } catch (e) { console.error(e); }
      out.toBlob(async (blob) => {
        const name = `map-${state.seed}.png`;
        if (window.api && window.api.savePNG) await window.api.savePNG(await blob.arrayBuffer(), name);
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
      }, 'image/png');
    };
  }

  const q = new URLSearchParams(location.search);
  state.seed = q.get('seed') || randomSeed();
  if (q.get('theme')) state.theme = q.get('theme');
  $('ver').textContent = 'v' + (FM.VERSION || '?');
  const setTitle = () => { document.title = 'Fantasy Map Studio v' + FM.VERSION + ' — ' + FM.T('Александра Шавкунова'); }; setTitle(); const prevUi = FM.onUiLang; FM.onUiLang = () => { if (prevUi) prevUi(); setTitle(); };
  bind();
  window.__state = state; window.__openCity = openCityMap;
  if (q.get('seed')) regenerate(); else state.openSetup();
})();
