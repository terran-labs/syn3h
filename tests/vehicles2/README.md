# Vehicle validation and integration

## Jet

- Landing gear, hover, flight, lift and drag.
- Mass 200, hover thrust 2, hover steering 4, hover angular drag 2, leveling 0.2, flight
  thrust 2, flight angular drag 3. The main thruster's local position is (0, 0, 2.971839).
- Hover drag .01, flight drag .0001, steer 20, lift .5, stall speed 20. Flight-drag slider
  bounds are a half-to-one-and-a-half multiplier around the default.
- Four-axis input smoothing with factor 10.

Atmosphere breakpoints are 15240 and 30480 metres. The lift coefficient is asymmetric and
the atmosphere has a discontinuity. Rapier uses the exported convex collider; mass
properties use its calculated principal inertia times 0.75 with center of mass at zero.
The landing-gear box scales with deployment. No async model load changes the physics.

The existing shared input starts with special=false. For Jet, false means hover and
true means flight, so the jet starts in hover without changing global input.
Throttle is input.z, and half throttle balances weight after input smoothing settles.
The existing base class has no field for smoothed input in its network snapshot; remote
copies reconstruct it from received inputs, as they do for other internal vehicle state.

`public/models/convert-mira-jet.py` re-exports the jet model using mesh-local coordinates,
removes authoring-scene offsets, reflects Z, and applies the model's offsets. The GLB is
already in the game's frame and must not be rotated or scaled again. The hull JSON
records the hull vertices; Jet.ts embeds those numbers for synchronous physics.

Materials are Vehicle Main, Vehicle Chrome, Vehicle Cockpit Day and Vehicle Accent.
PBR materials give blue metallic paint, .9 paint gloss, .822 chrome gloss, purple
cockpit, and the armor-scale texture. Reflections need a scene environment; the
inspection gallery supplies a lit studio environment. Thruster glow uses the HoverGlow
texture as an additive effect.

## Checks

Run `npx tsc --noEmit` and `MIRA_NO_ROOM_SERVER=1 npx vitest run`.
Start the isolated inspection server with
`npx vite --port 5185 --strictPort --config tests/vehicles2/vite.config.ts`.
Then run `node tests/vehicles2/gallery-smoke.mjs jet`.

The gallery is `tests/vehicles2/gallery.html`; screenshots are written to
`/tmp/syn3h-vehicles2/jet-mira-front.png` and `jet-mira-rear.png`.
The smoke test checks WebGPU rendering errors and captures deployed and retracted gear.
This is a local validation page, not a published preview.

## Hovercraft

The hovercraft keeps its force controller as the requested fallback.

The visual model's five named surfaces are Main, Cockpit, Accent, Chrome and Spoilers.
`convert-mira-hovercraft.py` decodes the binary property list's vertices, polygons and
UVs directly, fixes clockwise winding and preserves hard edges.

The 3.15 geometry multiplier interprets the .0315 importer scale with Cheetah's
centimetre conversion. This produces a 3.145 m body length and aligns the rear nozzle
with the 1.218 m rear glow position. Collision dimensions are 2 x 1 x 3, with the
collider transform at Y=0.4 applied. The body uses Vehicle Main paint; the other
materials are the chrome, accent and purple cockpit materials used by the Mira jet.

Run the gallery smoke with `hovercraft` to capture front and rear close-ups. Both
renders use the converted model, PBR material approximations and the glow texture.

## In-game Mira validation

The jet exposes a 5 m camera clearance and ride camera position
(0, 0.383, -2.085) in browser coordinates. The hovercraft exposes its ride camera
(0.000051, 0.56284, -0.497794); its 2 m clearance uses the base default.

Keyboard flight authority is deliberately reduced by `jet.controlResponse=0.3`.
The force equations are unchanged, and setting this slider to 1 restores
full authority. A half-second S tap at full authority pitched through roughly
100 degrees; the reduced setting produced a controlled 28 degree climb. R supplies
thrust, F reverses it, W pitches down, S pitches up, A/D bank, Q/E yaw, Shift brakes,
and Space switches hover/flight. Hover thrust is unaffected.

`tools/scenarios/jet-flight.json` covers hover takeoff, transition, climb, bank and
hover recovery. `jet-stall-landing.json` starts below stall speed at 45 m, recovers
in hover, then lands on the gear. `hovercraft-terrain.json` follows a deterministic
dune approach, crosses slopes, leaves its support height, turns and brakes.
Run these with `tools/drive-capture.mjs --url ... --vehicle jet|hovercraft`.
Contact sheets and telemetry are under `/tmp/syn3h-vehicles2/`.

The shared scene now uses a 64 px sky-only PMREM with the live sky material.
It captures no terrain, vehicle or shadow passes. It refreshes after sky edits
(debounced to at most twice per second), or six simulated minutes of day progression.
Environment intensity is 0.15 because the existing hemisphere light already supplies
sky ambient. `environment-smoke.mjs` verifies one capture while unchanged and one
additional capture after changing the hour. The first measured CPU submission took
31 ms, the warmed refresh 4 ms; these are CPU costs, not GPU timer measurements.
The same target is reused. Both vehicles apply replicated body/accent colours,
and the jet updates gear animation even when a remote proxy becomes kinematic.

## Tank

`Tank.ts` uses converted tank and tread geometry, with six independent tread offsets.
It is not added to the lobby by this work.

Three cuboid shape casts per side carry the tracks as a single body. Segment centres
are X +/-2 and Z -2.5, 0, 2.5. Each contact applies lateral 150 drag, rolling 50 drag,
constant 10 lift, the motor speed formula, persistent SmoothDamp state, inside-track
cutoff and half-power counterrotation for pivoting. Forces act above the contact by
tankGrip. Parked braking and overturn recovery are included.

Single-body design: 241 kg combines the runtime default 1 kg hull and six 40 kg tracks.
Inertia is an approximate distribution. A 4000 N/m spring and 450 Ns/m damper per cast
provide support; recovery torque is limited to 20000 Nm. Track geometry is normalized to
1 x 0.9 x 2.2 m.

Five headless checks cover mass/contact count, stable resting support, forward and
reverse drive, pivot direction, no airborne traction, braking, teleport reset and
recovery from an exactly inverted pose. Browser front/rear screenshots are
`/tmp/syn3h-vehicles2/tank-legacy-front.png` and `tank-legacy-rear.png`.

## Multiplayer evidence

Run an isolated room with `PORT=8788 npx tsx server/dev.ts` and launch the test
Vite config with `MIRA_ROOM_PORT=8788`, then run `multiplayer-smoke.mjs`.
Two pages verified remote jet and hovercraft kinds, distinct body/accent paint,
loaded meshes, and visible hover gear on the distant kinematic jet.
Across eight motion samples, maximum body-to-interpolated-target error was
0.000008 m. The moving owner-to-remote comparison was about 9 m under two-page
headless load; after settling into hover it converged to 0.12 m. Browser errors: zero.
The script photographs each remote vehicle from the other page's camera and writes
`multiplayer-remote-jet.png`, `multiplayer-remote-hovercraft.png`, and
`multiplayer.json` under `/tmp/syn3h-vehicles2/`.
