/**
 * One Rapier heightfield collider for the whole grid, plus a wrapped margin.
 *
 * Rapier's layout is the classic trap. Verified against rays in tests/world:
 *  - `nrows` and `ncols` are cell counts (samples minus one), not sample counts.
 *  - The heights array is column major with rows along local Z: index = iz + ix * (nrows + 1).
 *    Our grid is row major along X (iz * n + ix), so it is transposed on the way in.
 *  - `scale` is the full extent, and the field is centred on the collider origin.
 *
 * The world wraps, so the field covers the tile plus COLLIDER_MARGIN cells on every side
 * filled from the opposite edge. A vehicle crossing the seam has ground under it until the
 * game moves it back into the tile; the margin is the same surface `heightAt` reports there.
 */
import { GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../../core/physics'
import type { TerrainData } from './generate'

/** Cells of wrapped ground past each edge of the tile: 32 cells, 128 m at 4 m cells. */
export const COLLIDER_MARGIN = 32

export function heightfieldDesc(data: TerrainData, margin = COLLIDER_MARGIN): RAPIER.ColliderDesc {
  const n = data.resolution
  const period = n - 1 // the last sample is the image of the first
  const m = Math.min(margin, period)
  const src = data.heights
  const N = period + 2 * m + 1
  const cols = new Float32Array(N * N)
  // Inside the tile read the grid directly (so an unsealed grid still matches `heightAt`
  // there); in the margin read the wrapped sample.
  const wrap = (j: number) => {
    const g = j - m
    return g >= 0 && g <= period ? g : ((g % period) + period) % period
  }
  for (let jz = 0; jz < N; jz++) {
    const row = wrap(jz) * n
    for (let jx = 0; jx < N; jx++) cols[jz + jx * N] = src[row + wrap(jx)]
  }
  const extent = (N - 1) * data.cell
  return RAPIER.ColliderDesc.heightfield(
    N - 1,
    N - 1,
    cols,
    { x: extent, y: 1, z: extent },
    // Smooths contacts across triangle edges so wheels do not catch on flat ground.
    RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES,
  )
    .setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL))
    .setFriction(1)
}

export function createTerrainCollider(world: RAPIER.World, data: TerrainData): RAPIER.Collider {
  return world.createCollider(heightfieldDesc(data))
}
