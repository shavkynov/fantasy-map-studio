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
- `metersPerUnit` defaults to 10 000 (relative 1.0 = 10 km). The generator's heights were never calibrated; with this default a 144×72 test world gives about 50 m minimum, 2 000 m mean and 4 900 m maximum land height. The owner should confirm or change the default.
- `radiusKm` is accepted in 500–50 000 km. It must come from the map's planet parameters; no value is assumed by the module except in tests (6371).
- The record must be saved with the map together with the grid size, so an old save is never reinterpreted under another scale.

## Limits to keep in results
- A cell value is a mean over the cell (about 278 km wide at 144 columns, 111 km at 360) — not peaks.
- Lakes, spill levels and basins depend on resolution.
- Bathymetry (ocean depth in metres) is out of scope until the raster carries it.

## Not done (next, plan item 3b onward)
Raster import in metres, per-cell edit, saving the record with the map, session/UI display, parent→child rule for location maps.
