(function (root) {
'use strict';
// Устойчивая идентичность водоёмов поверх мгновенных растровых пятен SurfaceWaterObjects.
//
// Идентификатор водоёма = индекс его якорной клетки: самой низкой клетки рельефа среди мокрых клеток пятна
// (при равенстве высот — клетка с меньшим индексом). Рельеф во время расчёта не меняется, поэтому тот же водоём
// получает тот же идентификатор на любом шаге, в любом сценарии и при повторном запуске на той же ревизии рельефа.
// Правка рельефа может сменить минимумы: идентификаторы действительны только внутри одной ревизии рельефа.
//
// Слияние: наследует идентификатор пятно с более низким якорем (глубокий водоём «поглощает» мелкий).
// Разделение: часть, содержащая прежний якорь, сохраняет идентификатор, остальные получают свои якоря.
// События выводятся из перекрытия клеток между соседними наблюдениями (рёберная связность пятен как в SurfaceWaterObjects).
// Это учёт пятен растра, а не доказательство физического водоёма или выхода реки; физика и вода не изменяются.
function create(field, Objects, options = {}) {
  if (!Objects || typeof Objects.build !== 'function') throw Error('SurfaceWaterObjects required');
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'depthThreshold')) throw Error('Invalid water identity options');
  const { w, h, height } = field || {}, n = w * h;
  if (!Number.isInteger(w) || !Number.isInteger(h) || !height || height.length !== n) throw Error('Invalid water identity field');
  const bodies = new Map(), events = [], series = [];
  let prev = null, lastStep = 0, lastTime = 0;

  function label(depth) {
    const cat = Objects.build(field, { w, h, depth }, options.depthThreshold === undefined ? {} : { depthThreshold: options.depthThreshold });
    const m = cat.objects.length, anchor = new Int32Array(m).fill(-1);
    for (let i = 0; i < n; i++) {
      const l = cat.labels[i]; if (l < 0) continue;
      const a = anchor[l];
      if (a < 0 || height[i] < height[a]) anchor[l] = i;           // обход по возрастанию индекса: при равенстве остаётся меньший
    }
    const objects = cat.objects.map((o, l) => ({ id: anchor[l], anchorCell: anchor[l], label: l, cellCount: o.cellCount, areaSteradians: o.areaSteradians, volume: o.volume, maxDepth: o.maxDepth, touchesOceanMask: o.touchesOceanMask }));
    return { labels: cat.labels, objects, summary: cat.summary };
  }

  function components(a, b) {                                       // связные компоненты графа перекрытий
    const na = a.objects.length, nb = b.objects.length, parent = Int32Array.from({ length: na + nb }, (_, i) => i);
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    if (na && nb) for (let i = 0; i < n; i++) { const p = a.labels[i], q = b.labels[i]; if (p >= 0 && q >= 0) { const x = find(p), y = find(na + q); if (x !== y) parent[Math.max(x, y)] = Math.min(x, y); } }
    const groups = new Map();
    for (let i = 0; i < na + nb; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, { from: [], to: [] }); const g = groups.get(r); if (i < na) g.from.push(a.objects[i].id); else g.to.push(b.objects[i - na].id); }
    return [...groups.values()].map(g => ({ from: g.from.sort((x, y) => x - y), to: g.to.sort((x, y) => x - y) })).sort((x, y) => (x.to[0] ?? x.from[0]) - (y.to[0] ?? y.from[0]) || x.from.length - y.from.length);
  }

  function observe(water, step, time) {
    if (!Number.isInteger(step) || step <= lastStep) throw Error('Water identity steps must increase');
    if (!Number.isFinite(time) || time < lastTime) throw Error('Water identity time must not decrease');
    if (!water || water.depth?.length !== n) throw Error('Invalid water identity sample');
    const cur = label(water.depth), before = prev || { labels: new Int32Array(n).fill(-1), objects: [] };
    const prevIds = new Set(before.objects.map(o => o.id));
    for (const g of components(before, cur)) {
      const { from, to } = g;
      if (!from.length) { for (const id of to) events.push({ step, time, type: 'appear', from: [], to: [id] }); }
      else if (!to.length) { for (const id of from) events.push({ step, time, type: 'dry', from: [id], to: [] }); }
      else if (from.length === 1 && to.length === 1) { if (from[0] !== to[0]) events.push({ step, time, type: 'reanchor', from, to }); }
      else if (to.length === 1) events.push({ step, time, type: 'merge', from, to, heir: from.includes(to[0]) ? to[0] : null });
      else if (from.length === 1) events.push({ step, time, type: 'split', from, to, keeps: to.includes(from[0]) ? from[0] : null });
      else events.push({ step, time, type: 'reorganize', from, to });
    }
    for (const o of cur.objects) {
      let b = bodies.get(o.id);
      if (!b) { b = { id: o.id, anchorCell: o.anchorCell, firstStep: step, firstTime: time, lastStep: step, lastTime: time, appearances: 0, peakVolume: 0, peakVolumeStep: step, peakAreaSteradians: 0, activeSteps: 0 }; bodies.set(o.id, b); }
      if (!prevIds.has(o.id)) b.appearances++;
      b.lastStep = step; b.lastTime = time; b.activeSteps++;
      if (o.volume > b.peakVolume) { b.peakVolume = o.volume; b.peakVolumeStep = step; }
      b.peakAreaSteradians = Math.max(b.peakAreaSteradians, o.areaSteradians);
    }
    series.push({ step, time, bodies: cur.objects.length, wetCells: cur.summary.wetCells, wetAreaSteradians: cur.summary.wetAreaSteradians, volume: cur.summary.mappedVolume });
    prev = cur; lastStep = step; lastTime = time;
  }

  function snapshot() {
    const active = new Set(prev ? prev.objects.map(o => o.id) : []);
    const sum = type => events.filter(e => e.type === type).length;
    return {
      w, h, steps: series.map(s => ({ ...s })),
      bodies: [...bodies.values()].sort((a, b) => a.id - b.id).map(b => ({ ...b, active: active.has(b.id) })),
      current: prev ? prev.objects.map(o => ({ id: o.id, anchorCell: o.anchorCell, cellCount: o.cellCount, areaSteradians: o.areaSteradians, volume: o.volume, maxDepth: o.maxDepth, touchesOceanMask: o.touchesOceanMask })).sort((a, b) => a.id - b.id) : [],
      events: events.map(e => ({ ...e, from: e.from.slice(), to: e.to.slice() })),
      counts: { bodiesEver: bodies.size, bodiesNow: active.size, appear: sum('appear'), dry: sum('dry'), merge: sum('merge'), split: sum('split'), reorganize: sum('reorganize'), reanchor: sum('reanchor') },
      metadata: Object.freeze({
        ids: 'index of the lowest terrain cell among the wet cells of an edge-connected raster patch (ties: lower index); valid only within one terrain revision',
        merge: 'the patch with the lower anchor inherits its id', split: 'the part containing the previous anchor keeps the id',
        scope: 'bookkeeping of raster water patches between observed steps; not proof of a physical lake, outlet or river; terrain and water are not modified'
      })
    };
  }
  return { observe, snapshot };
}
const api = { create };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SurfaceWaterIdentity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
