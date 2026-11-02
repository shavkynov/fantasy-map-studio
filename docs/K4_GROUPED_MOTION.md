# K4 subdivision control

Status: code prepared; Node syntax check passed with exit code 0. Assistant JavaScript fixture integration and user execution pending. This is a control before independent K4 motion, not completion of the K4-world stage.

Run from the downloaded project root: `node tools/world-k4-grouped-motion-test.cjs`, then `echo "exit_code=$?"`.

Uses only existing vondoran-227 K2 and K4 fixtures through the checksum-validating loader. Independent Python decompression found identical land unions and child-to-parent mapping [0,1,0,1]. The JavaScript runner verifies this again rather than assuming containment from region ids or centers. No fixture files or baseline hashes change.

Each K4 child inherits its K2 parent's axis, rate and zero spin from the controlled pair experiment. Opening uses 17 times k/16. Closing uses times 0, 1/1048576 and 1/64, replaying the previously observed pair diagnostic endpoints; this runner does not search for a new collision time.

There are four fragments but only two motion groups. This intentionally preserves the K2 union and is not independent four-fragment drift. It tests subdivision invariance: identical coverage arrays, source-index arrays, grouped ownership, validity and overlap diagnostics, identical parent/child poses, source-area sums and 12 child point/restore checks per comparison. Opening samples and closing time=0 must be valid; the two positive closing samples must be rejected for fragment-overlap. Counts of overlapping cells are not hard-coded.

If execution passes, expected structural counts are comparisons=20, snapshots=40, provenanceRoundTrips=240, sources=2, K=4, motionGroups=2. These are counts implied by the runner, not observed integration results yet. Source and motion inputs must remain unchanged; importing world-v4.js fails the test.

No new water metric, frame ranking, continuous collision detection, collision resolution, climate, UI, visual acceptance or app integration. After this control, independent four-fragment motion remains a separate K4 task before frame selection.
