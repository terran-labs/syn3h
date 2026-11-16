# Proposed Post consumer, after Weather parity

Source plan only. The rejected runtime commit `b7ccc9b0` stays excluded. Start future
implementation from the accepted source plus Weather's accepted extraction, not this
experimental branch. Weather owns Sky/Environment extraction after Orchestrator plan
confirmation. Post later owns `PostChain.ts`, `clouds.ts` and focused tests. No runtime
consumer edits, jobs or additional workers are authorized by this document.

## Prerequisite

Weather must show unchanged visible sky and PMREM with shafts off, including post off,
underwater camera handling and reflection failure restoration. Its shared builders must
instantiate temporaries per graph and retain stable live uniforms. Post does not alter
fallback coverage to hide clouds, PMREM capture state, or the shared material proxy.

The reviewed Weather plan is `/Users/vtn/dev/Syn3h-wt/weather-sunrise-phase1/tools/weather-sunrise-phase1-handoff.md`.
Its readonly Node<'vec3'> callback and Node<'vec3'>/Node<'float'> return contract are
accepted by Post as a source-plan direction, subject to Orchestrator confirmation and parity.

## Source and exposure accounting

`shaftSource(viewDirectionWS)` builds a TSL graph. It is not a per-frame JavaScript sampler.
Scattering means exactly `max(Lin * SKY_SCALE, 0)` before cloud composition, solar disc,
L0, floor, night/twilight/stars/moon, underwater tint and exposure. Units are authored
scene-linear HDR, not calibrated physical radiance. Do not substitute Environment.sunColor,
which can represent moonlight. Any later twilight contribution needs a separately named
contract and review.

For exposure E, source S, cloud transmission T, terrain visibility V and footprint W:

```
exposedSource = huePreservingCap(E * S)
maskRGB = exposedSource * T * V * W
rayExposed = radialIntegral(maskRGB)
sceneHDR += shaftStrength * rayExposed / E
output = renderOutput(sceneHDR)
```

Multiply by exposure once and divide once. The cap operates in exposed HDR; it does not
turn these values into display colors. No post-tone-map color blend or whole-frame
darkening from the rejected wedge experiment carries forward. Preserve channel ratios
when capping, then validate zero/near-zero source and extreme exposure for finite output.

## Scene-world rays

At the existing top-left mask UV, reconstruct the view position with the scene depth and
`u.projInv`, normalize it, transform with `u.camWorld * vec4(direction, 0)`, then normalize
again. Use the scene camera matrices, not the fullscreen quad camera. The result is a
camera-to-scene world direction with +Y up, matching the rendered sky's sun basis.
Do not invert planet curvature. Verify near-horizon and far-depth directions on both
backends and reject nonfinite results before interpreting captures.

## High and Ultra

High uses Weather's exact fallback opacity expression, including direction gates,
cloud coordinates, drift, time, coverage, density and horizon fade. The callback does not
depend on cloudLayerVisible: render visibility policy stays separate from weather opacity.
`T = clamp(1 - alpha, 0, 1)` is an opacity-derived proxy. It is not an exact decomposition
of the visible sky: that shader's background coefficient includes RGB extinction, and
cloud color itself includes scattering. Label this limitation in acceptance evidence.
Build the fallback expression only on the fallback path. Evaluate it once per existing
quarter-resolution mask pixel, never inside every radial tap. No new target or pass.

Ultra retains the same `cloudVolume` RTT node used by cloud composition. Do not call
`cloudVolume` twice. Extract the current four half-resolution depth-aware reconstruction
samples into one shared graph builder in `clouds.ts`. Both consumers use the same taps,
weights, denominator guard and camera-specific underwater visibility:

```
filteredRGBA = sharedDepthAwareFourTap(volume, sceneDepth, sceneProjInv, uv)
visibleRGBA = filteredRGBA * underwaterVisibility
cloudComposite = sceneRGB * (1 - visibleRGBA.a) + visibleRGBA.rgb
shaftTransmission = 1 - clamp(visibleRGBA.a, 0, 1)
```

Apply the underwater fade once to premultiplied RGB and alpha. Raw volume alpha is not
enough near silhouettes. The two consumers can perform separate reconstruction arithmetic,
but must share the one RTT update and march. Measure those extra four samples in the
quarter-resolution mask. Avoid multiplying a second cloud opacity or fade into T.

## Flare dependency

The current flare samples the same mask at five locations around the sun. Changing that
mask changes flare color and occlusion even with shaft strength zero. First diagnose
shafts with flare off, then test flare-only and combined modes, sun hidden by terrain,
and clear sun. Keep the mask built when flare needs it. Removing solar-disc radiance from
the source may change flare energy; do not compensate with a new hidden gain or broadened
footprint without the paired evidence and review. High normally has flare off; Ultra does not.

## Normalization, staged after source isolation

First change only the source contract. Keep accepted defaults, footprint, tap count,
denominator and HDR composition. That isolates what the source actually fixes.

If dilution remains, the next separately reviewed experiment can accumulate source
footprint weights independently of occlusion: numerator includes T and V; denominator
includes W but never T or V. Never divide by lit taps, which erases shadowing. Bound
small-support gain and fade unsupported paths rather than amplifying tiny noise values.
Use the same geometric footprint in both terms. Preserve a dedicated flare interpretation
if mask alpha is repurposed. Record raw numerator, support and normalized values before
tuning strength. No broad tint overlay, invented rays or global display attenuation.

## Actual warmup and pipeline checks

`PlayerVehicleWarm` draws real cached instances through the normal scene/post path and
counts actual rendered frames. `warmGear` also uses real draws and responds to graphics
changes. Neither proves that every new Post topology is warmed. The chain can rebuild on
quality/effect membership, cloudsOn, temporal and debug changes; zero crossings remain
an explicit limitation until measured and addressed by their owners.

For the selected startup variant, render actual scene/post frames with the new mask and
rays reachable and a front-facing sun before declaring it warm. Count actual mask/ray
updates and backend pipeline creation; a compileAsync call against the root scene alone
does not establish this. Check subsequent dawn/dusk, positive strength changes and clock
motion for zero new pipelines/builds. Do not claim all six levels are prewarmed by the
existing vehicle warmup. Any production startup scheduling change needs core-owner approval.

## Smallest first visual experiment

After Weather parity and explicit Post START, use one accepted-source Volcanic High dawn
fixture at five degrees. Freeze camera, LOD, clock, weather drift, resolution and exposure;
disable the governor and flare. Begin cloud-free with all fog contributions zero. Record
source S, transmission T, mask, rays, separate open-sky/geometry linear pre-tone values,
and final output, comparing accepted source against extraction plus source-only consumer.
Use the exact rim fixture from the diagnostic handoff and a separately recorded flank
matrix or sun azimuth when a visible gap is needed. Keep parameter values identical.

Then restore uniform fog alone, height haze alone, aerial layer alone and the original
combined atmosphere, comparing each on/off pair without changing exposure. Aerial-off
changes extinction and glow together, so it cannot by itself prove which caused washout.
Sky material has fog disabled: geometry fog cannot directly wash open-sky pixels. If a
separate glow isolation is required, propose it to Weather rather than editing its files.

Send this first experiment for review before normalization/default tuning or wider scene
work. If it cannot produce useful contrast, keep the failure visible and revise the
source/atmosphere model rather than repeating display-space masking.

## Later acceptance, still pending

Run matched dusk, running-clock sunrise and midday; High/Ultra on Volcanic, Alpine and
archipelago on both backends; terrain and cloud gaps; flare/history; near vehicles;
underwater and lava; flat/curved/wrapped worlds. Require finite source at horizon and zero
parameters, no disc dependence or lunar substitution, High alpha parity, Ultra filtered
fade parity, no double attenuation, one cloud RTT update, stable positive-slider graphs,
and clean page/GPU warnings. HUD remains outside the post pipeline, but vehicle and camera
motion need actual visual checks.

Use alternating warmed control/candidate timings with variance and GPU timestamps where
available. Report selected resolution, level and machine conditions. Count added mask
arithmetic, four-tap reconstruction and pipeline changes; no measured saving or acceptable
frame cost is claimed yet. Further changes to quality budgets or startup scheduling are
proposals to their owners, not part of Post implementation permission.
