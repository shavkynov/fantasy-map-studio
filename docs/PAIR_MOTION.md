# Controlled K2 pair motion

Status: user run confirmed on 2026-11-02 at 15:24 MSK, exit_code=0, for code committed in 927e885a3a7f2cd60191299856bd1c6fc208ce45. Earlier isolated assistant Node run also passed. Not app integration or visual acceptance.

Run from the downloaded project folder: `node tools/world-pair-motion-test.cjs`. No generator, new masks, fixtures, baseline changes, water metrics, climate or UI.

Source: existing vondoran-227-k2 fixture, fingerprint f23e23e7c1bee7b68328dcc692bdded595e6c664862cb879109d9fbc6b0f6453, loaded through world-source-fixture.cjs. Uses existing world-drift.js motions overrides and world-frame-validity.cjs assess.

Let a be the initial angle between fragment centers and n their normalized cross product. Coincident/antipodal centers are rejected when the cross-product norm is below 1e-10. Both scenarios start from the original source, with spin=0 and dimensionless time in [0,1], not geological years.

Opening: span=(pi-a)/4; fragment 0 rate=-span/2 and fragment 1 rate=+span/2 around n. Expected center angle a+span*time. Check 17 frames at k/16, all required to be sampled-valid. Closing: span=a, reversed signs; expected center angle a-a*time. Scan k/64 in order until the first observed overlapping sample. Failure to find one fails the test. Refine its preceding valid/overlap bracket with 14 midpoint evaluations to width <=1e-6, then repeat both endpoints and require identical reports.

Output includes the axis, motions, center angles, openingFrames, closingScan, coarseBracket and refinedBracket. Unit assertions cover axis orientation, degenerate centers, refinement and invalid endpoints. Every snapshot checks analytical center angles, coverage/owner/provenance consistency and six point/restore round trips. Source and motion inputs must remain unchanged.

The bracket preserves differently classified endpoints; it does not establish globally monotone overlap, exclude missed events between earlier samples or locate a first continuous physical collision. Display is 360x180, centralMeridian=0. No automatic frame acceptance or stored numeric baseline.

Confirmed user output: unitChecksPassed=true, integrationRun=true, sources=1, snapshots=35 (including repeated endpoints), provenanceRoundTrips=210, sourceInputsUnchanged=true, motionInputsUnchanged=true, generatorImported=false, exit_code=0. All 17 opening samples are valid. Center angle increases from 1.7777877457763895 to 2.1187389727297403 radians. Closing coarse bracket [0,0.015625] has endpoint overlap counts 0 and 130. Refined bracket [0,0.00000095367431640625] has counts 0 and 10; right overlapAreaFraction=0.0002147732511735617. These match the earlier assistant observations, not a hard-coded baseline. The left endpoint remained zero: no resolved positive collision-free closing interval or coastline-contact time was established.

The earlier assistant run used isolated copies of repository modules; Git blob hashes of world-domain.js, world-drift.js, world-source-fixture.cjs and world-frame-validity.cjs matched the read files. The user's Mac execution above is separate evidence. Neither run confirms all-cases, CI, visual acceptance or app integration.
