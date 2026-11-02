# Focused K6 control-area experiment — not full-stage acceptance

Run node tools/world-irregular-k6-area.cjs;echo "exit_code=$?" from fresh extracted ZIP root on Mac. Optional --unit-only. One timestamp/PID exclusive JSON,short stdout,no screenshot series. Existing Node/project dependencies only,no new package installation. Do not run uncommitted world-irregular-k6-raster.cjs or repeat old tests.

## Why this separate package exists

K6 poses user20:20 MSK exit0:576 point checks/round trips,72 rigid distances,45 distinct-rotation checks,6 support controls. Supersedes old user-pending notes.
Assistant uncommitted moving-raster candidate units passed but full CLI exited1:piece2,reverse t0.25,360x180,area error0.03543776625744366 exceeds unchanged0.03 tolerance. Diagnostic collection of all10 frames found8 opening frames without pair overlap,2 correctly rejected overlapping controls,150 pair-frame entries and180 round trips. That collector was not a successful full CLI or user run. Controls360:unique540/incidences768/sextuple12;720:unique2017/incidences2929/sextuple48.
Focused resolution diagnostic for piece2 gave errors0.03543776625744366 on360x180,0.00017073316131921423 on720x360,0.0005295224462784631 on1440x720. Nonmonotone;finer results do not waive the original failure. Moving K6 is NOT accepted and its raster candidate was NOT committed by the assistant.

## Fixed experiment and estimators

Only pieceId2,time0.25,direction-1,base grid360x180,radius1,tolerance0.03. Reuse unchanged static K6 membership/reference and existing poses. Reverse actual pose is inverse(opening pose);membership uses its inverse. No geometry,labels,motion,time or baseline changes.
First recompute ORIGINAL latitude/longitude cell-centre measurement using core cell areas. Keep its failure in report. Reference is unchanged Simpson8192 sector area,approximately0.11109753056874229 steradians,not an exact closed form.
Then tensor Gauss-Legendre integration within EVERY original base cell at all predeclared orders2,4,8. Coordinates are longitude lambda and mu=sin(latitude);unit-sphere area element is d(lambda)d(mu). Transform stored nodes/weights into each cell's lambda/mu interval;sample the same inverse-rotated piece indicator. Orders mean4/16/64 samples per base cell,259200/1036800/4147200 evaluations,more work than one centre. All levels reported,no best-level selection or early stop. This is a DIFFERENT area estimator,not proof that original coarse centre coverage/area was accurate.
No collision/owner raster is recomputed or replaced by these area samples. Area estimates must remain separate from collision labels. No policy adoption or conditional fallback for failing frames is authorised by writing this experiment.

## Tests and evidence

28 polynomial moment checks across rule orders,positive finite weights/interior nodes,full-domain weight4*pi within1e-10,deliberately wrong16*pi normalisation rejected,invalid orders/areas,area pass/fail classification,inverse round trip,frozen probe/case/interval/parameter/reference immutability. Rule constants generated with NumPy Legendre routine during preparation,embedded in JS;Mac needs no Python. Polynomial checks do NOT certify error for discontinuous piece membership or guarantee monotone improvement.
Assistant isolated Node unit-only/default exit0,JSON nonempty. Full domain copy matched blob71ee09ed451bca803ab0150594c1cc2cc6dcb352;required K4/K6 static and poses definitions copied for harness,not full module files/full checkout. No actual repository loading,user Mac execution or CI claimed. Independent Python maximum polynomial residual5.551115123125783e-16.
Observed original area0.11503457888881657,error0.03543776625744366,gate false. Gauss2 area0.10929869376870684,error0.016191510205732396;Gauss4 area0.11122020378096296,error0.0011041938699507536;Gauss8 area0.11115172400464779,error0.0004878005445132505. All refined estimates below0.03 for THIS case. Observations,not hard-coded expected outputs or general accuracy guarantees.

exit0 means diagnostic experiment completed and structural tests passed,NOT that old3% gate or full moving K6 passed. Expected flags:originalRasterAreaGatePassed=false,acceptancePolicyChanged=false,fullMovingRasterRun=false,movingK6StageAccepted=false,integrationRun=false,areaQuadratureExperimentRun=true. User run pending after write.

## Next steps

Review user experiment run first. Then separately propose a fixed area-estimator policy across ALL pieces/frames,with original centre estimates retained and cost/accuracy checks. Do not add a fallback only to the known failing control or select a convenient quadrature order after observing results. Only an explicitly reviewed policy and a new full two-grid/15-pair K6 run can establish a revised acceptance result. No source fixtures/app/climate/crust changes here;visual acceptance and integration remain separate.
