# Fantasy Map Studio — current handoff

Updated2026-11-02. Repo shavkynov/fantasy-map-studio,branch feature/natural-world-v3. This replaces the earlier combined K4/K6 next task with small stages. Full prior detailed handoff,all historical results and commit provenance remain at immutable cc3e9af4e864e7244ed60540a3b4d70c7d3f0616:claude.md. Early full history at5294faa93d0e27ab4e09eeaab8e4321a51893ef9:docs/WORK_STATE.md.

## Read first
Current docs/WORK_STATE.md and docs/K4_STATIC_PARTITION.md. Historical specifications retained:WATER_METRIC,PAIR_MOTION,K4_GROUPED_MOTION,K4_RATE_EXPERIMENT,K4_RESOLUTION_CHECK,K4_BOUNDARY_CHECK,BOUNDARY_CONE,SEPARABLE_PAIR,IRREGULAR_PAIR. Confirmed results here supersede older pending notes.
NATURAL_WORLD_V3.md describes the earlier experimental application track:v2 default,local v3 preparation,planar crust/relief/incision/climate-finalizer work. Do not conflate it with spherical movement integration or run preparation as part of these analytic checks. Its save/load/browser/build/performance/CI limits remain distinct.

## Working agreement
- User downloads ZIP,runs from extracted root on Mac. No git pull/switch.
- Small substantive code+tests+docs packages. Do not ask separate approval for service steps or combine K4 and K6 into one heavy task.
- Before external writes resolve exact targets/content and use confirm_action with intended_source_id,intended_tool_name,intended_arguments matching the COMPLETE displayed placeholder. Execute only the approved package;never bind an old code package to a new documentation question.
- No automatic fixture/baseline/expected-value/visual-reference regeneration. Preserve historical checkpoints. No silent source smoothing,erosion or clearance cuts.
- Keep geometry,climate and app UI separate. Distinguish prepared code,assistant units/isolated execution,user Mac execution,visual review,explicit acceptance and integration. A test pass is not accepted geography.
- Keep context compact:short stdout plus one JSON if needed,no huge pasted logs or screenshot series. Do not request completed reruns or already supplied reports. Artifacts local,timestamped,exclusive creation unless approved for GitHub.

## Foundation and completed work
Five frozen sources:vondoran-227 K2/K3/K4/K6,talsaor-287 K4;checksum loader tools/world-source-fixture.cjs protects tools/fixtures/world-source. No new masks needed for baseline. Core src/world-domain.js and src/world-drift.js unchanged by recent experiments. Core1..32 fragment input limit is not a quality/performance guarantee;fragment count is not final disconnected-continent count.
Completed sequence,with full commits/numbers in immutable handoff:
1. R0/R1/R2/R3a and frozen-source R3b,then K2/K3/K6 data/routing/checkpoints.
2. Spherical math and rigid drift:user5 sources,11 loads,25 snapshots,2940 round trips,legacyRecoveries0,max area error0.005641059792295122;full-turn/polar/immutability/collision reporting passed.
3. Frame-validity rejection reasons:25 snapshots,17 rejected,8 valid.
4. Water component metric:8 measured/17 skipped;~66% K2 basin area is not ocean width. Early numeric exits not separately provided.
5. K2 controlled pair:user15:24 exit0,35 snapshots,210 round trips;sampled opening valid;closing bracket not physical collision time.
6. Grouped K4:signed-zero assertion failed then corrected without epsilon;user15:33 exit0,40 snapshots,240 round trips,coverage equal. Two inherited motions,not independent K4.
7. Independent original K4:user15:40 exit0;only zero valid,overlap0/137/358/852/3419 at0/0.5/1/2/4.
8. Early K4 schedule:user15:46 exit0,74 snapshots,9 valid including zero,65 rejected;tiny valid times are not continuous safety.
9. Visual export:user15:56 exit0,5 images reviewed16:00;assistant saw narrow/local changes,not substantive separation or explicit user acceptance.
10. Pair attribution:user16:10 exit0;at4 unique overlap3419,pair incidences4169,triple375. Multiple coverage intentionally contributes to several pairs.
11. Split02:user16:24 exit0;plus overlap0/2/0/0/0 across0/0.25/0.5/0.75/1;minus0/43/79/152/193;control all0,1/3 linked. Not an accepted safe trajectory.
12. Two-grid check:user16:32 exit0;plus0.25 overlap2/11,plus0.5 overlap0/4 on360x180/720x360. Do not select convenient raster validity.
13. Shared-boundary check:user16:43 and repeated16:49 exit0,164 midpoints,plus141 opening/23 closing. Repeat was unnecessary.
14. Cone0185230ac3dfe4e7820d829ce80e263539a1387c:user17:02 exit0,164 constraints,numerical-zero-cone,positive rank3 certificate. Numerical initial staircase-midpoint limitation,not formal whole-trajectory proof or impossibility of K4/K6/more fragments. Stop blind axis/speed/grid tuning of that blocked geometry.
15. Cap7a49ffa77b5a09756cb607b8078d2864289b35ab:user17:13 exit0,7 snapshots,6 opening valid,negative592,max area error0.014069632419527078.
16. Irregular pair4ec3481d2aa798832144e1496e4fb4285db0f873:user17:25 exit0,7 snapshots,6 opening valid,negative449,max area error0.019443303240093357. No repeat needed.

## Current small package and evidence
Static analytic K4 only:tools/world-irregular-k4-static.cjs and docs/K4_STATIC_PARTITION.md. Same explicit irregular radial profile,split by y=0 and z=0,zeros assigned to nonnegative sides. No motion or physical gap;four labels are not four separated continents. Standalone formula,not import/integration of the prior pair or core.
Assistant isolated Node unit-only and full static runs exit0:2 grids,all missing/outside/multiple-owner/owner-mismatch counters0,12 boundary probes,3 synthetic partition detector controls rejected,max relative area error0.0032357253234029937,max quadrature difference8.604228440844963e-16,JSON nonempty. Earlier Python probe was separate. No full checkout/CI or user Mac execution claimed.
User run pending AFTER write:node tools/world-irregular-k4-static.cjs;echo "exit_code=$?". Ask only short stdout,JSON if needed,no screenshots. This is not a request to rerun previous tests. frozenFixtureIntegrationRun=false,motionTested=false,visualAccepted=false,appIntegrated=false deliberately. integrationRun=true refers only to standalone analytic raster execution.

## Split roadmap
1. Static analytic K4 partition:this package,then user confirmation.
2. Separate K4 independent rotations and stated separating/support bounds;not two hidden linked groups.
3. Separate moving K4 validation:all6 pairs,round trips,areas,and intentionally rejected moving control.
4. Separate K6:first partition,then motions and all15 pairs;split further if necessary.
5. Later reviewed bridge to real source outlines/core drift,without silent frozen-source changes;test actual sources as controls and report unsupported cases.
6. Once useful admissible motion exists,choose a frame,make one compact comparison and obtain explicit visual acceptance. Raster validity is not continuous collision safety or geographic quality.
7. App motion/UI integration in a separately reviewed package. Climate remains separate;crust/fractures only after frame/geometry visual acceptance.
8. Before production claims confirm relevant regressions,integration,repeatability,save/load,performance and CI;state missing evidence.

App still flatv4,no accepted moving frame/wide-ocean geography,no frozen-source motion integration or general continuous collision resolution. Analytic pair/static K4 examples are not natural geography acceptance. Do not start the next implementation stage before this package is written and its user test is reviewed.
