# Spherical water field contract

Boundary identifier: `external-zero-level-v1`.

## Representation
- `land[i]` must be the numeric value 0 or 1 BEFORE typed-array conversion. Booleans, strings, fractions and wrapped integers are invalid.
- `land[i] === 0` denotes an external zero-level receiving boundary. All such cells share the water node in the current basin hierarchy, even if raster-disconnected. Their bottom height is unknown, not zero bathymetry.
- `land[i] === 1` has finite positive terrain height. A lake is represented by nonnegative `water.redistribution.depth[i]` ON that land cell. Its surface is terrain height plus depth. Its volume belongs to the surface inventory.
- Do not change land to 0 when a depression fills. Do not feed an ocean-plus-lakes mask from the main application directly into this experimental field builder.
- The builder emits `waterBoundary`. Callers may explicitly declare the same identifier in the input frame; an unknown declaration is rejected. Omitted declarations preserve the existing legacy interpretation, not proof of ocean provenance.

## No geographic inference
This contract does not select the largest water component or use the map edge to identify the ocean. A sphere has no outer raster coast. A future main-world adapter must use authoritative ocean/lake classification and retain terrain floors and lake inventory. Unsupported below-zero inland basin floors need an explicit extension; silently turning them into ocean is not allowed.

## Scope
Current editor sessions build the field from terrain and hold simulated lake depths separately. Surface-water objects are snapshot display patches, not boundary definitions. The contract test checks field construction and representation, NOT a simulated lake lifecycle. Direct callers constructing fields themselves are not newly validated by this builder patch.

## Verification and next work
Local Node checks covered invalid inputs and 40 before/after valid-field comparisons of arrays, gradients, areas, neighbours and distances. Full A/B, atmospheric replay, browser, Mac and CI acceptance remain unconfirmed. Existing project schemas and fixtures are unchanged. Next: exercise lake storage, ocean export and continuation through production drainage/hierarchy/fill/surface modules, then the atmosphere. Separately review recipe engine versioning after changed evaporation numerics; this patch does not establish old numerical replay equivalence.
