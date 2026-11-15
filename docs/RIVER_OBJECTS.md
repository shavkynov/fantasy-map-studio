# River objects and observed regime (plan item 4)

Status: written and tested on this branch; browser-tested in Chromium (default 360x180); CI, Electron and Mac not confirmed.
Modules: `src/river-objects.js` (`build`, `physical`), `src/river-selection.js` (`select`), wiring in `src/terrain-edit-session.js` and the editor page. Tests: `tools/river-objects-test.cjs`, `tools/terrain-edit-rivers-real-test.cjs`.

## What a river object is
Built from the run history of rainfall runoff (`RunoffFlowHistory`) on the fixed drainage graph; not from one snapshot.
- Channel cell: dry land observed (not wet) for at least `minCoverage` (default 0.5) of the run, with peak runoff rate >= `threshold` (default 1e-6). A cell that was wet most of the run is a lake cell. Without the coverage rule the channel ran into forming lakes and the flow along a reach could drop (found on real data).
- Reach: piece between nodes (headwater, confluence, closed root). Id = its start cell. Every channel cell is in exactly one reach (tested on 12 real runs).
- River: chain of reaches. At each confluence the main stem is the incoming reach with the larger mean flow (ties: larger peak, then lower start cell). River id = its source cell. Other branches are tributary rivers with `mouth.type = 'tributary'` and `joinsRiver`. Strahler order per reach and per river.
- Mouths: ocean, closed basin (with the lake label/anchor when the closed root holds a catalog lake), lake, tributary junction, below-threshold. Lake anchors equal the water-body tracker ids and the link ids.
- Lakes: rivers entering each lake and where its outlet continues. Outlet continuation is TOPOLOGICAL: from the saddle cell the receiver graph is followed to the first channel reach (`continuesInReach`, `continuesInRiver`) or to where it ends (`endsAt`: ocean, or a closed root, possibly with a lake). The model does not route the spill along it.
- Identity is valid within one terrain revision and one run.

## Observed regime (what is and is not claimed)
Per reach and per river: observation `throughout` or `intermittent` (source reach had zero runoff at some observed time), occurrence, longest observed dry duration. The run summary says whether a dry phase happened (`regime.dryPhaseObserved`).
- Finding: the water model has scalar forcing, no groundwater and no release from lakes. In a run without a dry phase every channel "flows throughout" by construction (817 of 817 rivers on the test world); in a run with a dry phase every source stops (817 of 817 intermittent). The classes therefore cannot separate perennial from ephemeral rivers, and the module says so in `regime.note` and `metadata.limits` and in the page text. A real regime classification needs spatially varying forcing and baseflow/lake release in the water model; that is model work, not done here.
- Topology (reaches, rivers, mouths) is identical for constant and wet-dry schedules (tested).

## Selection by scale (presentation layer, separate)
`RiverSelection.select(result, {minOrder, minCatchmentSteradians, minCatchmentKm2 (with a scale)})` returns the ids to show. A selected river always brings the rivers it joins downstream (`addedForConnectivity` counts those added for that reason; for order and catchment criteria it is 0, tested on real data). On a 360x180 test world: 2287 rivers, order up to 5, 37 of order 3 or higher. The full network stays the source of truth.

## Physical values
`RiverObjects.physical(result, field, scale)` with an `ElevationScale` gives per reach and river: length in km along cell centres on the planet radius, drop in metres (height difference start to end, mean cell heights), slope in m/km, catchment in km2. On the 360x180 test world at R = 6371 km: longest river about 5 400 km, drop about 3 100 m, catchment about 5.0 million km2 (all values finite, catchments within the land area). These are cell-centre estimates on a 1-degree grid, not channel lengths.
- The editor page does not show these values yet (no UI wiring for `physical`).

## Session and page
The session publishes `riverObjects` (deeply frozen, the same object on every snapshot) atomically with the other water results; it resets on edit, clear and load, and a cancelled or failed run keeps the previous one. It needs `Routing`, `Reaches` and `FlowHistory`; with `Links` it also joins lakes. The page shows two lines: rivers with mouths and orders, and the regime statement. Turning it on does not change depth, storage, balance or history (tested).

## Not done
Discharge in physical units; baseflow, lake release and spatially varying forcing (needed for a meaningful perennial/ephemeral split); drawing river objects on the map (the existing reach display is unchanged); physical values in the page; per-object flux from the step trace; larger grids than 360x180; Electron/Mac; CI.
