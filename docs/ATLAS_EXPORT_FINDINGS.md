# Atlas export, manual edits and save/open — findings (plan step 3)

Test: `tools/world-atlas-export-test.cjs` (real app in headless Chromium, real UI clicks). Added to `.github/workflows/world-atlas.yml` after the browser test; artifacts in `artifacts/world-atlas-export`. Local runs on 1582016 + this change: 3 consecutive runs passed. CI result for the new commit is not yet recorded.

Established by the test:
- PNG export does NOT re-render. `#export` copies the already rendered `state.base` canvas. Proof of atlas use is therefore the last render before export (theme atlas, atlas-ui1, same `pol.rv`/city/road counts as the current political data), zero renderer calls during export, atlas sea-colour pixels present in the PNG, and an ink export that lacks them.
- A manual city and a manual road made through the real UI bump `pol.rv`, trigger an atlas render, and change the next PNG.
- Save/open round trip: terrain-field hashes, political data (incl. manual city/road) and sea routes are identical after open; atlas sea-palette coverage is unchanged.

Measured, not a pass criterion: exported pixels after open differ from the pre-save export by 0.1–1.1% between runs (state-name glyph placement, some road/city spots; terrain identical). Pixel identity after open is NOT established.

Defect found (not fixed here): opening a saved world that contains states throws `TypeError: Cannot read properties of null (reading 'W')` in `showStateCard` (app.js) because `loadWorld` sets `state.map = null` before regeneration. Reproduced with the ink theme as well, so it is not atlas-specific. In the full test an atlas `Invalid complete-world grid` error from `validate(null)` also appeared during open. The world still opens correctly. The test records these in `report.json` (`knownOpenErrors`) and fails on any other page error. Fixing them is a separate runtime change and needs a decision.

Not checked: Electron/Mac native dialogs, visual acceptance, performance (plan step 4).
