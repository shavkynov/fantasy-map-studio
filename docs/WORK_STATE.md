# WORK STATE — current checkpoint

2026-11-02, feature/natural-world-v3. Keep this current state short to limit chat context. Full preceding history, source SHA values, checkpoints and tests remain in docs/WORK_STATE.md at immutable commit 5294faa93d0e27ab4e09eeaab8e4321a51893ef9:
https://github.com/shavkynov/fantasy-map-studio/blob/5294faa93d0e27ab4e09eeaab8e4321a51893ef9/docs/WORK_STATE.md
Detailed historical specs: docs/WATER_METRIC.md, docs/PAIR_MOTION.md, docs/K4_GROUPED_MOTION.md. Current status below supersedes their older pending notes. No fixture/baseline regeneration.

## Confirmed user results
- Five frozen sources: vondoran-227 K2/K3/K4/K6 and talsaor-287 K4. Existing loader/checksums cover current baseline; no new masks needed.
- Drift fixture-only: sources=5, loads=11, legacyRecoveries=0, snapshots=25, roundTrips=2940, maxRasterRelativeAreaError=0.005641059792295122. Full-turn owners, polar rotation, unchanged source and explicit collisions passed.
- Frame validity: 25 snapshots, 17 rejections; 8 valid (all zero plus K2 at 0.5,1,2), no generator import.
- Water metric commit 169ae9a: user 15:11 MSK, units/integration passed, sources=5, snapshots=25, measured=8, skipped=17; about 66% of sphere for largest K2 basin is NOT ocean width. Numeric exit code not separately provided for these early runs.
- Pair K2 commit 927e885a: user 15:24, exit_code=0, snapshots=35, roundTrips=210, 17 valid opening samples; closing bracket [0,0.00000095367431640625] with overlap 0/10, not physical first-contact time.
- Grouped K4 82927b60 first failed on signed zero at 15:30, exit=1, Node v26.12.0. Fix 58d02cce compares finite pose components numerically without epsilon. User 15:33 exit=0: sources=2, motionGroups=2, mapping=[0,1,0,1], comparisons=20, snapshots=40, roundTrips=240; coverage equal and inputs unchanged.
- Independent K4 61d42988: user 15:40 exit=0, original speeds, snapshots=5, pairChecks=30, roundTrips=60, raster error=0.0045891914976589065; time 0/0.5/1/2/4 overlaps 0/137/358/852/3419. Only zero valid in that set.
- Early K4 4ad97149: user 15:46 exit=0, snapshots=74, pairChecks=444, roundTrips=888, raster error=0.005226660207385159; valid=9, positiveValid=8, rejected=65. Valid positive powers 2^-16..2^-9; next sample 1/256 overlaps 7; 1/128 overlaps 2, so counts not monotone. No continuous safety or other-grid claims.
- Comparison 315c6202: user 15:56 exit=0, HTML written, 5 frames, overlaps 0/0/0/0/7. Screenshots reviewed at 16:00: assistant assessment found only narrow local changes in valid early frames, no substantive continent separation. This is not an explicit user acceptance/rejection decision.
- Pair attribution 5294faa9: user 16:10 exit=0, units/integration/artifacts passed, sources=1, snapshots=8, unchanged source, no generator import. Full coverage/owner/provenance and weighted accounting matched. At 4: unionCells=3419, pairIncidences=4169, triple=375, quadruple=0. Pair counts 01/02/03/12/13/23=23/268/175/1822/703/1178. At 0.5/1/2 only pairs02 and13 overlap: 89/48,218/140,367/485. Images supplied 16:15 show extended conflict areas. No more screenshots of the same diagnostics are required.

## Prepared next package: single 0–2 perturbation
Code tools/world-k4-split-02.cjs; spec docs/K4_RATE_EXPERIMENT.md. Existing grouped opening is control. Plus/minus fixed angular-velocity perturbations of 0/2 with delta=0.02, preserving their mean; 1/3 remain locked. Five fixed times in [0,1], 15 snapshots, all six overlap pairs checked. This is a targeted experiment, NOT a four-independent-fragment solution or automatic frame selection. Original independent speeds and core drift unchanged.
Assistant isolated Node unit-only checks passed exit=0 (vectors, invariants, direction convention, overview rendering). Full fixture experiment NOT run by assistant or user yet. No valid/rejected counts or improvement claimed. One compact stdout summary, full JSON file and one 3-row HTML overview; user should attach JSON, not paste many maps.

## Boundaries and next action
User downloads ZIP and runs commands on Mac; no git pull/switch. Before GitHub writes show exact package and confirm_action. No automatic fixture/baseline/expected-output changes. Geometry, climate and app UI remain separate. Generated artifacts are local, timestamped, exclusive creation.
No accepted moving frame or ocean geography, no collision resolution/continuous detection, no climate recomputation, no app integration. Atlas still flat v4. Full all-cases and CI unconfirmed. Distinguish code, assistant local check, user execution, visual review, explicit acceptance and app integration. Crust/fractures only after frame choice and visual comparison.
After this package is written: node tools/world-k4-split-02.cjs; echo "exit_code=$?". Provide short stdout and generated JSON. Examine all pairs before changing another part of the motion model.
