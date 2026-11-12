# Plan step 5: one combined acceptance session on Mac

Build under test: artifact `test-zip-natural-v3-<sha>` (or the DMG) of workflow "Тестовая сборка (ветка)" on feature/natural-world-v3. It is the integrated build: main app, Natural World v3 as the only generation model, atlas theme, no prototypes/candidate pages. Map size is fixed at 1440x960 (no size selector). Extract the ZIP, `cd fantasy-map-studio && npm start`. CI checks are automated only, not this session.

Checklist (mark each as passed / failed / not checked, with a note):
1. Generate a world (seed any; it is always 1440x960). Note: v3 may produce a different number of continents than requested (known limitation). Note generation time by feel; record if it freezes the window.
2. Auto states (3), auto cities, auto roads. Add one manual city and one manual road.
3. Switch theme to "Мировой атлас". Look at coast, relief symbols, rivers, labels: acceptable / not, and why.
4. Export PNG in atlas theme: opens, sea colour is the atlas blue, manual city and road present.
5. Save the world, restart the app, open the saved file: opens without an error dialog, states/cities/roads are the same, state card works when clicking a state.
6. Switch back to "чернила": map renders, no errors.
7. Anything slow, ugly or broken that was not listed.

Automated evidence (not a substitute): docs/CI_EVIDENCE_1582016.md (earlier commit), docs/ATLAS_PERF_MEASUREMENTS.md (sandbox numbers), docs/ATLAS_EXPORT_FINDINGS.md.
Step 6 (release scope, merge) needs explicit approval after this session.
