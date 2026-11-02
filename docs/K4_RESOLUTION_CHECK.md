# Fixed two-grid check

Status: isolated Node unit-only run passed, exit code 0. Full fixture check and user execution pending; no finer-grid counts inferred from prior runs.

Run node tools/world-k4-resolution.cjs, then echo "exit_code=$?". Optional --unit-only. Attach the generated JSON file; no screenshots or HTML are needed.

Two cases only: grouped-control and split-02-plus. Same existing K2/K4 sources and verified mapping [0,1,0,1]. Settings are constructed through existing motionsFor in world-k4-split-02.cjs, unchanged delta=0.02 and zero spins; no parameter search or original-speed replacement. This remains a single-pair experiment with 1/3 locked, not four independent motions.

Times 0,0.25,0.5; display grids 360x180 and 720x360, same meridian=0. Total 12 snapshots. Each grid is freshly sampled by world.snapshot, not an upscaled image. Same motions object is used across both grids. Existing pair reconstruct/summarize verifies coverage, owners, unique-source provenance and multiple-overlap spherical accounting. All six pairs, multiplicity histograms and spherical fractions are retained in JSON. Control and initial frames must be valid. Neither experimental validity nor agreement between grids is required for test success.

compare requires exactly the two grids for each case/time, checks dimensions and validity consistency, then records sameSampledValidity alongside raw overlap counts and sphere fractions. Raw cell counts have different cell sizes; do not require equality or divide counts blindly by four. Equal validity on two grids is not convergence, continuous safety or acceptance. Conflicting results are retained, not resolved by choosing the convenient grid.

Unit cases: complete matching inputs, one deliberate validity disagreement, unchanged input, missing frame and duplicated grid. Only these aggregate checks were locally executed by the assistant. New fixture execution, visual acceptance, frame choice, app integration, fixture/baseline changes and new geographic/water metrics are not claimed.

Prior experiment code 95c5d3140e84977fea87fb27b9adb823df0a2c20: user 2026-11-02 16:24 MSK exit_code=0, unitChecksPassed=true, integrationRun=true, sources=2, scenarios=3, snapshots=15, sourceInputsUnchanged=true, motionInputsUnchanged=true, generatorImported=false. Attached JSON read 16:25. At 360x180, grouped control counts at 0/0.25/0.5/0.75/1 are 0/0/0/0/0; plus 0/2/0/0/0; minus 0/43/79/152/193. Every conflict belongs to 0–2; other pairs remain zero in those sampled frames, triple/quad zero. Probe center-angle changes are approximately +4e-6/-4e-6 at time 1e-4, control approximately zero. Plus is not a safe trajectory because its t=0.25 snapshot is rejected. HTML was received, not visually accepted. These results supersede the older pending experiment status in K4_RATE_EXPERIMENT.md.
