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
| Weapons | `9fcabbc`: Bungee, Yoink, Big Red and Pesters enabled alongside tag beams, with ordinary gear controls. | Lead reports typecheck, 222 tests, normal-entry two-browser gear and smoke pass. Wheeled bots evade Pesters; hovercraft and jet evasion remains unfinished behind pilot stability. Integration acceptance remains open. |
| Bots | Count 4, mixed fleet on, Daydream 300 seconds. Graphics tiers cap bot counts. | Mixed-fleet multiplayer checks passed per lead. Jet forward-flight terrain safety and shared gear/race wiring still need validation. |
| Shared Vehicles | Force-field canopy enabled; higher-tier procedural paint, mobile plain paint. | Transparent tier-0 fallback landed as `e770802`; tyre relief as `748245e`. Lane typecheck and 200 tests passed. Combined normal-entry cockpit checks remain owed. Mobile high-tier paint remains unmeasured. |
| Buggy | Box arm body, cockpit, new tyre physics, drivetrain and suspension already unconditional. Approved smooth tyres, instancing and distance models also require no opt-in. | Final renderer checks underway. Old optional flight handling settings are not new feature gates. |
| Jet | `2e16bf9`: Mk2 replaces the old model on ordinary Jet selection, with gear, canopy and distance models. | Typecheck and 314 tests pass per lead. Managed lab now responds; lead has resumed its queued render and smoke gate. |
| Hovercraft | Assist and tuning already active; procedural material replacement unconditional. | Materials landed as `3d9fd5a`. Lead reports local tests, captures and final HTTPS Round 2 capture inspection complete. Replacement design studies remain alternatives for owner selection. |
| Tank | Climbing already enabled; latest ten-design study opens in the exhibit. | Owner rejected round six and requested new alternatives; no production design chosen. Not a hidden game feature. |
| Lobby | Galaxy, descent, keyboard/gamepad and Custom map button use ordinary entry. | Custom `0b1047e` landed as `e1eb15d`; lead reports typecheck, 100 tests and desktop/phone/iPad Chrome/WebKit checks pass. Terrain fidelity follow-up `c20bbe0` has typecheck and 19 tests, awaiting integration. Animated logo mounting remains assigned separately. |
| Vegetation | Ground cover and shade already default 1. | `d5daf1a` landed as `a10c79d`. Lead reports typecheck, 57 tests and local 150-tick smoke with 37 metres driven pass. HTTPS routing failures prevent claiming that path passed. Quality below 2 omits flora; mobile cover is not implemented or measured. Ice/Moon flora exclusion and no trees follow art direction. |
| Multiplayer | `4e17b1e`: same-player rejoin defaults true; explicit and stored off remain honored. Ordinary networking has no URL gate. | Lead reports typecheck, 181 net tests and six local Cloudflare runtime scenarios pass. Not production verified. Race display and normal-page integration remain open. |
| UX | Inspector starts closed; Create opens it. Focus, reticle, glass and generated branding use normal entry. | Generated-only wind removal `bcee066` awaits integration confirmation. Existing Score event layers were off; Orchestrator reassigned enablement to UX after Soundscape exhaustion. Preserve recorded SpaceStation default and explicit track choices. Race UI and final lifecycle checks remain open. |
| Water | Enable waves, sinking, underwater, ripples and spray in their declarations. WaterEffects already mounts unconditionally. | Orchestrator authorized bounded default edits; final controller, rendering and resource-cost checks remain open. Never invoke the legacy water query unconditionally: it overrides volcanic lava and user settings. Existing room values remain preserved. |

Snapshot checked against trunk `3e18b00`. Terrain and Weather defaults are on trunk
as `9f35a6a` and `9ecd33b`. Landing is not public acceptance. The shared lab returned
HTTPS 200 after Builds verified its ready ledger; rendering evidence stays with each
lane. Avoid bare broker status calls, which query every reservation serially.

## Acceptance

- Collect each lane's exact final revision and exceptions; preserve independent review.
- Integrate into one new frozen candidate. Earlier candidate results apply only to their exact source.
- Test normal entry without cinematic, weather or feature-enable URL parameters, on fresh and persisted settings.
- Check graphics tiers, transparent canopy and water, pointer capture, gear/bots, multiplayer and failure recovery together.
- Verify public asset delivery and live gameplay after deployment; roll back on failed live checks.
- Occupied lobbies do not block deployments, per the owner's later instruction.

The public fallback remains release 2 at this audit. Release 3 attempts failed public
checks and were rolled back. No default-on release is claimed here.
