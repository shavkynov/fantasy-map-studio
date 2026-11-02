# Stage 3: moving analytic K4 raster checks

Run from fresh branch ZIP root on Mac:

    node tools/world-irregular-k4-raster.cjs
    echo "exit_code=$?"

Optional --unit-only. One timestamp/PID exclusive JSON,short stdout,no HTML or screenshots. Do not rerun earlier static/poses scripts.

## Unchanged inputs and scope

Imports static radius/contains/owner/area references,stage2 poses,existing world-domain quaternions/cell areas,and assess from world-frame-validity. No edits to those dependencies,fixtures,baselines,parameters or coastline. This is analytic K4,not the frozen original K4 and not a production world-drift.fromSource integration.

For every target raster cell,apply inverse pose for each of4 pieces,then test its ORIGINAL static membership. Positive direction uses stage2 pose. Negative control reverses each rotation at t0.25;it is deliberately not constrained to opening supports. Longitude meridian0;cell weights are spherical areas on radius1. No optimized matrix substitute for core apply.

Eight opening frames:360x180 and720x360 at0/0.25/0.5/1. Eight includes TWO zero-time frames;SIX are positive-time frames. Two additional negative frames:reverse at0.25 on each grid. Total10. At zero,computed owners must equal static owner for every cell.

## Membership and accounting

Six pair order:01,02,03,12,13,23. Each cell has a4-bit membership mask,coverage0..4,owner=-1 for water,single id for one piece,-2 for overlap. No full raster arrays are exported;the compact report contains coverage histograms,piece and pair areas/counts.

uniqueOverlap=H2+H3+H4;pairIncidences=H2+3*H3+6*H4. A triple cell intentionally belongs to3 pairs,a quadruple to6. Analogous spherical-area identity must match. Also check full-sphere area sum and total piece-area sum weighted by multiplicity. PairFrameChecks=10*6=60 includes both control frames;it is not60 different source pairs.

Each piece/each frame must agree with its unchanged numerical Simpson area reference within the existing3% threshold,including negative controls. Each frame adds12 interior-point inverse round trips,120 total. Test frozen probe immutability and unchanged motion parameters/reference values;inputsUnchanged does NOT claim a filesystem-wide checksum audit.

All opening frames must have zero unique/pair/triple/quad overlap and assess reasons[]. Each negative frame must have actual overlap in all6 pairs,quadruple cells,and assess rejection fragment-overlap. These are actual raster-overlap controls,unlike stage2's support-direction probes.

Unit checks enumerate all16 membership masks,each pair identity,explicit triple/quad mappings,empty/single ownership,assess classification and invalid inputs. Initial assistant unit run caught expected combinatorial0 represented as-0 for the empty set;fixed expectedPairs=count<2?0:count*(count-1)/2. Geometry,times,poses and tolerances unchanged.

## Assistant evidence and boundaries

Final candidate unit-only and full CLI:isolated Node exit0. Exact domain copy matched blob71ee09ed451bca803ab0150594c1cc2cc6dcb352. Required static/poses/assess function definitions copied from repository tools for isolated harness,not full module files or full checkout. No actual full-repository loading,user Mac run or CI claimed.

Observed10 frames,8 valid opening,2 rejected controls,60 pair-frame checks,120 round trips. All8 opening unique overlaps0 and all6 pair counts0. Opening max area error0.017669376692592054;all-frame max0.023637600986236462<0.03. Max inverse angle1.2719202621569005e-16. Negative360:unique661,pairIncidences981,triple0,quad64. Negative720:unique2531,pairIncidences3511,triple0,quad196. These are observations,not hard-coded expected baselines. JSON nonempty.

integrationRun=true and movingRasterRun=true mean THIS analytic raster test only. frozenFixtureIntegrationRun=false,generatorImported=false,visualAccepted=false,appIntegrated=false. Sampled raster validity is not continuous collision detection,ocean quality,visual acceptance or arbitrary-motion support. Stage2's analytic separation derivation remains limited to its declared construction.

## Prerequisite status and next step

Stage2 code6140edb904c1d822c5efb655c07d0658c8922172:user2026-11-02 19:15 MSK exit0,384 point checks/round trips,48 rigid distances,18 distinct-rotation checks,4 support probes rejected. Supersedes old user-pending notes;second pasted command had no output and needs no follow-up. Static stage confirmed19:07. No additional old reports/screenshots needed.

After this package is written and its user run reviewed,next small task is STATIC analytic K6 partition;K6 motion/all15 pairs remain separate. Real frozen-source bridge,frame/visual comparison,explicit acceptance and app integration later. No climate/crust changes.
