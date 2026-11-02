# Uniform dual-Gauss area policy for analytic K6

This package explicitly revises the future AREA acceptance criterion. Approval of this package adopts the specification,not a claim that its measurements or full K6 have passed. Old centre-based failure remains a failure under its original criterion. No retroactive relabelling of historical reports.

Run node tools/world-irregular-k6-area-policy.cjs;echo "exit_code=$?" from extracted branch ZIP root on Mac. This is a fast pure policy/unit module,NOT an integrator. Stdout only,no measurement JSON or screenshots needed. No old-test reruns.

## Fixed rule before further quadrature measurements

Policy id analytic-k6-dual-gauss-area-v1. For EVERY piece id0..5 of EVERY required frame,retain original centre-relative error and require BOTH Gauss4x4 error<0.03 AND Gauss8x8 error<0.03 against unchanged static numerical area reference. Equality0.03 fails,no epsilon. Never take minimum,choose the better order,skip a failing control,use a special-case fallback,or stop after one order passes.

Ten frames:360x180 and720x360,each at0/0.25/0.5/1 direction+1 plus reverse0.25. Eight opening includes two zero frames. All60 piece-frame records must have centre/G4/G8 errors. Missing,duplicate,extra,unexpected frames,wrong dimensions/IDs/orders/tolerance,sparse arrays,negative/nonfinite errors are rejected. A failed valid measurement returns revisedAreaChecksPassed=false,not a changed threshold.

Orders4/8 were proposed AFTER observing the one calibration case;this is not an independently preregistered finding and must not be described as such. They are fixed before measuring the remaining quadrature cases,not selected per-frame from outcomes. Two agreeing estimates do not certify true integration error or universal accuracy. The unchanged Simpson reference is numerical,not exact.

The module classifies supplied ERROR records only. It does not compute areas,prove their provenance,validate quadrature code,derive inter-order area differences from absolute errors,or test collisions. Future measurement reports must include raw areas/reference values and actual area differences as well as these error records. Synthetic unit data are not measured worlds or new canonical fixtures.

## Original versus revised results

Preserve originalRasterAreaGatePassed independently of revisedAreaChecksPassed. criterionRevised=true must be explicit. For the known coarse control,original error0.03543776625744366 and original gatefalse must remain visible even if a later full revised-policy run passes. Do NOT claim the old coarse-centre gate was fixed or unchanged.

A full analytic moving-K6 result still needs all15 pair-overlap tests per frame,coverage0..6 accounting,positive-frame validity,actual rejected overlapping controls,round trips and complete measurement execution. This module always reports movingK6StageAccepted=false/collisionChecksPerformed=false and measures0 real frames. No frozen-source,application or visual acceptance.

## Cost and split implementation

Unculled counts for fixed schedule:1620000 base cells,9720000 original piece-membership evaluations,G4=155520000,G8=622080000,total quadrature777600000. These are arithmetic workload estimates,NOT elapsed-time benchmarks. Sharing/culling may reduce work only if correctness/equivalence is separately validated;never omit unresolved piece/frame records.

Next package is ONE complete-frame/six-piece implementation and cost pilot with both orders. Do not launch the whole expensive schedule blindly. Then reviewed batching/full-schedule implementation;evaluateSchedule rejects a partial batch as a final result. evaluateFrame may classify one complete frame without granting full-stage acceptance.

## User evidence and unit tests

Area experiment4c1bd98fd5e8de566f463d3945d25d4227e88ac4:user2026-11-02 20:39 MSK exit0,28 moment checks,wrong-normalisation control rejected. Original error0.03543776625744366 gatefalse;G2=0.016191510205732396,G4=0.0011041938699507536,G8=0.0004878005445132505;inputs unchanged,policy unchanged in that historical experiment,full K6 not accepted. Terminal later contained pasted JSON/uncompleted shell input;first successful run is sufficient and needs no repeat/report/screenshots.

Exact standalone candidate executed by assistant Node exit0:synthetic10-frame/60-piece-frame schedules,4 criterion-failure tests,19 invalid-input rejections,old failure retention,strict threshold and input immutability. All synthetic;measuredFrames0. No full repository/user Mac/CI run or area integration claimed. User policy-module run pending after write. No dependencies/old code,mask,pose,reference,fixture,baseline,climate or UI changes.
