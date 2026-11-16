import { wrapCoord } from '../../../shared/wrap'
export interface Point { x: number; y: number; z: number }
/**
 * Split a sight line at tile boundaries. The physics terrain is canonical, while the camera
 * and rendered vehicle can be in a neighbour tile. Each segment is translated, not wrapped
 * point by point (which would shoot a ray backwards across the whole map at a seam).
 */
export function wrappedOccluded(from: Point, to: Point, size: number, hit: (a: Point, b: Point) => boolean): boolean {
  if (!(size > 0)) return hit(from, to)
  const cuts = [0, 1]
  for (const key of ['x', 'z'] as const) {
    const delta = to[key] - from[key]
    if (Math.abs(delta) < 1e-8) continue
    const lo = Math.min(from[key], to[key]), hi = Math.max(from[key], to[key])
    for (let edge = (Math.floor(lo / size + .5) + .5) * size; edge < hi; edge += size) {
      const t = (edge - from[key]) / delta
      if (t > 1e-8 && t < 1 - 1e-8) cuts.push(t)
    }
  }
  cuts.sort((a, b) => a - b)
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i], mid = (a + b) / 2
    const mx = from.x + (to.x - from.x) * mid, mz = from.z + (to.z - from.z) * mid
    const dx = wrapCoord(mx, size) - mx, dz = wrapCoord(mz, size) - mz
    const at = (t: number): Point => ({ x: from.x + (to.x - from.x) * t + dx, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t + dz })
    if (b - a > 1e-8 && hit(at(a), at(b))) return true
  }
  return false
}
