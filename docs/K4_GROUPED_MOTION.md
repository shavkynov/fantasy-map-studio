# K4 motion checks

## Grouped subdivision control — user confirmed

User Mac rerun on 2026-11-02 at 15:33 MSK after correction commit 58d02cce7ad13b87077b6c35b64efb8bcee11deb passed with exit_code=0: checksPassed=true, poseComparisonUnitChecksPassed=true, integrationRun=true, sources=2, K=4, motionGroups=2, parentByChild=[0,1,0,1], comparisons=20, snapshots=40, provenanceRoundTrips=240, groupedCoverageEqual=true, sourceInputsUnchanged=true, motionInputsUnchanged=true, generatorImported=false.

Run: `node tools/world-k4-grouped-motion-test.cjs`, then `echo "exit_code=$?"`. Existing vondoran-227 K2/K4 fixtures use the checksum-validating loader. Matching source land unions and child containment are asserted, not inferred from centers. Each child inherits its parent's axis, rate and zero spin. Opening checks 17 times k/16; closing checks 0, 1/1048576 and 1/64. Coverage, source-index arrays, grouped owners, poses, parent-area sums and validity are compared. Twelve child point/restore checks run per comparison. All opening samples and closing time=0 passed as valid; positive closing samples reproduced 10 and 130 overlapping cells and fragment-overlap. These counts are observed, not hard-coded. Four fragments with two motion groups do not establish independent K4 drift.

### Failed first run and correction history

2026-11-02 15:30 MSK: user run of 82927b60d2c2fc81a0cd9d9e2781495d9749306b failed with exit_code=1 on Node v26.12.0. Line 48 used deepStrictEqual for poses [1,0,-0,0] and [1,0,0,0]. Only syntax had been checked by the assistant before that run.

Correction 58d02cce compares four finite components with numeric ===: signed zeros compare equal, nonzero discrepancies still fail. No epsilon, geometry changes or weakened coverage/overlap assertions. It is not a general quaternion sign-equivalence comparator. Six regression assertions reproduce the old failure, accept signed-zero variants and reject a 1e-12 difference, NaN, Infinity and wrong length. They passed separately in assistant Node v20.20.1 with exit code 0; that was not full fixture integration. Successful fixture integration is evidenced by the subsequent user rerun above.

## Original independent K4 motion — assistant local run passed, user pending

Run: `node tools/world-k4-independent-motion-test.cjs`, then `echo "exit_code=$?"`. Uses only the existing vondoran-227 K4 fixture. No motions override: world-drift.js derives each fragment's axis, rate and spin from its frozen source metadata. The report includes all four motion definitions. No speeds are searched or changed.

At time=0,0.5,1,2,4, check all six relative rotations. For poses a,b, form inverse(a)*b through sphere.compose, then report 2*atan2(norm(vector),abs(scalar)), the shortest rotation angle in radians. This is a kinematic diagnostic, not a second geographic/water metric or ocean-width score. Unit assertions cover identity, common nonidentity pose, opposite quaternion signs, a known 0.25-radian turn and malformed input. Signed zeros do not affect this angular comparison.

At time=0 every relative angle must be below 1e-12; at each positive sampled time every pair must exceed 1e-6 radians, and each individual pose must differ from identity. This verifies distinct sampled transformations, not statistical independence, monotone separation or collision-free motion. Each snapshot checks coverage/owner/source consistency, explicit rejection reasons, invariant source fragment areas, raster fragment-area error below the existing 3% tolerance and 12 point/restore checks. Input mutation and generator import fail the runner. No overlap count or exact relative angle is stored as a new baseline.

Assistant isolated Node run on 2026-11-02: exit code=0, unitChecksPassed=true, integrationRun=true, sources=1, K=4, snapshots=5, relativePairChecks=30, provenanceRoundTrips=60, validFrames=1, rejectedFrames=4, maxRasterRelativeAreaError=0.0045891914976589065, sourceInputsUnchanged=true, generatorImported=false. Overlap cells at the five times: 0,137,358,852,3419. These are observations, not user results or fixed expected values. Domain/drift copies matched Git blob SHA 71ee09ed451bca803ab0150594c1cc2cc6dcb352 and f07bcf3c7448ad50cd46908597720f285ae7f1f5. Exported loader and assess functions were copied into the isolated environment; K4 labels and region metadata passed the loader checks. This was not a full checkout, CI or user Mac execution.

Only the original frame is sampled-valid in that run. No admissible moving frame was found in the tested set; no claim is made about all intermediate times. No frame selection, new masks, fixture/baseline updates, water metric, continuous collision detection, collision resolution, climate, UI, visual acceptance or app integration.
