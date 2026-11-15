# Normal-entry defaults audit

Owner direction, 15 November 2026: developed features default on without special URLs.
This supersedes the earlier default-off policy. Player controls, biome choices and
measured hardware tiers remain. A lane report is not proof of integration or release.
The Orchestrator owns shared defaults in `shared/params.ts` and `src/main.ts`.

## Lane evidence and remaining gates

| Lane | Normal-entry behavior and change | Evidence and remaining work |
| --- | --- | --- |
| Post Effects | Enable post effects and tablet support; quality 0 disables effects, quality 1 uses lite rendering. Bounce 1, shadow softness 2, shadow strength 0.85. | Stable lighting and screen-space GI are integrated in `da5a89c`; combined normal-entry backend checks pass. Clouds `35c0167` and temporal `8edddad` are integrated and public in release 5 after combined and frozen rendering checks. Physical-device cost is unmeasured. |
| Terrain | `fb71cfa`: grain, surface response, macro colour, accents and river fords default to 1. | Typecheck and 49 tests pass per lead. Combined and frozen WebGPU/WebGL2 entry checks pass; rich-surface frame cost on physical low-tier hardware remains unmeasured. Trees remain excluded by owner direction; smooth-ground work remains deferred. |
| Weather | `0f2a55d`: aerial perspective 1; wind, height fog and drift already enabled. Airless worlds suppress atmospheric effects. | Typecheck and 26 tests pass per lead; CPU contrast checks are not visual acceptance. Combined frozen normal-entry browser checks pass; physical-phone performance remains unmeasured. UX owns the owner's generated-only wind choice. |
| Weapons | `9fcabbc`: Bungee, Yoink, Big Red and Pesters enabled alongside tag beams, with ordinary gear controls. | Typecheck, 222 lane tests and normal-entry gear checks passed; integrated in `da5a89c`. Wheeled bots evade Pesters. Aircraft draft `16df9a6` failed to convert catches into escapes and is excluded pending a different reviewed design. |
| Bots | Count 4, mixed fleet on, Daydream 300 seconds. Graphics tiers cap bot counts. | Jet repair `fae37e8` passed independent review, 26 pilot tests and 27 five-minute terrain drives, then the combined full suite. Mixed fleet and staged race/rejoin pass. Natural race frequency and aircraft Pester evasion remain unproven. |
| Shared Vehicles | Force-field canopy enabled; higher-tier procedural paint, mobile plain paint. | Transparent tier-0 canopy and tyre relief are integrated. Frozen and public Chrome/WebKit vehicle drives pass on the accepted release. Mobile high-tier paint remains unmeasured. |
| Buggy | Box arm body, cockpit, new tyre physics, drivetrain and suspension already unconditional. Approved smooth tyres, instancing and distance models also require no opt-in. | Approved tyre and distance-model source is integrated. Lane cockpit/steering/driving checks and guarded six-contact ram sequence pass. Rough-terrain handling and physical-device performance remain separate. |
| Jet | `2e16bf9`: Mk2 replaces the old model on ordinary Jet selection, with gear, canopy and distance models. | Mk2 lane typecheck, 314 tests, browser and smoke gates pass; integrated in `da5a89c`. Separate pilot inertia/descent repair also passes its lane and combined full-suite gates. |
| Hovercraft | Assist and tuning already active; procedural material replacement unconditional. | Materials landed as `3d9fd5a`. Lead reports local tests, captures and final HTTPS Round 2 capture inspection complete. Replacement design studies remain alternatives for owner selection. |
| Tank | Climbing already enabled; latest ten-design study opens in the exhibit. | Owner rejected round six and requested new alternatives; no production design chosen. Not a hidden game feature. |
| Lobby | Galaxy, descent, keyboard/gamepad and Custom map button use ordinary entry. | Custom maps, fidelity correction, logo animation and aggregate presence are integrated. Presence live endpoint checks pass in Chrome/WebKit. Saved-world moons `873e408` passed lane gates, source review and combined Chrome/WebKit checks, and are public in release 5. |
| Vegetation | Ground cover and shade already default 1. | `d5daf1a` landed as `a10c79d`. Lead reports typecheck, 57 tests and local 150-tick smoke with 37 metres driven pass. HTTPS routing failures prevent claiming that path passed. Quality below 2 omits flora; mobile cover is not implemented or measured. Ice/Moon flora exclusion and no trees follow art direction. |
| Multiplayer | `4e17b1e`: same-player rejoin defaults true; explicit and stored off remain honored. Ordinary networking has no URL gate. | Rejoin and presence are integrated. Combined staged race gate after `3234f64` passes host/guest winner display, dropout, same-player return and host expiry with no errors. Frozen and public multiplayer acceptance pass, including default replicated bot rosters; prior intermittent startup failures remain unexplained. |
| UX | Inspector starts closed; Create opens it. Focus, reticle, glass and generated branding use normal entry. | Generated-only wind, enabled Score layers and redesigned rail/minimap are integrated. Preserve SpaceStation default and explicit choices. Music selector and Escape review findings are corrected. Final lane keyboard/touch/cursor gates pass; physical-device feel and performance remain unmeasured. |
| Water | Enable waves, sinking, underwater, ripples and spray in their declarations. WaterEffects already mounts unconditionally. | Five activation defaults and correction `c28eafb` are integrated. Wing speed, approved Zorb depth and motor-contact regressions pass, as does the combined suite. Top-down sea/river transparency is unimplemented. Two-client wave visuals and physical-mobile cost remain unverified. Never make the legacy water query unconditional. |

Snapshot: 3:38am Pacific. Release 5 is accepted at source `5e38ef6`, milestone
`m17-clouds-moons`, frozen copy `20261115-032406-5e38ef6`. Combined typecheck,
1,156 tests across 150 files and production build pass. Frozen direct/latency networking,
vehicle/rendering and seam gates pass, with all 338 artifact hashes preserved.
Worker and primary-domain assets and multiplayer, plus all eight public Chrome/WebKit
vehicle checks, pass. The acceptance marker matches Worker
`e9f20f19-4194-40c2-8e6b-a8becb6190a0`.

Earlier lane evidence retains its source scope; public functional checks are not
physical-device performance measurements. Clouds, temporal AA, saved-world moons and
touch minimap clearance are integrated and public. Combined rendering, layout,
saved-world and settled-logo checks pass.
Aircraft response research completed 99 runs with two escapes and two harmful
conversions; no safe aircraft evasion implementation is accepted.

## Acceptance

- Collect each lane's exact final revision and exceptions; preserve independent review.
- Integrate into one new frozen candidate. Earlier candidate results apply only to their exact source.
- Test normal entry without cinematic, weather or feature-enable URL parameters, on fresh and persisted settings.
- Check graphics tiers, transparent canopy and water, pointer capture, gear/bots, multiplayer and failure recovery together.
- Verify public asset delivery and live gameplay after deployment; roll back on failed live checks.
- Occupied lobbies do not block deployments, per the owner's later instruction.

For the next release, select accepted release 5 as the rollback target explicitly.
The release 5 deployment supervisor targets release 4, and earlier versions target
release 2. Prepare the next supervisor deliberately rather than reusing either blindly. Release 3 and the first release 4 attempt failed public checks and were
rolled back; later success does not establish their root causes.
