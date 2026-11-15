# Frozen two-player seam fixture review

The repaired fixture passed one complete frozen gate on the integrator-approved fixed dry lane. Frozen game source and assets remain unchanged.

Frozen candidate: `da5a89c9712314100c117f7cabb7ff173b0517b8`.
Fixture revisions: `ec4173d` (initial dry route), `a15f433` (rejection diagnostics), `441f896` (bounded corridor).

## Changes

The fixture uses the supported shared world `alpine.7~terrain.planetSize=0,world.curve=0.8,terrain.dry=1,world.lavaAltitude=-80`. Bots and Daydream are disabled only in the disposable test. Both clients must verify the same dry corridor and world settings. Startup and placement require bounded fresh-state readiness. Actual trajectories must stay within the verified corridor, without recovery teleports. Existing seam errors, steps, canonical bounds, ram, tag, shove and beam assertions remain mandatory. Raw diagnostics are written on success and failure.

## Executed evidence

All runs checked frozen build identity, HTML and entry asset hashes. Ephemeral Wrangler used a temporary configuration and storage outside the frozen directory, with scoped cleanup. No managed preview was restarted.

- `ec4173d`: full invocation stopped before readiness/driving because no dry, gentle corridor qualified. No replication/contact verdict.
- `a15f433`: sampling only. Both clients applied seed 7, dry terrain and sea level -80. All 59 corridors were dry and finite, but all exceeded slope 0.3 over the initial long route. Minimum maximum slope: 0.7091.
- `441f896`: sampling only over seam-relative x [-90, +132] and lateral [-10, +16]. Again all 59 were dry and finite but too steep. Best lane z -296: ground -60 to -56.8746, liquid -80, maximum slope 0.4202. Both clients agree. Conditional authorization for a full gate was not satisfied, so none ran.

Logs: `/tmp/syn3h-frozen-wrap-dry.log`, `/tmp/syn3h-frozen-wrap-sample.log`, `/tmp/syn3h-frozen-wrap-sample-bounded.log`. Latest full raw sampling evidence: `/tmp/syn3h-frozen-wrap-sample-bounded.json`. The sampling raw path was reused; the earlier initial sampling summary above was captured before replacement. Syntax and diff checks pass; readiness and driving changes remain unvalidated at runtime.

## Earlier decision point

At this point the integrator needed to select supported fixture geometry before another gate. Do not lower the slope threshold, silently use water or replace terrain/colliders. The original intermittent startup stale-state failure remains unresolved; future readiness success would establish steady-state readiness, not repair or explain that earlier failure.

## Integrator-approved fixed-lane attempt

The integrator authorized one full gate on z -296, keeping the same world and travel bounds. The fixture-only grade cap changes from 0.3 to 0.5 based on the sampled route and existing climb evidence. This is a cap on sampled absolute X/Z partial slopes, not a universal terrain angle; combined gradient could be greater. It supports attempting the route, not claiming success. All original replication, contact, tag and shove assertions remain unchanged. Both-client corridor verification still precedes driving.

## Final frozen result

Fixture source `4198ea5` passed the single authorized full gate against exact frozen `da5a89c9712314100c117f7cabb7ff173b0517b8`. Identity, HTML and both entry assets matched. Both clients verified z -296, height range 3.1 m and maximum sampled per-axis slope 0.4202 under the approved 0.5 cap. No component-gradient magnitude was captured.

All 17 checks passed. Startup readiness took 2.286 seconds. Crossing top speeds were 16.6/16.4 m/s, errors 3.3/3.2 m, relative steps 0.6/0.6 m and stale samples zero. Chase contact occurred 17.5 m beyond the seam, transferred the tag and relayed a shove. The parked-target ram transferred the tag and the target reached 13.5 m/s. One beam hit across the seam. Every stage stayed dry and inside the verified bounds, without recovery teleports or page errors.

Unique evidence: `/tmp/syn3h-frozen-wrap-grade05.log`, `/tmp/syn3h-frozen-wrap-grade05.json`, `/tmp/syn3h-frozen-wrap-grade05-runtime.log`. The approved absolute heavy helper ran the ephemeral wrapper, which exited zero and removed its own runtime and temporary storage; port 18940 had no listener afterward. No managed preview was restarted.

This is one controlled dry-world pass after bounded readiness. It does not explain the earlier intermittent startup stale-state failure, establish rough-terrain coverage or validate natural sea driving. No original replication/contact/tag/shove bound changed.
