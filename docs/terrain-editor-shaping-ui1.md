# TEST editor-ui5 / shaping-ui1

One terrain-shaping milestone, not separate Mac acceptance for each control. Base app remains TEST .17; editor is separate from A/B projects.

## Tools

Flatten existing land toward target 0.000001–10; amount is interpolation fraction. Hard profile plus amount 1 makes a plateau. Coast unchanged. Linear profile preserves the five previous tools exactly. Soft uses smoothstep radial influence; hard is a uniform spherical disc. Maximum influence across gesture points, not accumulated dabs. Smooth remains one cardinal-neighbour land-only pass; no erosion or volume conservation. Heights are relative, not metres.

Per-action amount is remembered in the current window only. Radius/profile remain shared. Removal is binary and ignores amount/profile. New land uses amount times radial influence; this is not a soft-opacity shoreline.

Height view uses a fixed log1p(20*h)/log(201) brightness scale across the whole allowed height range; it is not a linear elevation legend. The pointer reads the actual current height. Height view hides water visually, not its data. Comparison views use their own original relief renderer and disable current-height inspection. PNG always exports canonical ordinary terrain plus enabled water, never the height, comparison or pointer layers. File schema and water solver unchanged.

## Automated acceptance

Numerical suite checks exact old-tool compatibility, target limits, coast invariants, all profiles, duplicate/order invariance, undo/redo, seam and both poles, atomic rejection, original-schema JSON, height view and real numerical water/no-op/stale-task lifecycle.

Chromium runs the real 360x180 procedural page: native island/plateau gestures, comparison readonly guard, shortcut/history/Esc, x4 scroll hit testing, height readout, 20-step water/reset/recalculation, JSON restore/wrong-base rejection and actual PNG dimensions/pixel equality with canonical canvas. CI retains report JSON, screenshot and exported PNG. These tests are not Electron, trackpad, Mac or visual-quality acceptance. Test definitions alone are not passing results.

## One Mac session after green CI

Build a fresh branch ZIP with `/bin/bash ./build-mac.command`. Check editor-ui5/shaping-ui1 in header. Make an island with raised and lowered areas, flatten a plateau, try soft smoothing at its edge, inspect heights and compare the last gesture. Undo/redo the sequence; calculate water, edit and recalculate. Save JSON/PNG, change the map, reopen JSON. Confirm the result is useful and navigation feels correct. Do not rebuild separately for each item.
