(function (root) {
'use strict';
// Presentation layer on top of RiverObjects: choose which rivers to SHOW for a given scale of interest. It never changes the objects,
// and the full network stays the source of truth. Criteria are Strahler order and catchment area (steradians, or km2 with a scale).
// A selected river always brings the rivers it joins downstream, so a shown tributary never ends in thin air.

function select(result, criteria = {}, scale) {
  if (!result || !Array.isArray(result.rivers) || !Array.isArray(result.reaches) || !Array.isArray(result.lakes)) throw Error('Invalid river result');
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria) || Object.keys(criteria).some(k => !['minOrder', 'minCatchmentSteradians', 'minCatchmentKm2'].includes(k))) throw Error('Invalid selection criteria');
  const minOrder = criteria.minOrder === undefined ? 1 : criteria.minOrder;
  let minCatchment = criteria.minCatchmentSteradians === undefined ? 0 : criteria.minCatchmentSteradians;
  if (!Number.isInteger(minOrder) || minOrder < 1) throw Error('Invalid minOrder');
  if (!Number.isFinite(minCatchment) || minCatchment < 0) throw Error('Invalid minCatchmentSteradians');
  if (criteria.minCatchmentKm2 !== undefined) {
    if (!scale || !scale.record || !Number.isFinite(scale.record.radiusKm) || !Number.isFinite(criteria.minCatchmentKm2) || criteria.minCatchmentKm2 < 0) throw Error('minCatchmentKm2 needs a scale and a non-negative value');
    minCatchment = Math.max(minCatchment, criteria.minCatchmentKm2 / (scale.record.radiusKm * scale.record.radiusKm));
  }
  const byId = new Map(result.rivers.map(r => [r.id, r])), chosen = new Set();
  for (const r of result.rivers) if (r.order >= minOrder && r.catchmentSteradians >= minCatchment) chosen.add(r.id);
  const direct = chosen.size; let added = 0;
  for (const id of [...chosen]) { let cur = byId.get(id), guard = 0; while (cur && cur.mouth.type === 'tributary' && guard++ <= byId.size) { const next = cur.mouth.joinsRiver; if (!chosen.has(next)) { chosen.add(next); added++; } cur = byId.get(next); } }
  const rivers = [...chosen].sort((a, b) => a - b), reaches = result.rivers.filter(r => chosen.has(r.id)).flatMap(r => r.reaches).sort((a, b) => a - b);
  const lakes = result.lakes.filter(l => l.inflowRivers.some(id => chosen.has(id)) || (l.outlet && l.outlet.continuesInRiver !== undefined && chosen.has(l.outlet.continuesInRiver))).map(l => l.anchorCell);
  return { rivers, reaches, lakes, counts: { selected: rivers.length, chosenByCriteria: direct, addedForConnectivity: added, of: result.rivers.length }, criteria: { minOrder, minCatchmentSteradians: minCatchment } };
}

const api = { select };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RiverSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
