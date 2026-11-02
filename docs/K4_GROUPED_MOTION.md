# K4 motion checks and comparison

## Grouped control — user confirmed

User Mac rerun 2026-11-02 15:33 MSK after fix 58d02cce7ad13b87077b6c35b64efb8bcee11deb: exit_code=0, checksPassed=true, poseComparisonUnitChecksPassed=true, integrationRun=true, sources=2, K=4, motionGroups=2, parentByChild=[0,1,0,1], comparisons=20, snapshots=40, provenanceRoundTrips=240, groupedCoverageEqual=true, sourceInputsUnchanged=true, motionInputsUnchanged=true, generatorImported=false.

Command: `node tools/world-k4-grouped-motion-test.cjs`. Existing checksummed K2/K4 fixtures assert matching land unions and containment. Children inherit parent axis/rate, spin=0. Opening checks k/16, k=0..16; closing checks 0,1/1048576,1/64. Coverage, provenance, grouped owners, poses, source-area sums and validity match; 12 child round trips per comparison. Opening and closing zero are valid; positive closing overlaps 10/130 cells. Four fragments with two motions are not independent K4 drift.

First run 15:30 MSK, code 82927b60d2c2fc81a0cd9d9e2781495d9749306b, Node v26.12.0: exit_code=1. deepStrictEqual distinguished [1,0,-0,0] and [1,0,0,0]. Only syntax was checked before it. Fix 58d02cce compares four finite components using ===, no epsilon or geometry changes. It is not general quaternion sign equivalence. Six regressions reproduce failure, accept signed zeros, reject a 1e-12 difference, NaN, Infinity and wrong length. Separate assistant Node v20.20.1 run passed; user rerun provides full fixture evidence.

## Independent motion — five-time user run confirmed

Code 61d42988775890dcea0d41b73ee9cbe7c2f3bc10; user 2026-11-02 15:40 MSK: exit_code=0, unitChecksPassed=true, integrationRun=true, sources=1, K=4, snapshots=5, relativePairChecks=30, provenanceRoundTrips=60, maxRasterRelativeAreaError=0.0045891914976589065, validFrames=1, rejectedFrames=4, sourceInputsUnchanged=true, generatorImported=false. At 0,0.5,1,2,4 overlap cells are 0,137,358,852,3419.

Command: `node tools/world-k4-independent-motion-test.cjs`. No overrides: four axis/rate/spin definitions derive from frozen source metadata and are reported. Relative pose inverse(a)*b gives angle 2*atan2(norm(vector),abs(scalar)). This is kinematic diagnostics, not another geographic/water metric. Unit cases: identity, common pose, opposite quaternion signs, known 0.25-radian turn, malformed input. At zero angles <1e-12; positive pair and individual angles >1e-6. Coverage/owners/provenance, reasons, invariant source areas, raster-area error <3%, 12 round trips per frame, unchanged source and no generator import are checked. At least one rejected frame and an initially valid frame are required. Counts/angles are not a baseline. Distinct sampled transforms do not prove statistical independence, separation or continuous safety.

Earlier assistant isolated Node run matched those values; domain/drift blobs matched 71ee09ed451bca803ab0150594c1cc2cc6dcb352 and f07bcf3c7448ad50cd46908597720f285ae7f1f5. Exported loader/assess functions were copied; labels/metadata passed loader checks. Not a full checkout or CI.

## Early fixed schedule — user confirmed

Command: `node tools/world-k4-independent-motion-test.cjs --early-frames`. Code 4ad97149c39e5996ec33650acefef747523d7ab0. Fixed times: zero; nine powers 2^-16..2^-8; k/128 for k=1..64. Assertions check 74 unique ascending finite times, bounds and endpoints 0,1/65536,0.5. All six pairs remain checked; early output shows their minimum angle. No adaptive search, early stop, ranking or speed changes.

User report 2026-11-02 15:46 MSK: exit_code=0, unitChecksPassed=true, scheduleChecksPassed=true, integrationRun=true, diagnosticMode=early-fixed-schedule, snapshots=74, relativePairChecks=444, provenanceRoundTrips=888, maxRasterRelativeAreaError=0.005226660207385159, validFrames=9, positiveValidFrames=8, rejectedFrames=65, sourceInputsUnchanged=true, generatorImported=false. Eight positive valid samples are powers 2^-16..2^-9. Last valid sampled time 0.001953125 has minimum pair angle 0.0006746735081517401 radians. Next sampled time 0.00390625 has 7 overlapping cells; all later samples in this schedule are rejected. At 0.0078125 the count is 2, so overlap count is not monotone. At 0.5 it is 137.

Before this user run, assistant checks covered only updated syntax and schedule assertions, exit codes 0; no assistant full early-fixture execution. User result supersedes the former integration-pending status. Do not extrapolate to (0,1/65536), gaps between samples, other grids or meridians. No precise first-collision time or geographic acceptance follows.

## Standalone geometry comparison — prepared, user export pending

Run `node tools/world-k4-compare.cjs`, then `echo "exit_code=$?"`. Optional unit-only: `node tools/world-k4-compare.cjs --unit-only`. The default command runs units, loads existing K4, takes fixed times 0,1/2048,1/1024,1/512,1/256 with original motions and grid 360x180, centralMeridian=0. It recomputes statuses; it never relabels an invalid frame as a candidate. No automatic winner or accepted frame is stored.

Writes one self-contained HTML file in the local artifacts folder, k4-compare-<timestamp>.html, using exclusive creation (no overwrite); stdout reports its actual path. No generated HTML is committed. Open it in a browser. Two SVG maps per time: fragment colors and changed owner/coverage relative to zero. Water is dark blue; unchanged land on the difference map is gray, changes orange, overlaps bright pink. Adjacent same-colored raster cells are merged into horizontal rectangles. The equirectangular grid is unchanged; browser enlargement does not add geographic detail.

The first three positive times were sampled-valid in the early run; 1/256 was rejected and is diagnostic only. Export computes labels from assess and coverage consistency, not from those observations. Valid labels say NOT ACCEPTED; invalid labels say NOT A CANDIDATE. No terrain, climate, water score, atlas change or app integration.

Assistant isolated Node unit-only run: exit code 0, unitChecksPassed=true, integrationRun=false, htmlWritten=false. Units use tiny synthetic snapshot objects, not new source fixtures; cover escaping, labels, overlap/change colors, SVG run merging, unchanged inputs, empty list, missing zero baseline, bad lengths, inconsistent owners/diagnostics and meridian mismatch. The copied assess function matches repository logic. Actual K4 export and browser appearance have not been executed/accepted by the assistant or user. Export success, visual review, frame choice and app integration remain separate.
