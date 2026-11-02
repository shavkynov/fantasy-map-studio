# Fantasy Map Studio — current handoff

Updated2026-11-02. Repo shavkynov/fantasy-map-studio,branch feature/natural-world-v3. Current stage2:analytic K4 distinct rotations/supports,not moving rasters. Full prior detailed history atcc3e9af4e864e7244ed60540a3b4d70c7d3f0616:claude.md;static-stage checkpoint1d2b2aa02394677c9a9002487c56afbc6835f69a;early full state5294faa93d0e27ab4e09eeaab8e4321a51893ef9.

## Read first and working rules
Read docs/WORK_STATE.md and docs/K4_POSES.md. Prior detailed specs retained,including K4_STATIC_PARTITION,IRREGULAR_PAIR,SEPARABLE_PAIR,BOUNDARY_CONE and earlier K4 diagnostics. Latest confirmed results override old pending notes. NATURAL_WORLD_V3.md describes earlier experimental app work,not spherical integration;its v2 default/preparation/save-load/browser/build/CI limits are separate. Do not run local preparation as part of analytic research.
- ZIP download/Mac,commands from extracted root,no git pull/switch.
- Small substantive code+tests+docs packages;K4 poses,moving K4 and K6 are separate. No service-step approval churn.
- Before GitHub writes resolve exact target and package;confirm_action's intended_source_id/tool_name/arguments must match the complete displayed placeholder. Write exactly the approved content. Never bind an old package to a new question.
- No automatic fixture/baseline/expected-output/visual-reference regeneration or silent source smoothing/erosion/clearance. Preserve immutable checkpoints.
- Geometry,climate,app UI separate. Distinguish prepared code,assistant units/isolated run,user Mac run,visual review,explicit acceptance and integration. Passing tests is not accepted geography.
- Keep context compact:short stdout and one JSON if needed,no huge logs or screenshot series. Do not request already completed reruns/reports. Local artifacts timestamped/exclusive unless approved for GitHub.

## Completed foundation and research
Five frozen canonical sources:vondoran-227 K2/K3/K4/K6,talsaor-287 K4;checksum loader tools/world-source-fixture.cjs and tools/fixtures/world-source unchanged. Core src/world-domain.js/src/world-drift.js unchanged by recent experiments. Core1..32 fragment limit is not quality/performance support;fragments are not final disconnected continents. Full commits/results in immutable history above.
1. R0/R1/R2/R3a,frozen R3b,K2/K3/K6 data/routing/checkpoints,spherical math and rigid drift. User5 sources,11 loads,legacyRecoveries0,25 snapshots,2940 round trips,max raster area error0.005641059792295122;full-turn/polar/immutability/collision reporting passed.
2. Frame validity17 rejected/8 valid;water8 measured/17 skipped. K2~66% largest basin area is not ocean width. Early numeric exits not separately shown.
3. Controlled K2:user15:24 exit0,35 snapshots/210 round trips;closing bracket is not physical first-contact time.
4. Grouped K4:signed-zero assertion failed then fixed without epsilon;user15:33 exit0,40 snapshots/240 round trips,coverage equal. Two inherited motions,not independent K4.
5. Original independent frozen K4:user15:40 exit0,overlap0/137/358/852/3419 at0/0.5/1/2/4. Early schedule15:46 exit0,74 frames,9 valid including zero;no unsampled/continuous-safety claim.
6. Visual export15:56 exit0,five images reviewed16:00:assistant saw only narrow local changes,not substantive separation or explicit user acceptance.
7. Pair attribution16:10 exit0;at4 unique overlap3419,pair incidences4169,triple375. Multiple coverage intentionally counted in several pairs.
8. Split02 user16:24 exit0:plus0/2/0/0/0,minus0/43/79/152/193,control all0 at0/0.25/0.5/0.75/1;all conflicts02,1/3 locked. Resolution16:32 exit0:plus0.25 overlap2/11,plus0.5 overlap0/4 across360x180/720x360. No convenient-raster acceptance.
9. Boundary16:43/repeated16:49 exit0,164 midpoints,plus141 opening/23 closing;repeat unnecessary. Cone0185230ac3dfe4e7820d829ce80e263539a1387c:user17:02 exit0,numerical-zero-cone,positive rank3 certificate. Initial sampled staircase representation only,not formal whole-trajectory proof or impossibility of K4/K6/more pieces. Stop blind tuning of that blocked geometry.
10. Cap7a49ffa77b5a09756cb607b8078d2864289b35ab:user17:13 exit0,7 frames,6 valid opening,negative592,max area error0.014069632419527078. Irregular pair4ec3481d2aa798832144e1496e4fb4285db0f873:user17:25 exit0,7 frames,6 valid opening,negative449,max area error0.019443303240093357. Analytic toys,not frozen-source/app integration or accepted geography. No repeat needed.
11. Static K4 code1d2b2aa02394677c9a9002487c56afbc6835f69a:user19:07 exit0,2 grids,all4 defect counters0,12 boundary probes,3 partition controls rejected,max area error0.0032357253234029937,quadrature difference8.604228440844963e-16. Static four labels,not four separated continents. Stage1 closed within this scope;do not request rerun/JSON/screenshots.

## Current stage2 and evidence
New tools/world-irregular-k4-poses.cjs and docs/K4_POSES.md. Reuse unchanged static shape/ownership and core quaternion functions. Four distinct prescribed angular velocities omega=(0,-sz*r,sy*r),r0.25,T1,alpha0.65. They are not hidden groups sharing transforms;arbitrary independent tuning is NOT supported. Analytic positive-x bound and signed-coordinate growth separate quadrants for positive times under explicit assumptions. No moving raster stage included.
Assistant isolated Node unit-only/default CLI exit0:384 point checks/round trips,48 rigid distances,18 rotation-distinctness checks,4 reversed support probes rejected;max roundtrip error1.3947004136484323e-16,distance2.220446049250313e-16,norm3.3306690738754696e-16. Core copy matched blob71ee09ed451bca803ab0150594c1cc2cc6dcb352;only required static definitions copied in harness. No full checkout,actual repository module-loading,user Mac execution or CI claimed.
integrationRun=false intentionally;analyticMotionSampleRun=true,movingRasterRun=false,frozenFixtureIntegrationRun=false,visualAccepted=false,appIntegrated=false. Sample support checks and analytic argument are not formal proof verification or general collision detection.
After write:user runs node tools/world-irregular-k4-poses.cjs;echo "exit_code=$?". Short stdout,JSON only if needed,no screenshots. User run pending. Do not start next implementation before this run is reviewed.

## Remaining small stages
1. Review user stage2 run.
2. Separate moving analytic K4:two grids,all6 pair memberships/overlap accounting,areas,round trips and deliberately overlapping moving control. Do not equate reversed support probes with a tested raster collision control.
3. Separate K6:first partition,then motions/all15 pairs;split further as necessary.
4. Reviewed bridge to actual source outlines/core drift;no silent frozen-mask changes,report unsupported cases.
5. Once useful admissible motion exists,frame choice and one compact comparison,then explicit user acceptance. Raster validity is not ocean quality/continuous safety.
6. Separate app movement/UI integration;climate separate,crust/fractures only after frame/visual acceptance. Before production claims confirm regressions,integration,repeatability,save/load,performance and CI.

App atlas still flatv4,no accepted moving frame/wide-ocean geography,no frozen-source movement integration or general continuous collision resolution,all-cases/CI unconfirmed. No implicit acceptance or source replacement.
