/**
 * Lava and vent passes: deterministic feature data for the effects code (src/fx), plus
 * the channels and pools carved so the lava sits in the ground. Nothing here renders.
 *
 * Data shapes. All positions are world metres; y is height.
 *
 *   data.lava.lake: LavaLake | null
 *     { x, z, radius, surface, floor }
 *     A disc of `radius` at height `surface` filling the caldera. The crater walls rise
 *     above the surface, so the part of the disc under them is hidden by the terrain.
 *
 *   data.lava.rivers: LavaRiver[]   (usually 3 to 8)
 *     { points: {x, y, z}[], width, pool, bounds }
 *     Polyline about 6 m per point from its source downhill to its pool. Sources are just
 *     below the rim road and just below each place the volcano road crosses that flank,
 *     so one flow down the mountain is two or three rivers, broken where the road passes. y is the lava surface, never increasing along the river. `width` is the
 *     lava ribbon width; the carved channel is a little wider. `pool` is the pool it
 *     feeds (also listed in data.lava.pools). `bounds` is the xz bounding box, for fast
 *     queries.
 *
 *   data.lava.pools: LavaPool[]
 *     { x, z, radius, surface }   A disc of lava at `surface`, in a carved basin.
 *
 *   data.vents: Vent[]   (10 to 30)
 *     { x, y, z, kind: 'flame' | 'embers' | 'smoke', size }
 *     Emitter anchor on the lava or ground surface; `size` is a rough emitter radius in
 *     metres (about 2 to 8). Placed in the lake, at each river source, along the rivers,
 *     at pools and in the craters of the small cones.
 *
 * Rivers keep ROAD_CLEARANCE from every road centreline and from the spawn pad: a river
 * that would come closer ends there in its pool, so roads never cross lava.
 */
import {
  type TerrainData, type TerrainPass, SPAWN_BLEND_RADIUS, randomDirection, volcanoT,
} from './generate'
import { perlin, rng, smoothstep, subSeed } from './noise'
import { KIND_VOLCANIC } from './settings'
import { TURN_GENTLE, distanceToPolyline, normalize2, sq, steer, visitNearPolyline } from './raster'
import { ROAD_FLAT_HALF, ROAD_SHOULDER, rimRoadRadius } from './roads'
import { HeightSampler } from './sampler'

export interface LavaLake {
  x: number
  z: number
  radius: number
  surface: number
  floor: number
}

export interface LavaPool {
  x: number
  z: number
  radius: number
  surface: number
}

export interface LavaRiverPoint {
  x: number
  y: number
  z: number
}

export interface RiverDrop {
  start: number
  end: number
  height: number
  /**
   * The steepest DROP_RUN of travel inside the drop: where a free-falling sheet belongs, with
   * the rest of the drop a cascade. Indices into `points`, and the fall between them.
   */
  steepest: { start: number; end: number; height: number }
}

/** A run counts as a drop when the bed falls more than this many metres ... */
export const DROP_FALL = 4
/** ... over this many metres of travel. */
export const DROP_RUN = 12

/** Steep runs along a river's points (see LavaRiver.drops). */
export function findDrops(points: readonly LavaRiverPoint[]): RiverDrop[] {
  const drops: RiverDrop[] = []
  for (let i = 0; i < points.length - 1; i++) {
    // Walk forward until DROP_RUN of travel is covered.
    let run = 0
    let j = i
    while (j < points.length - 1 && run < DROP_RUN - 1e-6) {
      run += Math.sqrt(sq(points[j + 1].x - points[j].x) + sq(points[j + 1].z - points[j].z))
      j++
    }
    if (run < DROP_RUN - 1e-6) break
    if (points[i].y - points[j].y <= DROP_FALL) continue
    const last = drops[drops.length - 1]
    if (last && i <= last.end) last.end = Math.max(last.end, j)
    else drops.push({ start: i, end: j, height: 0, steepest: { start: i, end: j, height: 0 } })
    // Keep the steepest window seen so far within this drop.
    const d = drops[drops.length - 1]
    const fall = points[i].y - points[j].y
    if (fall > d.steepest.height) d.steepest = { start: i, end: j, height: fall }
  }
  for (const d of drops) d.height = points[d.start].y - points[d.end].y
  return drops
}

export interface LavaRiver {
  points: LavaRiverPoint[]
  width: number
  pool: LavaPool
  /**
   * Steep runs of the river: places for a waterfall. `start` and `end` are indices into
   * `points` and `height` is how far the bed falls between them, in metres. A run is steep
   * where the bed falls more than DROP_FALL over DROP_RUN of travel; overlapping runs are
   * merged. Often empty: most rivers descend smoothly.
   */
  drops: RiverDrop[]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export interface LavaFeatures {
  lake: LavaLake | null
  rivers: LavaRiver[]
  pools: LavaPool[]
}

export type VentKind = 'flame' | 'embers' | 'smoke'

export interface Vent {
  x: number
  y: number
  z: number
  kind: VentKind
  size: number
}

/** Lake surface above the flat caldera floor. */
export const LAKE_DEPTH = 1.5
const CHANNEL_HALF = 6
const CHANNEL_DEPTH = 2.4
/** Lava depth in the channel: the surface sits this far above the bed. */
const RIVER_LAVA_DEPTH = 1.4
const RIVER_STEP = 6
/** Shorter stretches between roads are not worth a river. */
const MIN_RIVER_LENGTH = 72
/** Minimum distance from a river centreline to a road centreline. */
export const ROAD_CLEARANCE = ROAD_FLAT_HALF + ROAD_SHOULDER + CHANNEL_HALF * 1.6 + 4
const SCORCH_RADIUS = 18

interface Planned {
  pts: { x: number; z: number }[]
  dirX: number
  dirZ: number
}

function planRivers(data: TerrainData, s: HeightSampler): Planned[] {
  const L = data.layout
  const v = L.volcano
  const next = rng(subSeed(data.seed, 50))
  const want = 2 + Math.floor(next() * 3)
  const half = data.size / 2
  const startR = rimRoadRadius(data) + ROAD_CLEARANCE + 4
  const meanderSeed = subSeed(data.seed, 51)

  const roadClear = (x: number, z: number) => {
    for (const r of data.roads) if (distanceToPolyline(r.points, r.closed, x, z) < ROAD_CLEARANCE) return false
    return L.spawns.every((p) => sq(x - p.x) + sq(z - p.z) > sq(SPAWN_BLEND_RADIUS + 30))
  }
  const accepted: Planned[] = []
  const riverClear = (x: number, z: number) =>
    accepted.every((r) => distanceToPolyline(r.pts, false, x, z) > CHANNEL_HALF * 4 + 20)
  const featureClear = (x: number, z: number) => {
    for (const c of L.cones) if (volcanoT(c, x, z) < 1.05) return false
    for (const m of L.mesas) if (sq(x - m.x) + sq(z - m.z) < sq(m.radius * 1.6)) return false
    return true
  }

  // 24 candidate directions, 15 degrees apart from a seeded start, tried in seeded order.
  const C15 = 0.9659258262890683
  const S15 = 0.25881904510252074
  let [ux, uz] = randomDirection(next)
  const dirs: [number, number][] = []
  for (let i = 0; i < 24; i++) {
    dirs.push([ux, uz])
    const nx = ux * C15 - uz * S15
    uz = ux * S15 + uz * C15
    ux = nx
  }
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    const t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t
  }

  // The volcano road spirals round the whole cone, so a river from the summit meets it
  // somewhere. Rivers never cross a road: each direction is walked outward from the rim
  // and every stretch clear of roads gets its own river, which ends in a pool where the
  // next road is. Seen from below, the lava runs down to the road, vanishes, and comes out
  // again beneath it, like a flow that has gone through a tube.
  const footR = v.radius * (1 + v.gentleStretch)
  let directions = 0
  for (const [dx0, dz0] of dirs) {
    if (directions >= want) break
    // At least ~50 degrees from the directions already used.
    if (accepted.some((r) => r.dirX * dx0 + r.dirZ * dz0 > 0.64 && r.dirX * dx0 + r.dirZ * dz0 < 0.9999)) continue
    const starts: number[] = []
    let wasClear = false
    for (let r0 = startR; r0 < footR; r0 += RIVER_STEP) {
      const clear = roadClear(v.x + dx0 * r0, v.z + dz0 * r0)
      if (clear && !wasClear) starts.push(r0 + (starts.length ? 4 : 0))
      wasClear = clear
    }
    let any = false
    for (const r0 of starts.slice(0, 3)) {
      let x = v.x + dx0 * r0
      let z = v.z + dz0 * r0
      if (!roadClear(x, z) || !riverClear(x, z)) continue
      const pts = [{ x, z }]
      let hx = dx0
      let hz = dz0
      let length = 0
      for (let step = 0; step < 220; step++) {
        const gx = (s.heightAt(x + 6, z) - s.heightAt(x - 6, z)) / 12
        const gz = (s.heightAt(x, z + 6) - s.heightAt(x, z - 6)) / 12
        const slope = Math.sqrt(gx * gx + gz * gz)
        const [ddx, ddz] = normalize2(-gx, -gz)
        const m = 0.25 * perlin(length * 0.012, accepted.length * 7.3, meanderSeed)
        const [wx, wz] = normalize2(hx * 0.55 + ddx * 0.45 - hz * m, hz * 0.55 + ddz * 0.45 + hx * m)
        ;[hx, hz] = steer(hx, hz, wx, wz, TURN_GENTLE)
        const nx = x + hx * RIVER_STEP
        const nz = z + hz * RIVER_STEP
        const edge = half - Math.max(Math.abs(nx), Math.abs(nz))
        if (edge < 200 || !roadClear(nx, nz) || !riverClear(nx, nz) || !featureClear(nx, nz)) break
        if (s.heightAt(nx, nz) > s.heightAt(x, z) + 0.5) break
        // Reached the sea: the river ends at the shore.
        if (s.heightAt(nx, nz) < 2) break
        x = nx
        z = nz
        length += RIVER_STEP
        pts.push({ x, z })
        if (volcanoT(v, x, z) > 1.0 && slope < 0.03) break
      }
      // Long enough to read as a river.
      if (length < MIN_RIVER_LENGTH) continue
      accepted.push({ pts, dirX: dx0, dirZ: dz0 })
      any = true
    }
    if (any) directions++
  }
  return accepted
}

/** Lowest ground on a ring around (x, z), for a pool surface that does not spill. */
function ringMin(s: HeightSampler, x: number, z: number, r: number): number {
  const C = 0.9238795325112867
  const S = 0.3826834323650898
  let ux = 1
  let uz = 0
  let min = Infinity
  for (let i = 0; i < 16; i++) {
    min = Math.min(min, s.heightAt(x + ux * r, z + uz * r))
    const nx = ux * C - uz * S
    uz = ux * S + uz * C
    ux = nx
  }
  return min
}

function scorch(data: TerrainData, i: number, d: number): void {
  const w = smoothstep(SCORCH_RADIUS, 3, d)
  if (w > data.volcanic[i]) data.volcanic[i] = w
}

export const lavaPass: TerrainPass = {
  name: 'lava',
  run(data) {
    const s = new HeightSampler(data)
    const v = data.layout.volcano
    const lake: LavaLake = {
      x: v.x, z: v.z, radius: v.calderaRadius, floor: v.floorHeight, surface: v.floorHeight + LAKE_DEPTH,
    }
    const next = rng(subSeed(data.seed, 52))
    const rivers: LavaRiver[] = []
    const pools: LavaPool[] = []
    const h = data.heights

    for (const plan of planRivers(data, s)) {
      // Pool at the river mouth, backing up the river if the pool would touch a road.
      let pts = plan.pts
      let pool: LavaPool | null = null
      for (let back = 0; back < 5 && pts.length > 9 && !pool; back++) {
        const end = pts[pts.length - 1]
        const prev = pts[Math.max(0, pts.length - 4)]
        const [dx, dz] = normalize2(end.x - prev.x, end.z - prev.z)
        // A short stretch between two wraps of the road gets a small pool that fits there.
        const radius = pts.length < 34 ? 9 + next() * 5 : 18 + next() * 18
        const px = end.x + dx * radius * 0.7
        const pz = end.z + dz * radius * 0.7
        const clear = data.roads.every(
          (r) => distanceToPolyline(r.points, r.closed, px, pz) > radius + ROAD_FLAT_HALF + ROAD_SHOULDER + 4,
        ) && pools.every((p) => sq(p.x - px) + sq(p.z - pz) > sq(p.radius + radius + 20))
        if (clear) pool = { x: px, z: pz, radius, surface: ringMin(s, px, pz, radius) - 0.4 }
        else pts = pts.slice(0, pts.length - 3)
      }
      if (!pool) continue

      // Bed follows the ground down, never rising, so the lava always flows downhill.
      const points: LavaRiverPoint[] = []
      let bed = Infinity
      for (const p of pts) {
        bed = Math.min(s.heightAt(p.x, p.z) - CHANNEL_DEPTH, bed - 0.05)
        points.push({ x: p.x, y: bed + RIVER_LAVA_DEPTH, z: p.z })
      }
      pool.surface = Math.min(pool.surface, points[points.length - 1].y)
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const p of points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
      }
      rivers.push({
        points,
        // Where the parabolic channel crosses the lava surface.
        width: 2 * CHANNEL_HALF * Math.sqrt(RIVER_LAVA_DEPTH / CHANNEL_DEPTH),
        pool,
        drops: findDrops(points),
        bounds: { minX, maxX, minZ, maxZ },
      })
      pools.push(pool)
    }

    // Carve after planning, so every river was traced on the same ground.
    for (const r of rivers) {
      const pts = r.points
      visitNearPolyline(data, pts, false, SCORCH_RADIUS, (i, d, seg, t) => {
        scorch(data, i, d)
        if (d > CHANNEL_HALF * 1.6) return
        const a = pts[seg]
        const b = pts[seg + 1]
        const bedY = a.y + (b.y - a.y) * t - RIVER_LAVA_DEPTH
        const target = bedY + CHANNEL_DEPTH * (d / CHANNEL_HALF) * (d / CHANNEL_HALF)
        if (target < h[i]) h[i] = target
      })
    }
    for (const p of pools) {
      const floor = p.surface - 2.5
      visitNearPolyline(data, [{ x: p.x, z: p.z }, { x: p.x, z: p.z }], false, p.radius + SCORCH_RADIUS, (i, d) => {
        scorch(data, i, d - p.radius)
        const f = d / p.radius
        const target = floor + (p.surface + 1.2 - floor) * f * f
        if (target < h[i]) h[i] = target
      })
    }
    data.lava = { lake, rivers, pools }
  },
}

export const ventsPass: TerrainPass = {
  name: 'vents',
  run(data) {
    // Only volcanic worlds burn. Elsewhere the lake and rivers are water and nothing vents.
    if (data.settings.kind !== KIND_VOLCANIC) { data.vents = []; return }
    const next = rng(subSeed(data.seed, 60))
    const s = new HeightSampler(data)
    const { lake, rivers, pools } = data.lava
    const vents: Vent[] = []
    const lakeVent = () => {
      if (!lake) return
      const [dx, dz] = randomDirection(next)
      const r = lake.radius * (0.15 + 0.5 * next())
      vents.push({
        x: lake.x + dx * r, y: lake.surface, z: lake.z + dz * r,
        kind: next() < 0.6 ? 'flame' : 'smoke', size: 3 + next() * 5,
      })
    }
    const lakeCount = 4 + Math.floor(next() * 4)
    for (let i = 0; i < lakeCount; i++) lakeVent()
    for (const r of rivers) {
      const src = r.points[0]
      vents.push({ x: src.x, y: src.y, z: src.z, kind: 'flame', size: 6 })
    }
    for (const p of pools) vents.push({ x: p.x, y: p.surface, z: p.z, kind: 'smoke', size: 5 })
    for (const c of data.layout.cones) {
      vents.push({ x: c.x, y: s.heightAt(c.x, c.z), z: c.z, kind: 'smoke', size: 4 + next() * 3 })
    }
    // Embers along the rivers, about every 120 m, while there is room under the cap.
    for (const r of rivers) {
      for (let i = 20; i < r.points.length - 10 && vents.length < 30; i += 20) {
        const p = r.points[i]
        vents.push({ x: p.x, y: p.y, z: p.z, kind: 'embers', size: 2 + next() * 2 })
      }
    }
    while (vents.length < 10) lakeVent()
    data.vents = vents.slice(0, 30)
  },
}

/**
 * Lava surface height at (x, z): the lake inside the caldera, pools and rivers where they
 * are, otherwise `fallback` (the world lava altitude). Where both apply, the higher wins.
 */
export function lavaSurfaceAt(lava: LavaFeatures, x: number, z: number, fallback: number): number {
  let y = fallback
  const lake = lava.lake
  if (lake && sq(x - lake.x) + sq(z - lake.z) < sq(lake.radius) && lake.surface > y) y = lake.surface
  for (const p of lava.pools) {
    if (sq(x - p.x) + sq(z - p.z) < sq(p.radius) && p.surface > y) y = p.surface
  }
  for (const r of lava.rivers) {
    const b = r.bounds
    const w = r.width / 2
    if (x < b.minX - w || x > b.maxX + w || z < b.minZ - w || z > b.maxZ + w) continue
    const pts = r.points
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const c = pts[i + 1]
      const dx = c.x - a.x
      const dz = c.z - a.z
      const len2 = dx * dx + dz * dz
      let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      if (sq(a.x + dx * t - x) + sq(a.z + dz * t - z) < w * w) {
        const sy = a.y + (c.y - a.y) * t
        if (sy > y) y = sy
      }
    }
  }
  return y
}

/**
 * Manning's roughness for a rocky mountain stream bed, s/m^(1/3). With the river's 1.4 m
 * depth as the hydraulic radius, Manning's formula v = R^(2/3) sqrt(S) / n gives the mean
 * speed of open channel flow down a bed of slope S.
 */
export const RIVER_MANNING_N = 0.035
/** Hydraulic radius of the carved channels: the surface sits 1.4 m above the bed. */
const RIVER_HYDRAULIC_RADIUS = 1.4

/**
 * Velocity of the liquid at (x, z) in metres per second, written to `out`: along the river
 * where (x, z) is on one, from Manning's formula and the local slope of the surface; zero in
 * the sea, the lake and the pools. Uses the same segment test as `lavaSurfaceAt`, taking the
 * segment whose surface is highest (the one `lavaSurfaceAt` reports). Speed is capped at
 * `maxSpeed`. Canonical tile coordinates.
 */
export function liquidFlowAt(
  lava: LavaFeatures, x: number, z: number, maxSpeed: number, out: { x: number; z: number },
): { x: number; z: number } {
  out.x = 0
  out.z = 0
  let best = -Infinity
  for (const r of lava.rivers) {
    const b = r.bounds
    const w = r.width / 2
    if (x < b.minX - w || x > b.maxX + w || z < b.minZ - w || z > b.maxZ + w) continue
    const pts = r.points
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const c = pts[i + 1]
      const dx = c.x - a.x
      const dz = c.z - a.z
      const len2 = dx * dx + dz * dz
      if (len2 <= 0) continue
      let t = ((x - a.x) * dx + (z - a.z) * dz) / len2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      if (sq(a.x + dx * t - x) + sq(a.z + dz * t - z) >= w * w) continue
      const sy = a.y + (c.y - a.y) * t
      if (sy <= best) continue
      best = sy
      const len = Math.sqrt(len2)
      const slope = Math.max(0, a.y - c.y) / len
      // A trickle even where the bed is level, so a river never stands still.
      const speed = Math.min(maxSpeed, Math.max(0.3, (RIVER_HYDRAULIC_RADIUS ** (2 / 3) * Math.sqrt(slope)) / RIVER_MANNING_N))
      out.x = (dx / len) * speed
      out.z = (dz / len) * speed
    }
  }
  // Lake and pools are still: a higher still surface there overrides the river.
  if (best > -Infinity) {
    const lake = lava.lake
    if (lake && sq(x - lake.x) + sq(z - lake.z) < sq(lake.radius) && lake.surface > best) { out.x = 0; out.z = 0 }
    for (const p of lava.pools) if (sq(x - p.x) + sq(z - p.z) < sq(p.radius) && p.surface > best) { out.x = 0; out.z = 0 }
  }
  return out
}
