# Original vehicle models

Source material, not game assets. Since 16 November 2026 every vehicle is generated in code
and the game loads no model; these files moved here from `public/models` so the production
build never copies them (Vite copies only `public/`). Developer tools read them: the buggy
comparison harness (`tools/buggy-fit`) and two vehicle lab exhibits served by the dev server.
`buggy-boxarm.glb` is the Box arm body built by `tools/buggy-bodies` from `buggy.glb`.

Converted from the original Blender files with Blender 5.3 (`export_yup`, modifiers applied).
The owner created these and has authorised their reuse.

| File | Source | Meshes |
| --- | --- | --- |
| `buggy.glb` | Mira `Buggy.blend` | Body, Cockpit, Wings, Wheel Template, Wheel Template Simple, Rim, RimSimple, Axle, Collider |
| `jet.glb` | Mira `Core Jet.blend` | Body_Main, Body_Chrome, Body_Cockpit, Landing Gear, Landing Gear Simple, Collider |
| `tank.glb` | Mars Explorer `Tank.blend` | Three unnamed meshes, no materials |
| `tanktread.glb` | Mars Explorer `TankTread.blend` | Two meshes at about 0.03 units: needs scaling |

Notes for whoever wires these in:

- The buggy body measured 2.08 x 1.01 x 4.01 in Blender's own axes, so it was authored with
  length along Blender Z. Check orientation after loading and rotate so the nose points to
  local -Z (the project's forward).
- `Collider` meshes are collision hulls, not for rendering.
- `Wings` (about 8 x 10.5) is the force field wing surface the original deformed per vertex.

## Buggy skins

`buggy-classic.glb` and `buggy-classic-wheel.glb` contain recovered original geometry,
not a recreation. Source: the Unity 6 fan fork's `Buggy2.fbx` and `Buggy Wheel2.fbx`
under `unity/Assets/Martian Assets/Vehicles/Buggy/Components/`. The body FBX retains
original `Buggy.jas` mesh names and importer GUID. The original `.jas` is a Cheetah3D
binary property list, not a Unity mesh. Blender 5.3 imported the FBX and exported GLB.
Blender reported excess FBX layer indices; geometry loads and was visually checked.
The classic material references have no diffuse texture: the body was player-tinted,
and the cockpit used a purple tint plus an environment cubemap. The skins use PBR
materials for those colors, without the old cubemap shader.

Historical: `src/vehicles/skins` once loaded both generations and baked their transforms. Both headlight
meshes point along source +Z, so both bodies rotate 180 degrees about Y. Classic uses
its prefab body scale of 2.15. Mira uses 0.5 to fit the shared classic suspension frame;
its cockpit and wings need a 90 degree X correction, and their missing opposite halves
are mirrored. The source GLB remains unchanged. Wheels use a 0.30 m radius. Axles are
simple connecting rods that follow the recovered mounts.

The caller supplies wheel positions in vehicle local coordinates and angles in radians.
Wheel order: front left, front right, rear left, rear right. Advance the wing open amount
by `2 * dt` toward 0 or 1 to preserve the original half-second transition. Both loaders
expose a `ready` promise; handle rejection when an asset is unavailable. Disposal is safe
while a load is pending. The viewer at `skins.html` demonstrates the complete contract.

### Recovered classic prefab values

Values below are Unity coordinates, before reflecting Z into the game frame.

- `wheelPos`: (0.7, 0, 0.8), mirrored per side and axle by `Buggy.js` lines 67-76.
- `axelPos`: (0.375, -0.1, 0.75).
- Chassis collider: convex `Collider` mesh, local scale (2, 2, 2), zero position and rotation.
- Visual body `Lod0` and `Lod1`: local scale (2.15, 2.15, 2.15).
- Laser trigger: box size (1.5, 1.25, 2), center zero.
- Wing triggers: box size (8, 0.5, 4), center (0, 0, 0.1).
- No Rigidbody is serialized on the buggy prefab. `Vehicle.js` lines 110-112 adds one
  at runtime and enables interpolation. `Buggy.js` lines 193-195 sets mass 30,
  center of mass Z 0.2, Y `buggyCG * suspensionRange * 0.5`.
- Ground drag 0.01 and angular drag 0.2 (`Buggy.js` 284-298); braking and flight override
  those values. The commented inertia tensor (7, 7, 3) is not an active setting.

Verification: `npx tsc --noEmit`, `npx vitest run`, then run Vite with
`--port 5185 --strictPort --config tests/vehicles2/vite.config.ts` and
`node tests/vehicles2/skins-smoke.mjs`. The test config isolates Vite's cache because
concurrent worktrees share node_modules. Screenshots are written under
`/tmp/syn3h-vehicles2/` and the smoke check reports the rendering backend and errors.

## Mira jet correction

`jet.glb` is now exported in vehicle coordinates directly from the original Blender
mesh data, with the `terra.jet.prefab` offsets. It is full size (about 7.7 m wide and
6.94 m long), centered at the original vehicle origin, and faces -Z. Do not apply the
older import's authoring-scene offset or a second rotation. Landing gear is a separate
node. `jet-collider.json` contains the original convex hull points with the prefab's
Y=-0.1 offset. See the conversion script and `tests/vehicles2/README.md` for sources.

## Hovercraft: generated, no model file

The hovercraft has no file here. Since 15 November 2026 its body is generated at run time
from parameters (`src/vehicles/hovergen`, design Lowwing, approved by the owner), with its
cockpit and three detail levels. `hovercraft.glb` and its two converter scripts were removed
in the same change that stopped loading it. The recovered original mesh remains in the
project history and in the source archives if it is wanted as a reference again; its
measurements are recorded in `src/vehicles/hovergen/README.md`.

## Mars Explorer tank fallback

`Tank.ts` uses the already converted `tank.glb` and `tanktread.glb`. It rotates the
hull into Y-up, hides the duplicated hull mesh, and normalizes each of six tread
segments to 1 x 0.9 x 2.2 m. The tread map is generated at run time
(`createTreadMap` in `src/vehicles/effects/maps.ts`) after the original
`Vehicles/Tank/Components/Materials/TankTrack.png`, which is no longer shipped; its UV
offset follows contact speed. This is the legacy Mars Explorer tank, not a recovered Mira vehicle.
