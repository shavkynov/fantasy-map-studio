# K4 subdivision control

Status: initial user run failed on a signed-zero pose assertion; correction prepared. Successful K4 fixture integration is not confirmed. This is a control before independent K4 motion, not completion of the K4-world stage.

Run from the downloaded project root: `node tools/world-k4-grouped-motion-test.cjs`, then `echo "exit_code=$?"`.

Uses only existing vondoran-227 K2 and K4 fixtures through the checksum-validating loader. Independent Python decompression found identical land unions and child-to-parent mapping [0,1,0,1]. The JavaScript runner verifies this again rather than assuming containment from region ids or centers. No fixture files or baseline hashes change.

Each K4 child inherits its K2 parent's axis, rate and zero spin from the controlled pair experiment. Opening uses 17 times k/16. Closing uses times 0, 1/1048576 and 1/64, replaying the previously observed pair diagnostic endpoints; this runner does not search for a new collision time.

There are four fragments but only two motion groups. This intentionally preserves the K2 union and is not independent four-fragment drift. It tests subdivision invariance: identical coverage arrays, source-index arrays, grouped ownership, validity and overlap diagnostics, numerically equal parent/child pose components, source-area sums and 12 child point/restore checks per comparison. Opening samples and closing time=0 must be valid; the two positive closing samples must be rejected for fragment-overlap. Counts of overlapping cells are not hard-coded.

If execution passes, expected structural counts are comparisons=20, snapshots=40, provenanceRoundTrips=240, sources=2, K=4, motionGroups=2. These are counts implied by the runner, not observed integration results yet. Source and motion inputs must remain unchanged; importing world-v4.js fails the test.

## Failed user run and targeted correction

2026-11-02 15:30 MSK: user Mac run of the test from commit 82927b60d2c2fc81a0cd9d9e2781495d9749306b failed with exit_code=1 on Node v26.12.0. Line 48 compared poses via deepStrictEqual: actual [1,0,-0,0], expected [1,0,0,0]. The test had only received an assistant syntax check before that run, not assistant fixture integration. This failed run is not a successful K4 result. WORK_STATE's integration-pending state remains unresolved; this section records the subsequent attempted run.

Correction is confined to the test: compare four finite components with numeric ===, so +0 and -0 compare equal while any nonzero discrepancy still fails. No epsilon tolerance, geometry changes, fixture changes or weakening of coverage/overlap assertions. This is not a general quaternion sign-equivalence comparator; it checks the expected identical construction under inherited zero-spin motions.

Six regression assertions reproduce the old signed-zero failure, accept signed-zero variants, reject a 1e-12 component difference, reject NaN, reject Infinity and reject wrong length. The exact helper and regressions passed separately in assistant Node v20.20.1 with exit code 0. This isolated regression check is not execution of the corrected full K4 fixture runner; a successful user rerun remains required. The successful full report will include poseComparisonUnitChecksPassed=true.

No new water metric, frame ranking, continuous collision detection, collision resolution, climate, UI, visual acceptance or app integration. After this control, independent four-fragment motion remains a separate K4 task before frame selection.
