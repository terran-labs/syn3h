/**
 * Roads pass: plans graded roads from the seed and flattens the heightfield under them.
 *
 *  - volcano: from spawn pad 0 to the foot of the volcano, then one rising spiral round the
 *    cone to the rim road, steered so the ground under it climbs at TRACE_GRADE.
 *  - rim:     a closed ring just outside the caldera lip
 *  - plain:   a closed ring round the volcano's foot, and one approach road from every
 *    other spawn pad inward to that ring, so every player has a road toward the centre
 *
 * Data shape (`data.roads`):
 *
 *   interface Road {
 *     kind: 'volcano' | 'rim' | 'plain'
 *     closed: boolean        // ring roads: the last point connects back to the first
 *     width: number          // paved width in metres (ROAD_WIDTH)
 *     points: RoadPoint[]    // centreline about 4 m apart; y is the road surface height
 *   }
 *
 * The surface across the road is level (it takes the centreline height of the nearest
 * point), the longitudinal grade is capped at MAX_GRADE, and shoulders blend back into
 * the terrain. `data.roadDist` holds each sample's distance to the nearest centreline for
 * the material's road paint.
 */
import {
  FOOT_RING, SPAWN_FLAT_RADIUS, SPAWN_LEVEL, type TerrainData, type TerrainPass, approachMeander, rimRadius,
} from './generate'
import { hash2, smoothstep } from './noise'
import { TURN_GENTLE, normalize2, sq, steer, visitNearPolyline } from './raster'
import { HeightSampler } from './sampler'
import { ROAD_WIDTH, ROAD_FLAT_HALF, ROAD_SHOULDER, MAX_GRADE } from './roadConstants'
// Preserve existing callers while keeping eager dimension reads outside the pass cycle.
export { FORD_DEPTH, ROAD_WIDTH, ROAD_FLAT_HALF, ROAD_SHOULDER, MAX_GRADE } from './roadConstants'

export interface RoadPoint {
  x: number
  y: number
  z: number
}

export type RoadKind = 'volcano' | 'rim' | 'plain'

/** A stretch of road under shallow water where a river crosses it. */
export interface RoadFord {
  /** Indices into the road's points: the first and last point under water. */
  start: number
  end: number
  /** Deepest water over the road along the stretch, in metres. */
  depth: number
}

export interface Road {
  kind: RoadKind
  closed: boolean
  width: number
  points: RoadPoint[]
  /** Fords along this road, filled by the lava pass when `terrain.fords` is on. Usually empty. */
  fords: RoadFord[]
}

/** Grade the volcano road is planned at, leaving room under the cap to smooth bumps. */
const TRACE_GRADE = 0.14
const STEP = 4

/** Radius of the rim road around the volcano centre. */
export function rimRoadRadius(data: TerrainData): number {
  return rimRadius(data.layout.volcano)
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
  return { kind: 'rim', closed: true, width: ROAD_WIDTH, points, fords: [] }
}

/**
 * The volcano road: one spiral from spawn pad 0 round the cone to the summit ring.
 *
 * The road has a planned height for every metre travelled (a steady climb at TRACE_GRADE),
 * and the tracer steers toward or away from the centre so the ground under it stays at
 * that height. So the road lies on the mountain like a contour that slowly rises: it winds
 * into gullies and round ridges instead of bridging them, the cone steepening toward the
 * top simply makes the spiral tighter, and there are no hairpins, which on a slope this
 * steep would need a cutting tens of metres deep.
 */
function volcanoRoad(data: TerrainData, s: HeightSampler, rim: Road): Road {
  const v = data.layout.volcano
  const reach = v.radius * (1 + v.gentleStretch)
  const ringR = rimRoadRadius(data)
  const summit = data.layout.summitHeight
  const ex = v.x + v.gentleX * reach * 0.9
  const ez = v.z + v.gentleZ * reach * 0.9
  const rot = (hash2(data.seed, 31, 7) & 1) === 0 ? 1 : -1

  // Start on the inward edge of spawn pad 0, which sits on the gentle axis.
  const pad = data.layout.spawns[0]
  let [hx, hz] = normalize2(ex - pad.x, ez - pad.z)
  let px = pad.x + hx * (SPAWN_FLAT_RADIUS - 15)
  let pz = pad.z + hz * (SPAWN_FLAT_RADIUS - 15)
  const points: RoadPoint[] = [{ x: px, y: SPAWN_LEVEL, z: pz }]
  let climbing = false
  let planned = SPAWN_LEVEL
  for (let step = 0; step < 3000; step++) {
    let dx: number
    let dz: number
    if (!climbing) {
      // Across the plain to the foot of the cone.
      const tx = ex - px
      const tz = ez - pz
      if (tx * tx + tz * tz < 30 * 30) {
        climbing = true
        planned = s.heightAt(px, pz)
      }
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
        points.push({ x: v.x - ux * ringR, y: 0, z: v.z - uz * ringR })
        break
      }
      const ground = s.heightAt(px, pz)
      if ((ground > summit - 1.5 && r < ringR + 40) || planned >= summit - 0.01) {
        // On the flat summit, or with the whole climb already paid for: straight in to the
        // ring road. Without the second test a wide flat top just below summit height could
        // keep the road circling.
        dx = ux
        dz = uz
      } else {
        planned = Math.min(summit, planned + TRACE_GRADE * STEP)
        // Below the plan: turn uphill, toward the centre. Above it: ease outward.
        let inward = (planned - ground) / 14
        inward = inward < -0.35 ? -0.35 : inward > 0.9 ? 0.9 : inward
        const along = Math.sqrt(1 - inward * inward)
        dx = -uz * rot * along + ux * inward
        dz = ux * rot * along + uz * inward
      }
    }
    ;[hx, hz] = steer(hx, hz, dx!, dz!, TURN_GENTLE)
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
  return { kind: 'volcano', closed: false, width: ROAD_WIDTH, points, fords: [] }
}

/** Radius of the foot ring road in the direction of unit vector (ux, uz). */
function footRadius(data: TerrainData, ux: number, uz: number): number {
  const v = data.layout.volcano
  let g = ux * v.gentleX + uz * v.gentleZ
  g = g > 0 ? g * g : 0
  return v.radius * (1 + v.gentleStretch * g) * FOOT_RING + 14
}

/** A closed road round the foot of the volcano, joining every approach. */
function footRoad(data: TerrainData, s: HeightSampler): Road {
  const v = data.layout.volcano
  // 256 points by rotating a vector with exact literal cos and sin, so no Math.cos.
  const C = 0.9996988186962042
  const S = 0.02454122852291229
  let ux = 1
  let uz = 0
  const points: RoadPoint[] = []
  for (let i = 0; i < 256; i++) {
    const R = footRadius(data, ux, uz)
    const x = v.x + ux * R
    const z = v.z + uz * R
    points.push({ x, y: s.heightAt(x, z), z })
    const nx = ux * C - uz * S
    uz = ux * S + uz * C
    ux = nx
  }
  profile(points, true)
  return { kind: 'plain', closed: true, width: ROAD_WIDTH, points, fords: [] }
}

/** One road from each spawn pad (except pad 0, which has the volcano road) to the foot ring. */
function approachRoads(data: TerrainData, s: HeightSampler): Road[] {
  const L = data.layout
  const padR = L.spawnRadius
  const roads: Road[] = []
  for (let i = 1; i < L.spawns.length; i++) {
    const p = L.spawns[i]
    const points: RoadPoint[] = []
    // `a` is the distance inward from the pad centre. The centreline follows the same
    // meander the shape pass keeps clear of mountains.
    for (let a = SPAWN_FLAT_RADIUS - 15; a < padR; a += STEP) {
      const off = approachMeander(a, L.seeds.approach + 31 * i)
      const x = p.dirX * (padR - a) - p.dirZ * off
      const z = p.dirZ * (padR - a) + p.dirX * off
      const r = Math.sqrt(x * x + z * z)
      if (r <= footRadius(data, x / r, z / r)) break
      points.push({ x, y: s.heightAt(x, z), z })
    }
    if (points.length < 8) continue
    profile(points, false, SPAWN_LEVEL)
    roads.push({ kind: 'plain', closed: false, width: ROAD_WIDTH, points, fords: [] })
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
    data.roads = [main, rim, footRoad(data, s), ...approachRoads(data, s)]
    flattenRoads(data, data.roads)
  },
}
