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
