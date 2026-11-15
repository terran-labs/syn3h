# Device quality and load measurements

`gfx.level` is a client parameter: 0 safe, 1 mobile, 2 desktop. The controller starts before physics initialization, renderer initialization and terrain construction. The current static module graph is still downloaded and parsed before `Game` constructs; this is not a tiny standalone bootloader.

| Budget | Safe | Mobile | Desktop |
| --- | ---: | ---: | ---: |
| Render pixel ratio cap | 1 | 1 | 1.5 |
| Existing sky shadow quality | 0 | 0 | 1 |
| Particle cap | 240 | 960 | 2400 |
| Local bot cap | 2 | 4 | 8 |
| Optional terrain distance | 700 m | 1400 m | 3000 m |
| Optional terrain detail scale | 0.5 | 0.75 | 1 |

Classification uses user agent, touch points (including iPad's desktop user agent), optional deviceMemory and WebGPU adapter availability/limits. Low-memory and software-adapter devices start safe. Phones with an adapter start mobile; phones without one start safe. Desktop WebGL fallback starts mobile. These are conservative heuristics, not measured memory guarantees.

The client particle cap applies even when an emitter module is imported after initialization. A 50-vent safe-mode scene allocates four particles per vent, 200 total. The manager limits actual bots without changing the shared `bots.count` parameter. Managers may exist on every client, but `remote = true` holds no vehicles; networking owns remote copies. Local caps do not remove remote players or change physics/terrain generation.

The controller offers `game.quality.attachTerrain(terrain)`. If terrain implements `setRenderQuality({level, drawDistance, detail})`, it receives the current budget and future changes. The merged terrain implements that setter and the composition root attaches it, so graphics levels change visual LOD without changing the collider. No terrain files were changed.

## Six quality levels (15 November 2026)

This replaces the three tiers. Sections below that speak of three tiers, a device level or shading, particle and shadow rungs describe the earlier design and are kept for their measurements only.

There are six levels for every device: Minimal, Low, Medium, High, Ultra and Cinematic (`gfx.quality`, 0 to 5). The earlier tiers carry over exactly as Minimal, Medium and Ultra. `LEVELS` in `src/core/quality.ts` holds each level's budget (pixel ratio cap, target rate, shadows, vehicle shading, particles, bot cap, draw distance, terrain detail, ground cover, effect rate, post tier). `PRESET_TABLE` holds the value each level sets for every local parameter it owns, each post effect and indirect light included. A level never writes a world parameter. Placement is by the kind of work a feature adds, not by timings; moving a feature is a one-line edit.

**Fine-tuning.** Any owned parameter the player sets by hand is an override. It survives level changes made by the governor and is cleared when the player changes level. `clearOverride(id)` hands one value back.

**Starting level.** No user agent or touch test. A first visit starts at High; at Medium on a texture limit under 8192 or two gigabytes of reported memory; with no WebGPU adapter (the WebGL 2 path) at Medium with Medium as the ceiling; on a software adapter at Minimal with the same ceiling. Later visits start at the saved level. An unfinished load starts the next one a level lower.

**Governor.** Inside a level it eases only what builds no pipeline: the post budget fades, then resolution drops to 85 and 70 percent. After 8 seconds of slow windows at the bottom rung it gives up the level. Climbing a level needs 60 seconds of headroom with doubling backoff after a failed climb. Until the first shed of a session all climb waits are a quarter as long, so a strong device reaches Cinematic from High within three minutes of play, sooner with a menu visit.

**Level climbs and shader builds.** A level change rebuilds the post pipeline and may recompile lit materials (the 15 November matrix counted 44 to 195 pipelines for a tier change). The controller cannot prebuild pipelines for materials other modules own, so a climb is held as pending until a covered moment: a frame while a lobby or menu is on screen, or a call to `noteCovered()` (a respawn or teleport should call it). If no covered moment comes within 20 seconds of continued headroom, the climb is taken during play and costs one hitch. Each level change is recorded in `quality.levelChanges` with who made it, whether it was covered and the pipelines created in the following two seconds. Drops are immediate: the frames are already slow.

**Saved state.** `localStorage` key `syn3h.quality.v2` holds `{ level, auto, pinned, overrides }`. The earlier `syn3h.graphics.level` and `syn3h.graphics.manual` are read once, mapped 0, 1, 2 to 0, 2, 4, and removed after the first finished load. `syn3h.loading.level` stays tab scoped as the crash marker. `?gfx=0` to `?gfx=5` chooses a level for one page load and is not saved.

**Interface.** `game.quality` implements `QualitySource`: `qualityLevels`, `getQualityState()` (the same frozen object until something changes), `setLevel`, `stepUp`, `stepDown`, `setAuto`, `clearOverride`, `clearOverrides` and `subscribeQuality` (called at once and after every change). State carries `easing` (`'post'`, `'resolution'` or null) so the card can say what is being eased.

**Older three-step value.** `gfx.level` (0, 1, 2) follows the level (0; 1 and 2; 3 to 5) so existing consumers keep working, and setting it moves the level to 0, 2 or 4. Consumers should move to `qualityBudget()` fields and `quality.postTier`, after which it is deleted.

## Recovery, loading and diagnostics

Session storage records `syn3h.loading.level` when loading starts and clears it after a frame with draws. A surviving marker reduces the next attempt by one level, including repeated failures down to safe. A separate session value remembers a manually selected or automatically reduced level. Session storage avoids treating another tab's load as a crash; local storage is a fallback when session storage is unavailable. Storage denial does not prevent the game from starting.

Frame pressure is handled by the cascade described below. `FrameBudgetMonitor`, the original whole-level monitor (four consecutive two-second windows below 54 or 28 fps, 15 second cooldown), stays exported and tested but the controller no longer uses it.

`window` emits `syn3h:loading` events with `{phase, progress, elapsedMs}`. Phases are device, physics, renderer, world and ready. Progress is an estimate, not download byte progress. Elapsed time is measured from navigation. `loadingProgress` exports the latest state for UI code that subscribes after initialization. `syn3h:quality` carries the selected level, the effective rung values (`rung`, `rungs`, `kind`, `pixelRatio`, `vehicleShading`, `particles`, `shadows`, `auto`, `targetFps`), the fixed level `budget` and the `reason` for the change. `effectiveQuality()` returns the same values for code that polls.

F3 toggles a small HUD with the level, target fps, rung, pixel ratio, vehicle shading tier, the last window's 90th percentile frame, smoothed fps, frame interval, physics-step CPU time, draw calls and triangles. `game.performance` exposes these values and first-frame submission time. Physics time includes fixed system updates and Rapier stepping. Neither CPU time nor frame interval is isolated GPU time. `Game` now smooths frame duration before computing fps, avoiding the previous bias from averaging reciprocal frame times.

## Performance cascade

`QualityGovernor` (pure, no DOM) sheds cost in small rungs inside a level before giving up the level, and climbs back when there is sustained headroom. `QualityController` feeds it every rendered frame interval and applies its choice. Tests: `tests/core/quality-cascade.test.ts`, driven by synthetic frame traces.

| Level | Rung 0 (fixed budget) | Then, in order |
| --- | --- | --- |
| Desktop | pixel ratio 1.5, shading 3, particles 2400, shadows 1 | ratio 1.25, ratio 1, shading 2, particles 1200, shadows 0, drop to mobile |
| Mobile | ratio 1, shading 2, particles 960, shadows 0 | ratio 0.85, shading 1, particles 480, drop to safe |
| Safe | ratio 1, shading 0, particles 240, shadows 0 | ratio 0.85, particles 120, ratio 0.7 |

Pixel ratios are capped by the display, and rungs that change nothing on this display are dropped (a ratio 1 monitor has no 1.25 rung). The cascade is monotone: each level's bottom is nowhere richer than the next level's top, except safe's fixed ratio of 1; a drop maps to the first rung that is nowhere richer than the current one, so mobile at 0.85 drops to safe at 0.85. Shading caps are desktop 3, mobile 2, safe 0. Safe is the crash and low-memory level, so it compiles no extra material variants.

| Rung kind | Slow evidence to shed | Headroom to climb (before backoff) |
| --- | ---: | ---: |
| Resolution | 2 s | 10 s |
| Particles | 4 s | 20 s |
| Vehicle shading | 5 s | 30 s |
| Shadows | 6 s | 45 s |
| Whole level | 8 s | 60 s |

Frames go into one-second windows. A window is slow when its 90th percentile frame is 25 percent over target, and has headroom when its 95th percentile is within 10 percent of target (15 percent under target when the display is faster than the target, since only then can headroom be seen). Evidence must be consecutive. Hidden tabs and frames that are not finite, not positive or above one second clear the evidence. Nothing is decided in the first five seconds, and two seconds after any change are ignored so resize or compile hitches are not evidence.

Target rate is 60 fps on desktop and 30 on mobile and safe, never faster than the display. While the game loads, the controller probes idle animation frames to find the display interval, so a browser capped at 30 fps from the start (Low Power Mode) gets a 30 fps target. Game frames only ever reveal displays of 60 Hz or faster, so a desktop that is GPU bound at 45 fps from its first frame still sheds. A cap that starts mid-session looks the same as a slow GPU and is treated as one: desktop sheds to mobile, which targets 30.

A climb that has to be undone within 30 seconds doubles that rung's climb wait, up to 32 times its base and at most ten minutes. A climb that holds for 30 seconds halves it again. A scene that hovers on the threshold makes 9 changes in five simulated minutes, with climb waits of 10, 20, 40, 80 and 160 seconds.

### Manual and automatic

- A hand-set `gfx.level` pins that level for the session (`syn3h.graphics.manual` in session storage). The ladder restarts at its top. The governor may still shed rungs inside it but never changes the level.
- A hand-set `gfx.vehicleShading` pins shading at that value, even above the level cap. Shading rungs are skipped. The other rungs keep working.
- `gfx.auto` (default on) off returns to the current level's fixed budget, rung 0, and makes no automatic changes. Only the load crash fallback still lowers the level. Switching it on clears both pins.
- Automatic climbs never exceed the detected device level or the crash fallback level. An automatic drop is still saved as the next load's start level, but it does not cap later climbs.
- The controller writes `gfx.shadowQuality`, `lava.particleBudget` and `gfx.vehicleShading` only when their effective value or the level changes, and its own writes are not mistaken for the player's.

### What each rung buys on this machine

`node tests/core/quality-cascade-browser.mjs` renders the live autoplay scene in headless Chrome (WebGPU, 1280 by 720, device scale 2) with the animation loop stopped and waits for the GPU queue after each frame, so it reads submit plus GPU time. Medians of 40 frames, three passes, on a shared, loaded Mac (14 November 2026):

| Case | Pass 1 | Pass 2 | Pass 3 |
| --- | ---: | ---: | ---: |
| Ratio 1.5 | 5.2 ms | 5.1 | 5.1 |
| Ratio 1.25 | 5.3 | 4.9 | 3.9 |
| Ratio 1 | 5.9 | 4.3 | 3.4 |
| Ratio 0.85 | 4.3 | 3.2 | 3.1 |
| Ratio 0.7 | 3.2 | 3.3 | 2.8 |
| Ratio 1, shadows 1 | 4.9 | 5.0 | 3.1 |
| Ratio 1, shadows 0 | 5.6 | 3.7 | 3.4 |

The only reading above the noise is the full range: going from ratio 1.5 to 0.7 takes about 2 ms off a 5 ms frame. The intermediate steps differ by less than the spread between passes, and the first pass is still warming. Shadows 1 against 0 shows no difference beyond noise. Vehicle shading tiers had no consumer on this branch and were not measured. Particle budgets were not measured. These are an Apple GPU's numbers on a light scene. The ladder order rests on how cost scales (pixel count, compile hitches) rather than on these readings, and phone timing still needs a real device.

## Load experiment

Measured with system headless Chrome on this Mac, production `vite preview` on port 5186, 960 by 540 viewport, three fresh browser contexts per run. These timings do not represent a phone or a throttled mobile network. The benchmark observes the first public renderer frame on requestAnimationFrame, rather than treating DOM load as a rendered game.

The current camera/terrain baseline was 5427.85 kB JavaScript, 1966.96 kB gzip, with a median observed first frame of 451.7 ms. Adding quality controls without chunk changes measured 468.6 ms. Separating Three and Rapier and using Vite's generated modulepreload tags measured 597.6 ms, with raw chunks of 258.50, 840.93 and 4332.85 kB. The split experiment was reverted because it demonstrated no loading gain. Its total gzip size was effectively unchanged.

Rapier's compat package is statically used by terrain, vehicles and other systems and embeds its WASM as base64. A dynamic import in Game alone would not defer these static imports. Deferring all physics would postpone the first playable frame and require changes outside this task's ownership. No dependency replacement, speculative preload or loading-speed claim was added. The final Vite configuration is unchanged.

Run `node tests/core/load-benchmark.mjs http://localhost:5186/ /tmp/load.json` against a production preview. Run `node tests/core/quality-browser.mjs` for device emulation, crash recovery, fallback rendering and F3 checks. Actual iPhone Safari memory pressure and sustained thermal behavior still need device validation.

Final retained build: 5432.81 kB JavaScript, 1969.06 kB gzip. Its three observed first-frame times were 595.1, 458.1 and 490.4 ms, median 490.4 ms. This does not demonstrate a speed improvement over the 451.7 ms baseline. Results are retained in `/tmp/syn3h-load-current-before.json`, `/tmp/syn3h-load-quality-unsplit.json`, `/tmp/syn3h-load-split.json` and `/tmp/syn3h-load-final.json`.

Final validation passed TypeScript, the production build and all 105 tests. Browser checks passed desktop WebGPU, low-memory phone emulation and forced WebGL, including interrupted-load recovery, bot caps, loading events and F3. Inspected screenshots are `/tmp/syn3h-quality-mobile.png` and `/tmp/syn3h-quality-fallback.png`.
