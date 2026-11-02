# One spherical water metric

Status: implementation prepared; repository integration run pending. This document supplements WORK_STATE.md; no claim that the metric has passed fixture integration yet.

Output: largestWaterComponentSphereFraction = area of the largest connected water component divided by total sphere area, not by water area. Water means coverage=0. Land means coverage=1. Any overlap (coverage>1) is rejected rather than counted as additional water. The function does not mutate its input.

Input must be a full-sphere equirectangular coverage raster, as returned by WorldDrift.snapshot. Do not pass the cylindrical-equal-area source labels. Cell weights use world-domain.js cellAreaKm2 with radius 1, normalized by totalAreaKm2; the ratio does not depend on radius. Connectivity uses shared edges (four neighbours), wraps longitude, never wraps latitude, and makes no pole shortcuts or diagonal joins. This is a grid-connectivity approximation, including near the poles, not a continuous coastline-topology solution. Channels narrower than grid resolution can appear or disappear. A large connected basin can still have a narrow strait: this metric does not measure ocean width or certify geographic quality. No acceptance threshold or frame ranking is introduced.

Unit cases: all water/all land, hemisphere, seam connection, separated components, spherical polar weights, no north-south wrap, cyclic column shifts, unchanged inputs, malformed coverage, overlap rejection. An isolated local run passed using a small substitute exposing the same spherical cell-area formula; the actual repository module and fixture integration have not yet been executed by the assistant.

Run in the downloaded project folder: node tools/world-water-metric-test.cjs
Optional unit-only: node tools/world-water-metric-test.cjs --unit-only
The integration runner uses all five frozen sources and 25 existing snapshots. Based on the previously supplied diagnostics, expect 8 measured and 17 skipped frames, no generator import. Actual metric values must come from execution, not inferred beforehand. No changes to motion, existing fixtures, baseline hashes, UI, climate, or frame selection.
