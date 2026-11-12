# Atlas/main-world measurements (plan step 4)

Tool: `tools/world-atlas-perf.cjs` (real app, headless Chromium, real UI; seeds `perf-a/b/c`; medians of 3 for render and export). Run on commit 01e74ab (largest size, the only size the project uses). An earlier run at 480x320 and 960x640 was withdrawn: those sizes were picked without checking the single-size agreement. Environment: sandbox VM, 2 vCPU Intel Xeon 2.3 GHz, 8 GB RAM, Chromium via Playwright 1.59-alpha, Node 22-class. NOT a user Mac and NOT the CI runner; absolute numbers will differ. No performance improvement is claimed; this is a baseline.

Memory is the page JS heap only (`performance.memory`, 50 ms sampling); canvases and browser-process memory are not included. Peak covers the whole session per seed (generation, states, cities, roads, atlas switch, renders, exports).

| Grid | Seed | Generate, ms | Atlas first render, ms | Atlas repeat (cache), ms | Ink render, ms | PNG export, ms | Peak JS heap, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1440x960 | perf-a | 20695 | 1612 | 97 | 896 | 371 | 398 |
| 1440x960 | perf-b | 20256 | 1362 | 83 | 1002 | 339 | 433 |
| 1440x960 | perf-c | 27159 | 1274 | 81 | 935 | 375 | 486 |

Observations (measurement only): at the largest grid the atlas cache makes repeated renders about 12-17x cheaper than the first (1.3-1.6 s -> 80-97 ms). Generation dominates (20-27 s) and varies by seed. Export copies the rendered canvas (see ATLAS_EXPORT_FINDINGS.md), so it is cheap (~350 ms). Ink render is ~0.9-1.0 s, comparable to the atlas first render.

Not measured: a Mac, Electron, cold-start page load, canvas/GPU memory, CI runner timings. Grid size is `W x H` as reported by the generated map (size button `data-s="3"`).
