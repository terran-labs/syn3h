# Sunrise phase 1 source plan

Status: Orchestrator approved bounded extraction. Source is implemented for review; typecheck, tests and GPU parity have not run. Post adoption remains blocked on parity. No builds, browser, server or workers have been started.

Baseline: 8034263e4e630b367159825cab6e6f0416eb9e65.
Worktree: /Users/vtn/dev/Syn3h-wt/weather-sunrise-phase1.
Branch: feat/weather-sunrise-phase1.
The existing weather worktree is preserved.

## Scope and ownership

Weather is the designated Sky/Environment owner for this bounded extraction only:
- src/world/sky/AlienSkyMesh.ts
- src/world/Environment.ts
- tests/sky/shaft-source.test.ts, proposed narrow contract tests

No fog, defaults, SkyEnvironmentMap, Post consumer or startup edits. This handoff document is explicitly requested by Foreman. Post adoption waits on extraction review and parity evidence.

## Exact structural contract

Use the installed Three r187 generic Node type, whose declaration and package src export were inspected:

```ts
import type Node from 'three/src/nodes/core/Node.js'

export interface ShaftSourceNodes {
  readonly scattering: Node<'vec3'>
  readonly transmission: Node<'float'>
}
export type ShaftSourceBuilder =
  (viewDirectionWS: Node<'vec3'>) => ShaftSourceNodes
```

Export these types from AlienSkyMesh.ts. Expose a readonly arrow-function property shaftSource: ShaftSourceBuilder on AlienSkyMesh, and readonly shaftSource: ShaftSourceBuilder on Environment. createEnvironment returns the existing sky.shaftSource function by reference, without rebinding or allocating each update. Post can add an optional structural property of this type to its own SunSource later; no runtime import of Post into Environment.

The callback builds nodes once per consuming graph. It is not a CPU color sample or per-frame callback. Its input must already be normalized, nonzero, camera-to-scene, scene-world direction, with +Y up and the same basis as sky.sunDirection. Do not normalize again in the existing sky path or alter its arithmetic. The Post owner reconstructs this ray from its scene-camera inverse projection and world matrix with a w=0 direction, not the fullscreen camera. No inverse planet bend is applied to a sky ray.

scattering is max(Lin * SKY_SCALE, vec3(0)), the authored solar atmospheric contribution before clouds. It excludes L0, SKY_FLOOR, the solar disc, night/twilight additions, stars, moon and underwater tint. It uses the same Lin computation and uniforms as the visible sky. The output is raw linear scene RGB, not exposed HDR, display RGB or calibrated physical units. Environment.sunColor is not its source because that value becomes moonlight at night.

Post alone applies exposure once before its current capped exposed-HDR mask and divides once when adding rays into raw HDR before renderOutput. This callback never reads exposure. Solar-disc visibility must not change either returned node's value.

transmission is clamp(1-alpha,0,1) from the High fallback cloud opacity formula. It is a scalar occlusion proxy, not an exact factorization of visible sky RGB: the current cloud blend has an RGB Fex factor and also emits scattering-derived cloud light. Preserve that distinction in JSDoc. Clear/no-cloud/below-horizon fallback returns 1.

## Extraction mechanics and parity

Extract private node builders within AlienSkyMesh.ts:
1. Atmospheric terms from explicit direction: Lin, L0, Fex and angular terms needed by the existing disc/cloud calculations.
2. Cloud density/opacity terms from explicit direction: existing UV, drift, four-octave noise, region threshold, depth, horizon fade, cloudMask and alpha.

The visible sky calls these builders in the same existing Fn and cloud If scope. Preserve operation ordering, constants, branch conditions, mixes, clamp positions and the existing final clamp/underwater mix. In particular do not replace the visible sky formula with the callback's narrower scattering definition.

The callback constructs separate Fn-local graphs for scattering and proxy transmission. All mutable toVar temporaries belong to that consuming graph; never cache or return the existing sky color Fn's locals. The alpha graph uses the same direction.y > 0 and coverage > 0 guards, but does not depend on cloudLayerVisible. That property controls camera versus reflection rendering, not the weather field.

Keep sky uniform objects persistent and shared by reference. Do not snapshot their numeric values in a closure at graph construction. Preserve existing sky/PMREM uniform behavior rather than broadly changing update groups during extraction. Cross-material live upload correctness is an explicit later GPU check; if it requires render-group adapters, report that need before broadening the change.

At Ultra, Post replaces proxy transmission with opacity from its existing cloud volume RTT. It must not combine both models. Separate scattering and transmission Fn graphs allow Post to consume only scattering without connecting fallback-noise arithmetic to the Ultra shader. Post owns matching the existing four-tap depth-aware cloud reconstruction and underwater visibility. No new volume call or RTT belongs in this phase.

The PMREM proxy continues sharing the same material. Its try/finally fallback visibility override and camera-specific underwater behavior remain untouched.

## Actual startup mechanism and gap

At this baseline, main.ts installs PostChain before game.start(). Game.ts draws the active world during its first three startup frames even behind the covered lobby, and draws while quality is loading. recordStartupFrame records render-call/pipeline timings and first GPU completion; it does not precompile all variants.

Vehicle showroom and gear use dedicated proxy warming; materialization separately calls compileAsync. These mechanisms do not establish Post shader warming. Post builds its active topology lazily in render and can skip shaft target updates while the sun is hidden.

There is no discovered explicit prewarm of all High/Ultra shaft variants. Adding the callback alone does not warm its unused consumer graph. Later Post/startup ownership must ensure the selected mask, rays and cloud variant actually draw under loading before promising hitch-free play. That wiring is outside this phase. Source claims here are based on inspected baseline startup and Post code, not runtime measurement.

## Minimal acceptance before Post adoption

These checks are proposed, not run. UX retains the validation slot.

1. Static review: diff is restricted to ownership; no default, cloud visibility, PMREM, disc, underwater or fog behavior changes. Existing sky arithmetic and branch order remain intact.
2. Cleared test slot: typecheck plus narrow tests verifying stable callback identity, vec3/float contract node types, construction of independent graph locals, and stable uniform references. Add only tests that can catch a real contract regression; do not label structural tests as pixel parity.
3. Cleared browser slot: accepted baseline versus extraction, shafts disabled, fixed camera/clock/exposure/LOD and equal renderer time. Capture scene and PMREM at dawn and midday, clear sky and nonzero clouds; include a camera-volume-active capture to verify reflection fallback survives. Compare against same-build repeat noise and report maximum/mean pixel difference and any visual discrepancy.
4. Repeat relevant parity on WebGPU and WebGL2; exercise cloud settings and clock updates to expose stale cross-material uniforms. Confirm unchanged build counts for positive-value changes and no GPU warnings.
5. Verify callback source with solar disc on/off, cloud-free/covered, horizon and zero scattering coefficients, without treating source identity as visible-ray acceptance.

If validation remains prohibited, deliver source for review with parity explicitly pending. Do not tell Post the contract is accepted, integrated or runtime-ready.

## Extraction delivery and next gate

Orchestrator approved the exact contract. Source changes are restricted to the two assigned runtime files, one narrow contract test and this handoff.

AlienSkyMesh now owns atmosphericTerms, cloudField, cloudDepth and cloudAlpha builders. The visible material calls them without changing its formulas, branch guards, or relative depth/alpha assignment order. The stable arrow callback returns independent Fn roots; its scattering excludes the disc/background/night additions and its transmission ignores cloudLayerVisible. Existing uniform objects and update policies are retained. Environment exposes the same arrow callback by reference. No Post consumer is connected.

The two proposed contract tests cover structural typing and independent graph roots without replacing material/uniform identities. They have NOT run and do not establish shader compilation, numerical equality or GPU upload behavior. Source diff review and git diff --check are the only completed checks.

### Planned minimum parity fixture

Use the accepted Volcanic seed 7 rim fixture: High, 1280 by 720, pixel ratio 1, governor disabled, hour 06:20, latitude/tilt zero, sun elevation five degrees. Camera 450 metres west of the summit and 12 metres above local terrain, pitch up two degrees. Synchronize camera matrices, curve state, sky position and terrain LOD. Set shafts and flare to zero, freeze exposure to the same explicit value on both versions, and keep all other post settings equal. Record exact parameters rather than relying on saved room defaults.

Capture accepted 8034263e and candidate, plus repeats of each, at identical renderer time and cloud offset. Start clear with coverage zero, then use explicit coverage 0.4 and density 0.4. Repeat at noon. Read scene and PMREM pixels; report mean/max absolute differences separately and compare against repeat noise. This is an extraction parity fixture, so keep fog defaults identical rather than testing fog isolation here.

For reflection fallback, repeat the cloudy case with camera fallback suppressed by the existing volume-active policy, force the existing reflection invalidation/capture, then restore the policy. Verify PMREM remains equivalent to the cloudy capture and the camera policy restores. Repeat camera above/below water to check the existing camera-specific sky tint cannot enter PMREM. These operations belong to a later cleared diagnostic session, not current work.

Run the parity fixture on both WebGPU and WebGL2. Record GPU warnings, backend, graph build counts and source commit. A separate diagnostic graph must exercise the callback outputs with clock/cloud updates to verify live uploads; the shafts-off material cannot establish that. Any mismatch or compile failure returns to source review. Post adoption is not cleared by this commit.

Next request: Orchestrator source review, followed by explicit allocation of typecheck/tests and both-backend parity. UX still owns the validation slot. Startup prewarm remains unresolved; no hitch or performance claim is made.

## Prior source review

Source-only sunrise review complete. Reviewed handoff 4102f461 and ONLY the six requested files at accepted 8034263e; rejected b7ccc9b0 was not used. No edits, tests, browsers, builds, servers or workers.

Findings and precise proposed contract:
1. SunSource.shaftSource(viewDirectionWS) is a graph-construction callback, not a per-frame JS sampler. Input is a normalized camera-to-scene WORLD direction, +Y up, in the same rendered-world basis as sky.sunDirection. Post must reconstruct it using getViewPosition(mask UV, depth, u.projInv), normalize, then u.camWorld * vec4(dir,0) and normalize. Use the scene camera uniforms, never post-quad cameraPosition/positionWorld; no curve inverse on this sky direction. UV remains the existing top-left convention. Validate horizon/far-depth reconstruction on both backends.
2. Return { scattering: vec3 node, transmission: float node }. Define scattering narrowly as max(Lin * SKY_SCALE, 0), BEFORE cloud blending, solar disc, L0/background extinction term, SKY_FLOOR, night/twilight additions, stars/moon, underwater tint, exposure, tone mapping and display conversion. This is the existing authored linear scene-radiance scale, not calibrated physical units. AlienSkyMesh lines 101-115 distinguish these terms explicitly. Extract the same calculation for sky and callback; do not duplicate a second scattering model or use Environment.sunColor, which becomes moonlight at night. If twilight is wanted later, name that separate contribution instead of silently changing this definition.
3. transmission means fallback-cloud opacity-derived occlusion, clamp(1-alpha,0,1), clear=1. Reuse the EXACT existing direction.y/coverage gate, cloudUV, cloudOffset, time*speed evolution, coverage-region threshold, density and horizonFade at lines 171-205. Keep cloud visibility policy separate from density evaluation. At Ultra the Post consumer REPLACES this fallback transmission using volume opacity; a direction-only Environment callback cannot itself supply screen/depth-dependent Ultra transmission. Build the fallback expression only on the High/fallback branch, so Ultra does not execute both cloud models.
4. Important qualification: High's visible sky is NOT simply scattering*(1-alpha). Lines 206-208 first remove disc/L0, then mix with cloudColor through vector Fex. The original background coefficient is 1-alpha*Fex (RGB), and cloudColor itself includes Lin. Thus scalar 1-alpha is a useful agreed occlusion proxy from the visible model, not an exact decomposition or physically measured transmittance. If exact background separation becomes required, the proposed two-field scalar contract is insufficient.
5. Post's current mask uses depth-open sky times capped EXPOSED scene color and Gaussian source footprint. The radial pass divides by ALL weighted taps, including blocked/outside-source taps. A new source callback corrects source identity and cloud occlusion but does not solve footprint dilution or prove visible rays. Preserve exposure accounting: multiply raw scattering by exposure once for the mask's current exposed-HDR units, apply any cap intentionally, multiply by sky/transmission/footprint, and divide once when adding rays before renderOutput. Exposed HDR is not display space. The existing mask also feeds flare; changing its source changes flare and needs explicit acceptance.

No-new-pass feasibility:
6. High can evaluate shared scattering/cloud arithmetic in its existing quarter-resolution mask and reuse the mask in radial taps. This adds shader work, not a target. Do not carry constructor-local toVar nodes across Fn scopes/material graphs: share builders and persistent uniforms, instantiate local temporaries per shader.
7. Ultra cloudVolume already returns an RTT with alpha=1-transmission. Retain that SAME node outside the cloudsOn block, no second cloudVolume call. However compositeClouds depth-aware reconstructs four half-resolution taps and multiplies premultiplied RGBA by camera underwater visibility. A naive 1-volume.sample(p).a can disagree at terrain edges/submersion. Smallest accurate reuse: extract the existing four-tap reconstruction into a shared node builder and use its alpha times the SAME visibility uniform in both composite and quarter-resolution mask; T=1-clamp(reconstructedAlpha*visibility,0,1). Extra taps/depth math remain a cost. No new RTT is necessary in principle; shared RTT scheduling and one volume update per frame still require runtime evidence.
8. Existing two shaft RTTs and radial taps can remain. Nothing here establishes that additive rays over an already bright sky will look acceptable. Do not repeat global HDR/display darkening. If contrast requires subtracting/shadowing a forward-scattering component already in scene color, that is a separate scoped design with sky/fog decomposition and possible extra outputs, not a free consequence of this interface.

Reflection, uniforms and warmup:
9. Preserve SkyEnvironmentMap's shared material proxy and try/finally temporary cloudLayerVisible=true, including camera-specific underwater handling. Do not mutate coverage to hide fallback or let camera volume opacity enter PMREM. Scene-sky extraction must preserve current color exactly with shafts off.
10. Callback and uniform objects stay stable. Update values only; use explicit live/render-group values where cross-material uploads need them, verified for main scene, mask and PMREM. Do not capture numeric sky settings at build time. Current PostChain DOES rebuild on effect/quality membership, cloudsOn, temporal/debug and related key changes; it does not guarantee identity across coverage/density crossing zero. No explicit warmup exists in the six reviewed files. Require warming the actual selected High/Ultra shader variants and checking builds across positive-value slider/time updates; promise no stronger identity rule than that unless implemented.

Isolating sky versus haze:
11. AlienSkyMesh material.fog=false, so height/uniform fog cannot directly wash out its open-sky pixels. Environment provides directional horizon fog colors (toward bearing fourth-power, away broad), clamped to FOG_MAX=8. HeightFog then adds uniform squared-distance optical depth, height haze, and per-channel aerial depth; it also adds an eighth-power solar lobe weighted by aerial share. They affect geometry before post, not the sky material. Existing FogSun receives solar direction with sunColor that can be lunar; do not inherit this mismatch in the new solar source.
12. Use fixed camera/clock/LOD/exposure and shafts-off controls: clear cloud-free sky with all fog terms zero; uniform fog only (height haze=0, aerial=0); height haze only (uniform=0, aerial=0); aerial only (uniform=0, height haze=0); then combined defaults. Freeze exposure so sky edits do not change auto-exposure. Compare open-sky and geometry regions separately; record linear pre-tone-map and final pixels plus mask/rays. An aerial-off difference includes both extinction and its glow, so isolating the glow alone needs a diagnostic-only independent control, not a default brightness change. Keep atmosphere fixed during this decomposition.

Smallest implementation ownership proposal, pending Orchestrator assignment:
- One assigned Sky/Environment owner: AlienSkyMesh.ts extraction and stable callback, Environment.ts structural exposure. No SkyEnvironmentMap.ts edit expected; it is a regression target.
- Post owner: PostChain.ts SunSource typing, world-ray reconstruction, tier selection/exposure/mask consumer and retaining volume node; clouds.ts shared reconstruction helper. No initial fog.ts edits. Weather reviews fog isolation and reflection invariants. Shared startup warmup wiring remains Orchestrator-owned if existing startup cannot cover these variants.

Acceptance checks for implementers, NOT run here:
- Shafts-off sky and PMREM parity after extraction; fallback visible in PMREM while Ultra camera fallback hidden; restore after failure, post-off and water crossing.
- Source finite/nonnegative at horizon and zero coefficients; solar disc toggle does not change scattering; day/night source cannot become moonlight; High alpha matches existing model at identical direction/time/offset.
- Ultra one volume RTT update, same reconstructed opacity/fade; no silhouette leaks, double cloud attenuation or extra pass; High fallback restored when volume unavailable.
- Stable build counts during positive slider changes/running clock, selected variants warmed; supported topology switches tested separately; no new compile hitch claim without measurements.
- Accepted fixed dawn/dusk rim and flank fixtures, shafts on/off; running-clock sunrise, midday restraint, cloud/terrain gaps, near vehicles, underwater/lava, flat/curved wrap, High/Ultra across Volcanic/Alpine/archipelago, WebGPU/WebGL2. Check flare too.
- Isolated fog controls above, no broad tinted wedges or washed-out terrain; moving vehicle/history captures, GPU warnings/errors, warmed alternating timings with variance and GPU timestamps where supported.
No runtime acceptance or performance improvement is established by this review.

