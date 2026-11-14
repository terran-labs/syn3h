# Device quality and load measurements

`gfx.level` is a client parameter: 0 safe, 1 mobile, 2 desktop. The controller starts before physics initialization, renderer initialization and terrain construction. The current static module graph is still downloaded and parsed before `Game` constructs; this is not a tiny standalone bootloader.

| Budget | Safe | Mobile | Desktop |
| --- | ---: | ---: | ---: |
| Render pixel ratio cap | 1 | 1.25 | 2 |
| Existing sky shadow quality | 0 | 1 | 2 |
| Particle cap | 240 | 960 | 2400 |
| Local bot cap | 2 | 4 | 16 |
| Optional terrain distance | 700 m | 1400 m | 3000 m |
| Optional terrain detail scale | 0.5 | 0.75 | 1 |

Classification uses user agent, touch points (including iPad's desktop user agent), optional deviceMemory and WebGPU adapter availability/limits. Low-memory and software-adapter devices start safe. Phones with an adapter start mobile; phones without one start safe. Desktop WebGL fallback starts mobile. These are conservative heuristics, not measured memory guarantees.

The client particle cap applies even when an emitter module is imported after initialization. A 50-vent safe-mode scene allocates four particles per vent, 200 total. The manager limits actual bots without changing the shared `bots.count` parameter. Instantiate it only on the multiplayer host. Local caps do not remove remote players or change physics/terrain generation.

The controller offers `game.quality.attachTerrain(terrain)`. If terrain implements `setRenderQuality({level, drawDistance, detail})`, it receives the current budget and future changes. The currently merged terrain has internal distance-based LOD but no public setter; this hook is inactive until the terrain builder adds one. No terrain files were changed.

## Recovery, loading and diagnostics

Session storage records `syn3h.loading.level` when loading starts and clears it after a frame with draws. A surviving marker reduces the next attempt by one level, including repeated failures down to safe. A separate session value remembers a manually selected or automatically reduced level. Session storage avoids treating another tab's load as a crash; local storage is a fallback when session storage is unavailable. Storage denial does not prevent the game from starting.

After five seconds of warmup, four consecutive two-second windows below 28 fps reduce quality by one level. Hidden tabs, invalid samples and pauses above one second do not count. A 15-second cooldown prevents rapid repeated reductions. Quality does not automatically increase.

`window` emits `syn3h:loading` events with `{phase, progress, elapsedMs}`. Phases are device, physics, renderer, world and ready. Progress is an estimate, not download byte progress. Elapsed time is measured from navigation. `loadingProgress` exports the latest state for UI code that subscribes after initialization. `syn3h:quality` carries the selected level and budgets.

F3 toggles a small HUD with smoothed fps, frame interval, physics-step CPU time, draw calls and triangles. `game.performance` exposes these values and first-frame submission time. Physics time includes fixed system updates and Rapier stepping. Neither CPU time nor frame interval is isolated GPU time. `Game` now smooths frame duration before computing fps, avoiding the previous bias from averaging reciprocal frame times.

## Load experiment

Measured with system headless Chrome on this Mac, production `vite preview` on port 5186, 960 by 540 viewport, three fresh browser contexts per run. These timings do not represent a phone or a throttled mobile network. The benchmark observes the first public renderer frame on requestAnimationFrame, rather than treating DOM load as a rendered game.

The current camera/terrain baseline was 5427.85 kB JavaScript, 1966.96 kB gzip, with a median observed first frame of 451.7 ms. Adding quality controls without chunk changes measured 468.6 ms. Separating Three and Rapier and using Vite's generated modulepreload tags measured 597.6 ms, with raw chunks of 258.50, 840.93 and 4332.85 kB. The split experiment was reverted because it demonstrated no loading gain. Its total gzip size was effectively unchanged.

Rapier's compat package is statically used by terrain, vehicles and other systems and embeds its WASM as base64. A dynamic import in Game alone would not defer these static imports. Deferring all physics would postpone the first playable frame and require changes outside this task's ownership. No dependency replacement, speculative preload or loading-speed claim was added. The final Vite configuration is unchanged.

Run `node tests/core/load-benchmark.mjs http://localhost:5186/ /tmp/load.json` against a production preview. Run `node tests/core/quality-browser.mjs` for device emulation, crash recovery, fallback rendering and F3 checks. Actual iPhone Safari memory pressure and sustained thermal behavior still need device validation.

Final retained build: 5432.81 kB JavaScript, 1969.06 kB gzip. Its three observed first-frame times were 595.1, 458.1 and 490.4 ms, median 490.4 ms. This does not demonstrate a speed improvement over the 451.7 ms baseline. Results are retained in `/tmp/syn3h-load-current-before.json`, `/tmp/syn3h-load-quality-unsplit.json`, `/tmp/syn3h-load-split.json` and `/tmp/syn3h-load-final.json`.

Final validation passed TypeScript, the production build and all 105 tests. Browser checks passed desktop WebGPU, low-memory phone emulation and forced WebGL, including interrupted-load recovery, bot caps, loading events and F3. Inspected screenshots are `/tmp/syn3h-quality-mobile.png` and `/tmp/syn3h-quality-fallback.png`.
