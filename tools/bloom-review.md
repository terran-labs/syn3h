# Desktop bloom review

Bots, Performance and QA lane, branch `feat/fx-bloom`, Saturday 14 November 2026.

## Finding

**Bloom is in and off by default. At strength 0 the frame takes exactly the old path.**
When switched on, it works on WebGPU and WebGL 2 in Chrome and in WebKit 2388, at day and
at night, on the round planet. On this M2 Max it costs about 0.3 to 0.9 ms a frame at
1920 x 1080. It switches itself off and frees its targets when the governor drops below
graphics level 2, and it comes back when the level returns.

## Exactly what happens at strength 0

`Game.frame` calls `draw()`. The first test in `draw()` is `bloomStrength.value > 0`. At 0,
`draw()` calls `renderer.render(scene, camera)` and returns. No `Bloom` object exists,
because it is created on first use. That means no `RenderPipeline`, no pass node and no
render targets. The browser check confirms it in all eight off cases: `game.bloom` is null
and the renderer reports 15 textures, as before. The only work added at strength 0 is that
one comparison and the module import. The import builds one empty `QuadMesh` and two
vectors in three's `BloomNode.js`; none of them touch the GPU.

The first render call is still timed: `recordStartupFrame` brackets `draw()`. The
device-loss notice and the bounded startup were checked with bloom on
(`tools/startup-fallback-check.mjs` against `?bloom=0.5`, all five cases in both browsers).

## When it is on

`bloomActive` in `src/core/renderOptions.ts` requires all of these:

- strength above 0;
- graphics level 2;
- a device that `quality.ts` classified as level 2, which is desktop class. Phones and
  tablets classify at 1 or lower, so bloom cannot run on them even with `?gfx=2`;
- a backend marked as verified in `BLOOM_BACKENDS`. Both WebGPU and WebGL 2 are enabled,
  because both passed in both browsers with no errors or artifacts in the screenshots.

`?bloom=0.5` sets the strength for one page load (clamped to 0..1). The parameters are in
the Graphics group, client scope, so they are never shared with the room:

| Parameter | Default | Range | Meaning |
|---|---:|---|---|
| `gfx.bloom` | 0 | 0 to 1 | strength; 0 is off |
| `gfx.bloomThreshold` | 3 | 0 to 6 | on-screen brightness (after exposure) where glow starts |
| `gfx.bloomRadius` | 0.4 | 0 to 1 | how far the glow spreads |

## How it is built, and the two traps it avoids

The scene renders into a pass target with the canvas's own MSAA sample count. three's
`BloomNode` (r187: a high pass, five mips of separable blur, then a composite) blurs what is
bright. A `RenderPipeline` adds the blur back and applies the renderer's tone mapping and
output colour space, as `renderer.render` does. All of it is in `src/core/bloom.ts`.

1. **Night exposure.** The sky's auto exposure raises `toneMappingExposure` about seven times
   at night (0.32 by day, 2.29 at night here). The threshold and the strength therefore
   work on the exposed colour, and the blur is divided by the exposure before it is added
   back. A glow then blooms the same for the same on-screen brightness by day and by night.
   Measured: the share of nearly white pixels is identical with bloom off and on, at day
   and at night, in every browser and backend (0.077 to 0.081 percent). Bloom does not
   bring back the night bleaching that `hotExposureDim` fixed.
2. **Hot pixels.** The first version filled the night screen with a white blot from a few
   headlight and beam pixels: even at threshold 4, a handful of values hundreds of times
   too bright (or past the half float range) blurred over everything. The blur's input is
   now clamped at twice the threshold. Those pixels are white after tone mapping either way.

The day sky was the other lesson. At threshold 1 or 2, the bright haze round the sun bloomed
into a milky veil over the whole frame. At threshold 3 the day sky is clean and the glows
still bloom.

## Measured cost

Headed Chrome, WebGPU, Apple M2 Max, graphics level 2, pixel ratio 1, quality governor held
still, 2.5 s warm-up, 5 s of samples. The cases ran back to back as off, default, max, max,
default, off. Default is strength 0.5, threshold 3, radius 0.4; max is strength 1, radius 1.
`tools/bloom-profile.mjs`.

Uncapped (`BLOOM_UNCAPPED=1`: vsync and the frame limit off, so frame time shows the cost):

| Size | Case | Load | Frame ms (median) | p95 ms | Render CPU ms | Draws |
|---|---|---:|---:|---:|---:|---:|
| 1920x1080 | off | 9.7 | 1.10 | 6.7 | 0.70 | 89 |
| 1920x1080 | default | 12.3 | 1.90 | 14.2 | 1.00 | 101 |
| 1920x1080 | max | 13.3 | 2.00 | 11.5 | 1.30 | 101 |
| 1920x1080 | max | 14.3 | 1.40 | 9.0 | 0.90 | 101 |
| 1920x1080 | default | 13.9 | 1.40 | 7.8 | 0.90 | 101 |
| 1920x1080 | off | 14.0 | 1.00 | 5.5 | 0.60 | 89 |
| 1280x720 | off | 14.3 | 0.90 | 3.3 | 0.60 | 89 |
| 1280x720 | default | 13.8 | 1.20 | 4.8 | 0.80 | 101 |
| 1280x720 | max | 14.3 | 1.30 | 9.0 | 0.90 | 101 |
| 1280x720 | max | 16.3 | 1.40 | 11.2 | 0.90 | 101 |
| 1280x720 | default | 15.3 | 1.50 | 9.1 | 1.00 | 101 |
| 1280x720 | off | 15.2 | 1.10 | 5.7 | 0.70 | 89 |

Capped at the display's 120 Hz, the frame time was 8.3 ms in every case, with bloom off or on
(load 7.8 to 9.5).

Reading it: bloom adds roughly 0.3 to 0.9 ms of frame time at 1080p and 0.2 to 0.4 ms at
720p, plus 0.2 to 0.3 ms of render CPU and 12 draw calls (the high pass, ten blur passes
and the composite). Strength and radius change the cost very little, because they only
change weights. The load average was 10 to 16, so treat the spread as noise and the
off-to-on difference as the result. The renderer's GPU timestamps
are **not** usable for this pipeline: they reported 20 to 35 ms on frames that arrived every
8.3 ms, so they are counting something other than one frame's GPU time. The table leaves
them out; the raw values are in `/tmp/bloom-profile*.json`.

Memory is an estimate from target sizes, not a measurement. At 1080p the pass target is
full size, half float, with 4x MSAA: about 80 MB with its resolve. The bloom chain is
about 11 MB at half resolution. On a desktop GPU that is affordable. It is also why
this must stay off phones.

## Recommended values

Strength **0.5**, threshold **3**, radius **0.4**. Thresholds 1 and 2 haze the day sky. At
0.5 the glows read clearly; above about 0.7, the night halo round the buggy's own lights
grows larger than the vehicle. This is a judgement from screenshots, and the owner should look
before it becomes a default. Default stays 0 tonight.

## Screenshots

Day and night, off and on, at the spawn view with the round planet (`world.curve` 1):
`/tmp/bloom-check/{chrome,webkit}-{webgpu,webgl}-{day,night}-{off,bloom0.5}.png`
(16 images, numbers in `/tmp/bloom-check/results.json`).

Threshold sweep at the volcano rim and the sun-facing spawn view, off and at strength 0.35:
`/tmp/bloom-sweep/{spawn,rim}-t{12,0}-th{0,2.5,3,4}.png` (th0 is off). The earlier blot
before the clamp is described above. Its images were overwritten by later sweeps.

## Tests

- `tests/core/bloom-gate.test.ts`: strength 0 and invalid strengths are off; levels 1 and 0
  are off; non-desktop devices are off even at level 2; a disallowed backend is off;
  parsing and clamping of `?bloom=`.
- `tools/bloom-check.mjs`, both browsers, both backends, day and night, off and on: 16 of 16
  pass. In every on case the governor-style drop to level 1 released the pipeline (textures
  26 to 15), the return to level 2 rebuilt it (one more build), strength 0 switched it off,
  and strength 0.5 switched it on again.
- Gate on the merged branch: typecheck clean, tests/core 66 passed, SMOKE OK with bloom off
  and with `?bloom=0.5`.

## Unverified

- Phones and tablets: out of scope, and bloom cannot run there by construction (device class).
  Nothing about bloom on a phone is claimed.
- Any GPU other than this M2 Max, including integrated Intel or AMD laptop graphics. The
  desktop class test does not separate a weak laptop from a strong desktop.
- A real governor drop under load. The check sets the level by hand, which is the same
  parameter the governor writes, but the governor itself was held still.
- Roundness 0.4, which trunk does not default to yet: checked only at 1.
- Lava, tag beams and the jet's glows were seen only incidentally (rim view, autopilot
  drives). There is no scripted view of each glow source.

## Lines wanted in files this lane does not own

None.
