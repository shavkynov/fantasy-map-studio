'use strict';
const assert = require('assert/strict');
const { createSphere } = require('../src/world-domain.js');
const P = require('./world-irregular-k6-static.cjs');
const S = createSphere({ radiusKm: 1 });
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
function envelope(alpha, rate, maxTime) {
  assert([alpha, rate, maxTime].every(Number.isFinite), 'finite envelope required');
  assert(alpha > 0 && alpha < Math.PI / 2 && rate > 0 && maxTime > 0, 'positive supported envelope required');
  const maxAngle = alpha + rate * maxTime;
  assert(maxAngle < Math.PI / 2, 'positive-x hemisphere bound required');
  return Object.freeze({ alpha, rate, maxTime, speed: rate, maxAngle, xLower: Math.cos(maxAngle) });
}
const parameters = envelope(0.65, 0.25, 1);
function geometry(id) {
  assert(Number.isInteger(id) && id >= 0 && id < 6, 'piece id 0..5 required');
  const [start, end] = P.intervals[id], middle = (start + end) / 2;
  assert(Math.abs(end - start - Math.PI / 3) < 1e-14, 'expected six-sector partition');
  const direction = Object.freeze([Math.cos(middle), Math.sin(middle)]);
  const normals = Object.freeze([Object.freeze([-Math.sin(start), Math.cos(start)]), Object.freeze([Math.sin(end), -Math.cos(end)])]);
  const projections = Object.freeze(normals.map(n => dot2(n, direction)));
  assert(projections.every(v => v > 0));
  return Object.freeze({ start, end, middle, direction, normals, projections });
}
function validTime(time) { assert(Number.isFinite(time) && time >= 0 && time <= parameters.maxTime, 'time in [0,1] required'); }
function angularVelocity(id) { const u = geometry(id).direction; return [0, -parameters.rate * u[1], parameters.rate * u[0]]; }
function pose(id, time) { validTime(time); return S.axisRotation(angularVelocity(id), parameters.speed * time); }
function support(id, time) {
  validTime(time); const g = geometry(id);
  return { time, xLower: parameters.xLower, inwardCoordinateLower: g.projections.map(v => parameters.rate * time * parameters.xLower * v), positiveTimeSeparation: time > 0 };
}
function checkSupport(id, source, moved, time) {
  const g = geometry(id), b = support(id, time), tol = 1e-12;
  assert(source[0] >= Math.cos(parameters.alpha) - tol, 'source outside cap envelope');
  assert(moved[0] >= b.xLower - tol, 'x support violated');
  for (let k = 0; k < 2; k++) {
    const initial = dot2(g.normals[k], source.slice(1)), actual = dot2(g.normals[k], moved.slice(1));
    assert(initial >= -tol, 'source closure outside sector');
    assert(actual >= initial + b.inwardCoordinateLower[k] - tol, 'inward support violated');
  }
}
function unit() {
  assert.equal(P.intervals.length, 6); assert(Math.abs(P.radius(0) - 0.65 * 0.88) < 1e-14);
  const times = [0, 0.25, 0.5, 1];
  let pointChecks = 0, roundTrips = 0, rigidDistanceChecks = 0, distinctRotationChecks = 0, supportNegativeControlsRejected = 0;
  let maxRoundTripAngle = 0, maxRigidDistanceError = 0, maxNormError = 0;
  const beforeIntervals = JSON.stringify(P.intervals);
  for (let id = 0; id < 6; id++) {
    const g = geometry(id), points = [];
    assert(Math.abs(Math.hypot(...angularVelocity(id)) - parameters.rate) < 1e-14);
    assert(g.projections.every(v => Math.abs(v - 0.5) < 1e-14));
    for (let k = 1; k <= 7; k++) for (const fraction of [0.1, 0.5, 0.9]) {
      const phi = g.start + k / 8 * (g.end - g.start), a = P.radius(phi) * fraction;
      const p = [Math.cos(a), Math.sin(a) * Math.cos(phi), Math.sin(a) * Math.sin(phi)];
      assert(P.contains(id, p)); points.push(p);
    }
    points.push([1, 0, 0]);
    for (const phi of [g.start, g.end]) points.push([Math.cos(0.2), Math.sin(0.2) * Math.cos(phi), Math.sin(0.2) * Math.sin(phi)]);
    points.forEach(Object.freeze); const before = JSON.stringify(points);
    for (const time of times) {
      const q = pose(id, time); assert(Math.abs(Math.hypot(...q) - 1) < 1e-12);
      if (time === 0) { assert.equal(q[0], 1); assert(q.slice(1).every(v => v === 0)); }
      for (const p of points) {
        const moved = S.apply(q, p), back = S.apply(S.inverse(q), moved);
        checkSupport(id, p, moved, time); pointChecks++; roundTrips++;
        maxRoundTripAngle = Math.max(maxRoundTripAngle, S.angle(p, back));
        maxNormError = Math.max(maxNormError, Math.abs(Math.hypot(...moved) - 1));
      }
      for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
        const error = Math.abs(S.angle(points[a], points[b]) - S.angle(S.apply(q, points[a]), S.apply(q, points[b])));
        maxRigidDistanceError = Math.max(maxRigidDistanceError, error); rigidDistanceChecks++;
      }
    }
    assert.equal(JSON.stringify(points), before);
    const reverse = S.apply(S.inverse(pose(id, 0.25)), [1, 0, 0]);
    assert.throws(() => checkSupport(id, [1, 0, 0], reverse, 0.25), /support violated/); supportNegativeControlsRejected++;
  }
  for (const time of times.filter(t => t > 0)) for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
    const qa = pose(a, time), qb = pose(b, time);
    const distance = Math.min(Math.hypot(...qa.map((v, i) => v - qb[i])), Math.hypot(...qa.map((v, i) => v + qb[i])));
    assert(distance > 1e-8, 'distinct rotations required modulo quaternion sign'); distinctRotationChecks++;
  }
  assert.equal(JSON.stringify(P.intervals), beforeIntervals);
  assert(maxRoundTripAngle < 1e-12 && maxRigidDistanceError < 1e-12 && maxNormError < 1e-12);
  for (const id of [-1, 6, 0.5, NaN]) { assert.throws(() => pose(id, 0)); assert.throws(() => support(id, 0)); }
  for (const time of [-0.1, 1.01, Infinity, NaN, '0']) { assert.throws(() => pose(0, time)); assert.throws(() => support(0, time)); }
  for (const args of [[0, 0.25, 1], [0.65, 0, 1], [0.65, 0.25, 0], [0.65, 1, 1], [NaN, 0.25, 1]]) assert.throws(() => envelope(...args));
  return { pointChecks, roundTrips, rigidDistanceChecks, distinctRotationChecks, supportNegativeControlsRejected,
    maxRoundTripAngle, maxRigidDistanceError, maxNormError };
}
module.exports = { parameters, envelope, geometry, angularVelocity, pose, support, checkSupport, unit };
if (require.main === module) {
  const result = { unitChecksPassed: true, ...unit() };
  if (process.argv.includes('--unit-only')) console.log(JSON.stringify({ ...result, integrationRun: false }));
  else {
    const fs = require('fs'), path = require('path');
    assert(!Object.keys(require.cache).some(f => path.basename(f) === 'world-v4.js'));
    const supportsAt1 = Array.from({ length: 6 }, (_, id) => support(id, 1));
    const report = { ...result, integrationRun: false, analyticMotionSampleRun: true, geometryMode: 'analytic-irregular-k6-poses', parameters,
      intervals: P.intervals, angularVelocities: Array.from({ length: 6 }, (_, id) => angularVelocity(id)),
      sectorGeometry: Array.from({ length: 6 }, (_, id) => geometry(id)), supportsAt1,
      distinctPrescribedMotions: true, arbitraryIndependentTuningSupported: false, movingRasterRun: false,
      frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false,
      scope: 'Six prescribed rotations and sampled inward-support checks only;analytic argument in K6_POSES.md. Not moving rasters,formal proof verification,frozen sources or app integration.' };
    const dir = path.join(__dirname, '../artifacts'); fs.mkdirSync(dir, { recursive: true });
    const jsonFile = path.join(dir, 'world-irregular-k6-poses-' + Date.now() + '-' + process.pid + '.json');
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' }); assert(fs.statSync(jsonFile).size > 0);
    console.log(JSON.stringify({ ...result, integrationRun: false, analyticMotionSampleRun: true, geometryMode: report.geometryMode,
      xLower: parameters.xLower, minInwardCoordinateLowerAt1: Math.min(...supportsAt1.flatMap(s => s.inwardCoordinateLower)),
      movingRasterRun: false, frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false, jsonFile }, null, 2));
  }
}
