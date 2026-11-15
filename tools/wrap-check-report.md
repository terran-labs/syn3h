# Frozen two-player seam fixture review

The repaired fixture has not passed a full gate. Frozen game source and assets remain unchanged.

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

## Remaining decision

The integrator must select a different supported fixture geometry/world before another gate. Do not lower the slope threshold, silently use water or replace terrain/colliders. The original intermittent startup stale-state failure remains unresolved; future readiness success would establish steady-state readiness, not repair or explain that earlier failure.
