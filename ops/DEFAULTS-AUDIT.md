# Normal-entry defaults audit

Owner direction, 15 November 2026: developed features default on without special URLs.
This supersedes the earlier default-off policy. Player controls, biome choices and
measured hardware tiers remain. A lane report is not proof of integration or release.
The Orchestrator owns shared defaults in `shared/params.ts` and `src/main.ts`.

## Lane evidence and remaining gates

| Lane | Normal-entry behavior and change | Evidence and remaining work |
| --- | --- | --- |
| Post Effects | Enable post effects and tablet support; quality 0 disables effects, quality 1 uses lite rendering. Bounce 1, shadow softness 2, shadow strength 0.85. | Lighting validation underway. Temporal AA unvalidated; GI and volumetric clouds not yet built. These remain explicit unfinished work. |
| Terrain | `fb71cfa`: grain, surface response, macro colour, accents and river fords default to 1. | Typecheck and 49 tests pass per lead. Combined WebGPU/WebGL2 rendering, appearance and frame cost still owed. Trees remain excluded by owner direction; smooth-ground work remains deferred. |
| Weather | `0f2a55d`: aerial perspective 1; wind, height fog and drift already enabled. Airless worlds suppress atmospheric effects. | Typecheck and 26 tests pass per lead; CPU contrast checks are not visual acceptance. Combined normal-entry browser checks owed. UX owns the owner's generated-only wind choice. |
| Weapons | Bungee, Yoink, Big Red and Pesters enabled alongside tag beams, with ordinary gear controls. | Updated defaults, explicit-off tests and normal-entry multiplayer validation underway. Bot traffic limits and host ownership remain required. |
| Bots | Count 4, mixed fleet on, Daydream 300 seconds. Graphics tiers cap bot counts. | Mixed-fleet multiplayer checks passed per lead. Jet forward-flight terrain safety and shared gear/race wiring still need validation. |
| Shared Vehicles | Force-field canopy enabled; higher-tier procedural paint, mobile plain paint. | Cheap transparent tier-0 canopy added after opaque fallback obscured the view; final tests and normal-entry cockpit checks owed. Mobile high-tier paint remains unmeasured. |
| Buggy | Box arm body, cockpit, new tyre physics, drivetrain and suspension already unconditional. Approved smooth tyres, instancing and distance models also require no opt-in. | Final renderer checks underway. Old optional flight handling settings are not new feature gates. |
| Jet | `2e16bf9`: Mk2 replaces the old model on ordinary Jet selection, with gear, canopy and distance models. | Typecheck and 314 tests pass per lead. Browser gate blocked by shared lab connection refusal. |
| Hovercraft | Assist and tuning already active; procedural material replacement unconditional. | Typecheck and 316 tests plus render captures pass per lead; bitmap comparison underway. Replacement design studies remain alternatives for owner selection. |
| Tank | Climbing already enabled; latest ten-design study opens in the exhibit. | Owner rejected round six and requested new alternatives; no production design chosen. Not a hidden game feature. |
| Lobby | Galaxy, descent, keyboard/gamepad and Custom map button use ordinary entry. | Custom map forwarding/cache/stale-result handling implemented; editor framing and final browser gates underway. Crowd rehearsal and immediate attract URLs remain development shortcuts. |
| Vegetation | Ground cover and shade already default 1. | `d5daf1a`: typecheck and 57 tests pass per lead; normal alpine render seen, movement rerun pending. Quality below 2 omits flora; mobile cover is not implemented or measured. Ice/Moon flora exclusion and no trees follow art direction. |
| UX and Water | Audits and latest integration evidence still required through Orchestrator. | Recent cancellation notifications must be reconciled with actual owner intent before resumption. Earlier tests do not validate final edits. |

## Acceptance

- Collect each lane's exact final revision and exceptions; preserve independent review.
- Integrate into one new frozen candidate. Earlier candidate results apply only to their exact source.
- Test normal entry without cinematic, weather or feature-enable URL parameters, on fresh and persisted settings.
- Check graphics tiers, transparent canopy and water, pointer capture, gear/bots, multiplayer and failure recovery together.
- Verify public asset delivery and live gameplay after deployment; roll back on failed live checks.
- Occupied lobbies do not block deployments, per the owner's later instruction.

The public fallback remains release 2 at this audit. Release 3 attempts failed public
checks and were rolled back. No default-on release is claimed here.
