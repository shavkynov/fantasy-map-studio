'use strict';
const assert = require('assert/strict');
const policy = Object.freeze({ id: 'analytic-k6-dual-gauss-area-v1', tolerance: 0.03, orders: Object.freeze([4, 8]), pieceIds: Object.freeze([0, 1, 2, 3, 4, 5]) });
const schedule = Object.freeze([360, 720].flatMap(width => [0, 0.25, 0.5, 1].map(time => Object.freeze({ width, height: width / 2, time, direction: 1 })).concat([Object.freeze({ width, height: width / 2, time: 0.25, direction: -1 })])));
const key = frame => JSON.stringify([frame.width, frame.height, frame.time, frame.direction]);
const expectedKeys = new Set(schedule.map(key));
function errors(values) {
  assert(Array.isArray(values) && values.length === 6 && Array.from(values).every(e => Number.isFinite(e) && e >= 0), 'six finite nonnegative errors required');
  return Array.from(values);
}
function evaluateFrame(frame) {
  assert(frame && typeof frame === 'object' && expectedKeys.has(key(frame)), 'unexpected analytic K6 frame');
  assert.equal(frame.areaTolerance, policy.tolerance, 'tolerance must not change');
  assert.deepEqual(frame.quadratureOrders, [4, 8], 'both fixed orders required');
  assert.deepEqual(frame.pieceIds, [0, 1, 2, 3, 4, 5], 'all six piece IDs in order required');
  const centre = errors(frame.centreErrors), gauss4 = errors(frame.gauss4Errors), gauss8 = errors(frame.gauss8Errors);
  const pieces = policy.pieceIds.map(id => ({ id, centreError: centre[id], gauss4Error: gauss4[id], gauss8Error: gauss8[id],
    originalAreaGatePassed: centre[id] < policy.tolerance,
    revisedAreaGatePassed: gauss4[id] < policy.tolerance && gauss8[id] < policy.tolerance }));
  return { ...schedule.find(f => key(f) === key(frame)), policyId: policy.id, pieces,
    originalAreaGatePassed: pieces.every(p => p.originalAreaGatePassed), revisedAreaGatePassed: pieces.every(p => p.revisedAreaGatePassed) };
}
function evaluateSchedule(frames) {
  assert(Array.isArray(frames) && frames.length === 10, 'all ten frames required');
  const seen = new Set(), results = [];
  for (const frame of frames) {
    const result = evaluateFrame(frame), id = key(frame);
    assert(!seen.has(id), 'duplicate frame'); seen.add(id); results.push(result);
  }
  assert.equal(seen.size, expectedKeys.size);
  return { policyId: policy.id, frames: results, pieceFrameChecks: results.length * policy.pieceIds.length,
    originalRasterAreaGatePassed: results.every(f => f.originalAreaGatePassed), revisedAreaChecksPassed: results.every(f => f.revisedAreaGatePassed),
    criterionRevised: true, collisionChecksPerformed: false, movingK6StageAccepted: false };
}
function workload() {
  const baseCells = schedule.reduce((n, f) => n + f.width * f.height, 0), pieceCount = policy.pieceIds.length;
  return { frames: schedule.length, pieceFrameChecks: schedule.length * pieceCount, baseCells,
    originalMembershipEvaluations: baseCells * pieceCount,
    gauss4MembershipEvaluations: baseCells * pieceCount * 16, gauss8MembershipEvaluations: baseCells * pieceCount * 64,
    totalQuadratureMembershipEvaluations: baseCells * pieceCount * (16 + 64) };
}
function unit() {
  const fresh = () => schedule.map(f => ({ ...f, areaTolerance: 0.03, quadratureOrders: [4, 8], pieceIds: [0, 1, 2, 3, 4, 5],
    centreErrors: Array(6).fill(0.01), gauss4Errors: Array(6).fill(0.01), gauss8Errors: Array(6).fill(0.01) }));
  const good = fresh(), before = JSON.stringify(good), first = evaluateSchedule(good);
  assert(first.originalRasterAreaGatePassed && first.revisedAreaChecksPassed); assert.equal(first.pieceFrameChecks, 60);
  assert.equal(JSON.stringify(good), before); assert.equal(first.movingK6StageAccepted, false);
  const coarseFail = fresh(); coarseFail[4].centreErrors[2] = 0.03543776625744366;
  const retained = evaluateSchedule(coarseFail); assert(!retained.originalRasterAreaGatePassed && retained.revisedAreaChecksPassed);
  assert.equal(retained.frames[4].pieces[2].centreError, 0.03543776625744366);
  let criterionFailureChecks = 0, invalidInputRejections = 0;
  for (const field of ['gauss4Errors', 'gauss8Errors']) for (const value of [0.03, 0.04]) {
    const f = fresh(); f[0][field][5] = value;
    assert(!evaluateSchedule(f).revisedAreaChecksPassed); criterionFailureChecks++;
  }
  const below = fresh(); below[9].gauss4Errors[5] = 0.029999999999999995; assert(evaluateSchedule(below).revisedAreaChecksPassed);
  function reject(change) { const f = fresh(); change(f); assert.throws(() => evaluateSchedule(f)); invalidInputRejections++; }
  reject(f => f.pop()); reject(f => f.push(f[0])); reject(f => { f[9] = f[0]; });
  reject(f => { f[0].width = 1440; }); reject(f => { f[0].height = 181; }); reject(f => { f[0].time = 0.75; });
  reject(f => { f[0].direction = 0; }); reject(f => { f[0].areaTolerance = 0.04; });
  reject(f => { f[0].quadratureOrders = [8]; }); reject(f => { f[0].quadratureOrders = [8, 4]; });
  reject(f => { f[0].pieceIds = [0, 1, 2, 3, 4, 4]; }); reject(f => { f[0].gauss8Errors = undefined; });
  reject(f => { f[0].gauss4Errors = Array(6); }); reject(f => { f[0].centreErrors = []; });
  for (const value of [NaN, Infinity, -0.1, '0']) reject(f => { f[0].gauss8Errors[0] = value; });
  assert.throws(() => evaluateSchedule([])); invalidInputRejections++;
  const costs = workload(); assert.equal(costs.totalQuadratureMembershipEvaluations, costs.gauss4MembershipEvaluations + costs.gauss8MembershipEvaluations);
  return { syntheticFramesPerSchedule: 10, syntheticPieceFrameChecksPerSchedule: 60, criterionFailureChecks, invalidInputRejections };
}
module.exports = { policy, schedule, evaluateFrame, evaluateSchedule, workload, unit };
if (require.main === module) console.log(JSON.stringify({ unitChecksPassed: true, ...unit(), policy,
  policySpecificationOnly: true, criterionRevised: true, measuredFrames: 0, integrationRun: false,
  collisionChecksPerformed: false, movingK6StageAccepted: false, naiveWorkload: workload() }, null, 2));
