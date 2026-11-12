# Plan step 5: one combined acceptance session on Mac

Commit under test: e009a2d (branch feature/natural-world-v3). CI for this commit is green; that covers automated checks only, not this session.
Get the sources: download the branch ZIP from GitHub (Code -> Download ZIP on this branch), extract, `cd fantasy-map-studio && npm start`. Do not git pull/switch. Use only the largest map size (size button 3, 1440x960).

Checklist (mark each as passed / failed / not checked, with a note):
1. Generate a world at the largest size (seed any). Note generation time by feel; record if it freezes the window.
2. Auto states (3), auto cities, auto roads. Add one manual city and one manual road.
3. Switch theme to "Мировой атлас". Look at coast, relief symbols, rivers, labels: acceptable / not, and why.
4. Export PNG in atlas theme: opens, sea colour is the atlas blue, manual city and road present.
5. Save the world, restart the app, open the saved file: opens without an error dialog, states/cities/roads are the same, state card works when clicking a state.
6. Switch back to "чернила": map renders, no errors.
7. Anything slow, ugly or broken that was not listed.

Automated evidence (not a substitute): docs/CI_EVIDENCE_1582016.md (earlier commit), docs/ATLAS_PERF_MEASUREMENTS.md (sandbox numbers), docs/ATLAS_EXPORT_FINDINGS.md.
Step 6 (release scope, merge) needs explicit approval after this session.
