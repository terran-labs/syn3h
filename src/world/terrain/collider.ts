/**
 * One Rapier heightfield collider for the whole grid.
 *
 * Rapier's layout is the classic trap. Verified against rays in tests/world:
 *  - `nrows` and `ncols` are cell counts (samples minus one), not sample counts.
 *  - The heights array is column major with rows along local Z: index = iz + ix * (nrows + 1).
 *    Our grid is row major along X (iz * n + ix), so it is transposed on the way in.
 *  - `scale` is the full extent, and the field is centred on the collider origin.
 */
import { GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../../core/physics'
import type { TerrainData } from './generate'

export function heightfieldDesc(data: TerrainData): RAPIER.ColliderDesc {
  const n = data.resolution
  const src = data.heights
  const cols = new Float32Array(n * n)
  for (let iz = 0; iz < n; iz++) {
    const row = iz * n
    for (let ix = 0; ix < n; ix++) cols[iz + ix * n] = src[row + ix]
  }
  return RAPIER.ColliderDesc.heightfield(
    n - 1,
    n - 1,
    cols,
    { x: data.size, y: 1, z: data.size },
    // Smooths contacts across triangle edges so wheels do not catch on flat ground.
    RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES,
  )
    .setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL))
    .setFriction(1)
}

export function createTerrainCollider(world: RAPIER.World, data: TerrainData): RAPIER.Collider {
  return world.createCollider(heightfieldDesc(data))
}
