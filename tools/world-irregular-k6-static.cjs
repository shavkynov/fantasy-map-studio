'use strict';
const assert = require('assert/strict');
const P = require('./world-irregular-k4-static.cjs');
const cuts = Object.freeze([-Math.PI, -2 * Math.PI / 3, -Math.PI / 3, 0, Math.PI / 3, 2 * Math.PI / 3, Math.PI]);
const intervals = Object.freeze(Array.from({ length: 6 }, (_, id) => Object.freeze([cuts[id], cuts[id + 1]])));
function angle(phi) {
  assert(Number.isFinite(phi) && phi >= -Math.PI && phi <= Math.PI, 'atan2 angle in [-pi,pi] required');
  return phi === Math.PI ? -Math.PI : phi;
}
function sector(phi) {
  const a = angle(phi); let id = 0;
  while (id < 5 && a >= cuts[id + 1]) id++;
  return id;
}
function owner(p) {
  if (P.owner(p) < 0) return -1;
  if (p[1] === 0 && p[2] === 0) return 0;
  return sector(Math.atan2(p[2], p[1]));
}
function contains(id, p) {
  assert(Number.isInteger(id) && id >= 0 && id < 6, 'piece id 0..5 required');
  if (P.owner(p) < 0) return false;
  if (p[1] === 0 && p[2] === 0) return id === 0;
  const a = angle(Math.atan2(p[2], p[1]));
  return a >= cuts[id] && a < cuts[id + 1];
}
function reference(n = 8192) {
  assert(Number.isInteger(n) && n >= 2 && n <= 65536 && n % 2 === 0, 'even panels 2..65536 required');
  return intervals.map(([start, end]) => {
    const step = (end - start) / n; let sum = 0;
    for (let k = 0; k <= n; k++) sum += (k === 0 || k === n ? 1 : k % 2 ? 4 : 2) * (1 - Math.cos(P.radius(start + k * step)));
    return sum * step / 3;
  });
}
function audit(parent, hits) {
  assert(typeof parent === 'boolean' && Array.isArray(hits) && hits.length === 6 && Array.from(hits).every(h => typeof h === 'boolean'));
  const count = hits.filter(Boolean).length;
  return { missingParentCells: Number(parent && count === 0), outsideParentCells: Number(!parent && count > 0), multipleOwnerCells: Number(count > 1) };
}
function checkPartition(result) {
  for (const name of ['missingParentCells', 'outsideParentCells', 'multipleOwnerCells']) assert.equal(result[name], 0, name);
}
function snapshot(width) {
  assert(Number.isInteger(width) && width >= 16 && width <= 2048 && width % 2 === 0, 'even width 16..2048 required');
  const height = width / 2, counts = Array(6).fill(0), areas = Array(6).fill(0);
  const result = { width, height, missingParentCells: 0, outsideParentCells: 0, multipleOwnerCells: 0, ownerMismatchCells: 0, parentCells: 0 };
  let parentArea = 0;
  for (let row = 0; row < height; row++) {
    const top = Math.PI / 2 - row / height * Math.PI, bottom = Math.PI / 2 - (row + 1) / height * Math.PI;
    const lat = Math.PI / 2 - (row + 0.5) / height * Math.PI, c = Math.cos(lat), z = Math.sin(lat);
    const weight = 2 * Math.PI / width * (Math.sin(top) - Math.sin(bottom));
    for (let col = 0; col < width; col++) {
      const lon = (col + 0.5) / width * 2 * Math.PI - Math.PI, p = [c * Math.cos(lon), c * Math.sin(lon), z];
      const parent = P.owner(p) >= 0, hits = Array.from({ length: 6 }, (_, id) => contains(id, p)), errors = audit(parent, hits);
      for (const key of Object.keys(errors)) result[key] += errors[key];
      if (parent) { result.parentCells++; parentArea += weight; }
      if (hits.indexOf(true) !== owner(p)) result.ownerMismatchCells++;
      for (let id = 0; id < 6; id++) if (hits[id]) { counts[id]++; areas[id] += weight; }
    }
  }
  const refs = reference();
  return { ...result, pieceCells: counts, rasterPieceAreas: areas, parentRasterArea: parentArea,
    rasterAreaSumDifference: Math.abs(areas.reduce((a, b) => a + b, 0) - parentArea),
    relativeReferenceAreaErrors: areas.map((a, id) => Math.abs(a / refs[id] - 1)) };
}
function unit() {
  let angularBoundaryChecks = 0, interiorProbes = 0;
  for (let id = 0; id < 6; id++) {
    assert.equal(sector(cuts[id]), id);
    assert.equal(sector(id === 0 ? Math.PI - 1e-9 : cuts[id] - 1e-9), id === 0 ? 5 : id - 1);
    assert.equal(sector(cuts[id] + 1e-9), id); angularBoundaryChecks += 3;
    const [start, end] = intervals[id];
    for (const offset of [0.25, 0.5, 0.75]) for (const fraction of [0.25, 0.5, 0.75]) {
      const phi = start + offset * (end - start), a = fraction * P.radius(phi);
      const p = Object.freeze([Math.cos(a), Math.sin(a) * Math.cos(phi), Math.sin(a) * Math.sin(phi)]), before = JSON.stringify(p);
      assert.equal(owner(p), id); assert(contains(id, p)); assert.equal(JSON.stringify(p), before); interiorProbes++;
    }
  }
  assert.equal(sector(Math.PI), 0); assert.equal(sector(0), 3); assert.equal(sector(-0), 3); angularBoundaryChecks += 3;
  const probes = [[1, 0, 0], [1, -0, 0], [1, 0, -0], [1, -0, -0]].map(p => ({ p, expected: 0 }));
  const a = 0.2, c = Math.cos(a), s = Math.sin(a);
  for (const zero of [0, -0]) probes.push({ p: [c, s, zero], expected: 3 }, { p: [c, -s, zero], expected: 0 },
    { p: [c, zero, s], expected: 4 }, { p: [c, zero, -s], expected: 1 });
  for (const phi of cuts.slice(0, 6)) for (const psi of [0.1, 0.3]) probes.push({ p: [Math.cos(psi), Math.sin(psi) * Math.cos(phi), Math.sin(psi) * Math.sin(phi)], expected: null });
  for (const { p, expected } of probes) {
    Object.freeze(p); const hits = Array.from({ length: 6 }, (_, id) => contains(id, p));
    assert.equal(hits.filter(Boolean).length, 1); assert.equal(hits.indexOf(true), owner(p));
    if (expected !== null) assert.equal(owner(p), expected);
  }
  assert.equal(owner([-1, 0, 0]), -1);
  assert(Array.from({ length: 6 }, (_, id) => !contains(id, [-1, 0, 0])).every(Boolean));
  const refs = reference(), coarse = reference(4096), lower = Math.PI / 3 * (1 - Math.cos(0.6 * 0.65)), upper = Math.PI / 3 * (1 - Math.cos(0.65));
  assert(refs.every((area, id) => area > lower && area < upper && Math.abs(area - coarse[id]) < 1e-10));
  const parentArea = P.reference().reduce((x, y) => x + y, 0), referenceAreaSumDifference = Math.abs(refs.reduce((x, y) => x + y, 0) - parentArea);
  assert(referenceAreaSumDifference < 1e-10);
  checkPartition(audit(true, [true, false, false, false, false, false]));
  assert.throws(() => checkPartition(audit(true, Array(6).fill(false))), /missingParentCells/);
  assert.throws(() => checkPartition(audit(false, [true, false, false, false, false, false])), /outsideParentCells/);
  assert.throws(() => checkPartition(audit(true, [true, false, false, false, false, true])), /multipleOwnerCells/);
  assert.throws(() => audit(true, Array(6)));
  for (const id of [-1, 6, 0.5, NaN]) assert.throws(() => contains(id, [1, 0, 0]));
  for (const p of [[0, 0, 0], [2, 0, 0], [NaN, 0, 0], [1, 0]]) assert.throws(() => owner(p));
  for (const phi of [-Math.PI - 0.1, Math.PI + 0.1, NaN, Infinity]) assert.throws(() => sector(phi));
  for (const n of [0, 3, 2.5, 65538, NaN]) assert.throws(() => reference(n));
  for (const width of [0, 15, 361, 2050, NaN]) assert.throws(() => snapshot(width));
  return { angularBoundaryChecks, boundaryProbes: probes.length, interiorProbes, detectorNegativeControlsRejected: 3, referenceAreaSumDifference };
}
module.exports = { cuts, intervals, radius: P.radius, sector, owner, contains, reference, audit, checkPartition, snapshot, unit };
if (require.main === module) {
  const checks = unit();
  if (process.argv.includes('--unit-only')) console.log(JSON.stringify({ unitChecksPassed: true, integrationRun: false, ...checks }));
  else {
    const before = JSON.stringify({ cuts, parentReferences: P.reference() }), grids = [360, 720].map(snapshot);
    for (const s of grids) {
      checkPartition(s); assert.equal(s.ownerMismatchCells, 0); assert(s.pieceCells.every(n => n > 0));
      assert(s.relativeReferenceAreaErrors.every(e => e < 0.03)); assert(s.rasterAreaSumDifference < 1e-10);
    }
    assert.equal(JSON.stringify({ cuts, parentReferences: P.reference() }), before);
    const fs = require('fs'), path = require('path');
    assert(!Object.keys(require.cache).some(f => path.basename(f) === 'world-v4.js'));
    const refs = reference(), coarse = reference(4096);
    const report = { unitChecksPassed: true, integrationRun: true, geometryMode: 'analytic-irregular-static-k6',
      ...checks, intervals, pieceAreaReferences: refs, maxQuadratureDifference: Math.max(...refs.map((a, id) => Math.abs(a - coarse[id]))), grids,
      areaReferenceMethod: 'Composite Simpson8192 per sector;4096 comparison;numerical,not exact.',
      ownership: 'Half-open atan2 intervals[-pi,pi);+pi maps to-pi;central point assigned0 for all signed zeros;outside=-1.',
      inputsUnchanged: true, motionTested: false, frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false,
      scope: 'Static six-sector analytic partition only;not frozen K6,six separated continents,motion or app integration.' };
    const dir = path.join(__dirname, '../artifacts'); fs.mkdirSync(dir, { recursive: true });
    const jsonFile = path.join(dir, 'world-irregular-k6-static-' + Date.now() + '-' + process.pid + '.json');
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' }); assert(fs.statSync(jsonFile).size > 0);
    console.log(JSON.stringify({ unitChecksPassed: true, integrationRun: true, geometryMode: report.geometryMode, grids: grids.length,
      missingParentCells: grids.reduce((a, s) => a + s.missingParentCells, 0), outsideParentCells: grids.reduce((a, s) => a + s.outsideParentCells, 0),
      multipleOwnerCells: grids.reduce((a, s) => a + s.multipleOwnerCells, 0), ownerMismatchCells: grids.reduce((a, s) => a + s.ownerMismatchCells, 0), ...checks,
      maxRasterRelativeReferenceAreaError: Math.max(...grids.flatMap(s => s.relativeReferenceAreaErrors)), maxQuadratureDifference: report.maxQuadratureDifference,
      inputsUnchanged: true, motionTested: false, frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false, jsonFile }, null, 2));
  }
}
