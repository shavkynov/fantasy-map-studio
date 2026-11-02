# K4 motion checks

## Grouped subdivision control — user confirmed

User Mac rerun 2026-11-02 15:33 MSK after correction 58d02cce7ad13b87077b6c35b64efb8bcee11deb passed: exit_code=0, checksPassed=true, poseComparisonUnitChecksPassed=true, integrationRun=true, sources=2, K=4, motionGroups=2, parentByChild=[0,1,0,1], comparisons=20, snapshots=40, provenanceRoundTrips=240, groupedCoverageEqual=true, sourceInputsUnchanged=true, motionInputsUnchanged=true, generatorImported=false.

Run `node tools/world-k4-grouped-motion-test.cjs`, then `echo "exit_code=$?"`. Existing checksummed K2/K4 fixtures assert identical land unions and child containment. Children inherit parent axis/rate and zero spin. Opening: 17 times k/16. Closing: 0,1/1048576,1/64. Checks cover coverage, source indices, grouped owners, poses, parent-area sums and validity; 12 child round trips per comparison. Opening and closing zero were valid; positive closing counts were 10 and 130, rejected for fragment-overlap. Counts are observations, not hard-coded. This is four fragments under two motions, not independent K4 drift.

First user run 2026-11-02 15:30 MSK, code 82927b60d2c2fc81a0cd9d9e2781495d9749306b, Node v26.12.0: exit_code=1. Line 48 deepStrictEqual distinguished [1,0,-0,0] from [1,0,0,0]. Before it the assistant had checked only syntax. Fix 58d02cce uses numeric === on four finite components; no epsilon, geometry changes or weakened overlap checks. It is not general quaternion sign equivalence. Six regressions reproduce the old failure, accept signed zeros and reject a 1e-12 discrepancy, NaN, Infinity and wrong length. They passed separately in assistant Node v20.20.1, exit code 0; successful fixture integration comes from the user rerun above.

## Original independent K4 motion — user confirmed for five times

Code 61d42988775890dcea0d41b73ee9cbe7c2f3bc10. User Mac run 2026-11-02 15:40 MSK: exit_code=0, unitChecksPassed=true, integrationRun=true, sources=1, K=4, motionMode=original-source-per-fragment, snapshots=5, relativePairChecks=30, provenanceRoundTrips=60, maxRasterRelativeAreaError=0.0045891914976589065, validFrames=1, rejectedFrames=4, sourceInputsUnchanged=true, generatorImported=false. Overlap cells at time=0,0.5,1,2,4: 0,137,358,852,3419. All six pairs have distinct rotations at each positive sample. No valid moving frame was found in that set. No claim about intermediate times.

Run `node tools/world-k4-independent-motion-test.cjs`, then `echo "exit_code=$?"`. Uses existing K4, no motions override or speed search. world-drift.js derives four axis/rate/spin definitions from frozen metadata; all are reported. Relative pose is inverse(a)*b; 2*atan2(norm(vector),abs(scalar)) reports the shortest rotation angle. This is kinematic diagnostics, not a second geographic/water metric. Units cover identity, common nonidentity pose, opposite quaternion signs, a known 0.25-radian turn and malformed input.

At zero relative and individual angles must be below 1e-12; at positive sampled times every pair and individual rotation must exceed 1e-6 radians. This establishes distinct sampled transformations, not statistical independence, monotone separation or continuous safety. Coverage/owner/source consistency, explicit reasons, invariant source areas, raster-area error below 3% and 12 point/restore checks per snapshot remain enforced. At least one rejection and an initially valid frame are required. Source mutation or generator import fails. Exact angles and overlap counts are not a baseline.

Earlier assistant isolated Node fixture run passed with the same five-time values. Domain/drift matched Git blob SHA 71ee09ed451bca803ab0150594c1cc2cc6dcb352 and f07bcf3c7448ad50cd46908597720f285ae7f1f5; exported loader/assess functions were copied, labels and metadata passed loader checks. This was not a full checkout or CI; user execution is separate evidence.

## Early fixed schedule — prepared, fixture execution pending

Run `node tools/world-k4-independent-motion-test.cjs --early-frames`, then `echo "exit_code=$?"`. Default times remain unchanged. Early times are fixed before observing output: zero, nine powers 2^-16 through 2^-8, then k/128 for k=1..64. Total 74 unique ascending times, smallest positive 1/65536, endpoint 0.5. Schedule assertions check count, uniqueness, endpoints, finiteness, bounds and ordering. No adaptive search, early stop or automatic ranking.

All existing geometric and kinematic checks remain. Early frames print minRelativeRotationRadians instead of six pair records, but all six are checked. Expected structural counts if completed: snapshots=74, relativePairChecks=444, provenanceRoundTrips=888. diagnosticMode=early-fixed-schedule and scheduleChecksPassed=true identify this mode. positiveValidFrames counts only admissible positive sampled times; it does not select one. No expected valid/rejected count is imposed except the existing rejection-case assertion at this schedule's known overlapping endpoint.

Assistant checked full updated script syntax and schedule assertions for both modes in Node: exit codes 0. The updated full fixture runner, including --early-frames, has NOT been executed by the assistant or user yet. Early overlap counts, areas and positiveValidFrames are unknown. Earlier five-time success does not substitute for that execution.

Do not extrapolate to (0,1/65536), intervals between samples, another grid or meridian. Even a positive valid sample proves neither continuous collision freedom nor geographic quality. No frame selection, new masks, fixture/baseline changes, new water metric, collision resolution, climate, UI, visual acceptance or app integration.
