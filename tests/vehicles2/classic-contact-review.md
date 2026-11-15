# Classic buggy mesh contacts

The classic buggy now counts touching geometric contacts and orients the normal using
Rapier's pair-order flag, matching the Syn3h buggy correction. Its original self-righting
thresholds and torque remain unchanged.

Three real-Rapier triangle-mesh regressions cover roof detection and recovery, clearing a
stale inverted flag while the chassis touches the mesh, and both collider creation orders.
The initial tests failed on the old solver-count implementation. All three pass with the
fix. Unlike the Syn3h buggy, the classic suspension does not consult the inverted flag,
so a stale flag alone does not strand this vehicle. It clears on chassis contact, as in
the original, and can remain set after the suspension catches a recovering car.

Audit: Tank, Jet, Hovercraft and the shared Vehicle base contain no contact-pair normal
or solver-contact-count use. No tank change is needed for this issue.

Validation: typecheck passed; 141 vehicle tests across 19 files passed. Browser smoke
printed SMOKE OK at 40 mph with zero errors on the classic buggy. Screenshot:
`/tmp/syn3h-vehicles2/classic-contact-smoke.png`. All heavy jobs used tools/heavy.sh.

## Alpine summit road, seed 7

The instrumented Terrain Lab keyboard controller reproduced its departure at road point
273 of 520. With its original 13 m/s cruise target, the buggy was upright at 0.98 up-vector
while road offset grew from 2 to 10 metres. It first tipped below 0.5 up-vector at 21.3 metres
off-centre, after falling down the slope. Minimum up-vector before departure was 0.956.
This is evidence of losing the road before tumbling, not a spontaneous rollover on it.
The run ended at point 275, far below the road, with no browser errors.

A comparison changed only the test driver's cruise target to 7 m/s, sharp-turn target to
3.85 m/s, and brake threshold to target plus 1 m/s. It reached point 519 and the summit in
332 seconds, with zero browser errors. Minimum up-vector was 0.9735, maximum road offset
after the initial approach was 3.646 m, and peak horizontal speed was 8.224 m/s. The initial
spawn approach accounts for the tool's 11 m overall maximum offset. Summit height was
288.9 m; the vehicle finished at 289.4 m, upright at 0.99.

The road is climbable with the current physics. The faster controller's departure remains
a handling stress case; this comparison does not establish whether its first loss of
heading was tyre slip, steering overshoot or both. No Syn3h buggy tuning was changed.

Evidence, inspected locally:

- `/tmp/syn3h-vehicles2/alpine-road-review/trace.json` and `drive-2.png`, `drive-end.png`.
- `/tmp/syn3h-vehicles2/alpine-road-calm/trace.json` and `drive-3.png`, `drive-end.png`.

Reproduction uses `tests/vehicles2/alpine-road-capture.mjs`, an instrumented copy of
Terrain Lab's driver. Set QUERY to `planet=alpine&room=<isolated-room>`, pass seed 7, and
set ROAD_SPEED=7 for the conservative comparison. Run through the heavy-job gate.
