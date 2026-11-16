# Orchestrator state

Last verified: 2026-11-15 16:53 PST. The owner withdrew the afternoon cutoff.

## Authority and release order

Only the Orchestrator integrates and deploys. Green UX ships on demand; otherwise skip
empty trains. Between releases, lanes use the shared three-slot heavy-job limiter, with
one job per lane and at most two test workers. Keep the machine quiet from deployment
through public acceptance. Never restart held jobs without clearance.

Preserve every accepted frozen build and compatibility with the judging and embedded
clients. Require no new failures against the accepted baseline, exact-build and network
checks on both public addresses, frozen-file verification, and eight vehicle/browser cases.
Any failed public check rolls back to the previous accepted release. Attach the showcase
GIF before marking a release Latest; publish notes with the frozen playable link.

## Production

Accepted release: v26.11.1515 (release-19), source 50c9eb77, at https://www.syn3h.com/.
Human airborne Jet flight defaults to half throttle with Daydream ownership preserved.
Ground, braking, pause, materialization, settling and Zorb suppress neutral thrust.
The combined gate passes 1,036 tests with one skip and the exact known competitive-flee
failure. Local normal/latency tests, both public addresses and all eight vehicle cases pass.
The earlier quality controls, camera update order and tail lights remain live. The camera
change retains its disclosed evidence waiver and does not establish a full judder fix.

v26.11.1510 was live and superseded without its own vehicle matrix by explicit owner
waiver; the trailing 1511 matrix covers its sidebar and wingtip changes. Do not infer
acceptance from a tag alone. The showcase still predates the Tank paint and sidebar.

## Current queue

1. Validate the expanded fixed-stick and sidebar handoff, keeping touch aiming separate.
2. Review standalone room-full fallback and visible-bot retention when green.
3. Validate camera look/zoom and coordinated touch aiming before composed acceptance.
4. Formation remains withheld after the repeat recording; later world/Post handoffs stay separate.

The withdrawn 1507 build and the accepted 1506 control each passed two quiet local network
runs in 218 seconds. No failing half was isolated. The Foreman authorized restoration
behind a fresh full gate; the old failure is not proved to be solely machine load.

## Shipped behavior and remaining limits

Music, engine voices, wind and impacts are generated. Daydream begins after fifteen idle
seconds and yields to input and blocked UI flows. The approved Sherpa and Lowwing use
shared player colours. Six quality levels, the meadow, underwater cloud attenuation and
corrected sea-ring winding are live. Buggy wingtip trails follow visible deformed geometry;
its separate handling patches remain withheld for camera or water-safety failures.

Local materialization guards do not guarantee immunity from a remote authoritative ram.
Aircraft avoidance still lacks a validated safe response and remains deferred. Physical
phone performance and sound quality require owner feedback, not blanket automated claims.

## Operations

Use the absolute trunk heavy.sh for every heavy job. Keep lane edits in separate worktrees.
Managed previews require broker readiness and a rendered HTTPS check before sharing.
After release records are written, rerun dashboard statistics with SYN3H_SESSION_STATE
provided by the host environment; commit aggregate dashboard/stats.json only, never the
state-directory path. Existing release heartbeat and completion notifications remain active.

The thread checklist and latest handoffs supersede the historical lane locations below.

| Lane | Agent id | Worktree and branch | Dev port | Doing now |
|---|---|---|---|---|
| Foreman | c5dc3811-9bca-4a79-9c81-bcdfdf66908d | `/Users/vtn/dev/.vorteo/worktrees/2jg65r8u/foreman`, `ops/foreman` | none | See handoffs and current thread checklist. |
| Terrain Lab | 39e2a688-346b-4874-be02-46a7fe6f13ee | `.../2jg65r8u/terrain-lab`, `feat/terrain-lab` | 5191 | See handoffs and current thread checklist. |
| Vehicles, shared code (Codex 1) | 8b09a27b-c89d-46b1-9e52-0951e4bd020f | `/Users/vtn/dev/Syn3h-wt/vehicles2`, `feat/vehicles2` | 5185 | See handoffs and current thread checklist. |
| Bots, Performance, QA (Codex 2) | 1e6bdac4-cef1-44c7-9768-1eae4b85ef3d | `/Users/vtn/dev/Syn3h-wt/fx`, `feat/fx` | 5186 | See handoffs and current thread checklist. |
| UX and sound (Codex 3) | ba7d0154-b4d0-4b69-9008-805456c9fdde | `/Users/vtn/dev/Syn3h-wt/audio`, `feat/audio` | 5187 | See handoffs and current thread checklist. |
| Multiplayer | 1aea4dff-9b45-4b17-ba36-116438350f17 | `/Users/vtn/dev/Syn3h-wt/net`, `feat/net` | 5183, room 8791 | See handoffs and current thread checklist. |
| Syn3h buggy | 12abdd19-b672-40d7-938a-be2ab2339315 | `.../2jg65r8u/veh-buggy`, `veh/buggy` | 5201 | See handoffs and current thread checklist. |
| Jet | e73e5ed4-a32d-468e-a2cc-cfda3c196288 | `.../2jg65r8u/veh-jet`, `veh/jet` | 5202 | See handoffs and current thread checklist. |
| Hovercraft | 43191a2c-f8f5-4da4-b147-423a10dff345 | `.../2jg65r8u/veh-hovercraft`, `veh/hovercraft` | 5203 | See handoffs and current thread checklist. |
| Tank | 1e12b353-8e53-4aaa-8784-7d148ebf9c28 | `.../2jg65r8u/veh-tank`, `veh/tank` | 5205 | See handoffs and current thread checklist. |
