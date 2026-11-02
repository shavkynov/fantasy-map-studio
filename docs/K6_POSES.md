# K6 prescribed rotations and inward supports

Run node tools/world-irregular-k6-poses.cjs;echo "exit_code=$?" from fresh extracted branch ZIP root on Mac. Optional --unit-only. One timestamp/PID exclusive JSON,short stdout,no screenshots or old-test reruns.

## Fixed construction

Reuse unchanged K6 intervals/radius/contains and unchanged core world-domain quaternions. For sector[a,b],middle m=(a+b)/2,u=(cos(m),sin(m)). Prescribe omega=(0,-r*u_z,r*u_y),pose=axisRotation(omega,r*t). Fixed alpha0.65,r0.25,T1. Six distinct transforms,not linked groups sharing poses. All use a common prescribed speed;arbitrary independent tuning is NOT supported. Here r is angular-speed magnitude;K4's earlier r was a diagonal COMPONENT with magnitude sqrt(2)*r. Do not equate those two parameter conventions.

Inward YZ normals:nL=(-sin(a),cos(a)),nR=(sin(b),-cos(b)). For each60-degree sector,nL dot u=nR dot u=sin(pi/6)=1/2 in exact arithmetic;code computes the actual floating-point projections and checks positivity.

## Analytic separation argument

The original outline lies within alpha of+x. A rigid rotation at speed r displaces any point by at most r*t angular distance. Therefore throughout[0,T],X(t)>=c=cos(alpha+r*T)>0 when alpha+r*T<pi/2. Here c=0.6216099682706644.

The rotation equations are d(Y,Z)/dt=r*X*u. For either inward normal n,

    n dot (Y(t),Z(t)) >= n dot (Y(0),Z(0)) + r*t*c*(n dot u).

Initial closed-sector supports are nonnegative. At positive time both inequalities become strict,putting the rotated closure inside its own open sector;the six open sectors are disjoint. This yields separation for the declared analytic construction,not for arbitrary source masks,axes,speeds or times outside[0,1]. At0 closures touch and the static tool's half-open ownership applies;no physical clearance or relabelling is introduced.

Minimum computed lower-coordinate increment at1 is0.07770124603383302. This is a Cartesian normal projection on a unit sphere,not ocean width or a geodesic distance. envelope() validates prerequisites only;it does not create arbitrary parameterised motion models.

This is a mathematical derivation under exact geometric assumptions,not formal machine/interval verification. Trigonometric boundaries/atan2 labels have the documented finite-precision semantics from static K6;sample checks allow1e-12 error without changing membership or inserting gaps. positiveTimeSeparation denotes the analytic positive-time premise,not a certified positive floating-point margin for arbitrarily tiny/subnormal times. No general continuous collision detector or arbitrary-motion guarantee.

## Tests and assistant evidence

Per piece21 interior points plus3 closure probes(center and both cut edges);4 times0/0.25/0.5/1. Total576 point/support checks and576 inverse round trips. Closure probes deliberately test closed supports,not exclusive ownership of a shared point by every sector. Also72 rigid angular-distance checks,45 pairwise rotation-distinctness checks modulo quaternion sign(15 pairs*3 positive times),norms,identity including signed zeros,unchanged frozen probes/intervals,angular speed/projection values and invalid IDs/times/envelopes. Six reversed central-point motions must violate inward supports. These are NOT raster collision controls.

Assistant exact candidate unit-only/default CLI isolated Node exit0. Full domain copy matched blob71ee09ed451bca803ab0150594c1cc2cc6dcb352;required static K6/K4 definitions copied for harness,not full module files/full checkout. Observed max inverse angle2.2291027918243403e-16,max rigid-distance error1.6653345369377348e-16,max norm error2.220446049250313e-16;all counts above passed,JSON nonempty. Observations,not baseline constants. Actual full repository loading,user Mac run and CI remain unconfirmed.

Static K6 prerequisite5012a02d7f2f657db105665f0162bf285eca81f0:user2026-11-02 20:10 MSK exit0,2 grids,all4 defect counters0,21 angular checks,24 boundary probes,54 interior probes,3 partition controls rejected,max area error0.004477863963173734,quadrature difference6.661338147750939e-16,parent-reference sum difference1.4432899320127035e-15,inputs unchanged. Supersedes earlier user-pending notes. No extra old JSON/screenshots/rerun needed.

## Scope and next task

integrationRun=false,analyticMotionSampleRun=true,movingRasterRun=false intentionally. No moving-mask raster snapshots,15-pair overlap accounting,moving raster areas,frozen-source integration,visual acceptance or app integration. Static K6/K4,other tools,core,fixtures/baselines unchanged.

After this package is written and user run reviewed,next SEPARATE package:moving K6 on two grids,all15 pair memberships,coverage0..6,area checks,round trips and an actual overlapping-motion negative control. Real-source bridge,frame/visual acceptance and app integration later;climate/crust separate.
