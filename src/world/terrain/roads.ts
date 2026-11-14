/**
 * Roads pass: plans graded roads from the seed and flattens the heightfield under them.
 *
 *  - volcano: from the spawn pad to the gentle foot of the volcano, then switchbacks up the
 *    gentle flank whose heading keeps the uphill grade near TRACE_GRADE, to the rim road.
 *    Switchbacks stay within SWITCHBACK_SECTOR of the gentle axis, leaving the other flanks
 *    free for lava rivers (a spiral would wrap the whole cone).
 *  - rim:     a closed ring just outside the caldera lip
 *  - plain:   one or two roads from the spawn pad to small cones or mesas
 *
 * Data shape (`data.roads`):
 *
 *   interface Road {
 *     kind: 'volcano' | 'rim' | 'plain'
 *     closed: boolean        // rim road: the last point connects back to the first
 *     width: number          // paved width in metres (ROAD_WIDTH)
 *     points: RoadPoint[]    // centreline about 4 m apart; y is the road surface height
 *   }
 *
 * The surface across the road is level (it takes the centreline height of the nearest
 * point), the longitudinal grade is capped at MAX_GRADE, and shoulders blend back into
 * the terrain. `data.roadDist` holds each sample's distance to the nearest centreline for
 * the material's road paint.
 */
import { SPAWN_FLAT_RADIUS, SPAWN_LEVEL, type TerrainData, type TerrainPass, volcanoT } from './generate'
import { hash2, perlin, smoothstep, subSeed } from './noise'
import { TURN_GENTLE, TURN_HAIRPIN, normalize2, sq, steer, visitNearPolyline } from './raster'
import { HeightSampler } from './sampler'

export interface RoadPoint {
  x: number
  y: number
  z: number
}

export type RoadKind = 'volcano' | 'rim' | 'plain'

export interface Road {
  kind: RoadKind
  closed: boolean
  width: number
  points: RoadPoint[]
}

/** Painted width. */
export const ROAD_WIDTH = 11
/**
 * Half width of the perfectly level strip. Wider than the paint because the collider is
 * a 4 m triangle grid: a point 3.5 m off centre interpolates samples up to ~9 m out.
 */
export const ROAD_FLAT_HALF = 9.5
/** Blend from the level strip back to natural ground. */
export const ROAD_SHOULDER = 12
/** Longitudinal grade cap of the road profile: 0.2 is about 11.3 degrees. */
export const MAX_GRADE = 0.2
/** Grade the volcano tracer aims for, leaving room for the cap to smooth bumps. */
const TRACE_GRADE = 0.15
const STEP = 4
/** cos of the half angle of the sector the switchbacks stay in: 40 degrees. */
const SWITCHBACK_SECTOR_COS = 0.766044443118978

/** Radius of the rim road around the volcano centre. */
export function rimRoadRadius(data: TerrainData): number {
  return data.layout.volcano.calderaRadius * 1.45 + 4
}

/** Smooth the sampled heights along a road, then enforce the grade cap. */
function profile(pts: RoadPoint[], closed: boolean, startY?: number, endY?: number): void {
  const n = pts.length
  const src = pts.map((p) => p.y)
  const y = new Float64Array(n)
  const W = 5
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let k = -W; k <= W; k++) {
      let j = i + k
      if (closed) j = (j + n) % n
      else j = j < 0 ? 0 : j >= n ? n - 1 : j
      sum += src[j]
    }
    y[i] = sum / (2 * W + 1)
  }
  const ds = (i: number, j: number) => Math.sqrt(sq(pts[i].x - pts[j].x) + sq(pts[i].z - pts[j].z))
  const clampTo = (i: number, j: number) => {
    const lim = MAX_GRADE * ds(i, j)
    if (y[i] > y[j] + lim) y[i] = y[j] + lim
    else if (y[i] < y[j] - lim) y[i] = y[j] - lim
  }
  if (closed) {
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < n; i++) clampTo(i, (i - 1 + n) % n)
      for (let i = n - 1; i >= 0; i--) clampTo(i, (i + 1) % n)
    }
  } else {
    if (startY !== undefined) y[0] = startY
    for (let i = 1; i < n; i++) clampTo(i, i - 1)
    if (endY !== undefined) y[n - 1] = endY
    for (let i = n - 2; i >= 0; i--) clampTo(i, i + 1)
    // The backward pass may pull the start off its pin only if the pins are incompatible.
    for (let i = 1; i < n; i++) clampTo(i, i - 1)
  }
  for (let i = 0; i < n; i++) pts[i].y = y[i]
}

function rimRoad(data: TerrainData, s: HeightSampler): Road {
  const v = data.layout.volcano
  const R = rimRoadRadius(data)
  // 192 points by rotating a vector with exact literal cos and sin, so no Math.cos.
  const C = 0.9994645874763657
  const S = 0.03271908282177614
  let ux = 1
  let uz = 0
  const points: RoadPoint[] = []
  for (let i = 0; i < 192; i++) {
    const x = v.x + ux * R
    const z = v.z + uz * R
    points.push({ x, y: s.heightAt(x, z), z })
    const nx = ux * C - uz * S
    uz = ux * S + uz * C
    ux = nx
  }
  profile(points, true)
  return { kind: 'rim', closed: true, width: ROAD_WIDTH, points }
}

function volcanoRoad(data: TerrainData, s: HeightSampler, rim: Road): Road {
  const v = data.layout.volcano
  const reach = v.radius * (1 + v.gentleStretch)
  const ringR = rimRoadRadius(data)
  const ex = v.x + v.gentleX * reach * 0.9
  const ez = v.z + v.gentleZ * reach * 0.9
  let rot = (hash2(data.seed, 31, 7) & 1) === 0 ? 1 : -1
  let hairpin = false

  let [hx, hz] = normalize2(ex, ez)
  let px = hx * (SPAWN_FLAT_RADIUS - 15)
  let pz = hz * (SPAWN_FLAT_RADIUS - 15)
  const points: RoadPoint[] = [{ x: px, y: SPAWN_LEVEL, z: pz }]
  let climbing = false
  for (let step = 0; step < 1500; step++) {
    let dx: number
    let dz: number
    if (!climbing) {
      const tx = ex - px
      const tz = ez - pz
      if (tx * tx + tz * tz < 30 * 30) climbing = true
      ;[dx, dz] = normalize2(tx, tz)
    }
    if (climbing) {
      const cx = v.x - px
      const cz = v.z - pz
      const r = Math.sqrt(cx * cx + cz * cz)
      const ux = cx / r
      const uz = cz / r
      if (r <= ringR + STEP) {
        // Finish exactly on the rim road.
        const x = v.x - ux * ringR
        const z = v.z - uz * ringR
        points.push({ x, y: 0, z })
        break
      }
      // Uphill slope toward the centre, measured over 20 m to ignore small bumps.
      // Switch back at the edge of the sector, if still heading out of it.
      const ox = -ux
      const oz = -uz
      const axis = ox * v.gentleX + oz * v.gentleZ
      const side = ox * v.gentleZ - oz * v.gentleX // which side of the gentle axis we are on
      const tx = -uz * rot
      const tz = ux * rot
      const outward = (tx * v.gentleZ - tz * v.gentleX) * side > 0
      if (!hairpin && axis < SWITCHBACK_SECTOR_COS && outward) {
        rot = -rot
        hairpin = true
      }
      const slope = (s.heightAt(px + ux * 10, pz + uz * 10) - s.heightAt(px - ux * 10, pz - uz * 10)) / 20
      const sinA = slope > TRACE_GRADE ? TRACE_GRADE / slope : 1
      const cosA = Math.sqrt(1 - sinA * sinA)
      dx = -uz * rot * cosA + ux * sinA
      dz = ux * rot * cosA + uz * sinA
      if (hairpin && hx * dx + hz * dz > 0.985) hairpin = false
    }
    ;[hx, hz] = steer(hx, hz, dx!, dz!, hairpin ? TURN_HAIRPIN : TURN_GENTLE)
    px += hx * STEP
    pz += hz * STEP
    points.push({ x: px, y: s.heightAt(px, pz), z: pz })
  }
  // Pin the top to the rim road's height where they meet.
  const end = points[points.length - 1]
  let best = Infinity
  let endY = end.y
  for (const p of rim.points) {
    const d = sq(p.x - end.x) + sq(p.z - end.z)
    if (d < best) { best = d; endY = p.y }
  }
  profile(points, false, SPAWN_LEVEL, endY)
  return { kind: 'volcano', closed: false, width: ROAD_WIDTH, points }
}

function plainRoads(data: TerrainData, s: HeightSampler, main: Road): Road[] {
  const L = data.layout
  const v = L.volcano
  // Direction the main road leaves the pad, so plain roads fan out away from it.
  const m = main.points[Math.min(30, main.points.length - 1)]
  const [mx, mz] = normalize2(m.x, m.z)

  type Target = { x: number; z: number; stop: number; dist: number }
  const targets: Target[] = []
  for (const c of L.cones) targets.push({ x: c.x, z: c.z, stop: c.radius * 0.8, dist: 0 })
  for (const me of L.mesas) targets.push({ x: me.x, z: me.z, stop: me.radius * 1.55, dist: 0 })
  for (const t of targets) t.dist = Math.sqrt(t.x * t.x + t.z * t.z)
  targets.sort((a, b) => a.dist - b.dist)

  const want = 1 + (hash2(data.seed, 41, 3) & 1)
  const roads: Road[] = []
  const used: [number, number][] = [[mx, mz]]
  const seed = subSeed(data.seed, 40)
  for (const t of targets) {
    if (roads.length >= want) break
    const [dx, dz] = normalize2(t.x, t.z)
    // Fan out: at least ~40 degrees from the main road and from each other.
    if (used.some(([ux, uz]) => ux * dx + uz * dz > 0.76)) continue
    const len = t.dist - t.stop
    if (len < 150) continue
    // Stay off the volcano and away from other features.
    const clear = (x: number, z: number) => {
      if (volcanoT(v, x, z) < 1.08) return false
      for (const o of targets) {
        if (o === t) continue
        if (sq(x - o.x) + sq(z - o.z) < sq(o.stop + 25)) return false
      }
      return true
    }
    const points: RoadPoint[] = []
    const start = SPAWN_FLAT_RADIUS - 15
    let ok = true
    const count = Math.ceil((len - start) / STEP)
    for (let i = 0; i <= count; i++) {
      const f = i / count
      const along = start + (len - start) * f
      // A gentle meander, zero at both ends.
      const off = 45 * perlin(f * 2.2, 0.5, seed + roads.length) * 4 * f * (1 - f)
      const x = dx * along - dz * off
      const z = dz * along + dx * off
      if (!clear(x, z)) { ok = false; break }
      points.push({ x, y: s.heightAt(x, z), z })
    }
    if (!ok) continue
    profile(points, false, SPAWN_LEVEL)
    roads.push({ kind: 'plain', closed: false, width: ROAD_WIDTH, points })
    used.push([dx, dz])
  }
  return roads
}

/** Level the ground under every road and record the distance field for road paint. */
export function flattenRoads(data: TerrainData, roads: readonly Road[]): void {
  const reach = ROAD_FLAT_HALF + ROAD_SHOULDER
  const best = data.roadDist
  const target = new Float32Array(best.length)
  for (const road of roads) {
    const pts = road.points
    visitNearPolyline(data, pts, road.closed, reach, (i, d, seg, t) => {
      if (d >= best[i]) return
      best[i] = d
      const a = pts[seg]
      const b = pts[(seg + 1) % pts.length]
      target[i] = a.y + (b.y - a.y) * t
    })
  }
  const h = data.heights
  for (let i = 0; i < h.length; i++) {
    const d = best[i]
    if (d >= reach) continue
    const w = d <= ROAD_FLAT_HALF ? 1 : smoothstep(reach, ROAD_FLAT_HALF, d)
    h[i] += (target[i] - h[i]) * w
  }
}

export const roadsPass: TerrainPass = {
  name: 'roads',
  run(data) {
    const s = new HeightSampler(data)
    const rim = rimRoad(data, s)
    const main = volcanoRoad(data, s, rim)
    data.roads = [main, rim, ...plainRoads(data, s, main)]
    flattenRoads(data, data.roads)
  },
}
