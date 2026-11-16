# Sunrise diagnostic closeout

The sunrise fix is unfinished. Do not integrate the rejected runtime experiment.

Accepted baseline: `8034263e`. Diagnostic harness and projection tests: `395c3bb0`.
Rejected runtime experiment: `b7ccc9b0`. Worktree: `/Users/vtn/dev/Syn3h-wt/post-sunrise`.

## Evidence

The final baseline fixture uses Volcanic seed 7, High, 1280 by 720 at pixel ratio 1,
automatic quality disabled, a stopped clock, zero latitude, and a five-degree sun.
Dawn is 06:20; dusk is 17:40 with the path rotated 180 degrees to match the silhouette.
The camera is 450 metres west of the summit and 12 metres above local terrain, pitched
up two degrees. Camera matrices, curve state, terrain LOD and sky position are synchronized.
The running renderer clock is preserved. Each pair switches only shaft strength.

| Evidence | Directory | Result |
|---|---|---|
| Accepted source, sun behind rim | `/tmp/post-sunrise-rim-baseline` | Dawn and dusk agree; rays effectively disappear |
| Wider source and source-weighted normalization | `/tmp/post-sunrise-candidate1` | Signal restored, but visible sampling texture and washed-out contrast |
| HDR shadow modulation | `/tmp/post-sunrise-candidate2` | Rejected broad modulation |
| Sun near flank, HDR experiment | `/tmp/post-sunrise-gap-candidate` | Rejected broad light/shadow regions |
| Sun near flank, display-space experiment | `/tmp/post-sunrise-gap-candidate3` | Rejected tinted wedges |

Each directory contains `report.json` and dawn/dusk on/off PNGs. The flank cases rotate
the sun by another 20 degrees. Their off images are controls with candidate defaults,
not exact accepted-source comparisons. Earlier `before`, `before-valid`, `before-coherent`
and `rim-before` captures are superseded because of harness setup errors or incomplete
camera-dependent LOD synchronization. Do not use them for acceptance.

On the final accepted-source rim fixture, both times have sun visibility 1.5996 and
front-direction dot product 0.9986. Both shaft targets are 320 by 180. The mask's mean
maximum RGB is 0.0001105 and the ray target's is 0.0003087, before the final strength,
falloff and 0.3 multiplier. The source footprint is mostly blocked and its remaining
light is averaged against dark taps along the entire radial path.

The normalization experiment raises ray mean to about 0.09045, but does not produce
acceptable rays against the bright backdrop. This distinguishes source dilution from
the remaining compositing problem. Sky and fog contributions have not been isolated
individually: attributing all washout to height fog would overstate the evidence.
Exposure is about 1.1455 in this fixture, so the proposed sevenfold dawn exposure problem
does not explain this case. Source inspection and captures do not support a mirrored sun.

Typecheck and all 23 tests in `tests/fx` pass, including six tests of the actual sun
projection at dawn/dusk elevations 2, 5 and 10 degrees, plus rejection behind the camera.
Log: `/tmp/post-sunrise-focused.log`. These checks do not establish visual acceptance.
Reports record page errors only; broader GPU warning and backend acceptance remain undone.

## Proposed shared interface, not implemented

Sky/Environment ownership must be assigned by the Orchestrator. Post keeps
`src/fx/post/PostChain.ts`, `gate.ts`, `params.ts` and `clouds.ts`.

At High, `AlienSkyMesh` in `src/world/sky/AlienSkyMesh.ts` computes fallback cloud `alpha`
inside its color shader, then combines it with atmospheric scattering. Post receives
only scene color and depth. An opaque bright cloud and clear bright sky can therefore
look identical to the current shaft mask. Do not infer cloud transmission from brightness.

At Ultra, `cloudVolume` in `src/fx/post/clouds.ts` already returns premultiplied radiance
and `1 - transmission` in alpha. Post can retain that existing node for shaft occlusion
without another volume pass. The fallback sky layer is disabled while this volume draws.

Proposed minimum contract on the existing `SunSource`, wired by `createEnvironment`
in `src/world/Environment.ts`:

```ts
// Conceptual TSL interface, to be agreed with the sky owner.
shaftSource(viewDirection): {
  scattering: Node<'vec3'>  // Linear atmospheric source color, excluding the solar disc.
  transmission: Node<'float'> // Clear sky 1, opaque cloud 0, using the visible cloud model.
}
```

Extract and reuse the sky's existing cloud/scattering evaluation rather than copying its
noise model into Post. Evaluate this at the existing quarter-resolution mask, once per
mask pixel, not per radial tap. This adds no render pass, though repeated cloud arithmetic
has a real cost to measure. At Ultra use existing volume alpha instead of evaluating
the fallback cloud function. Uniform changes must preserve graph identity and the selected
quality variants must be warmed before play.

Separately review `createEnvironment`'s `horizonColors`/fog color inputs and `heightFog`
in `src/world/weather/fog.ts`. A diagnostic should isolate clear sky, uniform fog and
height/aerial haze before proposing a brightness change. If controlling source color and
transmission alone remains insufficient, agree a separate forward-scattering contribution
that can be shadowed before it is mixed into scene color. Do not darken the whole display
to imitate that separation; the rejected experiment demonstrates the problem.

## Remaining acceptance and cost

No runtime handoff is ready. High and Ultra across Volcanic, Alpine and archipelago,
running-clock sunrise, midday restraint, cloud/terrain gaps, near vehicles, underwater,
lava and both backends remain unfinished. HUD pixels are DOM overlays outside the post
chain, but moving-vehicle and temporal-history behavior still require captures.

Headless frame medians varied roughly 31 to 84 ms across these short captures, even with
the reserved slot and observed system load around 2.6. They are diagnostics, not a cost
claim. Measure warmed alternating controls with stable camera and scene, record GPU
timestamps where supported, and report variance. Expected work to measure is the existing
two quarter-resolution targets, 16/32 radial taps, added mask arithmetic or reused volume
sample, and any full-screen composite arithmetic. No numeric win is established.

All owned browser harnesses closed Chrome and their Vite child. The final test process
exited zero, process inspection found no sunrise or Vitest job, and port 5216 had no
listener. The solo slot was released to the Orchestrator. No further jobs are queued.
