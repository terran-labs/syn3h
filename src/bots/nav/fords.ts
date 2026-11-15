import type { Terrain, TerrainRoadPath } from '../../world/Terrain'
import { nearestImage } from '../../../shared/wrap'

// The driving policy stays independent of the generator's chosen ford depth. Importing
// generator internals here also enters its roads/generate/lava cycle before constants exist.
const MAX_FORD_DEPTH = 0.4

// Metadata comes from the generated world: disabled fords have no marked spans. Cache
// geometry by the public road array, which terrain replaces when it regenerates.
type Segment = { ax: number; az: number; bx: number; bz: number; radius: number }
const cache = new WeakMap<readonly TerrainRoadPath[], Segment[]>()
const EMPTY: readonly TerrainRoadPath[] = []

/** Only marked, shallow water crossings are safe for wheels. Lava never qualifies. */
export function isRoadFord(terrain: Terrain, x: number, z: number): boolean {
  const liquid = terrain.liquidHeightAt?.(x, z)
  const ground = terrain.heightAt(x, z)
  if (liquid == null || !Number.isFinite(liquid) || !Number.isFinite(ground) ||
      liquid - ground > MAX_FORD_DEPTH || terrain.liquidKindAt?.(x, z) === 'lava' ||
      (liquid > ground && terrain.liquidKindAt?.(x, z) !== 'water')) return false
  const roads = terrain.roadPaths?.() ?? EMPTY
  let segments = cache.get(roads)
  if (!segments) {
    segments = []
    for (const road of roads) for (const ford of road.fords ?? []) {
      if (ford.depth > MAX_FORD_DEPTH || ford.depth <= 0 || ford.start < 0 || ford.end >= road.points.length) continue
      // Include the bank on each end. A shoreline still fails the usual dry clearance.
      for (let i = Math.max(0, ford.start - 1); i <= ford.end && i + 1 < road.points.length; i++) {
        const a = road.points[i], b = road.points[i + 1]
        segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, radius: Math.max(0, road.width / 2 - 1) })
      }
    }
    cache.set(roads, segments)
  }
  for (const s of segments) {
    const px = terrain.wrapSize ? nearestImage(x, s.ax, terrain.wrapSize) : x
    const pz = terrain.wrapSize ? nearestImage(z, s.az, terrain.wrapSize) : z
    const dx = s.bx - s.ax, dz = s.bz - s.az, length2 = dx * dx + dz * dz
    const t = length2 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / length2)) : 0
    if ((px - s.ax - t * dx) ** 2 + (pz - s.az - t * dz) ** 2 <= s.radius ** 2) return true
  }
  return false
}
