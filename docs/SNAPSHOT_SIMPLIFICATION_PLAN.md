# Simplification plan: a realistic snapshot of the world

Status: PROPOSAL for the owner's approval (2026-11-16). Nothing in the code has been removed or changed by this document. Facts below marked "not verified" were not checked in code.

## Principle (owner)
The product is a realistic SNAPSHOT of a world. A mechanic stays only if it changes the snapshot: the parameters of the world on the Map, the consequences shown by the Catastrophe editor, or the currents map (which feeds climate, biomes and sea routes). Anything that does not affect the snapshot is reduced to the simplest sufficient parameter. Example: no rain schedule or seasons, only how frequent rain is (rare / moderate / frequent). What must stay is credibility: everything is where the laws of nature put it, and looks like it.

## The snapshot pipeline (static, no time stepping)
1. Terrain on the sphere from plates (mountains where plates converge). Existing: world domain, drift, terrain editor base.
2. Static hydrology: depression fill gives lakes, flow to the sea or a lake gives rivers.
   - Rivers: receiver graph and flow accumulation (existing `spherical-drainage`), weighted by a rain level per cell. A river never runs uphill and always ends in the sea or a lake by construction.
   - Lakes: a depression is filled up to its spill level (existing `basin-spill-hierarchy`), but not beyond what its water balance allows. Replace the time-stepped model by a STEADY-STATE balance per basin: inflow (rain level x runoff coefficient x catchment area) against evaporation over the lake surface gives either a full lake (humid) or a partial lake or salt flat (dry).
3. Currents (existing main-app model) -> climate: temperature and rain level per cell from latitude, height, distance to sea, currents.
4. Biomes from climate, height and water, with a transition table so that incompatible biomes do not touch (no forest next to fire wastes across a river).
5. Settlements and routes from suitability: water, fertility, defensibility, access; sea routes from currents and coasts.
6. Catastrophes = a parameterised change of terrain or climate fields, then the static pipeline is re-run and the consequences emerge (a crater becomes a depression and a lake; uplift reroutes rivers; ash or a new ice cap shifts climate and biomes). This needs the static pipeline to be fast; timings are not measured yet.

## What stays, what is simplified, what is frozen
Keep (changes the snapshot): terrain editor base and plates; `spherical-drainage`; `basin-spill-hierarchy` (and the static fill part of `basin-fill-spill`); `rainfall-runoff-routing` used as static accumulation with a rain level map; `elevation-scale` (metres/km, cheap, gives credible sizes) and the height import; the spherical bridge (exists on the branch, not reviewed here).

Simplify: rainfall -> a frequency level per climate zone (3 or 5 levels, owner to choose); evaporation -> a constant by temperature; no schedules, no seasons, no wet/dry runs; lake size -> steady-state balance instead of time stepping.

Freeze (kept in the repository as research, not developed, not in the main path): time-stepped coupled water (`coupled-basin-water`, `water-step-trace`, `basin-water-budget/experiment/resolution`, `ab-project-water`); history and tracking over steps (`runoff-flow-history`, `surface-water-identity`, `surface-water-flux`, `surface-water-links`); river regime classification and scale selection (`river-objects`, `river-selection`; selection may return as a display helper); the A/B and candidate viewers (`coupled-water-ui`, `drainage-candidate.html`, `surface-water-highlight/inspector`, `water-contact-readout`, `runoff-*-display`) except the one viewing path the owner picks. These water files are about 168 KB in 29 files; the static pipeline needs only a handful of them.

To check (not verified): `spherical-moisture-transport`, `atmosphere-surface-water`, `spatial-water-forcing` may be the natural source of the rain level; `spherical-bridge` may already carry the sphere into the main app; how the main-app biomes, `settlements.js`, `currents*.js`, `tides.js` and `catastrophes.js` consume a spherical snapshot.

## Realism checks (a few, replacing the volume of experiments)
- No river cell has a receiver higher than itself; every river ends in the sea or a lake.
- Every lake sits in a depression with a flat surface at or below its spill level.
- Mountain belts coincide with converging plate boundaries.
- Neighbouring biomes are compatible by the transition table.
- Cities lie near water and fertile land, none in dry open land without water.
- After a catastrophe the same checks still hold.

## Decisions needed from the owner
1. Approve the keep / simplify / freeze split above (or change it).
2. Rain frequency scale: 3 or 5 levels.
3. Is any time evolution ever wanted (for example an animated catastrophe)? Default: no.
4. Which single water viewing path stays in the editor.
5. Order of work after approval: (a) static hydrology with steady-state lakes and a rain level, (b) the bridge to climate and biomes, (c) catastrophe re-run, (d) the realism checks.
