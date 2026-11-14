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
