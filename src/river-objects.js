(function (root) {
'use strict';
// River objects from the run history of rainfall runoff on the fixed drainage graph.
//  * channel cells: dry land cells whose observed peak runoff rate reached the threshold at least once;
//  * reaches: node-to-node pieces (headwater / confluence / closed root); reach id = its start cell;
//  * rivers: main stems assembled by following, at each confluence, the incoming reach with the larger mean flow
//    (ties: larger peak, then lower start cell); river id = its source (headwater) cell; every other branch is a tributary river;
//  * ends: ocean, closed basin, lake (a cell that was wet during the run), or tributary junction;
//  * lakes: which rivers enter a lake and which reach the lake's outlet continues in (topological, via the receiver graph).
// Identity is valid within one terrain revision and one run, like the water-body ids.
// Honest limits: the water model has scalar forcing, no groundwater and no release from lakes, so flow is zero everywhere in a dry phase.
// The regime fields therefore describe what the run OBSERVED (see `regime.dryPhaseObserved`); they do not infer permanence.
// Rates are the model's arbitrary-time runoff rates, not discharge; physical length/drop/catchment are added by `physical()`.

const OBSERVATION = Object.freeze({ intermittent: 'intermittent', throughout: 'throughout' });

function build(field, drainage, history, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['threshold', 'minCoverage', 'catalog', 'links'].includes(k))) throw Error('Invalid river options');
  const threshold = options.threshold === undefined ? 1e-6 : options.threshold;
  if (!Number.isFinite(threshold) || threshold <= 0) throw Error('Invalid river threshold');
  // a cell that was wet for more than (1 - minCoverage) of the observed time is a lake cell, not a channel cell
  const minCoverage = options.minCoverage === undefined ? 0.5 : options.minCoverage;
  if (!Number.isFinite(minCoverage) || minCoverage <= 0 || minCoverage > 1) throw Error('Invalid minCoverage');
  const { w, h, land } = field || {}, n = w * h, receiver = drainage && drainage.receiver;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || !land || land.length !== n || !receiver || receiver.length !== n || drainage.w !== w || drainage.h !== h || !drainage.accumulation || drainage.accumulation.length !== n) throw Error('Invalid river input');
  if (!history || history.w !== w || history.h !== h) throw Error('Invalid flow history');
  for (const k of ['peakFlow', 'meanFlow', 'occurrence', 'wetTime', 'eligibleTime', 'zeroFlowTime', 'maxObservedDryDuration']) if (!history[k] || history[k].length !== n) throw Error('Flow history lacks ' + k);
  const { catalog, links } = options;
  if ((catalog === undefined) !== (links === undefined)) throw Error('catalog and links must be supplied together');
  if (catalog && (catalog.w !== w || catalog.h !== h || !catalog.labels || catalog.labels.length !== n || !links.links)) throw Error('Invalid catalog or links');

  const active = new Uint8Array(n), indeg = new Uint32Array(n); let activeCells = 0, dryPhase = false;
  for (let i = 0; i < n; i++) {
    if (land[i] !== 0 && land[i] !== 1) throw Error('Invalid land mask');
    if (!land[i]) continue;
    if (history.eligibleTime[i] > 0 && history.zeroFlowTime[i] > 0) dryPhase = true;
    if (history.eligibleTime[i] > 0 && history.eligibleTime[i] >= minCoverage * history.totalTime && history.peakFlow[i] >= threshold) { active[i] = 1; activeCells++; }
  }
  for (let i = 0; i < n; i++) if (active[i]) { const r = receiver[i]; if (!Number.isInteger(r) || r === i || r >= n) throw Error('Invalid receiver'); if (r >= 0 && active[r]) indeg[r]++; }
  const isNode = i => active[i] && (indeg[i] !== 1 || receiver[i] < 0);

  // reaches
  const reaches = new Map(), order = [];
  for (let s = 0; s < n; s++) {
    if (!isNode(s)) continue;
    const startKind = indeg[s] === 0 ? 'headwater' : indeg[s] >= 2 ? 'confluence' : 'closed-root';
    if (receiver[s] < 0) { reaches.set(s, { id: s, startCell: s, startKind: 'closed-root', cells: [s], closedRoot: true }); continue; }
    const cells = [s]; let cur = s, end;
    for (let guard = 0; ; guard++) {
      if (guard > n) throw Error('Receiver cycle in channel');
      const next = receiver[cur]; cells.push(next);
      if (next < 0 || next >= n) throw Error('Invalid channel receiver');
      if (!land[next]) { end = { type: 'ocean', cell: next }; break; }
      if (active[next]) { if (isNode(next)) { end = { type: receiver[next] < 0 ? 'closed' : 'junction', cell: next }; break; } cur = next; continue; }
      end = history.wetTime[next] > 0 ? { type: 'lake', cell: next } : { type: 'below-threshold', cell: next }; break;
    }
    const flowCell = cells[cells.length - 2];
    reaches.set(s, { id: s, startCell: s, startKind, cells, flowCell, end, closedRoot: false });
  }
  // partition check: each active cell is in exactly one reach body (start..flowCell) or is a closed root
  const owner = new Int32Array(n).fill(-1);
  for (const r of reaches.values()) {
    const body = r.closedRoot ? [r.startCell] : r.cells.slice(0, r.cells.length - 1);
    for (const c of body) { if (owner[c] >= 0) throw Error('Cell in two reaches'); owner[c] = r.id; }
  }
  for (let i = 0; i < n; i++) if (active[i] && owner[i] < 0) throw Error('Active cell outside every reach');

  // topological order, upstream first: a reach is ready when all reaches ending at its start cell are done
  const incoming = new Map(); for (const r of reaches.values()) if (!r.closedRoot && (r.end.type === 'junction' || r.end.type === 'closed')) { if (!incoming.has(r.end.cell)) incoming.set(r.end.cell, []); incoming.get(r.end.cell).push(r.id); }
  const pending = new Map(); for (const r of reaches.values()) pending.set(r.id, (incoming.get(r.id) || []).length);
  const queue = [...reaches.values()].filter(r => pending.get(r.id) === 0).map(r => r.id).sort((a, b) => a - b);
  for (let q = 0; q < queue.length; q++) { const r = reaches.get(queue[q]); order.push(r.id); if (!r.closedRoot && (r.end.type === 'junction' || r.end.type === 'closed')) { const d = r.end.cell; if (reaches.has(d)) { pending.set(d, pending.get(d) - 1); if (pending.get(d) === 0) queue.push(d); } } }
  if (order.length !== reaches.size) throw Error('Channel graph is not a forest');

  // statistics, order, rivers
  for (const r of reaches.values()) {
    const a = r.startCell, b = r.closedRoot ? r.startCell : r.flowCell;
    r.startOccurrence = history.occurrence[a]; r.endOccurrence = history.occurrence[b]; r.startMeanFlow = history.meanFlow[a]; r.endMeanFlow = history.meanFlow[b]; r.endPeakFlow = history.peakFlow[b];
    r.maxObservedDryDuration = history.maxObservedDryDuration[a];
    r.observation = history.zeroFlowTime[a] > 0 ? OBSERVATION.intermittent : OBSERVATION.throughout;
    r.cellCount = r.closedRoot ? 1 : r.cells.length - 1;
    r.catchmentSteradians = drainage.accumulation[b];
  }
  const incomingOf = id => incoming.get(id) || [];
  const strahler = new Map(), riverOf = new Map(), mainIn = new Map();
  for (const id of order) {
    const r = reaches.get(id), inc = incomingOf(id);
    if (inc.length === 0) { strahler.set(id, 1); riverOf.set(id, id); continue; }
    const ranked = inc.slice().sort((x, y) => { const a = reaches.get(x), b = reaches.get(y); return (b.endMeanFlow - a.endMeanFlow) || (b.endPeakFlow - a.endPeakFlow) || (x - y); });
    mainIn.set(id, ranked[0]); riverOf.set(id, riverOf.get(ranked[0]));
    const orders = inc.map(x => strahler.get(x)).sort((x, y) => y - x);
    strahler.set(id, inc.length >= 2 && orders[0] === orders[1] ? orders[0] + 1 : orders[0]);
  }
  // rivers: chains of reaches sharing a river id, upstream -> downstream
  const rivers = new Map();
  for (const id of order) { const rv = riverOf.get(id); if (!rivers.has(rv)) rivers.set(rv, { id: rv, sourceCell: rv, reaches: [] }); rivers.get(rv).reaches.push(id); }
  const labelOf = cell => (catalog ? catalog.labels[cell] : -1), linkByLabel = new Map(links ? links.links.map(x => [x.object, x]) : []);
  const riverList = [];
  for (const rv of rivers.values()) {
    const first = reaches.get(rv.reaches[0]), last = reaches.get(rv.reaches[rv.reaches.length - 1]);
    for (let k = 0; k + 1 < rv.reaches.length; k++) { const a = reaches.get(rv.reaches[k]); if (a.end.cell !== rv.reaches[k + 1]) throw Error('River chain is not connected'); }
    let mouth;
    const lakeAt = cell => { const l = labelOf(cell), lk = linkByLabel.get(l); return l >= 0 ? { lakeLabel: l, lakeAnchor: lk ? lk.anchorCell : null } : { lakeLabel: null, lakeAnchor: null }; };
    if (last.closedRoot) mouth = { type: 'closed', cell: last.startCell, ...lakeAt(last.startCell) };
    else if (last.end.type === 'junction' || last.end.type === 'closed') { const d = last.end.cell; mouth = { type: 'tributary', cell: d, joinsRiver: riverOf.get(d) }; }
    else if (last.end.type === 'lake') mouth = { type: 'lake', cell: last.end.cell, ...lakeAt(last.end.cell) };
    else mouth = { type: last.end.type, cell: last.end.cell };
    riverList.push({ id: rv.id, sourceCell: rv.sourceCell, reaches: rv.reaches.slice(), reachCount: rv.reaches.length, mouth, order: strahler.get(last.id), observation: first.observation, sourceOccurrence: first.startOccurrence, maxObservedDryDuration: first.maxObservedDryDuration, meanFlowAtMouth: last.endMeanFlow, peakFlowAtMouth: last.endPeakFlow, catchmentSteradians: last.catchmentSteradians });
  }
  riverList.sort((a, b) => a.id - b.id);
  const reachList = order.map(id => reaches.get(id)).sort((a, b) => a.id - b.id).map(r => ({ id: r.id, river: riverOf.get(r.id), startCell: r.startCell, startKind: r.startKind, cells: r.closedRoot ? [r.startCell] : r.cells.slice(), cellCount: r.cellCount, end: r.closedRoot ? { type: 'closed', cell: r.startCell } : { ...r.end }, downstream: !r.closedRoot && (r.end.type === 'junction' || r.end.type === 'closed') && reaches.has(r.end.cell) ? r.end.cell : null, order: strahler.get(r.id), observation: r.observation, startOccurrence: r.startOccurrence, endOccurrence: r.endOccurrence, startMeanFlow: r.startMeanFlow, endMeanFlow: r.endMeanFlow, endPeakFlow: r.endPeakFlow, maxObservedDryDuration: r.maxObservedDryDuration, catchmentSteradians: r.catchmentSteradians }));

  // lakes: rivers entering a lake, and the reach in which the lake's outlet continues
  const lakes = new Map();
  for (const rv of riverList) if (rv.mouth.type === 'lake' || (rv.mouth.type === 'closed' && rv.mouth.lakeLabel !== null)) { const key = rv.mouth.lakeAnchor !== null ? rv.mouth.lakeAnchor : 'cell:' + rv.mouth.cell; if (!lakes.has(key)) lakes.set(key, { anchorCell: rv.mouth.lakeAnchor, lakeLabel: rv.mouth.lakeLabel, entryCells: [], inflowRivers: [], outlet: null }); const L = lakes.get(key); L.inflowRivers.push(rv.id); L.entryCells.push(rv.mouth.cell); }
  // follow the receiver graph from a cell: the first channel reach met, else where the chain ends (ocean, or a closed root which may hold a lake)
  function followDownstream(cell) {
    let cur = cell, guard = 0;
    while (cur >= 0 && cur < n && land[cur] && guard++ <= n) { if (active[cur]) return { reach: owner[cur], endsAt: null }; if (receiver[cur] < 0) return { reach: null, endsAt: { type: 'closed', cell: cur, ...lakeAtCell(cur) } }; cur = receiver[cur]; }
    return { reach: null, endsAt: { type: cur >= 0 && cur < n && !land[cur] ? 'ocean' : 'unresolved', cell: cur } };
  }
  function lakeAtCell(cell) { const l = labelOf(cell), lk = linkByLabel.get(l); return l >= 0 ? { lakeLabel: l, lakeAnchor: lk ? lk.anchorCell : null } : { lakeLabel: null, lakeAnchor: null }; }
  if (links) for (const x of links.links) {
    if (!lakes.has(x.anchorCell)) lakes.set(x.anchorCell, { anchorCell: x.anchorCell, lakeLabel: x.object, entryCells: [], inflowRivers: [], outlet: null });
    const L = lakes.get(x.anchorCell), o = x.outlet;
    if (o) { const f = followDownstream(o.toCell); L.outlet = { toCell: o.toCell, target: o.target, toObject: o.toObject, continuesInReach: f.reach, endsAt: f.endsAt, headroom: o.headroom, atSpillLevel: o.atSpillLevel }; }
  }
  const lakeList = [...lakes.values()].sort((a, b) => (a.anchorCell === null) - (b.anchorCell === null) || a.anchorCell - b.anchorCell);
  for (const L of lakeList) { L.inflowRivers.sort((a, b) => a - b); L.entryCells.sort((a, b) => a - b); if (L.outlet && L.outlet.continuesInReach !== null) L.outlet.continuesInRiver = riverOf.get(L.outlet.continuesInReach); }

  const count = k => riverList.filter(r => r.mouth.type === k).length;
  return {
    w, h, threshold, minCoverage, rivers: riverList, reaches: reachList, lakes: lakeList,
    summary: { activeCells, reachCount: reachList.length, riverCount: riverList.length, tributaries: count('tributary'), toOcean: count('ocean'), toClosedBasin: count('closed'), toLake: count('lake'), closedWithLake: riverList.filter(r => r.mouth.type === 'closed' && r.mouth.lakeLabel !== null).length, belowThreshold: count('below-threshold'), maxOrder: riverList.reduce((a, r) => Math.max(a, r.order), 0), lakesWithInflow: lakeList.filter(l => l.inflowRivers.length).length },
    regime: { dryPhaseObserved: dryPhase, totalTime: history.totalTime, steps: history.steps, throughout: riverList.filter(r => r.observation === 'throughout').length, intermittent: riverList.filter(r => r.observation === 'intermittent').length,
      note: dryPhase ? 'the run contained a period with no runoff on some dry land; "intermittent" = flow stopped at the source reach at least once' : 'no dry-land cell ever had zero runoff in this run, so every channel "flowed throughout" by construction: permanence was NOT tested' },
    metadata: Object.freeze({
      method: 'channel cells = dry land observed (not wet) for at least minCoverage of the run, with peak runoff >= threshold; reaches between headwater/confluence/closed nodes on the fixed receiver graph; main stem = larger mean flow at each confluence',
      scope: 'topology and observed flow of one run on one terrain; ids = source / start cell, valid within one terrain revision; not discharge, not a climate or seasonal classification',
      limits: 'scalar forcing, no groundwater, no release from lakes: a dry phase stops all runoff, so regime classes cannot separate perennial from ephemeral rivers; lake outlet continuation is topological (receiver graph), the spill is not routed along it',
      units: 'rates in relative-height*steradian per model time; catchment in steradians (see physical() for km, m)',
      terrainModified: false, waterModified: false
    })
  };
}

// Physical length / drop / slope / catchment for a built result, using an ElevationScale object. Does not change the result.
function physical(result, field, scale) {
  if (!result || !Array.isArray(result.reaches) || !field || !field.angularDistance || !field.height || !scale || typeof scale.distanceKm !== 'function' || typeof scale.areaKm2 !== 'function' || typeof scale.toMeters !== 'function') throw Error('Invalid physical input');
  const reachInfo = new Map();
  for (const r of result.reaches) {
    let len = 0; for (let k = 0; k + 1 < r.cells.length; k++) len += field.angularDistance(r.cells[k], r.cells[k + 1]);
    const lengthKm = scale.distanceKm(len), top = field.height[r.cells[0]], endCell = r.cells[r.cells.length - 1], bottom = r.cells.length > 1 && field.land[endCell] ? field.height[endCell] : 0;
    const dropM = scale.toMeters(Math.max(0, top - bottom));
    reachInfo.set(r.id, { lengthKm, dropM, slopeMPerKm: lengthKm > 0 ? dropM / lengthKm : 0, catchmentKm2: scale.areaKm2(r.catchmentSteradians) });
  }
  const rivers = result.rivers.map(rv => { let len = 0, drop = 0; for (const id of rv.reaches) { const x = reachInfo.get(id); len += x.lengthKm; drop += x.dropM; } return { id: rv.id, lengthKm: len, dropM: drop, slopeMPerKm: len > 0 ? drop / len : 0, catchmentKm2: scale.areaKm2(rv.catchmentSteradians) }; });
  return { reaches: [...reachInfo].map(([id, v]) => ({ id, ...v })), rivers, record: scale.record, metadata: Object.freeze({ scope: 'length along cell centres on the planet radius of the scale; drop = height difference start to end of each reach; mean over cells, not channel gradient' }) };
}

const api = { build, physical };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RiverObjects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
