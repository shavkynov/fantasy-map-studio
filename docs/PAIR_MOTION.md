# Controlled K2 pair motion

Status: test prepared and passed in an isolated assistant Node run; user run pending. Not app integration or visual acceptance.

Run from the downloaded project folder: `node tools/world-pair-motion-test.cjs`. No generator, new masks, fixtures, baseline changes, water metrics, climate or UI.

Source: existing vondoran-227-k2 fixture, fingerprint f23e23e7c1bee7b68328dcc692bdded595e6c664862cb879109d9fbc6b0f6453, loaded through world-source-fixture.cjs. Uses existing world-drift.js motions overrides and world-frame-validity.cjs assess.

Let a be the initial angle between fragment centers and n their normalized cross product. Coincident/antipodal centers are rejected when the cross-product norm is below 1e-10. Both scenarios start from the original source, with spin=0 and time in [0,1]; time is dimensionless, not geological years.

Opening: span=(pi-a)/4; fragment 0 rate=-span/2 and fragment 1 rate=+span/2, both around n. Expected center angle a+span*time. Check 17 frames at k/16, all required to be sampled-valid. This checks only the declared opening range, not arbitrary divergence.

Closing: span=a, reversed signs. Expected center angle a-a*time. Scan k/64 in order, stopping at the first observed overlapping sample. Failure to find one is a test failure. Refine the preceding valid/overlap pair with 14 midpoint evaluations, requiring final width <=1e-6. Re-evaluate both endpoints and require identical reports.

The output includes the axis, motions, center angles, openingFrames, closingScan, coarseBracket and refinedBracket with overlap counts, areas and reasons. Unit assertions cover axis orientation, degenerate centers, bracket refinement and invalid endpoints. Each snapshot checks the analytical center angle, coverage/owner/provenance consistency and six point/restore round trips. Source data and motion options must remain unchanged.

This local bracket preserves a valid left endpoint and an overlapping right endpoint. It does not establish globally monotone overlap, exclude missed events between earlier samples, or locate a first continuous physical collision. Raster dimensions and meridian are fixed at 360x180 and 0. No automatic frame acceptance or stored numeric baseline is introduced.

Assistant local run, 2026-11-02: Node exit code 0, 35 snapshot evaluations (including repeated endpoints), 210 point/restore checks, 17 valid opening frames, generatorImported=false. Initial center angle 1.7777877457763895 radians. Closing coarse bracket [0,0.015625]; refined bracket [0,0.00000095367431640625]. Left overlapCells=0; right overlapCells=10 and overlapAreaFraction=0.0002147732511735617. This is a near-origin raster transition, not a resolved positive collision-free interval or a coastline-contact measurement. Values are observations, not hard-coded expected output.

Execution used isolated copies of the repository modules; Git blob hashes of world-domain.js, world-drift.js, world-source-fixture.cjs and world-frame-validity.cjs matched the read repository files. Fixture labels and region metadata passed the existing loader checks. This was not a full repository checkout, all-cases run, CI or user Mac execution.
