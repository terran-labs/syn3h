# Normal-entry defaults audit

Owner direction, 15 November 2026: developed features default on without special URLs.
This supersedes the earlier default-off policy. Player controls, biome choices and
measured hardware tiers remain. A lane report is not proof of integration or release.
The Orchestrator owns shared defaults in `shared/params.ts` and `src/main.ts`.

## Lane evidence and remaining gates

| Lane | Normal-entry behavior and change | Evidence and remaining work |
| --- | --- | --- |
| Post Effects | Enable post effects and tablet support; quality 0 disables effects, quality 1 uses lite rendering. Bounce 1, shadow softness 2, shadow strength 0.85. | Stable lighting and screen-space GI are integrated in `da5a89c`; combined normal-entry backend checks pass. Clouds `35c0167` passed lane gates and bounded source review, queued next. Temporal AA remains under validation. Physical-device cost is unmeasured. |
| Terrain | `fb71cfa`: grain, surface response, macro colour, accents and river fords default to 1. | Typecheck and 49 tests pass per lead. Combined WebGPU/WebGL2 rendering, appearance and frame cost still owed. Trees remain excluded by owner direction; smooth-ground work remains deferred. |
| Weather | `0f2a55d`: aerial perspective 1; wind, height fog and drift already enabled. Airless worlds suppress atmospheric effects. | Typecheck and 26 tests pass per lead; CPU contrast checks are not visual acceptance. Combined normal-entry browser checks owed. UX owns the owner's generated-only wind choice. |
| Weapons | `9fcabbc`: Bungee, Yoink, Big Red and Pesters enabled alongside tag beams, with ordinary gear controls. | Typecheck, 222 lane tests and normal-entry gear checks passed; integrated in `da5a89c`. Wheeled bots evade Pesters. Aircraft draft `16df9a6` failed to convert catches into escapes and is excluded pending a different reviewed design. |
| Bots | Count 4, mixed fleet on, Daydream 300 seconds. Graphics tiers cap bot counts. | Jet repair `fae37e8` passed independent review, 26 pilot tests and 27 five-minute terrain drives, then the combined full suite. Mixed fleet and staged race/rejoin pass. Natural race frequency and aircraft Pester evasion remain unproven. |
| Shared Vehicles | Force-field canopy enabled; higher-tier procedural paint, mobile plain paint. | Transparent tier-0 canopy and tyre relief are integrated. Combined Chrome/WebKit vehicle drives pass on the preceding combined revision; final frozen checks remain. Mobile high-tier paint remains unmeasured. |
| Buggy | Box arm body, cockpit, new tyre physics, drivetrain and suspension already unconditional. Approved smooth tyres, instancing and distance models also require no opt-in. | Approved tyre and distance-model source is integrated. Lane cockpit/steering/driving checks and guarded six-contact ram sequence pass. Rough-terrain handling and physical-device performance remain separate. |
| Jet | `2e16bf9`: Mk2 replaces the old model on ordinary Jet selection, with gear, canopy and distance models. | Mk2 lane typecheck, 314 tests, browser and smoke gates pass; integrated in `da5a89c`. Separate pilot inertia/descent repair also passes its lane and combined full-suite gates. |
| Hovercraft | Assist and tuning already active; procedural material replacement unconditional. | Materials landed as `3d9fd5a`. Lead reports local tests, captures and final HTTPS Round 2 capture inspection complete. Replacement design studies remain alternatives for owner selection. |
| Tank | Climbing already enabled; latest ten-design study opens in the exhibit. | Owner rejected round six and requested new alternatives; no production design chosen. Not a hidden game feature. |
| Lobby | Galaxy, descent, keyboard/gamepad and Custom map button use ordinary entry. | Custom maps, fidelity correction, logo animation and aggregate presence are integrated. Presence live endpoint checks pass in Chrome/WebKit. Saved-world moons `873e408` passed lane gates and bounded source review, queued outside the frozen candidate. |
| Vegetation | Ground cover and shade already default 1. | `d5daf1a` landed as `a10c79d`. Lead reports typecheck, 57 tests and local 150-tick smoke with 37 metres driven pass. HTTPS routing failures prevent claiming that path passed. Quality below 2 omits flora; mobile cover is not implemented or measured. Ice/Moon flora exclusion and no trees follow art direction. |
| Multiplayer | `4e17b1e`: same-player rejoin defaults true; explicit and stored off remain honored. Ordinary networking has no URL gate. | Rejoin and presence are integrated. Combined staged race gate after `3234f64` passes host/guest winner display, dropout, same-player return and host expiry with no errors. Frozen/public acceptance remains open. |
| UX | Inspector starts closed; Create opens it. Focus, reticle, glass and generated branding use normal entry. | Generated-only wind, enabled Score layers and redesigned rail/minimap are integrated. Preserve SpaceStation default and explicit choices. Music selector and Escape review findings are corrected. Final lane keyboard/touch/cursor gates pass; physical-device feel and performance remain unmeasured. |
| Water | Enable waves, sinking, underwater, ripples and spray in their declarations. WaterEffects already mounts unconditionally. | Five activation defaults and correction `c28eafb` are integrated. Wing speed, approved Zorb depth and motor-contact regressions pass, as does the combined suite. Top-down sea/river transparency is unimplemented. Two-client wave visuals and physical-mobile cost remain unverified. Never make the legacy water query unconditional. |

Snapshot: 2:19am Pacific, trunk `da5a89c`, milestone `m16-default-on`. Exact combined
typecheck and 1,143 tests across 146 files pass. Frozen copy
`20261115-021120-da5a89c` is undergoing release checks; its initial dry-run multiplayer
wait timed out. The test counts bots as players, so the integrator is capturing the
runtime roster before changing its two-human assumption. This is not a public pass.

Earlier lane and combined browser results retain their exact source scope. The final
frozen artifact must pass its own gates. The reviewed deploy wrapper pins its identity
and hashes without rebuilding; its source review does not establish gameplay acceptance.

## Acceptance

- Collect each lane's exact final revision and exceptions; preserve independent review.
- Integrate into one new frozen candidate. Earlier candidate results apply only to their exact source.
- Test normal entry without cinematic, weather or feature-enable URL parameters, on fresh and persisted settings.
- Check graphics tiers, transparent canopy and water, pointer capture, gear/bots, multiplayer and failure recovery together.
- Verify public asset delivery and live gameplay after deployment; roll back on failed live checks.
- Occupied lobbies do not block deployments, per the owner's later instruction.

The public fallback remains release 2 at this audit. Release 3 attempts failed public
checks and were rolled back. No default-on release is claimed here.
