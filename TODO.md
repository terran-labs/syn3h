# To do

Work deliberately left out of the MVP, with enough context to pick it up later. The
weekend push is tracked in `ops/BACKLOG.md`; this file is for what comes after.

## Classic buggy

Left off the MVP by the owner on 14 November 2026. The code stays in the tree as the kind
`buggy-classic`, and it is still the second choice in the lobby.

### Where it stands

- `src/vehicles/ClassicBuggy.ts`: raycast wheels, the "modified Yoggy" motor, four wheel steering, suspension, wings
  with stall, airbrakes and lava thermals, self righting, and lava floating.
- The model is `public/models/buggy-classic.glb` with `buggy-classic-wheel.glb`.
- Unit tests in `tests/vehicles/classic.test.ts` cover direction, braking, wings and self
  righting.
- Nobody has driven it by hand yet. Feel is the real acceptance test.

### Findings from a drive capture

One run of `tests/vehicles/scenarios/qa-seed42-turns.json` on seed 42 (W held for 20 s, A
at 7 s, D at 12 s) threw no errors and showed:

- **Twitchy at speed.** It reached 33 m/s (about 75 mph) at 12 s, still accelerating. A
  1.5 s tap of D at that speed put it on two wheels at 27 degrees of roll. It recovered
  without flipping.
- **Leaves the ground often.** On the hill climb after the turns, no wheel touched the
  ground in 3 of the last 5 samples, with pitch between 35 and 45 degrees.
- **Tiny on screen.** The chase camera holds this 1.6 m wheelbase car at about 3% of the
  frame width. The camera belongs to the Bots, Performance and QA lane, so the fix is
  likely a per vehicle camera distance there, not a change to the buggy.

### Known quirks

- Top speed runs far past the Speed slider, about 100 m/s at the default, because the
  motor equations divide by `buggySpeed * 10`.
- It creeps forward with no input unless `buggy.idleHold` is on.

### Ideas, in the order I would try them

1. Have the owner drive it with the sliders open (Power, Speed, Traction, Shocks,
   Stability (CG), Idle hold) and turn his words into slider values before touching code.
2. If it still rolls too easily, try Stability (CG) toward -0.7 first, then a lower
   Traction, before any change to the equations.
3. Ask the camera owner for a closer chase distance for small vehicles.
4. Consider a cap on top speed behind a slider that defaults off, so the current behaviour
   stays available.
5. Fix the stale header comment in `ClassicBuggy.ts`, which still says the wings and
   buoyancy "come later". Both are implemented.
6. Decide whether it stays in the lobby before the demo, since it has not been tuned.

### Rules when resuming

- `src/vehicles/buggyParams.ts` is shared with the Mira buggy. Do not change its
  `buggy.nextGen`, grip, slide, gripFade or steerLimit parameters, and tell the
  Orchestrator before adding new ones.
- Run heavy jobs through `tools/heavy.sh`, keep one dev server, and stop it by PID.
