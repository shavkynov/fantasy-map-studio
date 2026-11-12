# Atlas export, manual edits and save/open — findings (plan step 3)

Test: `tools/world-atlas-export-test.cjs` (real app in headless Chromium, real UI clicks). Added to `.github/workflows/world-atlas.yml` after the browser test; artifacts in `artifacts/world-atlas-export`. Local runs on 1582016 + this change: 3 consecutive runs passed. CI result for the new commit is not yet recorded.

Established by the test:
- PNG export does NOT re-render. `#export` copies the already rendered `state.base` canvas. Proof of atlas use is therefore the last render before export (theme atlas, atlas-ui1, same `pol.rv`/city/road counts as the current political data), zero renderer calls during export, atlas sea-colour pixels present in the PNG, and an ink export that lacks them.
- A manual city and a manual road made through the real UI bump `pol.rv`, trigger an atlas render, and change the next PNG.
- Save/open round trip: terrain-field hashes, political data (incl. manual city/road) and sea routes are identical after open; atlas sea-palette coverage is unchanged.

Measured, not a pass criterion: exported pixels after open differ from the pre-save export by 0.1–1.1% between runs at the earlier small size; 0% in the latest largest-size run (state-name glyph placement, some road/city spots; terrain identical). Pixel identity after open is NOT established.

Defect found and fixed: opening a saved world with states threw `TypeError ... reading 'W'` in `showStateCard`, and `Invalid complete-world grid` from the atlas `validate(null)` via `rebuildBase`, because `loadWorld` sets `state.map = null` before regeneration. Fix: early return in `showStateCard` and `rebuildBase` when `state.map` is null. The export test now runs at the largest size (1440x960) and fails on any page error. Verified locally once at that size; CI result pending.

Not checked: Electron/Mac native dialogs, visual acceptance, performance (plan step 4).
