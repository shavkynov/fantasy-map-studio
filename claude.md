# Fantasy Map Studio — project handoff

Updated: 2026-11-02. Repository `shavkynov/fantasy-map-studio`; branch `feature/natural-world-v3`. Latest implementation checkpoint: `4ec3481d2aa798832144e1496e4fb4285db0f873`. This handoff includes user evidence through 17:25 MSK that may still be marked pending in older specifications.

## Working rules

- User downloads branch ZIP and runs commands from the extracted root on Mac. Do not suggest git pull/switch.
- Deliver small substantive packages: code + tests + description/checkpoint, not individual approvals for service steps.
- Before any GitHub write, resolve exact targets/content and use confirm_action with matching intended_source_id, intended_tool_name and intended_arguments. The displayed placeholder must contain the SAME complete arguments. After approval write exactly that package. Never bind an old implementation package to a new documentation question.
- No automatic fixture, baseline, expected-value or visual-reference regeneration. Preserve immutable historical checkpoints.
- Keep geometry, climate and application UI/integration separate. Distinguish code prepared, assistant unit checks, assistant isolated run, user Mac run, image/browser review, explicit user acceptance and app integration. Passing a test does not establish accepted geography.
- Keep chat context compact: short stdout and one JSON report attachment; no huge pasted JSON or screenshot series. Use one overview when necessary. Do not request repeated runs already confirmed or documents already supplied.
- Generated artifacts stay local, timestamped and exclusively created, unless explicitly included in an approved repository package.

## Where to read

`docs/WORK_STATE.md` is the compact checkpoint. Full early history is preserved in that file at commit `5294faa93d0e27ab4e09eeaab8e4321a51893ef9`; detailed pre-cone state at `f4ba0c62767808a65d9f9acacc258767733ce02a`; full diagnostic checkpoint at `0185230ac3dfe4e7820d829ce80e263539a1387c`. Existing specifications remain in docs: WATER_METRIC, PAIR_MOTION, K4_GROUPED_MOTION, K4_RATE_EXPERIMENT, K4_RESOLUTION_CHECK, K4_BOUNDARY_CHECK, BOUNDARY_CONE, SEPARABLE_PAIR and IRREGULAR_PAIR. Confirmed results below supersede older pending notes; do not rerun tests simply because a historical document was not updated.

`NATURAL_WORLD_V3.md` describes the earlier experimental app-level v3 track, not proof of integrating the spherical work below. It documents v2 as default, local v3 preparation, silhouette/crust/planar-boundary/relief/incision and climate-finalizer work, plus unverified original-app save/load/browser/build/performance and pending CI. Do not conflate that track with current spherical geometry or run its local preparation script as part of this handoff.

## Core and frozen data

- Spherical math: src/world-domain.js, commit ded6cf7. Rigid drift: src/world-drift.js, commit d3b87f8. Recent experiments have not changed these files.
- Five frozen canonical sources: vondoran-227 K2/K3/K4/K6 and talsaor-287 K4; tools/fixtures/world-source and checksum loader tools/world-source-fixture.cjs. Current baseline is covered; new masks are not required for it.
- Early checkpoints R0/R1/R2/R3a:90e8a4c/aff5b68/2500244/d0e768e. Frozen-input R3b:aa170a2 with check9cc0e03; K2 data14b6acf, routingc3d7e3a, checkpointde65281; K3 data33ed259, routing3d07d32, checkpoint308462e; K6 data460f249, routing8f6c75e, checkpoint2acd5b5. Full provenance/source hashes remain in historical docs.
- Core drift accepts 1..32 fragments; that validation limit is not a quality/performance guarantee. Special K4 diagnostics are not all generic. Four fragments is a test case, not the intended maximum. Fragments and final disconnected continents are distinct concepts.
- App atlas still displays flat v4. Spherical movement is not app-integrated. No accepted moving frame or wide-ocean geography. Full all-cases and CI unconfirmed. No general continuous collision detection/resolution.

## Completed and verified stages

### Earlier foundation

- Spherical math, rigid drift, source-mask preservation, drift and validity diagnostics are documented in the historical checkpoint.
- User fixture-only drift run: 5 sources, 11 loads, `legacyRecoveries=0`, 25 snapshots, 2940 provenance round trips, maximum raster-relative area error `0.005641059792295122`. Full-turn owner equivalence, polar rotation, source immutability and explicit collision reporting passed.
- User frame-validity run: 5 sources, 25 snapshots, 17 sampled frames rejected, 8 valid; no generator import. Numeric exit code was not separately supplied for these early runs.
- Water metric commit `169ae9a92631cd2cb58a40c23ec828d9bc77fae5`. User run 2026-11-02 15:11 MSK: 5 sources, 25 snapshots, 8 measured, 17 skipped; unit/integration flags true. Largest K2 water component is about 66% of sphere area, not a measure of ocean width.

### K2 pair and K4 controls

- K2 pair-motion test commit `927e885a3a7f2cd60191299856bd1c6fc208ce45`. User Mac 15:24, exit 0, 35 snapshots and 210 round trips. Opening: 17 sampled-valid frames. Closing bracket `[0, 0.00000095367431640625]` had endpoint overlap counts 0 and 10; not a physical first-contact time or resolved positive collision-free interval.
- Grouped K4 test commit `82927b60d2c2fc81a0cd9d9e2781495d9749306b` initially failed at 15:30 because `deepStrictEqual` distinguishes `-0` from `0`. Correction commit `58d02cce7ad13b87077b6c35b64efb8bcee11deb` compares finite components numerically without epsilon and has signed-zero regressions. User rerun 15:33, exit 0: K2/K4 mapping `[0,1,0,1]`, 20 comparisons, 40 snapshots, 240 point round trips, grouped coverage equal, inputs unchanged. This is four fragments under two inherited motions, not independent K4 motion.
- Original independent K4 test commit `61d42988775890dcea0d41b73ee9cbe7c2f3bc10`. User 15:40, exit 0: 5 snapshots at `0,0.5,1,2,4`, 30 pair-rotation checks, 60 round trips, max raster area error `0.0045891914976589065`, only time 0 valid; overlap cells `0,137,358,852,3419`.
- Early fixed schedule commit `4ad97149c39e5996ec33650acefef747523d7ab0`. User 15:46, exit 0: 74 snapshots, 444 pair checks, 888 round trips, max raster area error `0.005226660207385159`, 9 valid including zero, 8 positive valid, 65 rejected. Positive valid powers are `2^-16..2^-9`; next time `1/256` has 7 overlaps, `1/128` has 2. Counts are non-monotone; no continuous-safety or unsampled-time conclusion.

### Comparison and overlap attribution

- Standalone K4 visual comparison export commit `315c620294153998530a9bb5f697a24bbcf2e9fa`. User 15:56, exit 0, 5 frames exported at 360x180. Five screenshots reviewed 16:00. Assistant assessment: allowed positive frames showed only narrow local changes, not substantial continent separation. This is not explicit user acceptance/rejection. No frame chosen, geography not accepted, app not integrated.
- Pair-overlap attribution commit `5294faa93d0e27ab4e09eeaab8e4321a51893ef9`. User 16:10, exit 0, 8 snapshots; membership reconstruction matched coverage/owner/provenance and spherical accounting. At time 4: 3419 unique overlap cells, 4169 pair incidences, 375 triple-covered, 0 quadruple-covered. Pair counts for 01/02/03/12/13/23: `23/268/175/1822/703/1178`. At 0.5/1/2 only 02 and 13 overlap: `89/48`, `218/140`, `367/485`. Pair maps reviewed; no more screenshots of the same diagnostics needed. Triple/quad cells intentionally belong to3/6 pairs.

### Split-02 experiment and resolution check

- Controlled grouped/plus/minus split experiment commit `95c5d3140e84977fea87fb27b9adb823df0a2c20`. User 16:24, exit 0, 15 snapshots, two sources, source/motion unchanged, no generator. Across times `0,0.25,0.5,0.75,1`: grouped overlap `0/0/0/0/0`; plus `0/2/0/0/0`; minus `0/43/79/152/193`. All conflicts were pair 0–2; 1–3 stayed linked. Plus/minus changed pair-center angle by about +/-`4e-6` at probe `1e-4`. Plus is not a safe trajectory because `t=0.25` overlaps. JSON/HTML received; HTML not visually accepted.
- Fixed resolution check commit `c3328aef00e03756be93274b0187fd518903b546`. User 16:32, exit 0, 12 snapshots. Grouped control valid on 360x180 and 720x360 at 0/0.25/0.5. Plus at 0.25 overlaps 2/11 cells; at 0.5 it overlaps 0/4. Every conflict remains pair 0–2; other pairs and triple/quad counts are zero. The coarse-grid zero at 0.5 is resolution-dependent; do not select a convenient grid to accept a frame.

### Shared-boundary check and numerical cone

- Initial source-boundary velocity diagnostic commit `f4ba0c62767808a65d9f9acacc258767733ce02a`. User runs 16:43 and repeated 16:49, both exit 0: 164 shared source-edge midpoint constraints; grouped control 164 neutral; plus 141 opening/23 closing; max finite-difference error `8.823025643422966e-12`; inputs unchanged, no generator. Repeating the same command was unnecessary.
- Generic initial-boundary cone checker commit `0185230ac3dfe4e7820d829ce80e263539a1387c`. User `--k4-02` run 17:02, exit 0: 164 constraints, `numerical-zero-cone`, no nonzero witness, input unchanged, no generator. Positive four-row certificate indices 34/43/86/35, residual `5.618469141565346e-17`, rank-3 minor `0.07875620531004299`; assistant Node and separate SciPy/HiGHS checks agree. This is floating-point evidence only for initial sampled edge midpoints of the current staircase source boundary. It is not a formal interval proof, not a whole-trajectory proof, and not a theorem that K4/K6 or more fragments are impossible. Stop blind axis/speed/grid tuning of the same blocked geometry.

### Constructive analytic examples

- Circular cap pair commit `7a49ffa77b5a09756cb607b8078d2864289b35ab`. User 17:13, exit 0: analytic half-cap, 7 snapshots, 6 valid opening frames, reversed-motion negative control rejected with 592 cells; max raster area error `0.014069632419527078`. `frozenFixtureIntegrationRun=false`, `visualAccepted=false`, `appIntegrated=false` are intentional. It proves only that a deliberately separable toy pair can be constructed analytically.
- Irregular-outline analytic pair commit `4ec3481d2aa798832144e1496e4fb4285db0f873`. User 17:25, exit 0: `geometryMode=analytic-irregular-half-patch`, 7 snapshots, 6 valid opening frames on two grids, reverse control 449 overlaps, maximum raster/reference area error `0.019443303240093357`, Simpson 4096/8192 reference difference `1.1435297153639112e-14`, no generator import. This is a wavy analytic half-cap, not a frozen fixture, natural coastline acceptance, K4/K6 generation, or app integration.

## What is NOT completed

- Multi-fragment constructive geometry beyond the two-piece analytic examples has not been implemented or run in this conversation.
- No new admissible representation/cut policy for actual frozen K4/K6 outlines; no authorised replacement of their jagged shared boundaries.
- Analytic examples are not frozen-mask integration, a natural-continent generator,accepted geography or a tested production movement model.
- No accepted moving frame,accepted wide oceans,application motion integration,continuous collision resolution,crust/fracture simulation,full all-cases/CI or confirmed end-to-end app save/load/build/performance for this work.
- A local area/reference check and small quadrature difference are not a formal continuous-collision or geography-quality proof.

## Next agreed work and subsequent roadmap

1. NEXT substantive package: analytic multiple-fragment cut/support bookkeeping, with explicit K=4 and K=6 examples. Verify initial union without loss/duplication, own per-fragment motions rather than hidden linked groups, separation under stated bounds for all pairs,area checks,round trips and deliberate rejected negative control. These are new analytic examples,not the unchanged frozen K4/K6 masks.
2. After user verification,design an explicit bridge from admissible continuous cuts to real source outlines and core drift. Preserve declared separation conditions; expose unsupported cases. Do not silently smooth/erode masks,add clearance or regenerate fixtures. Any source-geometry replacement needs a separate reviewed package.
3. Validate generalisation beyond one pair and one source, including existing K4/K6 as controls/diagnostic inputs. Do not assert arbitrary K support from one successful toy;core's1..32 input limit alone is not a quality guarantee.
4. Once useful admissible motion exists,perform frame selection and one compact visual comparison,then explicit user acceptance. Do not select time0 or a convenient raster as a substitute for meaningful motion.
5. Application integration comes in its own reviewed package after geometry decisions. UI,climate and geometry must not be mixed. Existing atlas must not be silently replaced.
6. Crust/fractures remain deferred until geometry/frame visual comparison and acceptance; do not start geological simulation to hide the present source-separability issue.
7. Before claiming a working production feature,confirm relevant integration/regressions,repeatability,save/load where used,performance and CI; report unverified items plainly.

## Immediate handoff

The last completed user action is the irregular-pair run at17:25. No additional report,JSON,rerun or screenshot is currently needed. Prepare the K=4/K=6 analytic package next if asked to continue. The current request only creates this handoff file: no implementation files or other documentation are changed by it.
