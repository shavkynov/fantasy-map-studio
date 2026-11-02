# Fantasy Map Studio — current handoff

Updated2026-11-02. Repo shavkynov/fantasy-map-studio,branch feature/natural-world-v3. Current stage3:moving analytic K4 raster. Full detailed history atcc3e9af4e864e7244ed60540a3b4d70c7d3f0616:claude.md;early full state5294faa93d0e27ab4e09eeaab8e4321a51893ef9. Static checkpoint1d2b2aa02394677c9a9002487c56afbc6835f69a;poses checkpoint6140edb904c1d822c5efb655c07d0658c8922172.

## Read first and working agreement
Read docs/WORK_STATE.md and docs/K4_MOVING_RASTER.md. Earlier specs retained including K4_POSES,K4_STATIC_PARTITION,IRREGULAR_PAIR,SEPARABLE_PAIR,BOUNDARY_CONE and older source diagnostics. Confirmed latest statuses supersede historical pending notes. NATURAL_WORLD_V3.md describes earlier experimental app work,not spherical integration;v2 default/local preparation/save-load/browser/build/CI limitations separate. Do not run app preparation for analytic checks.
- ZIP download/Mac,commands from extracted root,no git pull/switch.
- Small substantive code+tests+docs packages;static K4,poses,moving raster,static K6,K6 motion separate. No service-step approval churn.
- Before external writes resolve exact targets/content and use confirm_action with matching intended_source_id/tool_name/arguments and COMPLETE displayed placeholder. Write exactly the approved package;never bind old code to a new question.
- No automatic fixture/baseline/expected-value/visual-reference regeneration or silent source smoothing/erosion/clearance. Preserve immutable checkpoints.
- Geometry,climate and app UI separate. Distinguish prepared code,assistant units/isolated execution,user Mac run,image/browser review,explicit acceptance and integration. Tests passing is not accepted geography.
- Keep context compact:short stdout,one JSON if needed,no huge logs/screenshot series. Do not request completed reruns/already supplied reports. Artifacts local,timestamped/exclusive unless explicitly approved for GitHub.

## Completed research and boundaries
Five frozen sources:vondoran-227 K2/K3/K4/K6,talsaor-287 K4;tools/fixtures/world-source and checksum loader unchanged. Core src/world-domain.js/src/world-drift.js unchanged by recent experiments. Core1..32 input limit is not quality/performance support;fragments are not final disconnected continents. Full commits/numbers remain in immutable history.
1. R0/R1/R2/R3a,frozen R3b,K2/K3/K6 data/routing/checkpoints,spherical math and rigid drift. User5 sources,11 loads,legacyRecoveries0,25 snapshots,2940 round trips,max raster area error0.005641059792295122;full-turn/polar/immutability/collision reporting passed.
2. Validity17 rejected/8 valid;water8 measured/17 skipped,K2~66% basin area not ocean width. Early numeric exits not separately shown.
3. Controlled K2 user15:24 exit0,35 snapshots/210 round trips;closing bracket not physical first-contact time.
4. Grouped K4 signed-zero assertion fixed without epsilon;user15:33 exit0,40 snapshots/240 round trips,coverage equal. TWO inherited motions,not independent K4.
5. Original frozen independent K4 user15:40 exit0,overlap0/137/358/852/3419 at0/0.5/1/2/4;early15:46 exit0,74 frames,9 valid including zero. Tiny sampled-valid times do not establish continuous safety.
6. Visual export15:56 exit0,5 images reviewed16:00:assistant saw narrow/local changes,not substantive separation or explicit user acceptance.
7. Pair attribution16:10 exit0:at4 unique3419,pair incidences4169,triple375. Multiple coverage intentionally belongs to several pairs.
8. Split02 user16:24 exit0:plus0/2/0/0/0,minus0/43/79/152/193,control all0 at0/0.25/0.5/0.75/1;conflicts02,1/3 locked. Resolution16:32 exit0:plus0.25 overlap2/11,plus0.5 overlap0/4 across360x180/720x360. No convenient-raster acceptance.
9. Boundary16:43/repeated16:49 exit0,164 midpoints,141 opening/23 closing;repeat unnecessary. Cone0185230ac3dfe4e7820d829ce80e263539a1387c:user17:02 exit0,numerical-zero-cone,positive rank3 certificate. Initial sampled staircase representation only,not formal whole-trajectory proof or impossibility of K4/K6/more pieces. Stop blind tuning.
10. Cap7a49ffa77b5a09756cb607b8078d2864289b35ab:user17:13 exit0,7 frames,6 opening valid,negative592,max area error0.014069632419527078. Irregular pair4ec3481d2aa798832144e1496e4fb4285db0f873:user17:25 exit0,7 frames,6 opening valid,negative449,max area error0.019443303240093357. Analytic toys,not accepted geography or frozen-source/app integration.
11. Static K4 user19:07 exit0:2 grids,all4 defect counters0,12 boundary probes,3 controls rejected,max area error0.0032357253234029937. Four labels without movement,not separated continents.
12. K4 poses user19:15 exit0:384 point checks/round trips,48 rigid distances,18 rotation-distinctness checks,4 reversed support probes rejected,max roundtrip1.3947004136484323e-16. Four prescribed distinct motions,not arbitrary independent tuning. Analytic support argument limited to stated geometry/rate/time;not general collision detection or formal verification. Second pasted command had no output;confirmed first run suffices. No old reruns/reports/screenshots needed.

## Current small package and evidence
New tools/world-irregular-k4-raster.cjs and docs/K4_MOVING_RASTER.md. Uses unchanged static membership/references,stage2 poses,core apply/cell areas and existing assess. Ten frames:8 opening(including2 zero) on360x180/720x360 at0/0.25/0.5/1;2 reverse controls at0.25. All6 pairs,coverage0..4,unique overlaps,pair incidences and spherical-area identities checked. Same3% individual area tolerance.
Final isolated Node units/full CLI exit0:all8 opening frames overlap0;2 negative controls rejected. Negative360 unique661,pair incidences981,quad64;negative720 unique2531,pair incidences3511,quad196;triple0 both. 60 pair-frame checks,120 round trips,max area error0.023637600986236462(opening-only0.017669376692592054),max inverse angle1.2719202621569005e-16. JSON nonempty. Empty-set expected-pair signed-zero issue caught/fixed locally before approval;no geometry/tolerance changes.
Exact core copy matched blob71ee09ed451bca803ab0150594c1cc2cc6dcb352;required static/poses/assess definitions copied for isolated harness,not full repository modules/checkout. Full repository loading,user Mac run and CI pending. inputsUnchanged checks parameters/references and frozen probes,not filesystem-wide hashes.
integrationRun=true,movingRasterRun=true are ONLY analytic raster execution;frozenFixtureIntegrationRun=false,generatorImported=false,visualAccepted=false,appIntegrated=false. Raster validity is not continuous safety or ocean quality. Analytic K4 success does not reverse the frozen-source diagnostics.
After approved write:user runs node tools/world-irregular-k4-raster.cjs;echo "exit_code=$?". Short stdout,JSON if needed,no screenshots. Stage3 user run pending;do not start next implementation before review.

## Remaining small stages
1. Review user moving-K4 run.
2. STATIC analytic K6 partition only;K6 motion/supports and all15 pairs separately,split further as needed. No combined megatask.
3. Reviewed bridge to real source outlines/core drift;no silent source replacements,report unsupported cases.
4. Once useful admissible geometry exists,frame choice and one compact visual comparison,then explicit user acceptance.
5. Separate app movement/UI integration;climate separate,crust/fractures after frame/visual acceptance. Before production claims confirm regressions,integration,repeatability,save/load,performance,CI and state missing evidence.

Atlas still flatv4,no accepted moving frame/wide-ocean geography,no frozen-source motion integration or general continuous collision resolution,all-cases/CI unconfirmed.
