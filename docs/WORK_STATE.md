# WORK STATE — current checkpoint

2026-11-02, feature/natural-world-v3. Keep current state short. Full preceding history, source SHA values and checkpoints remain in docs/WORK_STATE.md at immutable commit 5294faa93d0e27ab4e09eeaab8e4321a51893ef9:
https://github.com/shavkynov/fantasy-map-studio/blob/5294faa93d0e27ab4e09eeaab8e4321a51893ef9/docs/WORK_STATE.md
Historical specs: docs/WATER_METRIC.md, docs/PAIR_MOTION.md, docs/K4_GROUPED_MOTION.md, docs/K4_RATE_EXPERIMENT.md. Current status below and docs/K4_RESOLUTION_CHECK.md supersede older pending notes. No fixture/baseline regeneration.

## Confirmed user results
- Five frozen sources: vondoran-227 K2/K3/K4/K6 and talsaor-287 K4; existing loader/checksums cover baseline. No new masks needed.
- Drift fixture-only: sources=5, loads=11, legacyRecoveries=0, snapshots=25, roundTrips=2940, maxRasterRelativeAreaError=0.005641059792295122. Full-turn owners, polar rotation, unchanged source and explicit collisions passed.
- Frame validity: snapshots=25, rejected=17, valid=8 (all zero plus K2 at 0.5,1,2), no generator import.
- Water 169ae9a, user 15:11 MSK: units/integration passed, sources=5, snapshots=25, measured=8, skipped=17. About 66% of sphere for largest K2 basin is NOT ocean width. Numeric exit code not separately provided for these early runs.
- Pair K2 927e885a, user 15:24 exit=0: snapshots=35, roundTrips=210, 17 valid opening samples; closing bracket [0,0.00000095367431640625], overlap 0/10, not physical first-contact time.
- Grouped K4 82927b60 first failed on signed zero at 15:30, exit=1, Node v26.12.0. Fix 58d02cce compares finite pose components without epsilon. User 15:33 exit=0: sources=2, groups=2, mapping=[0,1,0,1], comparisons=20, snapshots=40, roundTrips=240; coverage equal and inputs unchanged.
- Independent K4 61d42988, user 15:40 exit=0: original speeds, snapshots=5, pairChecks=30, roundTrips=60, raster error=0.0045891914976589065; times 0/0.5/1/2/4 overlap 0/137/358/852/3419. Only zero valid in that set.
- Early K4 4ad97149, user 15:46 exit=0: snapshots=74, pairChecks=444, roundTrips=888, raster error=0.005226660207385159; valid=9, positiveValid=8, rejected=65. Valid positive powers 2^-16..2^-9; next sample 1/256 overlap=7; 1/128 overlap=2. Nonmonotone counts; no continuous safety/other-grid claims.
- Comparison 315c6202, user 15:56 exit=0: HTML written, 5 frames, overlap 0/0/0/0/7. Screenshots reviewed 16:00: assistant assessment found narrow local changes, no substantive separation. Not explicit user acceptance/rejection.
- Pair attribution 5294faa9, user 16:10 exit=0: units/integration/artifacts passed, sources=1, snapshots=8, unchanged source, no generator import. Coverage/owner/provenance and weighted accounting matched. At 4 union=3419, pair incidences=4169, triple=375, quad=0; pairs 01/02/03/12/13/23=23/268/175/1822/703/1178. At 0.5/1/2 only 02 and13 overlap: 89/48,218/140,367/485. Images at16:15 show extended conflicts; no more screenshots needed.
- Single-pair experiment 95c5d3140e84977fea87fb27b9adb823df0a2c20, user 16:24 exit=0: units/integration passed, sources=2, scenarios=3, snapshots=15, sourceInputsUnchanged=true, motionInputsUnchanged=true, generatorImported=false. JSON and HTML received16:25; JSON read, HTML not visually accepted. At times0/0.25/0.5/0.75/1, control overlap=0/0/0/0/0; plus=0/2/0/0/0; minus=0/43/79/152/193. All conflicts are pair02; other pairs zero, triple/quad zero. Probe center-angle changes approximately +4e-6/-4e-6 at t=1e-4. Plus is not a continuously safe trajectory; t=0.25 is rejected.

## Prepared package: fixed resolution check
New tools/world-k4-resolution.cjs; docs/K4_RESOLUTION_CHECK.md. Reuses unchanged motionsFor and existing fixtures, no speed search. Grouped-control and split-02-plus, times0/0.25/0.5, grids360x180/720x360, meridian0, total12 snapshots. All six pairs and coverage/provenance/weighted accounting retained. Same motions across grids, fresh sampling, not image enlargement. Pair13 stays locked: still not four independent fragments.
Assistant isolated Node unit-only run exit=0 checks aggregate matching/disagreement, unchanged inputs, missing/duplicated grids. Full fixture check NOT executed by assistant/user yet. Fine-grid counts unknown. No assertion requires experimental validity or matching grid results. One JSON and concise stdout; no visual export or screenshot request.

## Boundaries and next action
User downloads ZIP and runs locally on Mac; no git pull/switch. Exact package plus confirm_action before GitHub writes. No automatic fixtures/baselines/expected-output changes. Keep geometry, climate and app UI separate. Artifacts local, timestamped, exclusive creation.
No accepted moving frame/ocean geography, continuous collision detection/resolution, climate recomputation or app integration. Atlas flat v4. Full all-cases/CI unconfirmed. Distinguish code, assistant local checks, user run, visual review, explicit acceptance and integration. Crust/fractures only after frame choice/comparison.
After writing: node tools/world-k4-resolution.cjs; echo "exit_code=$?". Provide short stdout and attach generated JSON. Agreement on two grids is not convergence/safety; never select the convenient grid to accept a frame.
