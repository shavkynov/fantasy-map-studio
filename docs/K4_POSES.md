# Stage 2: four distinct prescribed analytic K4 rotations

After ZIP download,run node tools/world-irregular-k4-poses.cjs;echo "exit_code=$?" from extracted root. Optional --unit-only. One exclusive timestamp/PID JSON,short stdout,no screenshot series.

## Construction and analytic argument

Reuse radius/contains from the unchanged static K4 tool and quaternion operations from unchanged src/world-domain.js. Static piece id determines signs sy=(id%2?1:-1),sz=(id>=2?1:-1). Fixed alpha0.65,rate r0.25,maxTime T1. For each piece prescribe omega=(0,-sz*r,sy*r); magnitude v=sqrt(2)*r. pose=axisRotation(omega,v*t). Four distinct angular velocities and rotations,not two groups sharing transforms. Equal speed and symmetric axes are intentional;arbitrary independently adjustable trajectories are NOT supported. No production world-drift.fromSource integration.

The unchanged outline lies within angular radius alpha of +x. Any point under a rotation of angular speed v has angular distance from its initial position at most v*t. Therefore throughout0<=t<=T its distance from+x is at most alpha+v*T<pi/2. Thus its x coordinate X(t)>=c=cos(alpha+v*T)>0.

For omega cross p,the equations are dY/dt=sy*r*X and dZ/dt=sz*r*X. Consequently sy*Y(t)>=sy*Y(0)+r*t*c and sz*Z(t)>=sz*Z(0)+r*t*c. Initial closed-quarter supports have sy*Y(0)>=0,sz*Z(0)>=0. For positive t,both signed coordinates are strictly positive;different sign pairs occupy disjoint quadrants of the YZ plane. This separates all six pairs within these assumptions. At0 the closures touch and existing half-open ownership labels the shared boundary;no initial clearance is cut out.

Numerical constants:c=0.5373088259957851;r*c=0.13432720649894628. These are Cartesian coordinate bounds on a unit sphere,NOT ocean width,geodesic clearance or accepted geographic separation. No assertion outside[0,1] or for altered masks/axes/speeds. envelope() checks the hemisphere prerequisite;it does not instantiate arbitrary motion configurations.

This is an analytic derivation for this explicit construction,not a machine-verified formal/interval proof. Floating-point sampled tests corroborate it;they do not substitute for its assumptions or a general collision detector.

## Tests and evidence

Per piece:21 interior points verified with static contains plus3 closure probes(center and two cut edges);4 times0/0.25/0.5/1,total384 point checks and384 inverse round trips. Closure probes deliberately test closed support,not exclusive source ownership of each shared point. Check quaternion/moved norms,initial identity,numeric signed zeros,input immutability,48 rigid angular-distance comparisons,18 pairwise rotation-distinctness comparisons modulo quaternion sign,invalid IDs/times/envelopes. Four reversed central-point motions must violate the positive-time support bound. These are support-direction controls,not raster collision controls.

Assistant isolated Node unit-only and default CLI runs exit0. Full domain copy matched Git blob71ee09ed451bca803ab0150594c1cc2cc6dcb352;only the required radius/contains function definitions and helpers were copied from current static tool for this isolated harness,not a full checkout. Observed maxRoundTripAngle1.3947004136484323e-16,maxRigidDistanceError2.220446049250313e-16,maxNormError3.3306690738754696e-16;all counts above passed and JSON nonempty. Observations,not baseline expected values. Actual repository module loading,user Mac run and CI remain unconfirmed.

Static K4 prerequisite1d2b2aa02394677c9a9002487c56afbc6835f69a:user2026-11-02 19:07 MSK exit0,units/integration true,2 grids,all missing/outside/multiple-owner/owner-mismatch counters0,12 boundary probes,3 partition controls rejected,max area error0.0032357253234029937,max quadrature difference8.604228440844963e-16. This supersedes static spec's earlier user-pending note;do not request its rerun.

## Scope and next stage

integrationRun=false and movingRasterRun=false deliberately:only analyticMotionSampleRun=true. No moved-mask raster snapshots,pair overlap areas,moved raster-area comparisons,frozen-fixture integration,browser review,visual acceptance or app integration. Old static/pair tools,core,fixtures and baselines unchanged.

After user confirms this stage,prepare stage3 separately:moving analytic K4 on two grids,all6 pair memberships,area checks,round trips and a deliberately overlapping moving control. Then K6 in separate small partition/motion stages. No screenshots until useful visual comparison;no app/climate/crust changes in this package.
