# Visual style contract v1 — concept status

## User decisions
- Initial raster/line prototype is rejected; do not integrate it.
- Mountain study v2 direction is liked: connected silhouette, filled facets,
  directed hatching, foothills. This is not production renderer acceptance.
- Gallery v3 direction and variation are liked, but other objects are NOT
  accepted. Trees, forest signs, shrubs, snow and ice remain concept problems.
- User references and main are mandatory visual baselines. Do not claim that
  unspecified footage has been viewed or analysed.

## Shared visual grammar
- One family of contours, lighter internal strokes, rounded line joins.
- A consistent upper-left light convention, restrained cool shadows.
- Connected mountain forms; coherent forest masses with a legible edge,
  overlap, clearings, and a few foreground tree details.
- Avoid grids of ellipses, geometric tree stamps and unrelated object styles.
- Snow/ice must follow slopes; white polygons alone are not an accepted design.
- Coast and water must belong to the same drawing. Underwater rendering must
  differ from land while retaining shared line and colour relationships.

## Acceptance boundary
A whole scene, not a disconnected symbol catalogue, must be visually reviewed.
Readability at map scale and zoom still needs validation on real worlds.
Aesthetic acceptance, executed draw commands, browser execution, numerical
invariants, CI, and Mac acceptance are distinct facts; never conflate them.

## Controlled scene v4
visual-scene-style-v4.html is a proposed composition only. The geometry,
forest regions and river are manually specified. The river is not simulated
runoff, shoreline accents are not bathymetry, and no climate model is implied.
The page does not modify the app or fmworld files. It is NOT marked accepted.
V3 remains on record but is not an approved production asset library.

## Later integration
Use real terrain and environmental inputs, preserve world arrays and water,
share renderer paths across view/comparison/export, and test projection,
interaction, performance and browser behaviour before one combined Mac check.
