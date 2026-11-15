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

## Not done (next, plan item 3b onward)
Raster import in metres, per-cell edit, saving the record with the map, session/UI display, parent→child rule for location maps.
