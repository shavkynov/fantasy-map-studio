# Spherical tectonic relief candidate

Generator version: spherical-terrain-v2-kinematic. Coastline RNG remains spherical-terrain-v1 to preserve the existing footprint for the same options. New generated heights intentionally differ. Existing saved terrain arrays are not regenerated.

## Implemented path
The existing terrain-edit-spherical-base.js generate() constructs a seeded full-sphere field of 12 plates before continent layout, then uses local convergence/divergence to form terrain heights. Plates are spherical Voronoi regions and are distinct from the 1..7 requested continents. Each has a prescribed Euler angular-velocity vector. At a boundary point p the relative tangent velocity is (omegaA-omegaB) cross p. Positive projection onto the normal from A to B means convergence; the tangential component measures shear. Exchanging plate order and reversing the normal preserves convergence and absolute shear.

At each sample the two nearest seeds define a supporting great circle. Its nearest projected point is used only if no third seed dominates there. The influence band is 0.08 radians with quadratic falloff. This is bounded nearest-two sampling, not exact distance to the complete boundary network; junction neighbourhoods can be omitted. Uplift and rift fields affect existing land heights; shear is diagnostic only. Background provinces and coastline shaping remain procedural. Ocean floor heights are still undefined.

## Evidence
Local Node checks used the original generator verified as Git blob caf7b1a527e19a383ce953891d953c06d5379aaf. Four analytic cases, three invalid-input cases, 1000 swap/common-motion/rotation invariance cases and repeated 1..7-continent generation passed. Seven land masks matched the original exactly; heights changed. Generation also executed at 360x180 and 720x360. These are not visual acceptance, whole-checkout static checks, water/session integration, browser, Mac or CI results. Existing integrated generation and Chromium tests remain in terrain-generation CI alongside the new regression.

## Explicit limitations
This is instantaneous prescribed kinematics plus heuristic relief, NOT a geological evolution solver. There is no continental advection, collision resolution, subduction, crust thickness/age/mass budget, calibrated geologic time or physical uplift in metres. Angular rates use arbitrary model time. A correct velocity formula does not validate chosen plate motions or artistic geography.

The workspace still saves exact terrain base and edits, not seed or plate fields. Opening a terrain file does not restore a tectonic simulation. The legacy main-app v3 pipeline and the editor-to-main bridge are unchanged. A persistent planet project, physical size drift, region derivation and globe/atlas view integration remain separate unfinished work. No size-drift range is silently adopted by this package.
