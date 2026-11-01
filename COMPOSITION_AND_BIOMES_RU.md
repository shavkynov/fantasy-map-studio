# Composition and biome refinement (experimental)

Run the updated `node scripts/enable-natural-v3.cjs` before launching. It supports pristine, previously prepared, and already refined pinned sources; unknown edits are rejected. Preparation still modifies the working tree, not main.

Placement: seeded continental groups or a broken belt replace maximum-separation scoring. Initial orientations follow the composition plan; bounded joint translation relaxation reduces a global position/neighbour-distance objective while retaining existing sampled collision/frame constraints. Coast shapes are unchanged. This is not geological-history simulation or a visually validated solution.

Epochs: the controls are removed from visible settings but their IDs remain inside a display:none container to preserve handlers/old values. Epochs remain internal.

V3 climate fixes: biome classification and downstream fields now use the same corrected temperature/moisture; alpine classification no longer replaces ice; wetland slope uses W/480 to compensate resolution. V2 numerical behaviour is intended to stay unchanged; full regression is pending. V3 seed output changes; metadata adds layoutRevision=2, climateRevision=1.

Audit: existing climate uses latitude, relative height, a coastal-current heuristic, zonal wind sweeps, uplift rainout, land-wide median precipitation normalisation, noise and threshold classification. Wetlands are applied after hydrology. These are dimensionless artistic approximations, not physical climate or Koppen-Geiger classification. There are no monthly temperature/rainfall fields, calibrated elevation/precipitation units, PET/soil-water balance or feedback from the separate Stommel SST solver. Median normalisation removes absolute rainfall scale. It is retained pending calibration rather than replaced by an arbitrary constant.

Local checks: 80 synthetic circle layouts (K=3,4,5,6), all improved objective and retained synthetic gaps; deterministic scale-independent plans, JS syntax, retained epoch IDs and hash helper. Not actual silhouette/world/browser tests. CI additionally loads the new module and checks the composition report in the existing integration test. Actual talsaor-287 / K4 / 1440x960, saved worlds and visual quality remain unverified. Compare real galleries without catastrophes before merging/releasing.
