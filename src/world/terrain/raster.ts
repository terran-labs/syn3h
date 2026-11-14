/**
 * Grid helpers shared by the road and lava passes: visiting the samples near a polyline,
 * and a turn-limited heading for path tracers. Integer and IEEE arithmetic only, so the
 * results are identical on every machine (see noise.ts).
 */
import type { TerrainData } from './generate'

export interface P2 {
  x: number
  z: number
}

/**
 * Call `visit(sampleIndex, distance, segment, t)` for every grid sample within `radius`
 * of each segment of `pts`. A sample near several segments is visited once per segment,
 * so callers keep whichever result they need (nearest, minimum height, ...).
 */
export function visitNearPolyline(
  data: TerrainData,
  pts: readonly P2[],
  closed: boolean,
  radius: number,
  visit: (i: number, dist: number, seg: number, t: number) => void,
): void {
  const n = data.resolution
  const c = data.cell
  const half = data.size / 2
  const segs = closed ? pts.length : pts.length - 1
  for (let s = 0; s < segs; s++) {
    const a = pts[s]
    const b = pts[(s + 1) % pts.length]
    const minX = Math.max(0, Math.floor(((a.x < b.x ? a.x : b.x) - radius + half) / c))
    const maxX = Math.min(n - 1, Math.ceil(((a.x > b.x ? a.x : b.x) + radius + half) / c))
    const minZ = Math.max(0, Math.floor(((a.z < b.z ? a.z : b.z) - radius + half) / c))
    const maxZ = Math.min(n - 1, Math.ceil(((a.z > b.z ? a.z : b.z) + radius + half) / c))
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const r2 = radius * radius
    for (let iz = minZ; iz <= maxZ; iz++) {
      const z = -half + iz * c
      for (let ix = minX; ix <= maxX; ix++) {
        const x = -half + ix * c
        let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const px = a.x + dx * t - x
        const pz = a.z + dz * t - z
        const d2 = px * px + pz * pz
        if (d2 <= r2) visit(iz * n + ix, Math.sqrt(d2), s, t)
      }
    }
  }
}

/** Distance from (x, z) to the nearest segment of a polyline. */
export function distanceToPolyline(pts: readonly P2[], closed: boolean, x: number, z: number): number {
  let best = Infinity
  const segs = closed ? pts.length : pts.length - 1
  for (let s = 0; s < segs; s++) {
    const a = pts[s]
    const b = pts[(s + 1) % pts.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = a.x + dx * t - x
    const pz = a.z + dz * t - z
    const d2 = px * px + pz * pz
    if (d2 < best) best = d2
  }
  return Math.sqrt(best)
}

// cos and sin of 4 and 9 degrees, as literals: the tracers must not depend on Math.cos.
export const TURN_GENTLE: readonly [number, number] = [0.9975640502598242, 0.0697564737441253]
export const TURN_HAIRPIN: readonly [number, number] = [0.9876883405951378, 0.15643446504023087]

/**
 * Turn unit heading (hx, hz) toward unit direction (dx, dz) by at most the given angle
 * (as [cos, sin]) per step. 4 degrees per 4 m step is a 57 m curve radius, 9 degrees 25 m.
 */
export function steer(hx: number, hz: number, dx: number, dz: number, turn = TURN_GENTLE): [number, number] {
  const [tc, ts] = turn
  const dot = hx * dx + hz * dz
  if (dot >= tc) return [dx, dz]
  const cross = hx * dz - hz * dx
  const s = cross >= 0 ? ts : -ts
  const nx = hx * tc - hz * s
  const nz = hx * s + hz * tc
  const inv = 1 / Math.sqrt(nx * nx + nz * nz)
  return [nx * inv, nz * inv]
}

/** x * x. Prefer it to `x ** 2`, which, like Math.pow, may differ in the last bit between engines. */
export function sq(x: number): number {
  return x * x
}

export function normalize2(x: number, z: number): [number, number] {
  const l = Math.sqrt(x * x + z * z)
  return l > 1e-9 ? [x / l, z / l] : [1, 0]
}
