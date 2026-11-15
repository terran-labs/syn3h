# Frame profiling method and audit

Use `node tools/frame-profile.mjs [URL] [output JSON] [headed|headless] [all|probe]`. The coordinator explicitly approved paired measurements under current load after the headed/headless difference emerged. Load is recorded per case. Optional `PROFILER_WAIT_QUIET=1` retains a quiet-host gate and runs the existing terrain tests unchanged. Each case gets a fresh context, fixed graphics level 2 and pixel ratio 1, 2.5 seconds of warmup and five seconds of samples. Cases change one setting from that baseline. Moving, night and bot cases are distinct workloads; compare their matching controls rather than adding their costs together.

The tool records CPU render submission, GPU timestamp query duration, frame interval, physics time, draw calls, triangles, substep count, pipeline creation and per-system CPU time. CPU system means matter because many individual calls are below browser timer resolution. GPU timestamps resolve asynchronously and can lag by a frame. A fresh context avoids leaked toggles and resources between cases. These are browser measurements on an Apple M2 Max, not measurements of a mid-range laptop or physical phone.

The original non-island harness probes were preliminary. Final paired measurements use the merged island build; they are not quiet-machine or physical-phone results. The hardware probe uses both WebGPU adapter info and Chrome SystemInfo: headed Chrome reports Apple/metal-3, fallback false, and ANGLE Metal Renderer Apple M2 Max.

## Code audit

- `src/core/Game.ts`: a frame executes at most five fixed steps. After hitting that limit it drops the remaining accumulator. This explains lost simulation time during delayed headless frames; it never runs more than five steps.
- `src/world/Environment.ts`: shadow levels use 2x1024, 3x2048 and 4x2048 cascades, reaching 1000 metres. The renderer draws shadow maps each frame. Cascade frustums are recalculated only when camera aspect or FOV changes; speed-dependent FOV can therefore recalculate them while driving.
- `src/world/sky/SkyEnvironmentMap.ts`: captures a sky-only, 64-pixel PMREM. It refreshes after relevant parameter changes or 0.1 game-hour movement, with a 0.5-second debounce. A stopped day clock should not recapture every frame. Cloud animation itself does not invalidate it.
- `src/world/sky/AlienSkyMesh.ts`: cloud coverage zero takes a shader branch that skips cloud noise. Sky, sun and weather sliders update uniforms; shadow quality rebuilds the light. Pipeline counters in the profiling trace distinguish steady-state work from compilation.
- `src/ui/Minimap.ts`: heightfield rasterization happens once per terrain revision. Marker drawing runs at 10 Hz on a 160-pixel canvas. Marker lists and coordinates allocate small arrays; the terrain is not regenerated or resampled per frame.
- `src/ui/Shell.ts`: hidden lobby skips its form queries and updates. Visible lobby queries controls and writes their values every frame. The bridge creates a map-self record and audio-motion record each frame.
- `src/main.ts`: the fallback HUD constructs and assigns its full text every frame, even when the text is unchanged.
- `src/net/NameTags.ts`: builds a Set and writes CSS display, color, opacity and transform each update. Text already avoids unchanged assignments. The eight-tag experiment uses synthetic labels at fixed positions to isolate label cost from eight extra physical vehicles.
- `src/vehicles/effects/index.ts`: clones a quaternion each vehicle update and allocates vectors/colors during emission and trails. Its six batches keep draw counts bounded, but expired slots remain drawn. Headlights are local-only, non-shadow-casting spotlights. The profiler measures idle effects and moving effects separately.

The DOM-off case hides DOM but retains game/UI update calls, so it isolates visible DOM/compositing cost rather than claiming all UI CPU work disappears. Sky-off hides the sky mesh but keeps lighting and fog. Hill cases switch the real mode to King of the Hill and place the player on the summit rim; the marker-off control keeps that same view. These scopes must accompany the per-case numbers.

## Island measurements before budget changes

Source build `57ddb54`, headed Chrome, Apple M2 Max hardware WebGPU. Fifty-nine cases completed without page errors. Host one-minute load ranged from 6.33 to 11.55. Measurements are milliseconds; CPU is median render submission, GPU is median timestamp duration. Small differences are noisy under shared host load. Dynamic bot and moving cases change the view, so their GPU differences are not isolated marginal costs.

| Case | 720p GPU | 720p CPU | 1080p GPU | 1080p CPU |
| --- | ---: | ---: | ---: | ---: |
| baseline | 3.56 | 1.40 | 6.23 | 1.70 |
| shadow0 | 2.82 | 0.80 | 5.39 | 0.90 |
| shadow1 | 3.02 | 1.30 | 5.76 | 1.20 |
| shadow3 | 3.44 | 1.80 | 6.32 | 1.90 |
| terrainLow | 3.29 | 1.50 | 5.82 | 1.40 |
| terrainMedium | 3.39 | 1.50 | 6.01 | 1.60 |
| skyOff | 3.07 | 1.40 | 5.60 | 1.20 |
| cloudZero | 3.18 | 1.50 | 5.56 | 1.70 |
| effectsOff | 2.86 | 1.20 | 5.08 | 1.50 |
| moving | 3.06 | 1.70 | 5.37 | 1.60 |
| movingEffectsOff | 2.78 | 1.60 | 5.04 | 1.30 |
| night | 3.47 | 1.40 | 6.00 | 1.50 |
| nightHeadlightOff | 3.37 | 1.50 | 6.07 | 1.50 |
| bots4 | 3.47 | 3.40 | 6.08 | 3.40 |
| bots8 | 3.57 | 5.50 | 5.82 | 5.40 |
| koth | 3.31 | 1.70 | 6.24 | 1.30 |
| koth4 | 3.01 | 3.20 | 5.25 | 3.30 |
| koth8 | 3.10 | 4.80 | 5.26 | 5.20 |
| kothMarkerOff | 3.11 | 1.30 | 5.41 | 1.90 |
| minimapOff | 3.38 | 1.50 | 6.06 | 1.30 |
| tags8 | 3.28 | 1.30 | 6.24 | 1.30 |
| domOff | 3.42 | 1.60 | 6.37 | 1.20 |
| lobby | 3.05 | 1.30 | 6.71 | 1.30 |
| pixel075 | 2.51 | 1.30 | 4.10 | 1.10 |
| pixel15 | 6.29 | 1.50 | 8.76 | 1.20 |
| pixel2 | 7.68 | 1.50 | 9.35 | 1.30 |
| uniformSweep | 2.45 | 1.20 | 5.71 | 1.20 |
| baselineEnd | 3.35 | 1.30 | 6.28 | 1.20 |

The baseline and all bot-count cases had median frame intervals around 8.3 ms. This is animation-frame cadence, not a guarantee that every frame was presented. Physics averaged 0.072 ms without bots and 0.213 ms with eight at 720p; draw calls increased from 163 to 902. Headed runs never exceeded 3 physics substeps.

At 390 x 844 CSS pixels with emulated DPR 3, old levels 0/1/2 capped drawing DPR at 1/1.25/2 and measured GPU times of 1.11/2.23/5.47 ms on the same Mac. These are resolution-budget measurements, not phone GPU measurements.

Steady cases created zero render pipelines and made zero additional environment captures. Continuously sweeping cloud coverage produced ten environment captures over five seconds and still zero pipeline creations. The 720p visible lobby averaged 0.080 ms of Shell update CPU; eight synthetic name tags raised NetClient update from about 0.011 to 0.021 ms. The minimap contributed roughly 0.004 ms averaged over frames; fallback HUD updates were roughly 0.004 ms. Timer resolution and workload variation limit those small differences. No heavy per-frame UI or environment task appeared.

Unchanged island terrain tests passed under recorded load 7.70: 513 x 513 best 110.1 ms, median 115.3 ms over twelve runs; 1025 x 1025 best 423.2 ms, median 440.7 ms over two. No timing threshold or test was changed.

## Applied budgets and verification

| Level | DPR cap | Shadows | Bot cap | Particles |
| --- | ---: | ---: | ---: | ---: |
| Safe | 1 | 0 | 2 | 240 |
| Mobile | 1 | 0 | 4 | 960 |
| Desktop | 1.5 | 1 | 8 | 2400 |

Desktop steps down after sustained frame rates below 54 fps; mobile retains the 28 fps threshold. Warmup, eight-second sustained-pressure requirement and fifteen-second cooldown remain unchanged. These are conservative candidates for 60 fps laptop and 30 fps phone targets; physical target hardware is not available to certify those rates.

| Verification | Drawing buffer | Bots | GPU ms | CPU render ms | Median frame ms |
| --- | --- | ---: | ---: | ---: | ---: |
| qualityDesktop8 | 2880 x 1620 | 8 | 7.84 | 4.20 | 8.30 |
| qualityMobile4 | 390 x 844 | 4 | 1.21 | 0.70 | 8.30 |
| qualitySafe2 | 390 x 844 | 2 | 0.95 | 0.80 | 8.30 |

A final current-island comparison after changing defaults recorded headed/headless median frame intervals 8.40/28.10 ms, GPU durations 3.05/3.06 ms and CPU render submissions 2.40/2.20 ms. Headed p95 rose to 31.80 ms under host contention, so median cadence alone must not be sold as stable presentation at 120 fps. Both modes used hardware WebGPU, identical 140 draws and 228,440 triangles, and had zero console/page errors. This repeat still locates most of the headless delay outside measured rendering and physics; the exact browser pacing mechanism is not established.

## Requests to the other builders

1. `src/vehicles/skins/LoadedBuggySkin.ts`, keyed by existing `gfx.level`: add a lower-draw-count bot/remote skin at levels 0 and 1, or merge static opaque parts that share a material within the same animated transform. At level 2, eight bots raised scene submissions from 163 to 902 and CPU render time from 1.4 to 5.5 ms at 720p. Preserve the local player model. This is the clearest remaining performance opportunity.
2. `src/world/Environment.ts`, existing `gfx.shadowQuality`: retain the quality controller's new 0/0/1 defaults and allow explicit user overrides to 2/3. Avoid resetting shadows to 2 elsewhere. No extra shadow-distance parameter is needed for tomorrow unless the lower-count vehicle skin cannot land.
3. `src/main.ts` HUD and `src/ui/Shell.ts` lobby: optional low-priority cleanup is to avoid unchanged text/attribute writes or update HUD text at 10 Hz. No new parameter is warranted by the measured cost. Do not remove the minimap or name tags for performance; their measured CPU cost is small.
4. `src/vehicles/effects/index.ts`: pool the per-update quaternion and emission temporaries when doing routine maintenance. Existing `gfx.level` budgets already bound batches. The measured effects CPU cost does not justify removing them for this demo.

Artifacts: `/tmp/syn3h-island-frame-profile.json` (full matrix), `/tmp/syn3h-quality-profile-after.json` (new budgets), `/tmp/syn3h-island-headed-final.json` and `/tmp/syn3h-island-headless-final.json` (final paired modes), `/tmp/syn3h-terrain-profile.log` (unchanged tests), and `/tmp/syn3h-profile-1280.png` and `/tmp/syn3h-profile-1920.png` (headed views).

Validation after applying budgets: `npx tsc --noEmit` passed; `SYN3H_NO_ROOM_SERVER=1 npx vitest run --maxWorkers=2` passed all 219 tests across 33 files. The browser verification recorded the expected drawing buffer sizes and bot caps.

## Round planet against the same world drawn flat, 14 November, 8:55pm PST

Finding: the round planet costs nothing measurable and submits fewer draws. Every case held
the display's 8.3 ms frame, round or flat.

Source `e5f7323` plus the `round` mode added to `tools/frame-profile.mjs`. Headed Chrome on
the Apple GPU, 1920 x 1080, pixel ratio 1, graphics level 2, default volcanic world (2 km
tile, planet radius 326 m), buggy at the spawn pad. Each case is a fresh page, 5 seconds of
samples. Host load average was 8 to 9 throughout, so read the pairs, not the absolutes: the
first pair is repeated at the end and the flat GPU reading moved from 5.6 to 4.8 ms between
them, which is the size of the noise.

| Case | Draw calls | Triangles | Render CPU ms | GPU ms | Frame ms (median, p95) |
|---|---:|---:|---:|---:|---|
| Round, parked | 89 | 123,848 | 1.1 | 5.7 | 8.3, 9.7 |
| Flat, parked | 164 | 195,844 | 1.7 | 5.6 | 8.3, 10.0 |
| Round, driving | 91 | 131,238 | 1.2 | 5.4 | 8.3, 10.0 |
| Flat, driving | 163 | 200,240 | 1.7 | 5.6 | 8.3, 10.0 |
| Round, 8 bots | 385 | 570,496 | 3.3 | 5.4 | 8.3, 10.0 |
| Flat, 8 bots | 365 | 519,623 | 3.8 | 6.4 | 8.3, 10.0 |
| Round, parked (repeat) | 89 | 123,848 | 1.2 | 5.3 | 8.3, 10.1 |
| Flat, parked (repeat) | 164 | 195,844 | 1.4 | 4.8 | 8.3, 10.0 |

- Horizon culling removes about 45 percent of the draw calls and 35 percent of the
  triangles from the driver's seat, and a third of the render CPU time. GPU time does not
  change beyond noise: the culled ground was cheap to shade.
- With eight bots the round world draws slightly more than the flat one (385 against 365).
  The bots spawn around the player, none is over the horizon, and three's own frustum
  culling is off on round worlds, so bots behind the camera are submitted. Eight bots are
  still the largest adjustable cost, as before: about 37 draw calls each, and 2 ms of render CPU
  time for all eight. A behind-the-camera test for vehicles would recover that on round worlds.
- The curve follows the camera exactly: `tools/curve-lag-check.mjs` carries the jet at
  60 m/s and finds the curve's centre under the camera on all 240 frames sampled.
- Not measured: a phone, mobile pixel ratios on the round world, or a quiet machine.
