(function (root) {
'use strict';
// Reconciles the raster water-object catalog with the hydrology model and derives the static link structure of lakes:
//  * every wet catalog object must be exactly one hydrology pool (a group of basins sharing one level), and vice versa;
//  * for each pool: its outlet (lowest saddle to a basin outside the pool, or to the external water), whether the pool stands at that
//    level (it can spill) and where it spills; from that, inflows from other lakes and the chain down to the external water.
// This is bookkeeping on one observed state. It does not model flow speed, discharge, rivers or time, and it modifies nothing.

function build(field, hierarchy, redistribution, catalog, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'tolerance')) throw Error('Invalid link options');
  const tol = options.tolerance === undefined ? 1e-9 : options.tolerance;
  if (!Number.isFinite(tol) || tol <= 0) throw Error('Invalid tolerance');
  const { w, h, height, area } = field || {}, n = w * h;
  if (!Number.isInteger(w) || !Number.isInteger(h) || !height || !area || height.length !== n || area.length !== n) throw Error('Invalid field');
  if (!hierarchy || hierarchy.w !== w || hierarchy.h !== h || !Array.isArray(hierarchy.edges) || !Array.isArray(hierarchy.basins) || !hierarchy.cellBasin || hierarchy.cellBasin.length !== n || !Number.isInteger(hierarchy.waterNode)) throw Error('Invalid hierarchy');
  if (!redistribution || redistribution.w !== w || redistribution.h !== h || !Array.isArray(redistribution.pools) || !redistribution.poolByBasin || !redistribution.depth || redistribution.depth.length !== n) throw Error('Invalid redistribution');
  if (!catalog || catalog.w !== w || catalog.h !== h || !catalog.labels || catalog.labels.length !== n || !Array.isArray(catalog.objects)) throw Error('Invalid catalog');
  if (!catalog.metadata || catalog.metadata.adjacency !== 'hydrology') throw Error('Catalog must be built with hydrology adjacency');
  const B = hierarchy.basins.length, water = hierarchy.waterNode, poolOfBasin = b => (b === water ? -1 : redistribution.poolByBasin[b]);
  const pools = new Map(redistribution.pools.map(p => [p.id, p]));

  // 1. object <-> pool correspondence, from the cells
  const objectPools = catalog.objects.map(() => new Set()), poolObjects = new Map(), anchor = new Int32Array(catalog.objects.length).fill(-1);
  for (let i = 0; i < n; i++) {
    const l = catalog.labels[i]; if (l < 0) continue;
    const p = poolOfBasin(hierarchy.cellBasin[i]);
    if (!pools.has(p)) throw Error('Wet cell ' + i + ' belongs to no pool');
    objectPools[l].add(p); if (!poolObjects.has(p)) poolObjects.set(p, new Set()); poolObjects.get(p).add(l);
    if (anchor[l] < 0 || height[i] < height[anchor[l]]) anchor[l] = i;
  }
  const mismatches = [];
  objectPools.forEach((s, l) => { if (s.size !== 1) mismatches.push({ kind: 'object-spans-pools', object: l, pools: [...s].sort((a, b) => a - b) }); });
  poolObjects.forEach((s, p) => { if (s.size !== 1) mismatches.push({ kind: 'pool-spans-objects', pool: p, objects: [...s].sort((a, b) => a - b) }); });
  const subThresholdPools = redistribution.pools.filter(p => p.volume > 0 && !poolObjects.has(p.id)).length;

  // 2. outlets: lowest saddle from each pool to a basin outside it
  const best = new Map();
  hierarchy.edges.forEach((e, k) => {
    for (const [inside, outside] of [[e.a, e.b], [e.b, e.a]]) {
      if (inside === water) continue;
      const p = poolOfBasin(inside), q = poolOfBasin(outside);
      if (p === q && outside !== water) continue;
      const cur = best.get(p);
      if (!cur || e.level < cur.level || (e.level === cur.level && k < cur.edge)) best.set(p, { edge: k, level: e.level, toBasin: outside, fromCell: e.fromCell, toCell: e.toCell });
    }
  });

  // 3. per wet object
  const links = [];
  for (let l = 0; l < catalog.objects.length; l++) {
    const o = catalog.objects[l], pid = [...objectPools[l]][0], p = pools.get(pid), out = best.get(pid) || null;
    const volumeRel = Math.abs(p.volume - o.volume) / Math.max(1e-300, p.volume), areaRel = Math.abs(p.wetAreaSteradians - o.areaSteradians) / Math.max(1e-300, p.wetAreaSteradians);
    let outlet = null;
    if (out) {
      const toWater = out.toBasin === water, toPool = toWater ? -1 : poolOfBasin(out.toBasin), target = pools.get(toPool);
      outlet = {
        edge: out.edge, saddleLevel: out.level, fromCell: out.fromCell, toCell: out.toCell, target: toWater ? 'water' : 'pool', toPool: toWater ? null : toPool,
        toObject: toWater || !poolObjects.has(toPool) ? null : [...poolObjects.get(toPool)][0],
        atSpillLevel: p.level >= out.level - tol * Math.max(1, Math.abs(out.level)),
        headroom: Math.max(0, out.level - p.level),   // relative height still to rise before this lake can spill over its lowest saddle
        targetWet: toWater ? null : !!(target && target.volume > 0)
      };
    }
    links.push({ object: l, anchorCell: anchor[l], pool: pid, basins: p.basins.slice(), level: p.level, volume: p.volume, catalogVolume: o.volume, volumeRelDiff: volumeRel, wetAreaSteradians: p.wetAreaSteradians, catalogAreaSteradians: o.areaSteradians, areaRelDiff: areaRel, outlet, inflowFrom: [], downstream: null });
  }
  const byObject = new Map(links.map(x => [x.object, x]));
  for (const x of links) if (x.outlet && x.outlet.atSpillLevel && x.outlet.toObject !== null) byObject.get(x.outlet.toObject).inflowFrom.push(x.object);
  for (const x of links) x.inflowFrom.sort((a, b) => a - b);

  // 4. chains of spilling lakes: where does a spilling lake's water go?
  for (const x of links) {
    const seen = new Set([x.object]); let cur = x, kind = null;
    for (;;) {
      if (!cur.outlet || !cur.outlet.atSpillLevel) { kind = cur === x ? 'stores' : 'ends-in-closed-lake'; break; }
      if (cur.outlet.target === 'water') { kind = 'reaches-water'; break; }
      if (cur.outlet.toObject === null) { kind = 'enters-dry-pool'; break; }
      if (seen.has(cur.outlet.toObject)) { kind = 'cycle'; mismatches.push({ kind: 'spill-cycle', object: x.object }); break; }
      seen.add(cur.outlet.toObject); cur = byObject.get(cur.outlet.toObject);
    }
    x.downstream = { kind, endObject: kind === 'ends-in-closed-lake' || kind === 'reaches-water' ? cur.object : null, steps: seen.size - 1 };
  }
  // consistency of the spill relation: a lake that spills into a wet pool must not stand lower than that pool's own saddle region
  for (const x of links) if (x.outlet && x.outlet.atSpillLevel && x.outlet.target === 'pool' && x.outlet.targetWet === false) mismatches.push({ kind: 'spills-into-empty-pool', object: x.object, pool: x.outlet.toPool });

  const count = k => links.filter(x => x.downstream.kind === k).length;
  return {
    w, h, links, mismatches,
    summary: {
      objectCount: links.length, wetPools: redistribution.pools.filter(p => p.volume > 0).length, subThresholdPools,
      consistent: mismatches.length === 0, mismatchCount: mismatches.length,
      spilling: links.filter(x => x.outlet && x.outlet.atSpillLevel).length, stores: count('stores'), reachesWater: count('reaches-water'), endsInClosedLake: count('ends-in-closed-lake'), entersDryPool: count('enters-dry-pool'),
      maxVolumeRelDiff: links.reduce((a, x) => Math.max(a, x.volumeRelDiff), 0), maxAreaRelDiff: links.reduce((a, x) => Math.max(a, x.areaRelDiff), 0)
    },
    metadata: Object.freeze({
      method: 'object <-> hydrology pool correspondence from cells; pool outlet = lowest saddle to a basin outside the pool or to the external water',
      scope: 'bookkeeping of one observed state; not discharge, flow speed, rivers or time; terrain and water are not modified',
      spill: 'atSpillLevel means the pool level is at or above its lowest outside saddle within the tolerance; it does not say how much water leaves. The published state is taken after the recession phase, so lakes are normally BELOW their saddle there (headroom > 0): actual spilling is visible only in the per-step routing trace (see SurfaceWaterFlux)'
    })
  };
}

const api = { build };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SurfaceWaterLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
