# Bounded analytic K6 collision runner

Review base: 70280b27a81a72ddac54729f25471bb0c1162ea3.

This is an implementation package, not measured collision evidence. CURRENT.json and all historical AREA reports stay unchanged. No collision or moving-K6 result has been accepted by adding these files.

## Unchanged semantics

Generalizes tools/world-irregular-k4-raster.cjs from four to six pieces. Uses the unchanged native K6 contains/pose/domain functions and world-frame-validity.cjs assess(). Cell centres, inverse rotations, half-open ownership and weights are unchanged. No culling, cap backend, Gauss integration, new gaps, epsilon membership or relaxed overlap threshold. Any overlapping sampled cell is invalid with reason fragment-overlap.

All 15 unordered pairs are accounted per cell; coverage bins are 0..6. Assert total cells, pair incidence sum = sum choose(n,2)*histogram[n], piece incidence sum = sum n*histogram[n], their weighted-area identities, sphere normalization, zero-time ownership and 18 interior inverse round trips per snapshot (angle < 1e-12). Weighted raster areas are incidental diagnostics only; this runner does not rerun or replace AREA acceptance.

## Commands, one action at a time

From repository root:

    node tools/world-irregular-k6-collision.cjs --unit-only
    node tools/world-irregular-k6-collision.cjs plan

These measure zero frames. The unit test covers 64 membership masks, each of 15 isolated pair cases and six invalid masks. It does not test native geometry.

The proposed bounded geometry checks are separate explicit commands, not automatic or already completed:

    node tools/world-irregular-k6-collision.cjs frame 6 artifacts --experimental
    node tools/world-irregular-k6-collision.cjs frame 9 artifacts --experimental

Both are 720x360 at t=0.25. Index6 direction+1 must have no pair overlaps and validSampledGeometry=true. Index9 direction-1 must remain invalid with fragment-overlap; all 15 pairs must register overlaps and coverage6 must be sampled. A successful negative-control command means the invalid geometry was detected, NOT accepted. Failed expectations exit1 after saving the raw snapshot. Runtime/invariant failures also exit1; the report includes the error but a failure during snapshot construction can leave no complete snapshot. Each file uses exclusive creation and a random suffix. Pin native dependency git blobs, record SHA-256 of all dependencies and runner, check unchanged files after measurement.

No all mode or automatic batch. No args only emits the plan. The two proposed snapshots require 3,110,400 unculled piece-membership evaluations combined, not a timing guarantee. No AREA pilot, old tests, static K6 suite or poses suite are rerun by this runner. The existing ten-frame AREA result is neither downgraded nor promoted.

## Acceptance boundaries

Every per-frame report keeps fullScheduleMeasured=false, fullCollisionScheduleMeasured=false, movingK6StageAccepted=false, integrationRun=false, frozenFixtureIntegrationRun=false, visualAccepted=false and appIntegrated=false. collisionChecksPerformed=true only after a new snapshot returns. Even two successful commands cover only indices6 and9, not all ten collision cases, continuous motion, real-source fixtures or the application. No full-stage assembler is added.

## Candidate validation

Exact candidate Node syntax check and standalone --unit-only both exited0. Unit results: 64 membership masks, 15 isolated pair cases, six invalid masks; zero measured frames. An initial unit assertion exposed JavaScript negative zero for choose(0,2); the expected count was corrected to zero for n<2, without changing geometry or collision semantics. The accompanying archive includes command stdout/stderr. No real geometry snapshots, full checkout, Mac run or CI are claimed for this implementation package. Review/saving this package does not authorize an automatic full run.
