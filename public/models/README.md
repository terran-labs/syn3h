# Original vehicle models

Converted from the original Blender files with Blender 5.3 (`export_yup`, modifiers applied).
The owner created these and has authorised their reuse.

| File | Source | Meshes |
| --- | --- | --- |
| `buggy.glb` | Syn3h `Buggy.blend` | Body, Cockpit, Wings, Wheel Template, Wheel Template Simple, Rim, RimSimple, Axle, Collider |
| `jet.glb` | Syn3h `Core Jet.blend` | Body_Main, Body_Chrome, Body_Cockpit, Landing Gear, Landing Gear Simple, Collider |
| `tank.glb` | Mars Explorer `Tank.blend` | Three unnamed meshes, no materials |
| `tanktread.glb` | Mars Explorer `TankTread.blend` | Two meshes at about 0.03 units: needs scaling |

Notes for whoever wires these in:

- The buggy body measured 2.08 x 1.01 x 4.01 in Blender's own axes, so it was authored with
  length along Blender Z. Check orientation after loading and rotate so the nose points to
  local -Z (the project's forward).
- `Collider` meshes are collision hulls, not for rendering.
- `Wings` (about 8 x 10.5) is the force field wing surface the original deformed per vertex.
- The hovercraft exists only as `.3ds` and is not converted yet.

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

`src/vehicles/skins` loads both generations and bakes their transforms. Both headlight
meshes point along source +Z, so both bodies rotate 180 degrees about Y. Classic uses
its prefab body scale of 2.15. Syn3h uses 0.5 to fit the shared classic suspension frame;
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
