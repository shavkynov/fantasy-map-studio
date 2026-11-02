'use strict';
const assert = require('assert/strict');
const { createSphere } = require('../src/world-domain.js');
const P = require('./world-irregular-k4-static.cjs');
const M = require('./world-irregular-k4-poses.cjs');
const { assess } = require('./world-frame-validity.cjs');
const S = createSphere({ radiusKm: 1 });
const pairs = Object.freeze([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].map(Object.freeze));
function membership(bits) {
  assert(Number.isInteger(bits) && bits >= 0 && bits < 16, 'four-bit membership required');
  const ids = [0, 1, 2, 3].filter(id => bits & (1 << id));
  return { count: ids.length, owner: ids.length === 0 ? -1 : ids.length === 1 ? ids[0] : -2,
    pairHits: pairs.map(([a, b]) => Boolean((bits & (1 << a)) && (bits & (1 << b)))) };
}
const lookup = Array.from({ length: 16 }, (_, bits) => membership(bits));
function rotations(time, direction) {
  assert(direction === 1 || direction === -1, 'direction must be +1 or -1');
  return [0, 1, 2, 3].map(id => { const q = M.pose(id, time); return direction === 1 ? q : S.inverse(q); });
}
function snapshot(time, width, direction = 1) {
  assert(Number.isInteger(width) && width >= 16 && width <= 2048 && width % 2 === 0, 'even width 16..2048 required');
  const q = rotations(time, direction), inverse = q.map(S.inverse), height = width / 2;
  const histogram = [0, 0, 0, 0, 0], areaByCoverage = [0, 0, 0, 0, 0], pieceCells = [0, 0, 0, 0], pieceAreas = [0, 0, 0, 0];
  const pairCells = Array(6).fill(0), pairAreas = Array(6).fill(0);
  let zeroTimeOwnerMismatchCells = 0;
  for (let row = 0; row < height; row++) {
    const lat = Math.PI / 2 - (row + 0.5) / height * Math.PI, c = Math.cos(lat), z = Math.sin(lat), weight = S.cellAreaKm2(width, height, row);
    for (let col = 0; col < width; col++) {
      const lon = (col + 0.5) / width * 2 * Math.PI - Math.PI, p = [c * Math.cos(lon), c * Math.sin(lon), z];
      let bits = 0;
      for (let id = 0; id < 4; id++) if (P.contains(id, S.apply(inverse[id], p))) {
        bits |= 1 << id; pieceCells[id]++; pieceAreas[id] += weight;
      }
      const state = lookup[bits]; histogram[state.count]++; areaByCoverage[state.count] += weight;
      for (let k = 0; k < 6; k++) if (state.pairHits[k]) { pairCells[k]++; pairAreas[k] += weight; }
      if (time === 0 && state.owner !== P.owner(p)) zeroTimeOwnerMismatchCells++;
    }
  }
  const overlapCells = histogram[2] + histogram[3] + histogram[4], overlapArea = areaByCoverage[2] + areaByCoverage[3] + areaByCoverage[4];
  const incidences = pairCells.reduce((a, b) => a + b, 0), expectedIncidences = histogram[2] + 3 * histogram[3] + 6 * histogram[4];
  const expectedPairArea = areaByCoverage[2] + 3 * areaByCoverage[3] + 6 * areaByCoverage[4];
  assert.equal(histogram.reduce((a, b) => a + b, 0), width * height);
  assert.equal(incidences, expectedIncidences); assert.equal(zeroTimeOwnerMismatchCells, 0);
  assert(Math.abs(pairAreas.reduce((a, b) => a + b, 0) - expectedPairArea) < 1e-10);
  assert(Math.abs(pieceAreas.reduce((a, b) => a + b, 0) - areaByCoverage.reduce((a, b, n) => a + n * b, 0)) < 1e-10);
  assert(Math.abs(areaByCoverage.reduce((a, b) => a + b, 0) - S.totalAreaKm2) < 1e-10);
  const starts = [Math.PI, 1.5 * Math.PI, 0.5 * Math.PI, 0], refs = P.reference();
  let roundTrips = 0, maxRoundTripAngle = 0;
  for (let id = 0; id < 4; id++) for (const fraction of [0.25, 0.5, 0.75]) {
    const phi = starts[id] + Math.PI / 4, a = P.radius(phi) * fraction;
    const source = Object.freeze([Math.cos(a), Math.sin(a) * Math.cos(phi), Math.sin(a) * Math.sin(phi)]);
    assert(P.contains(id, source)); const before = JSON.stringify(source);
    const moved = S.apply(q[id], source), back = S.apply(inverse[id], moved);
    assert(P.contains(id, back)); assert.equal(JSON.stringify(source), before);
    maxRoundTripAngle = Math.max(maxRoundTripAngle, S.angle(source, back)); roundTrips++;
  }
  assert(maxRoundTripAngle < 1e-12);
  const diagnostics = { overlapCells, overlapAreaFraction: overlapArea / S.totalAreaKm2, validSampledGeometry: overlapCells === 0 };
  return { time, width, height, direction, centralMeridian: 0, coverageHistogram: histogram, areaByCoverage,
    pieceCells, rasterPieceAreas: pieceAreas, pieceAreaReferences: refs,
    relativeReferenceAreaErrors: pieceAreas.map((a, id) => Math.abs(a / refs[id] - 1)),
    pairOverlapCells: pairCells, pairOverlapAreas: pairAreas, pairIncidences: incidences,
    tripleCells: histogram[3], quadrupleCells: histogram[4], zeroTimeOwnerMismatchCells,
    roundTrips, maxRoundTripAngle, diagnostics, ...assess({ diagnostics }) };
}
function unit() {
  for (let bits = 0; bits < 16; bits++) {
    const state = membership(bits), count = bits.toString(2).replace(/0/g, '').length;
    const expectedPairs = count < 2 ? 0 : count * (count - 1) / 2;
    assert.equal(state.count, count); assert.equal(state.pairHits.filter(Boolean).length, expectedPairs);
  }
  assert.deepEqual(membership(0), { count: 0, owner: -1, pairHits: Array(6).fill(false) });
  for (let id = 0; id < 4; id++) assert.equal(membership(1 << id).owner, id);
  for (let k = 0; k < pairs.length; k++) {
    const [a, b] = pairs[k], state = membership((1 << a) | (1 << b));
    assert.deepEqual(state.pairHits, pairs.map((_, index) => index === k));
  }
  assert.deepEqual(membership(7).pairHits, [true, true, false, true, false, false]);
  assert.equal(membership(7).owner, -2); assert.equal(membership(15).pairHits.filter(Boolean).length, 6);
  assert.deepEqual(assess({ diagnostics: { overlapCells: 0, overlapAreaFraction: 0, validSampledGeometry: true } }).reasons, []);
  assert.deepEqual(assess({ diagnostics: { overlapCells: 1, overlapAreaFraction: 0.01, validSampledGeometry: false } }).reasons, ['fragment-overlap']);
  for (const bits of [-1, 16, 0.5, NaN]) assert.throws(() => membership(bits));
  for (const width of [0, 15, 361, 2050, NaN]) assert.throws(() => snapshot(0, width));
  assert.throws(() => snapshot(-1, 360)); assert.throws(() => snapshot(1.1, 360)); assert.throws(() => snapshot(0, 360, 0));
  return true;
}
module.exports = { pairs, membership, snapshot, unit };
if (require.main === module) {
  unit();
  if (process.argv.includes('--unit-only')) console.log(JSON.stringify({ unitChecksPassed: true, integrationRun: false }));
  else {
    const before = JSON.stringify({ parameters: M.parameters, references: P.reference() }), frames = [];
    for (const width of [360, 720]) for (const time of [0, 0.25, 0.5, 1]) {
      const s = snapshot(time, width); assert(s.validSampledGeometry); assert.deepEqual(s.reasons, []);
      assert(s.pairOverlapCells.every(n => n === 0)); assert.equal(s.tripleCells + s.quadrupleCells, 0);
      assert(s.relativeReferenceAreaErrors.every(e => e < 0.03)); frames.push(s);
    }
    for (const width of [360, 720]) {
      const s = snapshot(0.25, width, -1); assert(!s.validSampledGeometry); assert.deepEqual(s.reasons, ['fragment-overlap']);
      assert(s.pairOverlapCells.every(n => n > 0)); assert(s.quadrupleCells > 0);
      assert(s.relativeReferenceAreaErrors.every(e => e < 0.03)); frames.push(s);
    }
    assert.equal(JSON.stringify({ parameters: M.parameters, references: P.reference() }), before);
    const fs = require('fs'), path = require('path');
    assert(!Object.keys(require.cache).some(f => path.basename(f) === 'world-v4.js'));
    const report = { unitChecksPassed: true, integrationRun: true, movingRasterRun: true,
      geometryMode: 'analytic-irregular-moving-k4', parameters: M.parameters, pairOrder: pairs, frames,
      frozenFixtureIntegrationRun: false, generatorImported: false, inputsUnchanged: true, visualAccepted: false, appIntegrated: false,
      scope: 'Analytic K4 raster snapshots only; not frozen K4/K6, continuous collision detection, accepted geography or app integration.' };
    const dir = path.join(__dirname, '../artifacts'); fs.mkdirSync(dir, { recursive: true });
    const jsonFile = path.join(dir, 'world-irregular-k4-raster-' + Date.now() + '-' + process.pid + '.json');
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' }); assert(fs.statSync(jsonFile).size > 0);
    console.log(JSON.stringify({ unitChecksPassed: true, integrationRun: true, movingRasterRun: true, geometryMode: report.geometryMode,
      snapshots: frames.length, validOpeningFrames: frames.filter(s => s.direction === 1 && s.validSampledGeometry).length,
      rejectedControlFrames: frames.filter(s => s.direction === -1 && !s.validSampledGeometry).length,
      negativeControls: frames.filter(s => s.direction === -1).map(s => ({ width: s.width, overlapCells: s.diagnostics.overlapCells, pairIncidences: s.pairIncidences, tripleCells: s.tripleCells, quadrupleCells: s.quadrupleCells })),
      pairFrameChecks: frames.length * pairs.length, roundTrips: frames.reduce((a, s) => a + s.roundTrips, 0),
      maxRasterRelativeReferenceAreaError: Math.max(...frames.flatMap(s => s.relativeReferenceAreaErrors)),
      maxRoundTripAngle: Math.max(...frames.map(s => s.maxRoundTripAngle)), inputsUnchanged: true,
      frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false, jsonFile }, null, 2));
  }
}
