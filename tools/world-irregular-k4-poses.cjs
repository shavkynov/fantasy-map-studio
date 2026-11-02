'use strict';
const assert = require('assert/strict');
const { createSphere } = require('../src/world-domain.js');
const P = require('./world-irregular-k4-static.cjs');
const S = createSphere({ radiusKm: 1 });
function envelope(alpha, rate, maxTime) {
  assert([alpha, rate, maxTime].every(Number.isFinite), 'finite envelope required');
  assert(alpha > 0 && alpha < Math.PI / 2 && rate > 0 && maxTime > 0, 'positive supported envelope required');
  const speed = Math.SQRT2 * rate, maxAngle = alpha + speed * maxTime;
  assert(maxAngle < Math.PI / 2, 'positive-x hemisphere bound required');
  return Object.freeze({ alpha, rate, maxTime, speed, maxAngle, xLower: Math.cos(maxAngle) });
}
const parameters = envelope(0.65, 0.25, 1);
function signs(id) {
  assert(Number.isInteger(id) && id >= 0 && id < 4, 'piece id 0..3 required');
  return [id % 2 ? 1 : -1, id >= 2 ? 1 : -1];
}
function validTime(time) { assert(Number.isFinite(time) && time >= 0 && time <= parameters.maxTime, 'time in [0,1] required'); }
function angularVelocity(id) { const [sy, sz] = signs(id); return [0, -sz * parameters.rate, sy * parameters.rate]; }
function pose(id, time) { validTime(time); return S.axisRotation(angularVelocity(id), parameters.speed * time); }
function support(time) {
  validTime(time);
  return { time, xLower: parameters.xLower, signedCoordinateLower: parameters.rate * time * parameters.xLower,
    positiveTimeSeparation: time > 0 };
}
function checkSupport(id, source, moved, time) {
  const [sy, sz] = signs(id), b = support(time), tol = 1e-12;
  assert(source[0] >= Math.cos(parameters.alpha) - tol && sy * source[1] >= -tol && sz * source[2] >= -tol, 'source closure outside envelope');
  assert(moved[0] >= b.xLower - tol, 'x support violated');
  assert(sy * moved[1] >= sy * source[1] + b.signedCoordinateLower - tol, 'y support violated');
  assert(sz * moved[2] >= sz * source[2] + b.signedCoordinateLower - tol, 'z support violated');
}
function unit() {
  const times = [0, 0.25, 0.5, 1], starts = [Math.PI, 1.5 * Math.PI, 0.5 * Math.PI, 0];
  let pointChecks = 0, roundTrips = 0, rigidDistanceChecks = 0, distinctRotationChecks = 0, supportNegativeControlsRejected = 0;
  let maxRoundTripAngle = 0, maxRigidDistanceError = 0, maxNormError = 0;
  assert(Math.abs(P.radius(0) - parameters.alpha * 0.88) < 1e-14);
  for (let id = 0; id < 4; id++) {
    const [sy, sz] = signs(id), points = [];
    for (let k = 1; k <= 7; k++) for (const fraction of [0.1, 0.5, 0.9]) {
      const phi = starts[id] + k / 8 * Math.PI / 2, a = P.radius(phi) * fraction;
      const p = [Math.cos(a), Math.sin(a) * Math.cos(phi), Math.sin(a) * Math.sin(phi)];
      assert(P.contains(id, p)); points.push(p);
    }
    points.push([1, 0, 0], [Math.cos(0.2), 0, sz * Math.sin(0.2)], [Math.cos(0.2), sy * Math.sin(0.2), 0]);
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
    assert.throws(() => checkSupport(id, [1, 0, 0], reverse, 0.25), /support violated/);
    supportNegativeControlsRejected++;
  }
  for (const time of times.filter(t => t > 0)) for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    const qa = pose(a, time), qb = pose(b, time);
    const distance = Math.min(Math.hypot(...qa.map((v, i) => v - qb[i])), Math.hypot(...qa.map((v, i) => v + qb[i])));
    assert(distance > 1e-8, 'rotations must be distinct modulo quaternion sign'); distinctRotationChecks++;
  }
  assert(maxRoundTripAngle < 1e-12 && maxRigidDistanceError < 1e-12 && maxNormError < 1e-12);
  for (const id of [-1, 4, 0.5, NaN]) assert.throws(() => pose(id, 0));
  for (const time of [-0.1, 1.01, Infinity, NaN, '0']) { assert.throws(() => pose(0, time)); assert.throws(() => support(time)); }
  for (const args of [[0, 0.25, 1], [0.65, 0, 1], [0.65, 0.25, 0], [0.65, 1, 1], [NaN, 0.25, 1]]) assert.throws(() => envelope(...args));
  return { pointChecks, roundTrips, rigidDistanceChecks, distinctRotationChecks, supportNegativeControlsRejected,
    maxRoundTripAngle, maxRigidDistanceError, maxNormError };
}
module.exports = { parameters, envelope, signs, angularVelocity, pose, support, checkSupport, unit };
if (require.main === module) {
  const result = { unitChecksPassed: true, ...unit() };
  if (process.argv.includes('--unit-only')) console.log(JSON.stringify({ ...result, integrationRun: false }));
  else {
    const fs = require('fs'), path = require('path');
    assert(!Object.keys(require.cache).some(f => path.basename(f) === 'world-v4.js'));
    const report = { ...result, integrationRun: false, analyticMotionSampleRun: true,
      geometryMode: 'analytic-irregular-k4-poses', parameters,
      angularVelocities: [0, 1, 2, 3].map(angularVelocity), supports: [0, 0.25, 0.5, 1].map(support),
      distinctPrescribedMotions: true, arbitraryIndependentTuningSupported: false,
      movingRasterRun: false, frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false,
      scope: 'Four prescribed distinct rigid rotations and sampled support checks only; see K4_POSES.md for analytic argument. No moving raster, formal proof verification, frozen sources or app integration.' };
    const dir = path.join(__dirname, '../artifacts'); fs.mkdirSync(dir, { recursive: true });
    const jsonFile = path.join(dir, 'world-irregular-k4-poses-' + Date.now() + '-' + process.pid + '.json');
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' }); assert(fs.statSync(jsonFile).size > 0);
    console.log(JSON.stringify({ ...result, integrationRun: false, analyticMotionSampleRun: true,
      geometryMode: report.geometryMode, xLower: parameters.xLower, signedCoordinateLowerAt1: support(1).signedCoordinateLower,
      movingRasterRun: false, frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false, jsonFile }, null, 2));
  }
}
