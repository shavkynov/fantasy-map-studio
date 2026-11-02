# One spherical water metric

Status: user fixture integration confirmed on 2026-11-02 at 15:11 MSK for implementation commit 169ae9a92631cd2cb58a40c23ec828d9bc77fae5. This supersedes the earlier integration-pending status. Not visual acceptance or app integration.

Output: largestWaterComponentSphereFraction = area of the largest connected water component divided by total sphere area, not by water area. Water means coverage=0. Land means coverage=1. Any overlap (coverage>1) is rejected rather than counted as additional water. The function does not mutate its input.

Input must be a full-sphere equirectangular coverage raster, as returned by WorldDrift.snapshot. Do not pass the cylindrical-equal-area source labels. Cell weights use world-domain.js cellAreaKm2 with radius 1, normalized by totalAreaKm2; the ratio does not depend on radius. Connectivity uses shared edges (four neighbours), wraps longitude, never wraps latitude, and makes no pole shortcuts or diagonal joins. This is a grid-connectivity approximation, including near the poles, not a continuous coastline-topology solution. Channels narrower than grid resolution can appear or disappear. A large connected basin can still have a narrow strait: this metric does not measure ocean width or certify geographic quality. No acceptance threshold or frame ranking is introduced.

Unit cases: all water/all land, hemisphere, seam connection, separated components, spherical polar weights, no north-south wrap, cyclic column shifts, unchanged inputs, malformed coverage, overlap rejection. An earlier isolated assistant unit run used a substitute exposing the same spherical cell-area formula; it was not repository fixture integration. The integration evidence below is the user's actual run, not an assistant execution of the water runner.

Run in the downloaded project folder: `node tools/world-water-metric-test.cjs`. Optional unit-only: `node tools/world-water-metric-test.cjs --unit-only`.

Confirmed user output: unitChecksPassed=true, integrationRun=true, sources=5, snapshots=25, measuredFrames=8, skippedFrames=17, generatorImported=false. The terminal prompt returned without a shown error; a numeric exit code was not separately provided.

| Source | K | Time | largestWaterComponentSphereFraction |
| --- | --- | --- | --- |
| vondoran-227 | 2 | 0 | 0.6600878239516726 |
| vondoran-227 | 2 | 0.5 | 0.6599661146367357 |
| vondoran-227 | 2 | 1 | 0.6599997099419159 |
| vondoran-227 | 2 | 2 | 0.6603943792604203 |
| vondoran-227 | 3 | 0 | 0.6600878239516726 |
| vondoran-227 | 4 | 0 | 0.6600878239516726 |
| vondoran-227 | 6 | 0 | 0.6600878239516726 |
| talsaor-287 | 4 | 0 | 0.6601792577201768 |

Skipped for fragment-overlap: vondoran-227 K2 at time=4; vondoran-227 K3,K4,K6 and talsaor-287 K4 each at time=0.5,1,2,4. Seventeen skipped frames are expected exclusions, not seventeen failed unit tests. K2's largest basin remains about 66% of sphere area in its measured frames; this says nothing about ocean width. No changes to motion, existing fixtures, baseline hashes, UI, climate or frame selection.
