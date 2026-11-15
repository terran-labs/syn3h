# The vehicle pattern

Set by the owner on 14 November 2026: every vehicle uses the same shading and texturing
system and the same force field cockpit, can be driven from inside its cockpit and look right
from there, and is built with levels of detail, few triangles and clean, consistent geometry.
The Vehicles lane keeps this file; vehicle leads keep their vehicles to it. The budgets in
rule 4 are the Vehicles lane's proposal and change with evidence.

1. One shading system. A vehicle creates no look of its own: no MeshPhysicalMaterial numbers, no bump or flake maps, no image files. It tags each surface with a role and the shared system (src/vehicles/skins/showroom.ts) builds every quality tier, the night fill and the lava glow from that. Roles today: paint, accent, chrome, tyre, lamp, trim, glass. Tag with `setRole(material, role)`; untagged surfaces are guessed from names, which is a fallback, not the pattern. Colours stay live through the source material's Color object, so `setColors` keeps working. Player-facing paint sliders (paint.scaleSize, scaleDepth, seams, flakes, gloss) then apply to your vehicle for free.

2. One cockpit: a force field, not glass. I am adding a `canopy` role to showroom.ts now (branch feat/vehicles2-canopy, handoff to follow): an energy canopy in the vehicle's accent colour, one draw, double sided in a single pass, bright at the rim from outside and almost clear from inside so the driver sees out. Until it lands, tag the canopy `glass` and it will switch over with a one-word change. Do not author black or tinted glass.

3. The camera sits in the cockpit and it must look right from there. That means:
   - a `ridePosition` Object3D at the driver's eye, inside the canopy, at least 0.25 m from any surface;
   - a real interior: a tub with floor, sills, a cowl or dash ahead and a seat back behind, as inward-facing geometry tagged `trim`. Do not rely on a double-sided body shell to fake an inside: it doubles shading cost and lights wrongly;
   - the canopy as one closed mesh with outward normals and nothing else merged into it (the rim is separate, `chrome`);
   - nothing tagged `userData.hideInRide`, so the driver sees their own nose, wheels, wings or tracks. Today the ride view hides the canopy on the buggy and hides the whole vehicle on everything untagged; both go away under this pattern;
   - a clear view: nothing but canopy within about 35 degrees either side of straight ahead and 15 degrees down over the nose.

4. Levels of detail, authored, with budgets. Proposed, tell me if your vehicle cannot meet them and why:
   - LOD0, the player's own vehicle and others within 30 m: at most 12,000 triangles including wheels or tracks, at most 6 draws (merged body, canopy, instanced moving parts, glow);
   - LOD1, 30 to 120 m: at most 2,500 triangles, at most 3 draws;
   - LOD2, beyond 120 m: at most 400 triangles, 1 draw, silhouette only.
   Generated vehicles should produce LOD1 and LOD2 from the generator at lower detail, not by decimating LOD0. `staticLods`/`reducedGeometry` in mergeStatic.ts quantise vertices and are a stopgap for imported models. Switching goes through `registerVehicleDetail(root, (distance, remote, level) => ...)`.

5. Clean, consistent geometry: metres; vehicle frame +X right, +Y up, -Z forward; origin where the physics body is; closed surfaces with consistent outward winding; no duplicated or coplanar overlapping faces; welded vertices with smooth normals except where a crease is meant; static parts mergeable (`mergeStatic`) and moving parts named and separate; one low-polygon collider that is not the visual mesh.

6. No bitmaps anywhere in the vehicle, by the owner's order tonight.
