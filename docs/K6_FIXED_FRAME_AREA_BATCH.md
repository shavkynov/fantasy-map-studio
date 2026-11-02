# Fixed-frame K6 area batches

Base 014bec13a086f970bf1d44e18901f2e09ebb8467, feature/natural-world-v3.
User Mac pilot 2026-11-02 21:05 MSK exit0 confirmed. Never repeat it or request its JSON again.

Commands:
- node tools/world-irregular-k6-area-batch-test.cjs: synthetic checks only.
- node tools/world-irregular-k6-area-batch.cjs plan: fixed indices/cost counts only.
- node tools/world-irregular-k6-area-batch.cjs import-pilot EXISTING_LOCAL_PILOT.json artifacts/k6-area-batch-run1: zero new measurements, import index4. No transmission to assistant. Requires full saved report, not stdout.
- node tools/world-irregular-k6-area-batch.cjs frame INDEX artifacts/k6-area-batch-run1: exactly one frame. Review cost first; after import do not repeat index4. No default/all run.
- node tools/world-irregular-k6-area-batch.cjs assemble artifacts/k6-area-batch-run1 artifacts/k6-area-batch-summary1: saved records only.

Direct S.apply/P.contains, independent six-piece accumulation, centre/G4/G8, no culling or new matrices. No geometry/core/policy/pilot/fixture/baseline changes. Original C.evaluateSchedule enforces BOTH Gauss errors strictly<0.03 on ALL6/ALL10; retain old centre gate. Save raw areas/references/hits/counts/timings and actual inter-order differences. Hits are not collision counts. No new focused live audit is claimed.

wx timestamp/random files retain completed evidence before gate assertions; no within-frame resume. Assembly rejects missing/duplicate/unexpected/malformed/mixed-version records. Select retry results explicitly into a separate directory; never overwrite/auto-select. Dependencies pinned by original Git blob SHA, runner fingerprinted; preserve line endings. Complete failed-area schedules are saved then exit1. Partial sets never claim full completion.

Legacy import rechecks raw data/classification/focused audit; preserves exact original JSON bytes+SHA256 and rechecks them at assembly. originalFileHashesAvailable=false: old report lacks historical file hashes. Current hashes do not attest the Mac checkout; origin relies on user confirmation. Hashes protect accidental mixing, not forgery. Nine new records plus imported pilot suffice.

Assistant syntax and isolated contract tests exit0:19 invalid collections,7 invalid imports,byte/data corruption controls,complete and mixed positive controls,retained centre failure and Gauss failure controls. Copied policy functions,synthetic references/sphere; NOT full checkout,geometry evaluation,user batch execution or CI. Repository test uses real imports when run; that execution remains unconfirmed. Mac timings unavailable; no runtime promises or heavy launch.

Area only: integrationRun=false,collisionChecksPerformed=false,movingK6StageAccepted=false,visualAccepted=false,appIntegrated=false. Unchanged15-pair/frame collisions,coverage0..6,negative controls and round trips remain separate. No geography/frozen-source/app acceptance.
