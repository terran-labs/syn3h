import { RAPIER, GROUP_PROJECTILE, GROUP_TERRAIN, groups } from '../../core/physics'
import type { Point } from './occlusion'
/** Reuse the existing physics terrain, not a mesh traversal or a new network query. */
export function terrainOcclusion(world: RAPIER.World): (from: Point, to: Point) => boolean {
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  return (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz)
    if (length < .1) return false
    Object.assign(ray.origin, from); Object.assign(ray.dir, { x: dx / length, y: dy / length, z: dz / length })
    return world.castRay(ray, length, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(GROUP_PROJECTILE, GROUP_TERRAIN)) !== null
  }
}
