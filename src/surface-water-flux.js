(function (root) {
'use strict';
// Per-step water bookkeeping of the INFLOW phase from the coupled model's routing trace (Surface.create(..., {trackRouting:true})).
// It separates NEW water (rain on the catchment of a pool) from water that is only RELAYED between pools (spill transfers),
// so the two are never added together. Trace transfers are hops: one parcel of water that crosses three lakes appears as three
// transfer events, so the sum of transfer volumes ("hopVolume") is not an amount of water and must never be added to rain input.
// Scope: inflow phase only. Evaporation and seepage happen in the recession phase and are not attributed to pools here.
// Pools are the pools at the END of the inflow phase (trace.finalPools); they can differ from the pools of the published state, which is
// taken after recession. Each pool carries its basins so a consumer can join it to catalog objects by cells.

function analyze(hierarchy, trace, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'previousStorage')) throw Error('Invalid flux options');
  if (!hierarchy || !Array.isArray(hierarchy.basins) || !Number.isInteger(hierarchy.waterNode)) throw Error('Invalid hierarchy');
  if (!trace || trace.waterNode !== hierarchy.waterNode || !Array.isArray(trace.events) || !Array.isArray(trace.finalPools) || !trace.initialByBasin) throw Error('Invalid routing trace');
  const B = hierarchy.basins.length, water = trace.waterNode, initial = trace.initialByBasin, prev = options.previousStorage;
  if (initial.length !== B) throw Error('Trace does not match the hierarchy');
  if (prev !== undefined && (!prev || prev.length !== B)) throw Error('previousStorage does not match the hierarchy');

  // merge forest: node -> parent node; basins are nodes 0..B-1
  const parent = new Map();
  for (const e of trace.events) if (e.kind === 'merge') { parent.set(e.left, e.node); parent.set(e.right, e.node); }
  const top = node => { let x = node; while (parent.has(x)) x = parent.get(x); return x; };
  const poolIndexOfNode = new Map(trace.finalPools.map((p, i) => [p.node, i]));
  const basinsOf = trace.finalPools.map(() => []);
  for (let b = 0; b < B; b++) {
    const i = poolIndexOfNode.get(top(b));
    if (i === undefined) { if (initial[b] !== 0) throw Error('Basin ' + b + ' has supply but belongs to no final pool'); continue; }
    basinsOf[i].push(b);
  }
  const P = trace.finalPools.length, supplied = new Float64Array(P), rain = new Float64Array(P), spillIn = new Float64Array(P), spillOut = new Float64Array(P), exported = new Float64Array(P);
  for (let i = 0; i < P; i++) for (const b of basinsOf[i]) { supplied[i] += initial[b]; rain[i] += initial[b] - (prev ? prev[b] : 0); }
  const poolOf = node => { const i = poolIndexOfNode.get(top(node)); if (i === undefined) throw Error('Event node ' + node + ' is not in a final pool'); return i; };
  let hop = 0, internalHop = 0, crossHop = 0, boundary = 0; const edges = new Map();
  for (const e of trace.events) {
    if (e.kind === 'merge') continue;
    if (!Number.isFinite(e.volume) || e.volume < 0) throw Error('Invalid event volume');
    if (e.kind === 'transfer') {
      const a = poolOf(e.from), b = poolOf(e.to); hop += e.volume;
      if (a === b) { internalHop += e.volume; continue; }
      crossHop += e.volume; spillOut[a] += e.volume; spillIn[b] += e.volume;
      const key = a + '>' + b; edges.set(key, (edges.get(key) || 0) + e.volume);
    } else if (e.kind === 'boundary') {
      if (e.to !== water) throw Error('Boundary event does not end at the external water');
      const a = poolOf(e.from); exported[a] += e.volume; boundary += e.volume;
      const key = a + '>water'; edges.set(key, (edges.get(key) || 0) + e.volume);
    } else throw Error('Unknown trace event ' + e.kind);
  }
  const pools = []; let totalSupplied = 0, totalRain = 0, stored = 0, maxResidual = 0;
  for (let i = 0; i < P; i++) {
    const end = trace.finalPools[i].volume, residual = supplied[i] + spillIn[i] - spillOut[i] - exported[i] - end;
    totalSupplied += supplied[i]; totalRain += rain[i]; stored += end; maxResidual = Math.max(maxResidual, Math.abs(residual));
    if (supplied[i] || spillIn[i] || spillOut[i] || exported[i] || end) pools.push({ pool: i, node: trace.finalPools[i].node, basins: basinsOf[i], supplied: supplied[i], rain: rain[i], spillIn: spillIn[i], spillOut: spillOut[i], exported: exported[i], volumeEnd: end, residual });
  }
  const edgeList = [...edges].map(([k, volume]) => { const [a, b] = k.split('>'); return { from: Number(a), to: b === 'water' ? 'water' : Number(b), volume }; }).sort((x, y) => x.from - y.from || String(x.to).localeCompare(String(y.to), 'en', { numeric: true }));
  return {
    pools, edges: edgeList,
    totals: { supplied: totalSupplied, rainInput: prev ? totalRain : null, exportedToWater: boundary, storedAfterInflow: stored, hopVolume: hop, crossPoolHopVolume: crossHop, internalHopVolume: internalHop, maxPoolResidual: maxResidual, activePools: pools.length },
    metadata: Object.freeze({
      scope: 'inflow phase of one coupled step; evaporation and seepage (recession phase) are not attributed to pools',
      warning: 'hopVolume counts relays: water crossing several lakes appears once per hop. It is not an amount of water; never add it to rain input or to exports',
      closure: 'per pool: supplied (old storage + new input) + spillIn - spillOut - exported = volumeEnd; internal transfers inside a final pool cancel and are excluded',
      pools: 'pools at the end of the inflow phase; may differ from published pools taken after recession'
    })
  };
}

const api = { analyze };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SurfaceWaterFlux = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
