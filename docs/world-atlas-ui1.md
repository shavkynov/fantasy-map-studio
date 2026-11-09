# World atlas / atlas-ui1 candidate

Scope: generalised view of the COMPLETE MAIN WORLD in the existing app, not a
synthetic scene or an integration of the standalone spherical editor. The full
main map carries climate, biome, river and settlement inputs. Do not substitute
missing fields with invented values or silently replace the selected generator.
The new spherical-editor-to-main bridge is NOT implemented by this package.

New style button: Layers and Style -> Мировой атлас · atlas-ui1. Existing themes,
city tools, roads, sea routes, zoom, PNG and seabed use their original paths.
The prepare:contacts build/start hook also runs prepare-world-atlas.cjs, which
idempotently inserts a local script before app.js in the LOCAL src/index.html.
No direct edit of the committed index or core generator is included.

The renderer uses a shallow presentation map and political copy. World arrays,
states, cities, stored roads and their generation rules are not modified. Cache
keys follow map/height/biome identity and pol version/rv; call WorldAtlas.clear
if external code changes environmental arrays in place. Renderer hooks restore
their dispatch state on errors; other themes and seabed delegate unchanged.

The first atlas mode generalises terrain colours and broad forest biome tints,
keeps sparse MAIN mountain/volcano forms, omits individual hill/tree stamps,
and shows longer existing river polylines. It does NOT yet reproduce every
plateau/escarpment/depression treatment of the chosen reference. No licensed
third-party asset files are included. Underwater rendering is unchanged.

Feature footprints avoid water, rivers, road cells and city marker clearances.
This is cartographic selection, NOT a claim that physical features disappeared.
Stored invalid road paths are retained, but endpoint-only A* fallbacks and other
non-contiguous/water-crossing paths are not rendered in atlas mode. Diagnostics
are available from FM.WorldAtlas.inspect(); this is not a route-cost rewrite.

Local checks: syntax and fixture-based core/isolation/cache/guard/installer
execution with renderer and Canvas doubles. CI additionally checks five main
source blob hashes and runs actual main generation, states, cities, automatic
roads, style/zoom invariance, sea-route equality and PNG export in Chromium.
A zero sea-route count is possible in a test world; equality is not proof of a
nonempty trade network. Browser tests do not yet exercise manual road editing
or native Mac file dialogs. Do not report CI or Mac passed before confirmation.

After CI: download ZIP, build normally, create a complete main world, place
states/cities and roads, switch the atlas theme, inspect whole-world readability,
try manual city/road tools, sea-route layer, zoom, PNG, save/open and seabed.
One combined Mac acceptance. Artistic quality is not accepted by numerical tests.
