# Atlas/main-world measurements (plan step 4)

Tool: `tools/world-atlas-perf.cjs` (real app, headless Chromium, real UI; seeds `perf-a/b/c`; medians of 3 for render and export). Run on commit c5165ad. Environment: sandbox VM, 2 vCPU Intel Xeon 2.3 GHz, 8 GB RAM, Chromium via Playwright 1.59-alpha, Node 22-class. NOT a user Mac and NOT the CI runner; absolute numbers will differ. No performance improvement is claimed; this is a baseline.

Memory is the page JS heap only (`performance.memory`, 50 ms sampling); canvases and browser-process memory are not included. Peak covers the whole session per seed (generation, states, cities, roads, atlas switch, renders, exports).

| Grid | Seed | Generate, ms | Atlas first render, ms | Atlas repeat (cache), ms | Ink render, ms | PNG export, ms | Peak JS heap, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 480x320 | perf-a | 3342 | 191 | 17 | 25 | 83 | 78 |
| 480x320 | perf-b | 2027 | 221 | 16 | 33 | 94 | 73 |
| 480x320 | perf-c | 2058 | 176 | 20 | 27 | 83 | 84 |
| 960x640 | perf-a | 10218 | 572 | 47 | 509 | 199 | 250 |
| 960x640 | perf-b | 10670 | 921 | 49 | 532 | 211 | 202 |
| 960x640 | perf-c | 7049 | 593 | 41 | 450 | 216 | 229 |

Observations (measurement only): the atlas cache makes repeated renders roughly 10–20x cheaper than the first; first render at 960x640 is 0.6–0.9 s. Generation time dominates (7–11 s at 960x640) and varies by seed. Export copies the rendered canvas (see ATLAS_EXPORT_FINDINGS.md), so it is cheap. The ink figure at 480x320 is far below 960x640 (25 ms vs ~500 ms) and was not investigated; do not compare it to atlas without further checking.

Not measured: larger grids (1.5x and 3x sizes), a Mac, Electron, cold-start page load, canvas/GPU memory, CI runner timings. Grid sizes: `W x H` as reported by the generated map.
