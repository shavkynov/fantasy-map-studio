'use strict';
// Воспроизведение рисков кэша атласа (шаг 2 docs/DEVELOPMENT_PLAN.md). Это измерение, а не приёмка:
// скрипт НЕ утверждает, что дефект проявляется в приложении, а фиксирует, какие виды изменений кэш замечает.
// Достижимость из реальных путей правки (patchMap, citiesChanged) разбирается отдельно в отчёте.
const A = require('../src/world-atlas-render');

function fixture() {
  const W = 32, H = 20, N = W * H, h = new Float64Array(N).fill(.3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || x >= W - 2 || y < 2 || y >= H - 2) h[y * W + x] = -.2;
  return { W, H, seed: 'cache-repro', h, young: new Float32Array(N), old: new Float32Array(N), biome: new Uint8Array(N).fill(5), moist: new Float32Array(N).fill(.5), temp: new Float32Array(N).fill(.5), ocean: Uint8Array.from(h, v => v <= 0 ? 1 : 0), dist: new Float32Array(N).fill(3), riverMask: new Uint8Array(N), riverAcc: new Float32Array(N), riverDown: new Int32Array(N).fill(-1), rivers: [], volcanoes: [] };
}

function harness() {
  let canvasData = null, lastView = null, lastOpts = null, placeCalls = 0, canvasBuilds = 0;
  const FM = {
    R: { THEMES: {}, gameTerrain: () => 'legacy', placeFeatures: () => { placeCalls++; return [{ t: 'm', x: 50, y: 40, w: 8, h: 8 }]; } },
    makeCanvas: (w, h) => { canvasBuilds++; return { width: w, height: h, getContext: () => ({ createImageData: () => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData(im) { canvasData = Uint8ClampedArray.from(im.data); } }) }; },
    renderMap(m, o) { lastView = m; lastOpts = o; return { atlasCanvas: m._atlasCanvas, features: m._atlasFeatures, rivers: m.rivers }; },
  };
  A.install(FM);
  return { FM, render: (map, pol) => FM.renderMap(map, { theme: 'atlas', political: pol }), get canvasBuilds() { return canvasBuilds; }, get placeCalls() { return placeCalls; }, get canvasData() { return canvasData; }, get view() { return lastView; }, get opts() { return lastOpts; } };
}

const rows = [];
function record(name, noticed, note) { rows.push({ scenario: name, cacheNoticed: noticed, note }); }
const polOf = () => ({ states: [], cities: [], roads: [], version: 1, rv: 1 });

{ // A. тот же объект карты, высоты правят на месте
  const map = fixture(), pol = polOf(), t = harness(); t.render(map, pol); const builds = t.canvasBuilds, before = Uint8ClampedArray.from(t.canvasData);
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) map.h[y * map.W + x] = -.4;
  t.render(map, pol); const fresh = A.terrainPixels(map);
  record('in-place height edit, same map object and same arrays', t.canvasBuilds > builds, 'cached pixels differ from a fresh terrainPixels(map): ' + (JSON.stringify(Array.from(before)) !== JSON.stringify(Array.from(fresh))));
}
{ // B. биомы на месте
  const map = fixture(), pol = polOf(), t = harness(); t.render(map, pol); const builds = t.canvasBuilds;
  for (let i = 100; i < 140; i++) map.biome[i] = 2;
  t.render(map, pol); record('in-place biome edit, same arrays', t.canvasBuilds > builds, 'terrain canvas is rebuilt only when h or biome array identity changes');
}
{ // C. новые массивы h и biome в новом объекте карты (так возвращает patchMap)
  const map = fixture(), pol = polOf(), t = harness(); t.render(map, pol); const builds = t.canvasBuilds;
  const next = Object.assign({}, map, { h: Float64Array.from(map.h), biome: Uint8Array.from(map.biome) }); next.h[200] = -.4;
  t.render(next, pol); record('new map object with new h and biome arrays (patchMap-style)', t.canvasBuilds > builds, 'WeakMap is keyed by map object');
}
{ // D. новый объект карты, но те же массивы h/biome (меняется только поле рек)
  const map = fixture(), pol = polOf(), t = harness(); t.render(map, pol);
  const next = Object.assign({}, map, { rivers: [new Array(20).fill(0).map((_, i) => 100 + i)] });
  t.render(next, pol); record('new map object sharing h/biome, different rivers', t.opts.political !== undefined && t.view.rivers.length === 1, 'rivers are read when the political view is rebuilt for the new object');
}
{ // E. реки заменены на месте в том же объекте карты, pol не менялся
  const map = fixture(), pol = polOf(), t = harness(); t.render(map, pol);
  map.rivers = [new Array(20).fill(0).map((_, i) => 100 + i)]; t.render(map, pol);
  record('rivers array replaced in place, pol unchanged', t.view.rivers.length === 1, 'view.rivers is copied when pol key changes, not when map.rivers changes');
}
{ // F. дорога добавлена без увеличения version/rv
  const map = fixture(), pol = polOf(), t = harness(); t.render(map, pol); const shown = t.opts.political.roads.length;
  pol.roads.push({ manual: true, path: [100, 101, 102] }); t.render(map, pol);
  record('road pushed without version/rv bump', t.opts.political.roads.length !== shown, 'real app paths call citiesChanged(), which increments pol.rv');
}
{ // G. дорога добавлена с увеличением rv (как делает citiesChanged)
  const map = fixture(), pol = polOf(), t = harness(); t.render(map, pol); const shown = t.opts.political.roads.length;
  pol.roads.push({ manual: true, path: [100, 101, 102] }); pol.rv++; t.render(map, pol);
  record('road pushed with rv bump (real app path)', t.opts.political.roads.length !== shown, '');
}
{ // H. город сдвинут с rv++ — защищённые клетки рельефа обновляются
  const map = fixture(), pol = polOf(), t = harness(); t.render(map, pol); const v1 = t.view;
  pol.cities.push({ id: 1, x: 10, y: 10, name: 'X' }); pol.rv++; t.render(map, pol);
  record('city added with rv bump', t.view !== v1, '');
}
console.log(JSON.stringify({ test: 'world-atlas-cache-repro', commitScope: 'measurement only, no pass/fail claim about the application', rows }, null, 1));
