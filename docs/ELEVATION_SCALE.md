# Elevation scale v1 (physical units)

Module: `src/elevation-scale.js` (`ElevationScale`). Tests: `tools/elevation-scale-test.cjs`. Status: written and unit-tested; NOT yet used by the session, the editor page or any import path.

## What exists in the field today
- `height` is a relative value, defined on land cells only (ocean cells are NaN; there is no bathymetry in the raster). The relief integration declares `units: {height:'relative', area:'steradian'}`.
- Area is in steradians on the unit sphere; distances are angles in radians.
- Water level 0 is the external water level; lake water is depth over land.

## What the scale adds
A stored record `{version:'elevation-scale-v1', radiusKm, metersPerUnit, datum:'external water level 0 m', scope}` and pure conversions:
- height: metres = relative × `metersPerUnit`;
- area: km² = steradians × `radiusKm`²; distance: km = radians × `radiusKm`;
- slope: relative/radian → metres per km of ground distance;
- `describe(field)`: total and land area, land fraction, cell size at the equator, min/area-weighted mean/max land height in metres.

Nothing in the field, the session or the water model is changed by it.

## Decisions that are conventions, not facts
- `metersPerUnit` defaults to 8 000 (relative 1.0 = 8 km). The owner delegated the choice and named Earth as the reference. The generator's relative heights are flatter-topped than Earth's (its max/mean ratio is about 3, Earth's about 6 at cell-mean resolution), so no single linear factor matches both. 8 000 is a compromise: on 6 test seeds (144x72) the 95th percentile of land height is about 2.5-3.1 km and the cell-mean maximum 3.8-4.4 km, while the mean land height is 1.2-1.6 km against Earth's about 0.84 km. Earth figures are from memory, not checked against a source in this session. A non-linear height curve could fix the shape later; it is not part of this step.
- `radiusKm` must lie in the terrestrial range: 2 440 km (Mercury) to 6 378 km (Earth, equatorial). Earth (6 371) is the reference; Mars 3 390 and Venus 6 052 are inside. How a world picks its radius (e.g. a band close to Earth) belongs to the planet parameters, not to this module. A band close to Earth's but not above it is an interpretation of the owner's wording and can be changed.
- The record must be saved with the map together with the grid size, so an old save is never reinterpreted under another scale.

## Limits to keep in results
- A cell value is a mean over the cell (about 278 km wide at 144 columns, 111 km at 360) — not peaks.
- Lakes, spill levels and basins depend on resolution.
- Bathymetry (ocean depth in metres) is out of scope until the raster carries it.

## Import of a height raster in metres (plan 3b)
Modules: `src/elevation-import.js` (`ElevationImport.create(ElevationScale).convert(raster, scale, options)`), `workspace.stageImported(raster, scale, Importer, options)` in `src/terrain-edit-shaping.js`. Tests: `tools/elevation-import-test.cjs`.
- Raster = `{w, h, meters}`; row-major, first row north, first column longitude -180. Same layout as the editor grid.
- Datum: metres above the external water level 0, shifted by `seaLevelMeters` (default 0). Cells at or below the datum are ocean; their depths are discarded (no bathymetry in the base).
- Grid: the target is the workspace grid; the raster must be that size or an integer multiple of it. Reduction is an area-weighted mean over the land sub-cells of a block; a block is land if its land-area fraction is >= 0.5. No interpolation, no other resampling.
- Strict: any non-finite value, or |value| > 1 000 000 m, rejects the whole raster; a height beyond the editor limit for the scale rejects it; heights below the editor minimum are raised to it and counted in `report.clampedToMinimum`.
- `stageImported` follows the generated-world path: preparing does not touch the map; `commit()` replaces it (name "Импорт рельефа", not persisted, dirty, water cleared, history empty); a stale stage is refused.
- Verified (real modules, 144×72, 288×144 source): heights come out as metres / metersPerUnit; area and height statistics from `ElevationScale.describe` match the import report; edit, undo and a water run (residual < 1e-10) work after the import.

## Saving the scale with the map (workspace file)
Implemented in `src/terrain-edit-shaping.js`; tests: `tools/elevation-scale-persist-test.cjs` (+ the existing workspace browser test).
- A map WITHOUT a scale is written exactly as before: `schema: 'fm-terrain-workspace-v1'`, no `scale` key. Old files and old readers are unaffected.
- A map WITH a scale is written as `schema: 'fm-terrain-workspace-v2'` = v1 fields + `scale` (the record: version, radiusKm, metersPerUnit, datum, scope). A v1 file never carries `scale`; a v2 file must.
- Opening: v1 -> no scale; v2 -> the record is validated by `ElevationScale.fromRecord`, which now accepts only a record identical to what `create()` writes (no unknown keys, no other datum/scope text). Any invalid file is refused and the open map stays unchanged. Opening a file replaces the scale of the previous map (a v1 file clears it).
- A scale is set by `stageImported` (commit) or by `workspace.setScale(record | null)` for a map that already exists (e.g. a generated one); `setScale` marks the map as changed. `info().scale` exposes it. New ocean/procedural/generated maps start without a scale.
- The grid size is already inside the file (`patch.w/h`), so scale + grid travel together. The workspace needs `deps.Scale` (`ElevationScale`) to read or set a scale; without it v2 files are refused. The editor page now loads `elevation-scale.js` and passes it.
- Verified: import -> save document -> open in a fresh workspace gives the same heights and scale, not dirty; v1 round trip unchanged; setScale/validation; brush edits keep the scale; 10 kinds of malformed v2/v1 documents are refused.
- Found while testing: `fromRecord` used to ignore unknown keys in a record; it is now strict.

## Not done (next)
- The editor page shows no scale and has no control to set it; no file picker / PNG decoding for rasters (only a JS raster object is accepted).
- Real Mac/Electron disk and dialog acceptance of v2 files (the browser test mocks the native save adapter).
- Per-cell edit and readout in metres/km, the parent→child rule for location maps, resolutions other than the workspace grid.
