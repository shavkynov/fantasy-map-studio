# V4 reference gallery — task 1 only

No generator or renderer changes. Pinned core blob: 6cd6ab743be0b3e93fc8e2f8013ac1fa320f291d, read at commit 5c31643ea943e481627aa2417ccb665103abff48. This freezes current behaviour, not geographic quality.

Run `node tools/world-v4-baseline.cjs` from the repository. Open artifacts/v4-reference/index.html. No npm dependencies. Six cases include both user seeds with four continents, K=2/3/6, and a 1440x960 counterpart. Each has a three-panel SVG, PGM masks, params, source/final geometry hashes, fragment transforms, cuts, diagnostics and pixel-grid metrics. Inland lakes remain part of the continental footprint. Node/platform metadata is in summary.json.

Reference mode requires the exact LF core blob and checks frozen geometry fingerprints. Outputs must be empty/new directories; non-empty folders are never overwritten. There is no auto-update of reference fingerprints. After future generator changes use `node tools/world-v4-baseline.cjs --candidate --out artifacts/v4-candidate` and compare with the preserved reference. Candidate mode does not update the manifest. Existing API compatibility is required.

Central land fraction uses the central half-width and half-height (one quarter of image area). Water clearance is an approximate two-pass 8-neighbour chamfer distance to land/image frame, divided by image width; it is not an exact ocean-width or spherical-area metric. These diagnostics are not aesthetic pass/fail thresholds.

Locally generated all six cases twice from the byte-identical published core; source/final geometry hashes matched. Changed-core and overwrite attempts were rejected. This task does not improve ocean space or choose global geometry. Those belong to subsequent tasks. Raw reference images must remain available for visual comparison rather than treating numeric checks as evidence of natural appearance.
