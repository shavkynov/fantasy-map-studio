'use strict';
const assert = require('assert/strict');
const { createSphere } = require('../src/world-domain.js');
const P = require('./world-irregular-k6-static.cjs');
const M = require('./world-irregular-k6-poses.cjs');
const S = createSphere({ radiusKm: 1 });
const testCase = Object.freeze({ pieceId: 2, time: 0.25, direction: -1, width: 360, height: 180, areaTolerance: 0.03 });
const rules = {"2":{"nodes":[-0.5773502691896257,0.5773502691896257],"weights":[1.0,1.0]},"4":{"nodes":[-0.8611363115940526,-0.33998104358485626,0.33998104358485626,0.8611363115940526],"weights":[0.3478548451374537,0.6521451548625462,0.6521451548625462,0.3478548451374537]},"8":{"nodes":[-0.9602898564975362,-0.7966664774136267,-0.525532409916329,-0.18343464249564978,0.18343464249564978,0.525532409916329,0.7966664774136267,0.9602898564975362],"weights":[0.10122853629037669,0.22238103445337434,0.31370664587788705,0.36268378337836177,0.36268378337836177,0.31370664587788705,0.22238103445337434,0.10122853629037669]}};
for (const r of Object.values(rules)) { Object.freeze(r.nodes); Object.freeze(r.weights); Object.freeze(r); }
Object.freeze(rules);
function rule(order) { assert(Number.isInteger(order) && [2, 4, 8].includes(order), 'quadrature order 2,4,8 required'); return rules[order]; }
function inversePose() { return S.inverse(S.inverse(M.pose(testCase.pieceId, testCase.time))); }
function describeArea(area) {
  const referenceArea = P.reference()[testCase.pieceId];
  assert(Number.isFinite(area) && area >= 0 && area <= S.totalAreaKm2 && referenceArea > 0);
  const relativeReferenceAreaError = Math.abs(area / referenceArea - 1);
  return { area, referenceArea, relativeReferenceAreaError, withinOriginalTolerance: relativeReferenceAreaError < testCase.areaTolerance };
}
function checkTotalWeight(area) { assert(Number.isFinite(area) && Math.abs(area - S.totalAreaKm2) < 1e-10, 'quadrature domain weight mismatch'); }
function baseline() {
  const { width, height, pieceId } = testCase, inverse = inversePose(); let area = 0, cells = 0;
  for (let row = 0; row < height; row++) {
    const lat = Math.PI / 2 - (row + 0.5) / height * Math.PI, c = Math.cos(lat), z = Math.sin(lat), weight = S.cellAreaKm2(width, height, row);
    for (let col = 0; col < width; col++) {
      const lon = (col + 0.5) / width * 2 * Math.PI - Math.PI;
      if (P.contains(pieceId, S.apply(inverse, [c * Math.cos(lon), c * Math.sin(lon), z]))) { cells++; area += weight; }
    }
  }
  return { method: 'original-latitude-longitude-cell-centres', evaluations: width * height, cells, ...describeArea(area) };
}
function quadrature(order) {
  const r = rule(order), { width, height, pieceId } = testCase, inverse = inversePose();
  const lonHalf = Math.PI / width, samples = [];
  for (let col = 0; col < width; col++) {
    const centre = (col + 0.5) / width * 2 * Math.PI - Math.PI;
    for (let k = 0; k < order; k++) { const lon = centre + lonHalf * r.nodes[k]; samples.push({ c: Math.cos(lon), s: Math.sin(lon), weight: lonHalf * r.weights[k] }); }
  }
  let area = 0, totalDomainWeight = 0;
  const weightSum = r.weights.reduce((a, b) => a + b, 0);
  for (let row = 0; row < height; row++) {
    const muTop = Math.sin(Math.PI / 2 - row / height * Math.PI), muBottom = Math.sin(Math.PI / 2 - (row + 1) / height * Math.PI);
    const muMiddle = (muTop + muBottom) / 2, muHalf = (muTop - muBottom) / 2;
    totalDomainWeight += width * lonHalf * muHalf * weightSum * weightSum;
    for (let k = 0; k < order; k++) {
      const z = muMiddle + muHalf * r.nodes[k], c = Math.sqrt(Math.max(0, 1 - z * z)), weight = muHalf * r.weights[k];
      for (const sample of samples) if (P.contains(pieceId, S.apply(inverse, [c * sample.c, c * sample.s, z]))) area += weight * sample.weight;
    }
  }
  checkTotalWeight(totalDomainWeight);
  return { method: 'tensor-Gauss-Legendre-in-lon-and-sin-lat-within-original-cells', order, samplesPerBaseCell: order * order,
    evaluations: width * height * order * order, totalDomainWeight, ...describeArea(area) };
}
function unit() {
  let momentChecks = 0;
  for (const order of [2, 4, 8]) {
    const r = rule(order); assert.equal(r.nodes.length, order); assert.equal(r.weights.length, order);
    assert(r.nodes.every(v => Number.isFinite(v) && v > -1 && v < 1)); assert(r.weights.every(v => Number.isFinite(v) && v > 0));
    for (let degree = 0; degree < 2 * order; degree++) {
      const actual = r.nodes.reduce((a, x, k) => a + r.weights[k] * x ** degree, 0), expected = degree % 2 ? 0 : 2 / (degree + 1);
      assert(Math.abs(actual - expected) < 1e-13); momentChecks++;
    }
  }
  checkTotalWeight(4 * Math.PI); assert.throws(() => checkTotalWeight(16 * Math.PI), /domain weight mismatch/);
  for (const order of [0, 1, 3, 16, NaN, '2']) assert.throws(() => rule(order));
  for (const area of [-1, NaN, Infinity, 100]) assert.throws(() => describeArea(area));
  assert(describeArea(P.reference()[2]).withinOriginalTolerance);
  assert(!describeArea(2 * P.reference()[2]).withinOriginalTolerance);
  const q = inversePose(), p = Object.freeze([1, 0, 0]), before = JSON.stringify(p), moved = S.apply(q, p), back = S.apply(S.inverse(q), moved);
  assert(S.angle(p, back) < 1e-12); assert.equal(JSON.stringify(p), before);
  return { momentChecks, domainWeightNegativeControlsRejected: 1 };
}
module.exports = { testCase, rule, baseline, quadrature, unit };
if (require.main === module) {
  const checks = unit();
  if (process.argv.includes('--unit-only')) console.log(JSON.stringify({ unitChecksPassed: true, integrationRun: false, ...checks }));
  else {
    const before = JSON.stringify({ testCase, intervals: P.intervals, parameters: M.parameters, references: P.reference() });
    const original = baseline(), refinements = [2, 4, 8].map(quadrature);
    let previous = original.area;
    for (const result of refinements) { result.changeFromPreviousRelativeToReference = Math.abs(result.area - previous) / result.referenceArea; previous = result.area; }
    assert.equal(JSON.stringify({ testCase, intervals: P.intervals, parameters: M.parameters, references: P.reference() }), before);
    const fs = require('fs'), path = require('path');
    assert(!Object.keys(require.cache).some(f => path.basename(f) === 'world-v4.js'));
    const report = { unitChecksPassed: true, experimentCompleted: true, integrationRun: false, areaQuadratureExperimentRun: true,
      geometryMode: 'analytic-k6-single-control-area-experiment', ...checks, testCase, original, refinements,
      originalRasterAreaGatePassed: original.withinOriginalTolerance, allRefinementLevelsWithinTolerance: refinements.every(r => r.withinOriginalTolerance),
      acceptancePolicyChanged: false, fullMovingRasterRun: false, movingK6StageAccepted: false,
      inputsUnchanged: true, frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false,
      scope: 'Single piece/control area experiment only. Original failure preserved. No collision labels changed,no adoption of a new acceptance estimator,no full K6 pass or certified quadrature error bound.' };
    const dir = path.join(__dirname, '../artifacts'); fs.mkdirSync(dir, { recursive: true });
    const jsonFile = path.join(dir, 'world-irregular-k6-area-' + Date.now() + '-' + process.pid + '.json');
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' }); assert(fs.statSync(jsonFile).size > 0);
    console.log(JSON.stringify({ unitChecksPassed: true, experimentCompleted: true, integrationRun: false, areaQuadratureExperimentRun: true,
      geometryMode: report.geometryMode, ...checks, testCase,
      originalRelativeAreaError: original.relativeReferenceAreaError, originalRasterAreaGatePassed: report.originalRasterAreaGatePassed,
      refinements: refinements.map(r => ({ order: r.order, relativeAreaError: r.relativeReferenceAreaError, withinOriginalTolerance: r.withinOriginalTolerance })),
      acceptancePolicyChanged: false, fullMovingRasterRun: false, movingK6StageAccepted: false,
      inputsUnchanged: true, frozenFixtureIntegrationRun: false, generatorImported: false, visualAccepted: false, appIntegrated: false, jsonFile }, null, 2));
  }
}
