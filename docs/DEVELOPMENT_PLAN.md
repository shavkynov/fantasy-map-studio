# Current branch coordination plan

Date: 2026-11-10. Branch: feature/natural-world-v3. Review baseline: e953a685fca2d6ecfa02ef9622b6bd4ac4719aba.

## Scope and truth boundaries
This plan coordinates existing work; it does not silently choose release scope or retire geometry research. Existing experimental documentation remains valid within its stated scope. No runtime or CI pass is established by this document.

Three distinct tracks exist:
1. Complete main-world generation with climate, biomes, settlements and routes.
2. Standalone spherical terrain generation/editor and its water/workspace lifecycle. See terrain-editor-generation-ui1.md.
3. atlas-ui1 presentation of the COMPLETE MAIN WORLD. See world-atlas-ui1.md.
The spherical-editor-to-main bridge is NOT implemented. An atlas pass is not a spherical-generator integration pass.

## Next bounded work, in order
1. Establish CI results for an exact commit. Record workflow, SHA, run URL, result and artifact; configuration alone is not a pass. The atlas workflow must cover PRs and its build/check dependencies.
2. Reproduce cache risks before changing runtime contracts. Exercise in-place height/biome/river/ocean changes and manual city/road edits. Check whether actual editing paths invalidate atlas caches. A stale-render defect is not yet confirmed.
3. Strengthen export regression: prove atlas rendering is used during export, not only PNG validity and world-data invariance. Add real save/open round-trip and manual city/road scenarios. Native Mac dialogs remain separate.
4. Record generation, first/repeated render, export and peak-memory measurements for a small fixed seed set. Keep environment and grid sizes with results. No performance improvement is claimed yet.
5. After relevant CI passes, perform ONE combined Mac acceptance: generate, edit, water, cities/routes where supported, style switch, zoom, PNG, save/open and seabed. Preserve evidence of failures.
6. Explicitly agree next release scope: atlas/main-app improvement versus integrated spherical generation. If the latter is chosen, specify and implement the bridge before adding more independent features. Do not merge/release merely because this list exists.

## Acceptance matrix
| Track | Implementation evidence | Still required |
| --- | --- | --- |
| Main-world atlas | e953a685; renderer, core and browser tests exist | Actual CI result, manual edits, export-path proof, save/open, visual/Mac acceptance |
| Spherical editor/generation | generation-ui1 and workspace/shaping documents | Actual relevant CI results and combined Mac acceptance; bridge is absent |
| Historical K6 | WORK_STATE.md and evidence/CURRENT.json | Consult original records only when this track is explicitly resumed; do not infer full acceptance |

## Completion reporting
For each task state: changed files, reproduced failure, checks actually run, checks not run and remaining acceptance. Keep planned, implemented, automatically verified and user-accepted distinct. Never change baselines to make a failure disappear.
