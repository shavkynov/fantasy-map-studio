# Water bodies: reconciliation of the catalog with the hydrology (plan item 2)

Status: written and tested on this branch; browser-tested in Chromium; CI, Electron and Mac not confirmed.
Modules: `src/surface-water-objects.js` (`adjacency` option), `src/surface-water-links.js`, `src/surface-water-flux.js`, wiring in `src/terrain-edit-session.js` and the editor page. Tests: `tools/surface-water-reconcile-test.cjs`, `tools/terrain-edit-water-flux-real-test.cjs`.

## 1. One neighbourhood for everything
Drainage and the basin hierarchy use `field.neighbors` (8 neighbours, periodic longitude, reflection over the poles). The object catalog used 4 neighbours without polar crossing. A lake joined diagonally, or over a pole, was one pool for the model and two objects in the catalog.
- `SurfaceWaterObjects.build(..., {adjacency:'hydrology'})` uses `field.neighbors`. `'edge'` stays the default and behaves as before (existing tests unchanged). The session builds its tracker with `'hydrology'`.
- Evidence on real data: 360x180, seed `rec-c` after 20 steps gives 11 objects with `'edge'` and 10 with `'hydrology'` (kept as a regression test). Across 36 real runs (144x72 and 360x180, two rainfall levels) every wet catalog object is exactly one hydrology pool; volume and area agree to better than 1e-9 (about 1e-12 in practice).

## 2. Object <-> pool links (`SurfaceWaterLinks.build`)
Per wet object: its pool, basins, level, model volume and area against the catalog values, the pool's outlet (lowest saddle to a basin outside the pool or to the external water), the headroom (relative height still to rise before it can spill), whether it is at its spill level, and the chain a spilling lake would follow. It reports `mismatches` instead of hiding them and refuses a catalog that was not built with hydrology adjacency. `anchorCell` equals the identity-tracker id, so objects join across modules.
- Finding: the published state is taken after the recession phase, so lakes are normally below their saddle there. Actual spilling is visible only in the routing trace of a step, which is why item 3 exists.

## 3. Rain runoff against relayed water (`SurfaceWaterFlux.analyze`)
The coupled model can emit a routing trace (`trackRouting:true`). A trace `transfer` is a HOP: water crossing three lakes appears as three transfers. Summing transfers counts the same water several times.
- Measured: per step, hop volume is 1.3 to 2.1 times the new water (24 real steps, 144x72 and 360x180). That is the double counting the handoff warned about.
- `analyze` separates, per pool of the inflow phase: new rain (supplied minus the old storage), spill in, spill out, export to the external water, and the volume at the end of the phase. It closes per pool: supplied + spill in - spill out - exported = volume end (residual about 1e-19 on real runs). Transfers that end inside one final pool (after merges) are internal and excluded.
- Totals checked on real runs: new rain equals the step input of the model, exports equal the boundary outflow, hop volume equals cross-pool plus internal hops.
- The session publishes `waterFlux` (per-step totals and run totals) and `waterLinks` atomically with the other water results; both reset on edit, clear, load and a new run only replaces them when it completes. Turning tracking on does not change depth, storage or the balance (tested).
- Scope limits: inflow phase only. Evaporation and seepage happen in the recession phase and are not attributed to pools. Pools of the inflow phase can differ from the published pools; each carries its basins, so a consumer joins by cells.

## Not done
- River objects and their regime classification (plan item 4); discharge in physical units; per-pool evaporation and seepage; per-object flux in the published object list (pools are joined by basins, not yet by catalog object); larger grids than 144x72 in the session test (the module tests also use 360x180); Electron/Mac; CI.
