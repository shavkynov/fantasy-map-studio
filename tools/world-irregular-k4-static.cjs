'use strict';
const assert = require('assert/strict');
const ALPHA = 0.65;
const radius = phi => ALPHA * (0.8 + 0.12 * Math.sin(3 * phi) + 0.08 * Math.cos(5 * phi));
function point(p) {
  assert(Array.isArray(p) && p.length === 3 && p.every(Number.isFinite), 'finite xyz required');
  assert(Math.abs(Math.hypot(...p) - 1) < 1e-10, 'unit vector required');
}
function inside(p) { return p[0] >= Math.cos(radius(Math.atan2(p[2], p[1]))); }
function mask(id, p) {
  return inside(p) && (id % 2 ? p[1] >= 0 : p[1] < 0) && (id >= 2 ? p[2] >= 0 : p[2] < 0);
}
function contains(id, p) {
  assert(Number.isInteger(id) && id >= 0 && id < 4, 'piece id 0..3 required');
  point(p); return mask(id, p);
}
function owner(p) { point(p); return inside(p) ? Number(p[1] >= 0) + 2 * Number(p[2] >= 0) : -1; }
function integral(start, span, n) {
  assert(Number.isInteger(n) && n >= 2 && n <= 65536 && n % 2 === 0, 'even panels 2..65536 required');
  const step = span / n; let sum = 0;
  for (let k = 0; k <= n; k++) sum += (k === 0 || k === n ? 1 : k % 2 ? 4 : 2) * (1 - Math.cos(radius(start + k * step)));
  return sum * step / 3;
}
function reference(n = 8192) { return [Math.PI, 1.5 * Math.PI, 0.5 * Math.PI, 0].map(s => integral(s, Math.PI / 2, n)); }
function audit(parent, hits) {
  assert(typeof parent === 'boolean' && Array.isArray(hits) && hits.length === 4 && hits.every(h => typeof h === 'boolean'));
  const count = hits.filter(Boolean).length;
  return { missingParentCells: Number(parent && count === 0), outsideParentCells: Number(!parent && count > 0), multipleOwnerCells: Number(count > 1) };
}
function checkPartition(result) {
  for (const name of ['missingParentCells', 'outsideParentCells', 'multipleOwnerCells']) assert.equal(result[name], 0, name);
}
function snapshot(width) {
  assert(Number.isInteger(width) && width >= 16 && width <= 2048 && width % 2 === 0, 'even width 16..2048 required');
  const height = width / 2, counts = [0, 0, 0, 0], areas = [0, 0, 0, 0];
  const result = { width, height, missingParentCells: 0, outsideParentCells: 0, multipleOwnerCells: 0, ownerMismatchCells: 0, parentCells: 0 };
  let parentArea = 0;
  for (let row = 0; row < height; row++) {
    const top = Math.PI / 2 - row / height * Math.PI, bottom = Math.PI / 2 - (row + 1) / height * Math.PI;
    const lat = Math.PI / 2 - (row + 0.5) / height * Math.PI, c = Math.cos(lat), z = Math.sin(lat);
    const weight = 2 * Math.PI / width * (Math.sin(top) - Math.sin(bottom));
    for (let col = 0; col < width; col++) {
      const lon = (col + 0.5) / width * 2 * Math.PI - Math.PI, p = [c * Math.cos(lon), c * Math.sin(lon), z];
      const parent = inside(p), hits = [0, 1, 2, 3].map(id => mask(id, p)), errors = audit(parent, hits), expected = owner(p);
      for (const key of Object.keys(errors)) result[key] += errors[key];
      if (parent) { result.parentCells++; parentArea += weight; }
      const actual = hits.indexOf(true); if (actual !== expected) result.ownerMismatchCells++;
      for (let id = 0; id < 4; id++) if (hits[id]) { counts[id]++; areas[id] += weight; }
    }
  }
  const refs = reference();
  return { ...result, pieceCells: counts, rasterPieceAreas: areas, parentRasterArea: parentArea,
    rasterAreaSumDifference: Math.abs(areas.reduce((a, b) => a + b, 0) - parentArea),
    relativeReferenceAreaErrors: areas.map((a, i) => Math.abs(a / refs[i] - 1)) };
}
function unit() {
  const boundary = [ [1, 0, 0], [1, -0, 0], [1, 0, -0], [1, -0, -0] ].map(p => ({ p, expected: 3 }));
  for (const a of [0.1, 0.3]) for (const sign of [-1, 1]) {
    boundary.push({ p: [Math.cos(a), 0, sign * Math.sin(a)], expected: sign > 0 ? 3 : 1 });
    boundary.push({ p: [Math.cos(a), sign * Math.sin(a), 0], expected: sign > 0 ? 3 : 2 });
  }
  for (const { p, expected } of boundary) {
    Object.freeze(p); assert.equal(owner(p), expected);
    assert.deepEqual([0, 1, 2, 3].map(id => contains(id, p)), [0, 1, 2, 3].map(id => id === expected));
  }
  for (const [id, phi] of [1.25, 1.75, 0.75, 0.25].map((v, i) => [i, v * Math.PI])) {
    const a = radius(phi) / 2, p = [Math.cos(a), Math.sin(a) * Math.cos(phi), Math.sin(a) * Math.sin(phi)];
    assert.equal(owner(p), id); assert(contains(id, p));
  }
  assert.equal(owner([-1, 0, 0]), -1);
  assert.deepEqual([0, 1, 2, 3].map(id => contains(id, [-1, 0, 0])), [false, false, false, false]);
  const refs = reference(), coarse = reference(4096), lower = Math.PI / 2 * (1 - Math.cos(0.6 * ALPHA)), upper = Math.PI / 2 * (1 - Math.cos(ALPHA));
  assert(refs.every((a, i) => a > lower && a < upper && Math.abs(a - coarse[i]) < 1e-10));
  const halves = [integral(Math.PI / 2, Math.PI, 8192), integral(-Math.PI / 2, Math.PI, 8192)];
  assert(Math.abs(refs[0] + refs[2] - halves[0]) < 1e-10);
  assert(Math.abs(refs[1] + refs[3] - halves[1]) < 1e-10);
  assert(Math.abs(refs.reduce((a, b) => a + b, 0) - integral(0, 2 * Math.PI, 32768)) < 1e-10);
  checkPartition(audit(true, [true, false, false, false]));
  assert.throws(() => checkPartition(audit(true, [false, false, false, false])), /missingParentCells/);
  assert.throws(() => checkPartition(audit(false, [true, false, false, false])), /outsideParentCells/);
  assert.throws(() => checkPartition(audit(true, [true, true, false, false])), /multipleOwnerCells/);
  for (const id of [-1, 4, 0.5, NaN]) assert.throws(() => contains(id, [1, 0, 0]));
  for (const p of [[0, 0, 0], [2, 0, 0], [NaN, 0, 0], [1, 0]]) assert.throws(() => owner(p));
  for (const n of [0, 3, 2.5, 65538, NaN]) assert.throws(() => reference(n));
  for (const width of [0, 15, 361, 2050, NaN]) assert.throws(() => snapshot(width));
  return { boundaryProbes: boundary.length, detectorNegativeControlsRejected: 3 };
}
module.exports = { radius, contains, owner, reference, audit, checkPartition, snapshot, unit };
if (require.main === module) {
  const checks = unit();
  if (process.argv.includes('--unit-only')) console.log(JSON.stringify({ unitChecksPassed: true, integrationRun: false, ...checks }));
  else {
    const grids = [360, 720].map(snapshot);
    for (const s of grids) {
      checkPartition(s); assert.equal(s.ownerMismatchCells, 0); assert(s.pieceCells.every(n => n > 0));
      assert(s.relativeReferenceAreaErrors.every(e => e < 0.03)); assert(s.rasterAreaSumDifference < 1e-10);
    }
    const fs = require('fs'), path = require('path');
    assert(!Object.keys(require.cache).some(f => path.basename(f) === 'world-v4.js'));
    const refs = reference(), coarse = reference(4096);
    const report = { unitChecksPassed: true, integrationRun: true, geometryMode: 'analytic-irregular-static-k4',
      frozenFixtureIntegrationRun: false, motionTested: false, generatorImported: false, visualAccepted: false, appIntegrated: false,
      alpha: ALPHA, radialProfile: 'alpha*(0.8+0.12*sin(3*phi)+0.08*cos(5*phi))',
      ownership: 'Inside parent: id=(y>=0?1:0)+(z>=0?2:0); outside:-1. Signed zeros belong to nonnegative side.',
      pieceAreaReferences: refs, maxQuadratureDifference: Math.max(...refs.map((a, i) => Math.abs(a - coarse[i]))),
      areaReferenceMethod: 'Composite Simpson8192 per quarter;4096 comparison; numerical,not exact.', ...checks, grids,
      scope: 'Static analytic partition only. Not frozen K4, motion, continuous collision proof, accepted geography or app integration.' };
    const dir = path.join(__dirname, '../artifacts'); fs.mkdirSync(dir, { recursive: true });
    const jsonFile = path.join(dir, 'world-irregular-k4-static-' + Date.now() + '-' + process.pid + '.json');
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' }); assert(fs.statSync(jsonFile).size > 0);
    console.log(JSON.stringify({ unitChecksPassed: true, integrationRun: true, geometryMode: report.geometryMode,
      grids: grids.length, missingParentCells: grids.reduce((a, s) => a + s.missingParentCells, 0),
      outsideParentCells: grids.reduce((a, s) => a + s.outsideParentCells, 0), multipleOwnerCells: grids.reduce((a, s) => a + s.multipleOwnerCells, 0),
      ownerMismatchCells: grids.reduce((a, s) => a + s.ownerMismatchCells, 0), ...checks,
      maxRasterRelativeReferenceAreaError: Math.max(...grids.flatMap(s => s.relativeReferenceAreaErrors)),
      maxQuadratureDifference: report.maxQuadratureDifference, frozenFixtureIntegrationRun: false, motionTested: false,
      generatorImported: false, visualAccepted: false, appIntegrated: false, jsonFile }, null, 2));
  }
}
