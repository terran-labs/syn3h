/**
 * Open terrain navigator: plans a route any vehicle profile can travel, on or off road.
 *
 * Two lattices share one origin at the world's corner:
 *
 *   fine    nodes FINE (4 m) apart, exactly on the terrain's own height samples, so a fine
 *           node height is the collider height and an axis step between two of them follows
 *           a collider triangle edge. Ground and liquid heights are sampled lazily and cached.
 *   coarse  CELL (8 m) cells whose centres are every other fine node. A* runs on these,
 *           8 connected. A step between two cell centres passes through the fine node
 *           between them, so every step is checked as two 4 m half steps and a cliff
 *           narrower than a cell cannot be jumped.
 *
 * Step cost is horizontal metres times a grade factor times the road multiplier. Climbing
 * above `maxGrade` or descending or traversing above 1.5 times it is impassable; below that
 * the factor rises with the square of the grade, so a climb is cheapest at about half the
 * limit and a direct line up a steep face loses to switchbacks. Road cells are only those
 * whose ground agrees with the road's own height, so the stacked turns of the volcano spiral
 * never count as one road, and the bank between turns fails the grade check.
 *
 * The cell path is then string pulled: a straight segment replaces a run of cells only when
 * it passes the same checks sampled on the real surface and costs no more than the cells it
 * replaces (so a road or a switchback is not cut). Finally it is thinned to waypoints about
 * 10 to 25 m apart, each with a surface height.
 *
 * Deterministic: no clocks, no random numbers, fixed tie breaking.
 */
import type { NavPoint, NavProfile, Navigator, Route } from '../pilot/types'
import type { Terrain } from '../../world/Terrain'
import { NodeHeap } from './heap'
import { isRoadFord } from './fords'
import { onSeaSettled } from '../../world/seaLevel'

/** Coarse cell size in metres. Twice the terrain sample spacing; see the report in tests/bots/nav. */
export const CELL = 8
const FINE = CELL / 2
/** Bots keep this far inside the world edge (as isSafeGround in BotBrain does). */
export const EDGE_MARGIN = 3
/** A 'blocked' vehicle needs ground at least this far above the liquid. */
export const WET_CLEARANCE = 0.5
/** A cell is road only when the road surface is within this of the cell's ground. */
const ROAD_HEIGHT_TOLERANCE = 2
/** Road paint reaches width / 2; the level strip a little further. */
const ROAD_REACH = 2
/**
 * Searches stop after this many expansions and return the closest place reached. A ground
 * vehicle's whole reachable island is 15,000 to 22,000 cells, so a full flood (the cost of
 * proving a goal unreachable) fits; a hovercraft on open sea can be capped. Measured cost
 * is in tests/bots/nav/navigator.test.ts.
 */
export const MAX_EXPANSIONS = 30000
/** Grade weights: factor = 1 + K * (grade / limit)^2 for each component. */
const CLIMB_K = 3
const DESCENT_K = 1
const CROSS_K = 1.5
/** String pulling may replace a run of cells when the straight line costs at most this much more. */
const PULL_SLACK = 1.02
/** Look at most this many cells ahead when string pulling. */
const PULL_LOOK = 24
/** Waypoint spacing after thinning. */
const MIN_SPACING = 10
const MAX_SPACING = 25
/** Aircraft routes: one point every FLY_STEP metres. */
const FLY_STEP = 40
/** Search this many cells around an unusable start for a usable one. */
const SNAP_CELLS = 3
/**
 * An unusable goal (in lava, on a cliff) is replaced by the usable cell nearest it within
 * this many cells, so the search heads somewhere instead of flooding the island.
 */
const GOAL_SNAP_CELLS = 8
/** Edge costs are cached for this many distinct profiles (2 MB each on the default island). */
const EDGE_CACHES = 4

export interface NavigatorOptions {
  /** Expansion cap per query. Defaults to MAX_EXPANSIONS. */
  maxExpansions?: number
}

export interface GridNavigator extends Navigator {
  /** Stop listening for terrain regeneration. */
  dispose(): void
  /** What the last `route` call did, for tests and profiling. */
  readonly lastQuery: { expansions: number; capped: boolean }
  /** Bytes held by the caches (allocated up front, filled lazily). */
  readonly memoryBytes: number
}

const LIQUID_BLOCKED = 0
const LIQUID_SURFACE = 1
const LIQUID_IGNORED = 2

/** Per query limits derived from a profile. */
interface Limits {
  mode: number
  climb: number
  descent: number
  slope: number
  road: number
}

function limitsFor(profile: NavProfile): Limits {
  const climb = Math.max(0.01, profile.maxGrade)
  return {
    mode: profile.liquid === 'blocked' ? LIQUID_BLOCKED : profile.liquid === 'surface' ? LIQUID_SURFACE : LIQUID_IGNORED,
    climb,
    descent: climb * 1.5,
    slope: climb * 1.5,
    road: Math.min(1, Math.max(0.05, profile.roadCost)),
  }
}

const SQRT2 = Math.SQRT2
const DX = [1, -1, 0, 0, 1, 1, -1, -1]
const DZ = [0, 0, 1, -1, 1, -1, 1, -1]

export function createNavigator(terrain: Terrain, options: NavigatorOptions = {}): GridNavigator {
  const maxExpansions = options.maxExpansions ?? MAX_EXPANSIONS
  let half = terrain.size / 2
  let nf = Math.floor(terrain.size / FINE) + 1
  let nc = Math.floor((nf - 1) / 2)
  let ground = new Float32Array(nf * nf)
  let liquid = new Float32Array(nf * nf)
  let road = new Uint8Array(nc * nc)
  let roadsReady = false
  /** Cells marked as road. With none, the heuristic needs no road discount. */
  let roadCells = 0
  let g = new Float32Array(nc * nc)
  let parent = new Int32Array(nc * nc)
  let seen = new Uint32Array(nc * nc)
  let closed = new Uint32Array(nc * nc)
  let stamp = 0
  /** Per profile: the cost of each of the 8 steps out of every cell. NaN until computed. */
  let edgeCaches: { key: string; cost: Float32Array }[] = []
  const heap = new NodeHeap()
  const lastQuery = { expansions: 0, capped: false }

  function allocate() {
    half = terrain.size / 2
    nf = Math.floor(terrain.size / FINE) + 1
    nc = Math.floor((nf - 1) / 2)
    if (ground.length !== nf * nf) {
      ground = new Float32Array(nf * nf)
      liquid = new Float32Array(nf * nf)
    }
    if (road.length !== nc * nc) {
      road = new Uint8Array(nc * nc)
      g = new Float32Array(nc * nc)
      parent = new Int32Array(nc * nc)
      seen = new Uint32Array(nc * nc)
      closed = new Uint32Array(nc * nc)
    }
    ground.fill(NaN)
    edgeCaches = []
    road.fill(0)
    seen.fill(0)
    closed.fill(0)
    stamp = 0
    roadsReady = false
    roadCells = 0
  }
  allocate()

  const liquidAt = (x: number, z: number): number => {
    const l = terrain.liquidHeightAt?.(x, z)
    return l == null || Number.isNaN(l) ? -Infinity : l
  }

  // ---- fine lattice ---------------------------------------------------------------------

  /** Load fine node k (row major) into the cache. */
  function load(k: number): void {
    if (!Number.isNaN(ground[k])) return
    const x = -half + (k % nf) * FINE
    const z = -half + Math.floor(k / nf) * FINE
    ground[k] = terrain.heightAt(x, z)
    liquid[k] = liquidAt(x, z)
  }

  /** Surface the profile drives on at fine node k. */
  function surface(k: number, mode: number): number {
    load(k)
    const h = ground[k]
    if (mode === LIQUID_SURFACE) { const l = liquid[k]; return l > h ? l : h }
    return h
  }

  const clampF = (i: number) => (i < 0 ? 0 : i >= nf ? nf - 1 : i)
  const inside = (x: number, z: number) => Math.abs(x) <= half - EDGE_MARGIN && Math.abs(z) <= half - EDGE_MARGIN

  // Gradient of the last `stand` call, read by the cross slope cost.
  let gradX = 0
  let gradZ = 0

  /** True when the profile may stand at fine node (fx, fz). Leaves the surface gradient in gradX, gradZ. */
  function stand(fx: number, fz: number, L: Limits): boolean {
    const x = -half + fx * FINE
    const z = -half + fz * FINE
    if (!inside(x, z)) return false
    const k = fz * nf + fx
    load(k)
    if (L.mode === LIQUID_BLOCKED && ground[k] < liquid[k] + WET_CLEARANCE && !isRoadFord(terrain, x, z)) return false
    const x0 = clampF(fx - 1), x1 = clampF(fx + 1), z0 = clampF(fz - 1), z1 = clampF(fz + 1)
    gradX = (surface(fz * nf + x1, L.mode) - surface(fz * nf + x0, L.mode)) / ((x1 - x0) * FINE)
    gradZ = (surface(z1 * nf + fx, L.mode) - surface(z0 * nf + fx, L.mode)) / ((z1 - z0) * FINE)
    return gradX * gradX + gradZ * gradZ <= L.slope * L.slope
  }

  /** Grade factor for travel along (ux, uz) at grade `grade`, using the gradient from the last `stand`. */
  function factor(grade: number, ux: number, uz: number, L: Limits): number {
    if (grade > L.climb || -grade > L.descent) return Infinity
    const cross = Math.abs(gradX * uz - gradZ * ux)
    if (cross > L.slope) return Infinity
    const c = grade > 0 ? grade / L.climb : 0
    const d = grade < 0 ? grade / L.descent : 0
    const t = cross / L.slope
    return 1 + CLIMB_K * c * c + DESCENT_K * d * d + CROSS_K * t * t
  }

  /**
   * Cost of one half step between neighbouring fine nodes, or Infinity. A diagonal from
   * (ix, iz) to (ix + 1, iz + 1) crosses the collider's split line (the anti diagonal, see
   * sampler.ts), where the surface bends; it is checked as two quarter steps through the
   * height on that line, so neither half of the bend can hide a grade over the limit.
   */
  function halfStep(ax: number, az: number, bx: number, bz: number, L: Limits): number {
    if (!stand(bx, bz, L)) return Infinity
    const diagonal = ax !== bx && az !== bz
    const run = diagonal ? FINE * SQRT2 : FINE
    const ux = (bx - ax) * FINE / run
    const uz = (bz - az) * FINE / run
    const sa = surface(az * nf + ax, L.mode)
    const sb = surface(bz * nf + bx, L.mode)
    if (diagonal && bx - ax === bz - az) {
      const mid = (surface(az * nf + bx, L.mode) + surface(bz * nf + ax, L.mode)) / 2
      const q = run / 2
      return q * (factor((mid - sa) / q, ux, uz, L) + factor((sb - mid) / q, ux, uz, L))
    }
    return run * factor((sb - sa) / run, ux, uz, L)
  }

  // ---- roads ----------------------------------------------------------------------------

  /** Mark coarse cells on a road whose surface agrees with the cell's ground. */
  function buildRoads(): void {
    roadsReady = true
    const roads = terrain.roadPaths?.() ?? []
    for (const r of roads) {
      const reach = r.width / 2 + ROAD_REACH
      const pts = r.points
      for (let p = 0; p < pts.length; p++) {
        const a = pts[p]
        // Points are about 4 m apart; add the midpoint to the next so no cell is skipped.
        const b = pts[p + 1] ?? (r.closed ? pts[0] : a)
        for (let s = 0; s < 2; s++) {
          const x = s === 0 ? a.x : (a.x + b.x) / 2
          const z = s === 0 ? a.z : (a.z + b.z) / 2
          const y = s === 0 ? a.y : (a.y + b.y) / 2
          const i0 = Math.max(0, Math.floor((x - reach + half) / CELL))
          const i1 = Math.min(nc - 1, Math.floor((x + reach + half) / CELL))
          const j0 = Math.max(0, Math.floor((z - reach + half) / CELL))
          const j1 = Math.min(nc - 1, Math.floor((z + reach + half) / CELL))
          for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
              const cx = -half + (i + 0.5) * CELL
              const cz = -half + (j + 0.5) * CELL
              if ((cx - x) ** 2 + (cz - z) ** 2 > reach * reach) continue
              const k = (2 * j + 1) * nf + 2 * i + 1
              load(k)
              if (road[j * nc + i] === 0 && Math.abs(ground[k] - y) <= ROAD_HEIGHT_TOLERANCE) { road[j * nc + i] = 1; roadCells++ }
            }
          }
        }
      }
    }
  }

  function roadMultiplier(a: number, b: number, L: Limits): number {
    const n = road[a] + road[b]
    return n === 2 ? L.road : n === 1 ? (1 + L.road) / 2 : 1
  }

  // ---- exact surface checks for smoothing -------------------------------------------------

  /** Surface height the profile drives on at an arbitrary point. */
  function exactSurface(x: number, z: number, mode: number): number {
    const h = terrain.heightAt(x, z)
    if (mode !== LIQUID_SURFACE) return h
    const l = liquidAt(x, z)
    return l > h ? l : h
  }

  const fineIndex = (v: number) => clampF(Math.round((v + half) / FINE))
  const cellOf = (v: number) => {
    const i = Math.floor((v + half) / CELL)
    return i < 0 ? 0 : i >= nc ? nc - 1 : i
  }

  /**
   * Cost of driving the straight segment, sampled every FINE metres or less on the real
   * surface, or Infinity when any sample fails. Standing and cross slope use the nearest
   * fine node; grade uses the exact heights.
   */
  function segmentCost(ax: number, az: number, bx: number, bz: number, L: Limits): number {
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 1e-6) return 0
    const n = Math.ceil(len / FINE)
    const run = len / n
    const ux = (bx - ax) / len
    const uz = (bz - az) / len
    let prev = exactSurface(ax, az, L.mode)
    let prevCell = cellOf(az) * nc + cellOf(ax)
    let cost = 0
    for (let s = 1; s <= n; s++) {
      const t = s / n
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      if (!inside(x, z)) return Infinity
      if (!stand(fineIndex(x), fineIndex(z), L)) return Infinity
      if (L.mode === LIQUID_BLOCKED) {
        const h = terrain.heightAt(x, z)
        if (h < liquidAt(x, z) + WET_CLEARANCE && !isRoadFord(terrain, x, z)) return Infinity
      }
      const y = exactSurface(x, z, L.mode)
      const f = factor((y - prev) / run, ux, uz, L)
      if (f === Infinity) return Infinity
      const cell = cellOf(z) * nc + cellOf(x)
      cost += run * f * roadMultiplier(prevCell, cell, L)
      prev = y
      prevCell = cell
    }
    return cost
  }

  // ---- search -----------------------------------------------------------------------------

  const centreX = (cell: number) => -half + ((cell % nc) + 0.5) * CELL
  const centreZ = (cell: number) => -half + (Math.floor(cell / nc) + 0.5) * CELL
  const cellStands = (cell: number, L: Limits) => stand(2 * (cell % nc) + 1, 2 * Math.floor(cell / nc) + 1, L)

  /** The usable cell nearest (x, z) within SNAP_CELLS, or -1. */
  function snap(x: number, z: number, L: Limits, radius = SNAP_CELLS): number {
    const ci = cellOf(x)
    const cj = cellOf(z)
    if (cellStands(cj * nc + ci, L)) return cj * nc + ci
    let best = -1
    let bestD = Infinity
    for (let j = Math.max(0, cj - radius); j <= Math.min(nc - 1, cj + radius); j++) {
      for (let i = Math.max(0, ci - radius); i <= Math.min(nc - 1, ci + radius); i++) {
        const c = j * nc + i
        const d = (centreX(c) - x) ** 2 + (centreZ(c) - z) ** 2
        if (d < bestD && cellStands(c, L)) { bestD = d; best = c }
      }
    }
    return best
  }

  function edgesFor(profile: NavProfile): Float32Array {
    const key = `${profile.maxGrade}|${profile.liquid}|${profile.roadCost}`
    const i = edgeCaches.findIndex((e) => e.key === key)
    if (i >= 0) {
      const hit = edgeCaches[i]
      if (i > 0) { edgeCaches.splice(i, 1); edgeCaches.unshift(hit) }
      return hit.cost
    }
    const cost = new Float32Array(nc * nc * 8).fill(NaN)
    edgeCaches.unshift({ key, cost })
    if (edgeCaches.length > EDGE_CACHES) edgeCaches.pop()
    return cost
  }

  function search(start: number, goal: number, L: Limits, edges: Float32Array): { end: number; reached: boolean } {
    stamp++
    if (stamp === 0xffffffff) { seen.fill(0); closed.fill(0); stamp = 1 }
    heap.clear()
    const gi = goal % nc
    const gj = Math.floor(goal / nc)
    // The cheapest possible step is a road step, so octile distance times that stays admissible.
    const cheapest = roadCells > 0 ? L.road : 1
    const h = (cell: number) => {
      const di = Math.abs((cell % nc) - gi)
      const dj = Math.abs(Math.floor(cell / nc) - gj)
      return (di > dj ? di + (SQRT2 - 1) * dj : dj + (SQRT2 - 1) * di) * CELL * cheapest
    }
    g[start] = 0
    parent[start] = -1
    seen[start] = stamp
    heap.push(start, h(start))
    let best = start
    let bestH = h(start)
    let expansions = 0
    let capped = false
    while (heap.size > 0) {
      const cell = heap.pop()
      if (closed[cell] === stamp) continue
      closed[cell] = stamp
      if (cell === goal) { lastQuery.expansions = expansions; lastQuery.capped = false; return { end: goal, reached: true } }
      const ch = h(cell)
      if (ch < bestH || (ch === bestH && g[cell] < g[best])) { bestH = ch; best = cell }
      if (++expansions > maxExpansions) { capped = true; break }
      const i = cell % nc
      const j = Math.floor(cell / nc)
      const fx = 2 * i + 1
      const fz = 2 * j + 1
      const base = g[cell]
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d]
        const nj = j + DZ[d]
        if (ni < 0 || nj < 0 || ni >= nc || nj >= nc) continue
        const next = nj * nc + ni
        if (closed[next] === stamp) continue
        let step = edges[cell * 8 + d]
        if (step !== step) {
          const a = halfStep(fx, fz, fx + DX[d], fz + DZ[d], L)
          const b = a === Infinity ? Infinity : halfStep(fx + DX[d], fz + DZ[d], fx + 2 * DX[d], fz + 2 * DZ[d], L)
          // Rounded as the cache stores it, so a cold query and a warm one agree exactly.
          step = Math.fround((a + b) * roadMultiplier(cell, next, L))
          edges[cell * 8 + d] = step
        }
        if (step === Infinity) continue
        const value = base + step
        if (seen[next] !== stamp || value < g[next]) {
          seen[next] = stamp
          g[next] = value
          parent[next] = cell
          heap.push(next, value + h(next))
        }
      }
    }
    lastQuery.expansions = expansions
    lastQuery.capped = capped
    return { end: best, reached: false }
  }

  // ---- smoothing --------------------------------------------------------------------------

  interface Node { x: number; z: number; g: number }

  /** Replace runs of cells with straight segments that are no worse; see the header. */
  function pull(path: Node[], L: Limits): Node[] {
    const out: Node[] = [path[0]]
    let a = 0
    while (a < path.length - 1) {
      let take = a + 1
      let misses = 0
      for (let t = a + 2; t < path.length && t <= a + PULL_LOOK; t++) {
        const c = segmentCost(path[a].x, path[a].z, path[t].x, path[t].z, L)
        if (c <= (path[t].g - path[a].g) * PULL_SLACK + 0.5) { take = t; misses = 0 } else if (++misses >= 3) break
      }
      out.push(path[take])
      a = take
    }
    return out
  }

  /** Drop points closer than MIN_SPACING where the straight line allows, then split long legs. */
  function thin(path: Node[], L: Limits): Node[] {
    const kept: Node[] = [path[0]]
    for (let i = 1; i < path.length - 1; i++) {
      const last = kept[kept.length - 1]
      const p = path[i]
      const nextP = path[i + 1]
      if (Math.hypot(p.x - last.x, p.z - last.z) < MIN_SPACING &&
        segmentCost(last.x, last.z, nextP.x, nextP.z, L) <= (nextP.g - last.g) * PULL_SLACK + 0.5) continue
      kept.push(p)
    }
    if (path.length > 1) kept.push(path[path.length - 1])
    const out: Node[] = [kept[0]]
    for (let i = 1; i < kept.length; i++) {
      const a = kept[i - 1]
      const b = kept[i]
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      const n = Math.ceil(len / MAX_SPACING)
      for (let s = 1; s < n; s++) out.push({ x: a.x + (b.x - a.x) * s / n, z: a.z + (b.z - a.z) * s / n, g: a.g + (b.g - a.g) * s / n })
      out.push(b)
    }
    return out
  }

  // ---- aircraft ---------------------------------------------------------------------------

  function flyRoute(from: NavPoint, to: NavPoint, profile: NavProfile): Route {
    const len = Math.hypot(to.x - from.x, to.z - from.z)
    const n = Math.max(1, Math.ceil(len / FLY_STEP))
    const step = len / n
    // Highest surface (ground or liquid) along the line. The collider is linear between its
    // 4 m samples, so the highest of the lattice nodes around a point bounds every triangle
    // near it; sampling every half node with the 3 by 3 nodes around each catches peaks a
    // plain line sample would slip past on a crag.
    const samples = Math.max(1, Math.ceil(len / (FINE / 2)))
    const tops = new Float64Array(samples + 1)
    for (let s = 0; s <= samples; s++) {
      const t = s / samples
      const fx = fineIndex(from.x + (to.x - from.x) * t)
      const fz = fineIndex(from.z + (to.z - from.z) * t)
      let top = -Infinity
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = surface(clampF(fz + dz) * nf + clampF(fx + dx), LIQUID_SURFACE)
          if (y > top) top = y
        }
      }
      tops[s] = top
    }
    const points: NavPoint[] = []
    for (let i = 0; i <= n; i++) {
      // Window from one leg back to two legs ahead: both ends of every leg then clear
      // everything under it, so the straight climb or descent between them does too.
      const lo = Math.max(0, Math.floor(((i - 1) * step / len) * samples))
      const hi = Math.min(samples, Math.ceil(((i + 2) * step / len) * samples))
      let top = -Infinity
      for (let s = lo; s <= hi; s++) if (tops[s] > top) top = tops[s]
      if (len < 1e-6) top = tops[0]
      const t = i / n
      points.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t, y: top + profile.cruiseAltitude })
    }
    lastQuery.expansions = 0
    lastQuery.capped = false
    return { points, cost: len, reached: true }
  }

  // ---- public -----------------------------------------------------------------------------

  function route(from: NavPoint, to: NavPoint, profile: NavProfile): Route | null {
    if (profile.flies) return flyRoute(from, to, profile)
    if (!roadsReady) buildRoads()
    const L = limitsFor(profile)
    const start = snap(from.x, from.z, L)
    if (start < 0) return null
    let goal = snap(to.x, to.z, L)
    const goalUsable = goal >= 0
    if (!goalUsable) goal = snap(to.x, to.z, L, GOAL_SNAP_CELLS)
    if (goal < 0) goal = cellOf(to.z) * nc + cellOf(to.x)
    const found = search(start, goal, L, edgesFor(profile))
    const reached = found.reached && goalUsable
    const cells: number[] = []
    for (let c = found.end; c !== -1; c = parent[c]) cells.push(c)
    cells.reverse()
    let path: Node[] = cells.map((c) => ({ x: centreX(c), z: centreZ(c), g: g[c] }))
    // Begin at the vehicle and end at the goal itself where the line from the cell centre allows.
    const startLeg = segmentCost(from.x, from.z, path[0].x, path[0].z, L)
    if (startLeg !== Infinity) {
      for (const p of path) p.g += startLeg
      if (path.length > 1 || startLeg > 0) path.unshift({ x: from.x, z: from.z, g: 0 })
    }
    const last = path[path.length - 1]
    if (reached) {
      const endLeg = segmentCost(last.x, last.z, to.x, to.z, L)
      if (endLeg !== Infinity) path.push({ x: to.x, z: to.z, g: last.g + endLeg })
    }
    const cost = path[path.length - 1].g
    if (path.length > 2) path = thin(pull(path, L), L)
    const points = path.map((p) => ({ x: p.x, z: p.z, y: exactSurface(p.x, p.z, L.mode) }))
    return { points, cost, reached }
  }

  function passable(x: number, z: number, profile: NavProfile): boolean {
    if (!inside(x, z)) return false
    if (profile.flies) return true
    const L = limitsFor(profile)
    if (L.mode === LIQUID_BLOCKED && terrain.heightAt(x, z) < liquidAt(x, z) + WET_CLEARANCE && !isRoadFord(terrain, x, z)) return false
    const e = FINE
    const gx = (exactSurface(x + e, z, L.mode) - exactSurface(x - e, z, L.mode)) / (2 * e)
    const gz = (exactSurface(x, z + e, L.mode) - exactSurface(x, z - e, L.mode)) / (2 * e)
    return gx * gx + gz * gz <= L.slope * L.slope
  }

  const unsubscribe = terrain.onRegenerate?.(() => allocate())
  // The wet cells are cached; a sea that has glided to a new level makes them stale.
  const unsubscribeSea = onSeaSettled(() => allocate())

  return {
    route,
    passable,
    invalidate: allocate,
    dispose() { unsubscribe?.(); unsubscribeSea() },
    lastQuery,
    get memoryBytes() {
      return edgeCaches.reduce((a, e) => a + e.cost.byteLength, 0) + ground.byteLength + liquid.byteLength + road.byteLength + g.byteLength + parent.byteLength + seen.byteLength + closed.byteLength
    },
  }
}
