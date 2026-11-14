# Vehicle validation and integration

The jet now follows Syn3h. The earlier Mars Explorer jet commit is superseded.

## Jet

Sources in `syn3h-client/Assets/`:

- `_Actors/Packages/Jet/Components/VhiclJet.cs`, lines 84-211: landing gear, hover,
  flight, lift and drag. The old liquid code at 213-232 is commented out and is omitted.
- `_Actors/terra.jet.prefab`: mass 200, hover thrust 2, hover steering 4, hover angular
  drag 2, leveling 0.2, flight thrust 2, flight angular drag 3. Main thruster local
  position is (0, 0, -2.971839) in Unity, reflected to +Z in this implementation.
- `_Core/Scripts/CoreSettings.cs`, lines 52-56: hover drag .01, flight drag .0001,
  steer 20, lift .5, stall speed 20. Flight-drag slider bounds retain the original
  half-to-one-and-a-half multiplier around the corrected Syn3h default.
- `_Core/Scripts/Vhicl.cs`, line 269: four-axis input smoothing with factor 10.

Atmosphere breakpoints are 15240 and 30480 metres. The source's asymmetric lift
coefficient and atmosphere discontinuity are preserved. Rapier uses the exported
original convex collider; mass properties use its calculated principal inertia times
0.75 with center of mass at zero. The landing-gear box follows its original dimensions
and scales with deployment. No async model load changes the physics.

The existing shared input starts with special=false. For Jet, false means hover and
true means flight, preserving the original startup mode without changing global input.
Throttle is input.z, and half throttle balances weight after input smoothing settles.
The existing base class has no field for smoothed input in its network snapshot; remote
copies reconstruct it from received inputs, as they do for other internal vehicle state.

`public/models/convert-syn3h-jet.py` re-exports Core Jet.blend using mesh-local coordinates,
removes authoring-scene offsets, reflects Z, and applies prefab offsets. The GLB is
already in the game's frame and must not be rotated or scaled again. The hull JSON
records the source vertices; Jet.ts embeds those numbers for synchronous physics.

Materials follow the prefab's Vehicle Main, Vehicle Chrome, Vehicle Cockpit Day and
Vehicle Accent references. PBR substitutes preserve blue metallic paint, .9 paint gloss,
.822 chrome gloss, purple cockpit, and the original armor-scale texture. The Unity
shader's animated weather and screen-depth effects are not reproduced. Reflections
need a scene environment; the inspection gallery supplies a lit studio environment.
Thruster glow uses the original HoverGlow texture as an additive effect.

## Checks

Run `npx tsc --noEmit` and `SYN3H_NO_ROOM_SERVER=1 npx vitest run`.
Start the isolated inspection server with
`npx vite --port 5185 --strictPort --config tests/vehicles2/vite.config.ts`.
Then run `node tests/vehicles2/gallery-smoke.mjs jet`.

The gallery is `tests/vehicles2/gallery.html`; screenshots are written to
`/tmp/syn3h-vehicles2/jet-syn3h-front.png` and `jet-syn3h-rear.png`.
The smoke test checks WebGPU rendering errors and captures deployed and retracted gear.
This is a local validation page, not a published preview.

## Hovercraft

The Syn3h Hovercraft.prefab refers to script GUID
`f6aa30511de264fde964ac9c24f8b0b9`. It resolves to Mars Explorer's Hovercraft.js in both
legacy upstream trees. There is no matching script metadata in syn3h-client,
syn3h-player-proprietary or syn3h-client-proprietary-libraries. Searches for hover
force code in those repositories also found only commented jet ground-effect code.
The Mars Explorer force port is therefore retained as the requested fallback.

The visual now comes from the exact Syn3h prefab mesh reference:
`_Actors/Packages/Hovercraft/Components/Model/Hovercraft.jas`, GUID
`a9894bbcc44bb4703a846a51e26241ba`. Its five named surfaces are Main, Cockpit, Accent,
Chrome and Spoilers. The old .3ds is byte-identical to the Mars Explorer copy and is
not the prefab's selected model. The .skp alternatives also are not referenced by this
prefab. `convert-syn3h-hovercraft.py` decodes the binary property list's vertices,
polygons and UVs directly, fixes clockwise winding and preserves hard edges.

The 3.15 geometry multiplier interprets the .0315 importer scale with Cheetah's
centimetre conversion. This produces a 3.145 m body length and aligns the rear nozzle
with the prefab's 1.218 m rear glow position. Collision dimensions are 2 x 1 x 3,
with the prefab's previously omitted collider transform at Y=0.4 now applied.
The LOD0 body material GUID is missing from the checked repositories; Vehicle Main
paint is used as a documented substitute. Other material GUIDs resolve to the same
chrome, accent and purple cockpit materials used by the Syn3h jet.

Run the gallery smoke with `hovercraft` to capture front and rear close-ups. Both
renders use the recovered model, PBR material approximations and the original glow
texture. There was no vehicle promo screenshot in the searched Syn3h source trees;
geometry and serialized material references were the visual comparison sources.

## In-game Syn3h validation

The jet exposes the prefab's 5 m camera clearance and RideCamera position
(0, 0.383, -2.085) in browser coordinates. The hovercraft exposes its RideCamera
(0.000051, 0.56284, -0.497794); its 2 m clearance uses the Syn3h base default,
not a serialized override.

Keyboard flight authority is deliberately reduced by `jet.controlResponse=0.3`.
The original force equations are unchanged, and setting this slider to 1 restores
source authority. A half-second S tap at source authority pitched through roughly
100 degrees; the reduced setting produced a controlled 28 degree climb. R supplies
thrust, F reverses it, W pitches down, S pitches up, A/D bank, Q/E yaw, Shift brakes,
and Space switches hover/flight. Hover thrust still follows the original source.

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

## Legacy tank fallback

`Tank.ts` ports Mars Explorer `Tank.js`, `TankTrack.js` and `TankMe.js`. No Syn3h
tank was found. It uses the converted original Tank.blend/TankTread.blend geometry
and original TankTrack.png, with six independent tread offsets. The gallery labels
it as legacy. It is not added to the lobby by this work.

Three cuboid shape casts per side replace the six jointed track bodies. Segment
centres remain X +/-2 and Z -2.5, 0, 2.5. Each contact retains the source lateral
150 drag, rolling 50 drag, constant 10 lift, motor speed formula, persistent
SmoothDamp state, inside-track cutoff and half-power counterrotation for pivoting.
Forces act above the contact by tankGrip. Settings retain the source defaults and
ranges. Parked braking and overturn recovery are included.

Deliberate changes for the single-body design: 241 kg combines the runtime default
1 kg hull and six serialized 40 kg tracks. Approximate distributed inertia replaces
jointed inertia. A 4000 N/m spring and 450 Ns/m damper per cast provide support;
recovery torque is limited to 20000 Nm rather than the original enormous acceleration
mode torque. Track geometry is normalized to 1 x 0.9 x 2.2 m. These approximations
are not claimed as serialized Syn3h values.

Five headless checks cover mass/contact count, stable resting support, forward and
reverse drive, pivot direction, no airborne traction, braking, teleport reset and
recovery from an exactly inverted pose. Browser front/rear screenshots are
`/tmp/syn3h-vehicles2/tank-legacy-front.png` and `tank-legacy-rear.png`.
