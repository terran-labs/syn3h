# Liquid handover and shoreline camera

No liquid physics was changed. The coordinator narrowed water work after the buggy lead's
motor-speed correction merged at 2a39feb. A quick planar nine-degree water beach test passes
for both buggies. The earlier Alpine failure sample is a 0.47 rise/m bank, outside the
lead's gentle-bank criterion of 0.3 rise/m. Terrain Lab owns any beach redesign.

## Lava returns control to the wheels

Real-Rapier ramp tests pass for Syn3h buggy, classic buggy and tank: each starts in lava,
crawls through a nine-degree shallows ramp, crosses the shoreline, and drives at least
eight metres beyond it. The tests assert lavaDepth returns to zero and stuck becomes false.

The live volcanic seed-7 capture also exits the shallows, reaches ground height 5.59 m,
and stops with four grounded wheels. Seed 1 returns to all four wheels and reaches dry
ground in 6.76 simulation seconds. No handover dead zone was observed.

The shared liquid path returns immediately when the lower chassis clears the surface
(body y >= surface + 0.25), or liquidKindAt returns null. It therefore stops overwriting
velocity and resetting force accumulators on dry ground. In shallows its target height
includes bed height plus 0.7 m, capped at surface plus 0.3 m, to lift it into that handover.
Correction after inspecting UnityBody.flush: it submits forces, not impulses. resetForces
therefore replaces those controller forces while immersed; the early return above restores
normal wheel control outside the liquid band. The handover test results remain unchanged.

Evidence: `/tmp/syn3h-vehicles2/lava-camera-repro/trace.json` and contact sheet (seed 7),
`/tmp/syn3h-vehicles2/lava-camera-seed1/trace.json` and contact sheet (seed 1).

## Exact camera repro for the camera lane

Use `?autoplay=1&vehicle=buggy&planet=volcanic&seed=1`, default chase camera, time 12:00.
Teleport to **(-508.902333, -0.4, -761.626165)**, heading **3.730641276 radians**.
Set velocity to zero. Hold forward with no steering. When terrain height under the vehicle
exceeds 0.5 m, release forward and hold brakes. The committed capture automates this:

```sh
tools/heavy.sh env SHALLOW=1 SEED=1 EXIT_GROUND=.5 node tests/vehicles2/water-capture.mjs /tmp/lava-camera volcanic
```

Measured on this lane's merged build:

| Moment | Trace tick | Relative time | Camera position | Seabed height | Liquid height |
| --- | --- | --- | --- | --- | --- |
| First submerged camera sample | 334 | 6.28 s | (-512.3305, -0.5565, -766.7594) | -4.3261 | 0 |
| Deepest camera sample | 344 | 6.48 s | (-511.9871, -1.5321, -765.9554) | -4.2197 | 0 |
| Vehicle reaches dry stopping band | 358 | 6.76 s | (-511.5558, -1.4013, -765.3230) | -4.1308 | 0 |

The first sampled vehicle tick is 20. All three moments have four grounded wheels. At tick
344 the vehicle is at (-506.9149, 0.7341, -758.9651), moving 3.35 m/s. The camera remains
submerged after the car stops; its final y is -0.2883. 694 of 1008 physics samples have a
camera below the liquid surface. This is a liquid-surface clip, not penetration of the bed.

Inspected screenshots: `/tmp/syn3h-vehicles2/lava-camera-seed1/12-sea-exit-0.5.png` and
`contact-sheet.png`. The 0.5 image is requested at 500 steps after teleport; screenshot
latency can add steps. The exact sample ticks above come from the trace, not inferred PNG
timing. The 0.1 and 0.25 frames precede the clip; 0.5 and 1 show the persistent underside view.

Likely seam: constrainCamera in ChaseCamera.ts reads heightAt only, including its final
clamp. It never includes liquidHeightAt. Camera code was not edited in this lane.

Validation: 148 lane tests passed, then all three new lava-handover tests passed. Typecheck
and browser smoke passed. Both volcanic captures report zero browser errors. The camera
failure is recorded for the owning lane, not hidden by changing vehicle forces.
