# Stage 1: static analytic K4 partition

Run from extracted ZIP root on Mac:

    node tools/world-irregular-k4-static.cjs
    echo "exit_code=$?"

Optional --unit-only. One timestamped, exclusively created JSON in artifacts; short stdout, no HTML or screenshot requirement.

## Scope and geometry

Standalone analytic research check, not frozen K4, core drift integration or app integration. Fixed alpha=0.65, same radial profile as world-irregular-pair.cjs: r(phi)=alpha*(0.8+0.12*sin(3phi)+0.08*cos(5phi)),phi=atan2(z,y). Membership x>=cos(r(phi)) on the unit sphere. The formula is repeated explicitly in this standalone tool; the prior pair tool and its dependencies are not imported or changed. There is no new motion or coastline generator.

Cut by y=0 and z=0. Within the parent: id=(y>=0?1:0)+(z>=0?2:0). Thus0 is y<0,z<0;1 is y>=0,z<0;2 is y<0,z>=0;3 is y>=0,z>=0. Outside owner=-1. Positive and negative zero belong to the nonnegative side. The common central point belongs only to3. Half-open ownership prevents duplicate labels; closures still touch, with no physical clearance inserted. Four labelled fragments are NOT four separated continents.

Quarter azimuth starts in ID order: pi,3pi/2,pi/2,0, each span pi/2. Reference areas in steradians are numerical integrals of1-cos(r(phi)), Simpson8192 per quarter with4096 comparison. Check quarter sums against the two original half-formula integrals and full-parent integral. Quadrature stability is not an exact area or rigorous error bound.

## Checks

- Unit vectors, IDs, width and integration-panel input validation.
- Twelve explicit boundary probes, including all four signed-zero combinations at the central point; four interior probes and outside membership.
- Independent sign-predicate membership versus owner formula.
- Raster360x180 and720x360: no missing parent cells, outside cells, multiple owners or owner mismatches; all four pieces nonempty.
- Sum of piece raster areas matches parent raster area within1e-10; each quarter agrees with its numerical reference within3%. References also lie between inner/outer radial-envelope area bounds.
- Three synthetic detector controls must reject missing coverage, extra coverage and double membership. These are STATIC partition controls, not moving-collision controls. Synthetic booleans are not source fixtures.

## Evidence and limitations

Assistant executed this exact standalone JavaScript in an isolated Node environment: unit-only exit0 and full analytic run exit0. Observed:2 grids,all four defect counters0,12 boundary probes,3 detector controls rejected,maxRasterRelativeReferenceAreaError0.0032357253234029937,maxQuadratureDifference8.604228440844963e-16. JSON nonempty. Observations,not fixed baseline values. Earlier independent Python design probe agreed approximately; do not confuse it with the Node run.

No full repository checkout/CI run, user Mac run, frozen-fixture integration, motion, continuous-collision proof, browser review, explicit geography acceptance or app integration claimed. integrationRun=true means this standalone analytic raster test ONLY. frozenFixtureIntegrationRun=false,motionTested=false,visualAccepted=false,appIntegrated=false are intentional. User run pending after package write; no need to rerun older pair or blocked-source diagnostics.

## Split roadmap

1. This package: static analytic K4 partition and user confirmation.
2. Separate package: four independent rotations and declared separating bounds; not hidden paired/grouped motions.
3. Separate package: moving K4,all six pairs,round trips,areas,and deliberately rejected motion control.
4. Separate K6 construction: first partition,then motions and all15 pairs. Split further if needed.

Only later: reviewed bridge to real source outlines/core drift,frame choice and compact visual comparison,user acceptance,app integration. No automatic frozen-mask smoothing/erosion/gap creation or baseline regeneration. Climate and crust/fractures remain outside this package.
