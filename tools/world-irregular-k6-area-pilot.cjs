'use strict';
const assert = require('assert/strict');
const { performance } = require('perf_hooks');
const { createSphere } = require('../src/world-domain.js');
const P = require('./world-irregular-k6-static.cjs');
const M = require('./world-irregular-k6-poses.cjs');
const A = require('./world-irregular-k6-area.cjs');
const C = require('./world-irregular-k6-area-policy.cjs');
const S = createSphere({ radiusKm: 1 });
const frame = Object.freeze({ width: 360, height: 180, time: 0.25, direction: -1 });
function checkWeight(value) { assert(Number.isFinite(value) && Math.abs(value - S.totalAreaKm2) < 1e-10, 'domain weight mismatch'); }
function measure(order) {
  assert(order === 'centre' || C.policy.orders.includes(order), 'centre or fixed order4/8 required');
  const start = performance.now(), { width, height, time, direction } = frame;
  const inverse = C.policy.pieceIds.map(id => { const q = M.pose(id, time), actual = direction === 1 ? q : S.inverse(q); return S.inverse(actual); });
  const areas = Array(6).fill(0), hits = Array(6).fill(0);
  let totalDomainWeight = 0;
  function sample(p, weight) {
    for (let id = 0; id < 6; id++) if (P.contains(id, S.apply(inverse[id], p))) { areas[id] += weight; hits[id]++; }
  }
  if (order === 'centre') {
    const longitude = Array.from({ length: width }, (_, col) => { const lon = (col + 0.5) / width * 2 * Math.PI - Math.PI; return [Math.cos(lon), Math.sin(lon)]; });
    for (let row = 0; row < height; row++) {
      const lat = Math.PI / 2 - (row + 0.5) / height * Math.PI, c = Math.cos(lat), z = Math.sin(lat), weight = S.cellAreaKm2(width, height, row);
      totalDomainWeight += width * weight;
      for (const [co, si] of longitude) sample([c * co, c * si, z], weight);
    }
  } else {
    const r = A.rule(order), lonHalf = Math.PI / width, longitude = [], weightSum = r.weights.reduce((a, b) => a + b, 0);
    for (let col = 0; col < width; col++) {
      const centre = (col + 0.5) / width * 2 * Math.PI - Math.PI;
      for (let k = 0; k < order; k++) { const lon = centre + lonHalf * r.nodes[k]; longitude.push([Math.cos(lon), Math.sin(lon), lonHalf * r.weights[k]]); }
    }
    for (let row = 0; row < height; row++) {
      const top = Math.sin(Math.PI / 2 - row / height * Math.PI), bottom = Math.sin(Math.PI / 2 - (row + 1) / height * Math.PI);
      const middle = (top + bottom) / 2, half = (top - bottom) / 2;
      totalDomainWeight += width * lonHalf * half * weightSum * weightSum;
      for (let k = 0; k < order; k++) {
        const z = middle + half * r.nodes[k], c = Math.sqrt(Math.max(0, 1 - z * z)), weight = half * r.weights[k];
        for (const [co, si, lonWeight] of longitude) sample([c * co, c * si, z], weight * lonWeight);
      }
    }
  }
  checkWeight(totalDomainWeight); assert(areas.every(a => Number.isFinite(a) && a >= 0 && a <= S.totalAreaKm2));
  return { order, areas, hitSamples: hits, totalDomainWeight, membershipEvaluations: width * height * 6 * (order === 'centre' ? 1 : order * order), elapsedMilliseconds: performance.now() - start };
}
function unit() {
  let momentChecks = 0;
  for (const order of C.policy.orders) {
    const r = A.rule(order);
    for (let degree = 0; degree < 2 * order; degree++) {
      const actual = r.nodes.reduce((s, x, i) => s + r.weights[i] * x ** degree, 0), expected = degree % 2 ? 0 : 2 / (degree + 1);
      assert(Math.abs(actual - expected) < 1e-13); momentChecks++;
    }
  }
  checkWeight(4 * Math.PI); assert.throws(() => checkWeight(16 * Math.PI));
  for (const order of [0, 2, 16, NaN, undefined]) assert.throws(() => measure(order));
  const synthetic = { ...frame, areaTolerance: C.policy.tolerance, quadratureOrders: [4, 8], pieceIds: [0, 1, 2, 3, 4, 5], centreErrors: Array(6).fill(0.01), gauss4Errors: Array(6).fill(0.01), gauss8Errors: Array(6).fill(0.01) };
  assert(C.evaluateFrame(synthetic).revisedAreaGatePassed); synthetic.gauss8Errors[0] = 0.03; assert(!C.evaluateFrame(synthetic).revisedAreaGatePassed);
  assert.throws(() => C.evaluateSchedule([synthetic]), /all ten frames required/);
  assert.equal(A.testCase.pieceId, 2); for (const key of ['width', 'height', 'time', 'direction']) assert.equal(frame[key], A.testCase[key]);
  return { momentChecks, domainWeightNegativeControlsRejected: 1, partialScheduleRejected: true };
}
module.exports = { frame, measure, unit };
if (require.main === module) {
  const checks = unit();
  if (process.argv.includes('--unit-only')) console.log(JSON.stringify({ unitChecksPassed: true, measuredFrames: 0, integrationRun: false, ...checks }));
  else {
    const before = JSON.stringify({ frame, intervals: P.intervals, references: P.reference(), parameters: M.parameters, policy: C.policy });
    const references = P.reference(), centre = measure('centre'), gauss4 = measure(4), gauss8 = measure(8);
    const auditStart = performance.now(), originalFocused = [A.baseline(), A.quadrature(4), A.quadrature(8)];
    const referenceAuditMilliseconds = performance.now() - auditStart;
    const differences = [centre, gauss4, gauss8].map((r, i) => Math.abs(r.areas[2] - originalFocused[i].area));
    assert(differences.every(v => v < 1e-12), 'focused estimator equivalence mismatch');
    const relative = result => result.areas.map((a, id) => Math.abs(a / references[id] - 1));
    const input = { ...frame, areaTolerance: C.policy.tolerance, quadratureOrders: [4, 8], pieceIds: [0, 1, 2, 3, 4, 5], centreErrors: relative(centre), gauss4Errors: relative(gauss4), gauss8Errors: relative(gauss8) };
    const classification = C.evaluateFrame(input);
    assert.throws(() => C.evaluateSchedule([input]), /all ten frames required/);
    assert.equal(JSON.stringify({ frame, intervals: P.intervals, references: P.reference(), parameters: M.parameters, policy: C.policy }), before);
    const fs = require('fs'), path = require('path'); assert(!Object.keys(require.cache).some(f => path.basename(f) === 'world-v4.js'));
    const measurementMembershipEvaluations = centre.membershipEvaluations + gauss4.membershipEvaluations + gauss8.membershipEvaluations;
    const focusedReferenceEvaluations = originalFocused.reduce((n, r) => n + r.evaluations, 0);
    const report = { unitChecksPassed: true, ...checks, areaPilotRun: true, measuredFrames: 1, integrationRun: false,
      geometryMode: 'analytic-k6-one-frame-area-pilot', frame, policyId: C.policy.id, criterionRevised: true, references,
      measurements: { centre, gauss4, gauss8 }, classification,
      interOrderAbsoluteAreaDifferences: gauss4.areas.map((a, id) => Math.abs(a - gauss8.areas[id])),
      interOrderRelativeAreaDifferences: gauss4.areas.map((a, id) => Math.abs(a - gauss8.areas[id]) / references[id]),
      referenceAudit: { pieceId: 2, originalFocused, absoluteDifferences: differences, referenceAuditMilliseconds },
      measurementMembershipEvaluations, focusedReferenceEvaluations,
      totalMembershipEvaluationsIncludingReference: measurementMembershipEvaluations + focusedReferenceEvaluations,
      inputsUnchanged: true, fullScheduleMeasured: false, collisionChecksPerformed: false, movingK6StageAccepted: false,
      frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false,
      scope: 'One complete analytic control frame/all six piece areas and phase timings only. No culling,full schedule,collision checks,formal error bound or app integration. Timings are local observations,not Mac/full-suite guarantees.' };
    const dir = path.join(__dirname, '../artifacts'); fs.mkdirSync(dir, { recursive: true });
    const jsonFile = path.join(dir, 'world-irregular-k6-area-pilot-' + Date.now() + '-' + process.pid + '.json');
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' }); assert(fs.statSync(jsonFile).size > 0);
    console.log(JSON.stringify({ unitChecksPassed: true, areaPilotRun: true, measuredFrames: 1, pieceFrameChecks: 6, integrationRun: false, frame,
      originalRasterAreaGatePassed: classification.originalAreaGatePassed, revisedAreaGatePassed: classification.revisedAreaGatePassed,
      maxCentreRelativeAreaError: Math.max(...input.centreErrors), maxGauss4RelativeAreaError: Math.max(...input.gauss4Errors), maxGauss8RelativeAreaError: Math.max(...input.gauss8Errors),
      maxAbsoluteReferenceAuditDifference: Math.max(...differences), timingsMilliseconds: { centre: centre.elapsedMilliseconds, gauss4: gauss4.elapsedMilliseconds, gauss8: gauss8.elapsedMilliseconds, focusedReferenceAudit: referenceAuditMilliseconds },
      measurementMembershipEvaluations, focusedReferenceEvaluations,
      fullScheduleMeasured: false, collisionChecksPerformed: false, movingK6StageAccepted: false, inputsUnchanged: true, frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false, jsonFile }, null, 2));
    assert(classification.revisedAreaGatePassed, 'one-frame revised area gate failed;report preserved');
  }
}
