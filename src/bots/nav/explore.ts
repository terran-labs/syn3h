/**
 * Helpers for an exploring mind: named places worth driving to, and a coarse map of where
 * a vehicle has already been, so it can pick somewhere new that it can actually reach.
 *
 * Deterministic: places come from the terrain alone, and the only randomness is the
 * `random` function the caller injects.
 */
import type { NavPoint, NavProfile, Navigator, Route } from '../pilot/types'
import type { Terrain } from '../../world/Terrain'
import { EDGE_MARGIN, WET_CLEARANCE } from './grid'

export type PoiKind = 'spawn' | 'summit' | 'road-end' | 'road-mid' | 'vent' | 'peak' | 'shore'

export interface PointOfInterest {
  x: number
  z: number
  /** Surface height. */
  y: number
  kind: PoiKind
  name?: string
}

/** Places closer than this to an earlier place are dropped; earlier kinds in the list win. */
const POI_SPACING = 24
/** Spawn pads with their own spot. Matches SPAWN_PADS in the generator. */
const SPAWN_PADS = 8
/** Spacing of the grid local peaks are found on. */
const PEAK_GRID = 64
const PEAKS = 6
const SHORE_DIRECTIONS = 8

const COMPASS = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west']

/** Compass word for a direction. North is -Z, east is +X. */
function compass(dx: number, dz: number): string {
  const a = Math.atan2(dx, -dz)
  const i = Math.round(a / (Math.PI / 4))
  return COMPASS[(i + 8) % 8]
}

function liquidAt(terrain: Terrain, x: number, z: number): number {
  const l = terrain.liquidHeightAt?.(x, z)
  return l == null || Number.isNaN(l) ? -Infinity : l
}

function dry(terrain: Terrain, x: number, z: number): boolean {
  return terrain.heightAt(x, z) >= liquidAt(terrain, x, z) + WET_CLEARANCE
}

/**
 * Named, deterministic places worth driving to: spawn pads, the summit rim, road ends and
 * midpoints, vents, the highest local peaks and a few shore points, in that order.
 */
export function pointsOfInterest(terrain: Terrain): PointOfInterest[] {
  const out: PointOfInterest[] = []
  const half = terrain.size / 2 - EDGE_MARGIN
  const add = (x: number, z: number, kind: PoiKind, name?: string, y?: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > half || Math.abs(z) > half) return
    for (const p of out) if ((p.x - x) ** 2 + (p.z - z) ** 2 < POI_SPACING * POI_SPACING) return
    out.push({ x, z, y: y ?? terrain.heightAt(x, z), kind, name })
  }

  for (let i = 0; i < SPAWN_PADS; i++) {
    const p = terrain.spawnPoint(i).position
    add(p.x, p.z, 'spawn', `Pad ${i + 1}`)
  }

  const summit = terrain.summit?.() ?? null
  const centreX = summit?.x ?? 0
  const centreZ = summit?.z ?? 0
  const roads = terrain.roadPaths?.() ?? []
  if (summit) {
    const rim = roads.find((r) => r.kind === 'rim')
    for (let q = 0; q < 4; q++) {
      if (rim && rim.points.length >= 4) {
        const p = rim.points[Math.floor((q * rim.points.length) / 4)]
        add(p.x, p.z, 'summit', `Summit rim ${compass(p.x - centreX, p.z - centreZ)}`, p.y)
      } else {
        const a = (q * Math.PI) / 2
        const x = summit.x + Math.sin(a) * summit.rimRadius
        const z = summit.z - Math.cos(a) * summit.rimRadius
        add(x, z, 'summit', `Summit rim ${compass(x - centreX, z - centreZ)}`)
      }
    }
  }

  roads.forEach((r, i) => {
    const pts = r.points
    if (pts.length === 0) return
    const label = `${r.kind} road ${i + 1}`
    if (!r.closed) {
      add(pts[0].x, pts[0].z, 'road-end', `Start of ${label}`, pts[0].y)
      const e = pts[pts.length - 1]
      add(e.x, e.z, 'road-end', `End of ${label}`, e.y)
    }
    const m = pts[Math.floor(pts.length / 2)]
    add(m.x, m.z, 'road-mid', `Middle of ${label}`, m.y)
  })

  for (const v of terrain.vents?.() ?? []) add(v.x, v.z, 'vent', `${v.kind} vent`, v.y)

  // Local peaks on a coarse grid, away from the summit, highest first.
  const n = Math.floor(terrain.size / PEAK_GRID)
  const at = (i: number) => -terrain.size / 2 + (i + 0.5) * PEAK_GRID
  const heights = new Float64Array(n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = terrain.heightAt(at(i), at(j))
  const peaks: number[] = []
  const exclusion = summit ? summit.rimRadius * 1.6 : 0
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const h = heights[j * n + i]
      let top = true
      for (let dj = -1; dj <= 1 && top; dj++) for (let di = -1; di <= 1; di++) {
        if ((di || dj) && heights[(j + dj) * n + i + di] >= h) { top = false; break }
      }
      if (!top) continue
      const x = at(i), z = at(j)
      if (!dry(terrain, x, z) || Math.hypot(x - centreX, z - centreZ) < exclusion) continue
      peaks.push(j * n + i)
    }
  }
  peaks.sort((a, b) => heights[b] - heights[a] || a - b)
  for (const c of peaks.slice(0, PEAKS)) {
    const x = at(c % n), z = at(Math.floor(c / n))
    add(x, z, 'peak', `${compass(x - centreX, z - centreZ)} peak`)
  }

  // Shore points: march in from the world edge until the ground is dry.
  if (terrain.liquidHeightAt) {
    for (let q = 0; q < SHORE_DIRECTIONS; q++) {
      const a = (q * 2 * Math.PI) / SHORE_DIRECTIONS
      const ux = Math.sin(a), uz = -Math.cos(a)
      const far = half / Math.max(Math.abs(ux), Math.abs(uz))
      for (let r = far; r > 0; r -= 4) {
        const x = centreX + ux * r, z = centreZ + uz * r
        if (Math.abs(x) > half || Math.abs(z) > half) continue
        if (dry(terrain, x, z)) { add(x, z, 'shore', `${COMPASS[q]} shore`); break }
      }
    }
  }
  return out
}

/** A destination chosen by `pickFrontier`, with the route that reaches it. */
export interface Frontier {
  x: number
  z: number
  y: number
  kind: PoiKind | 'frontier'
  name?: string
  route: Route
}

export interface ExplorationOptions {
  /** Cell size in metres. Default 64. */
  cellSize?: number
  /** Places to prefer. Default `pointsOfInterest(terrain)`. */
  points?: PointOfInterest[]
}

/**
 * Preferred leg length, in cells: nearer than this is a dull hop, further costs time. The
 * score rises gently either side, so near places still win over far ones of equal novelty.
 */
const PREFERRED_CELLS = 3
/** How many of the best candidates `pickFrontier` chooses between at random. */
const SHORTLIST = 8
/** How many candidates it routes to before giving up for this call. */
const ROUTE_TRIES = 3

/** A coarse grid of where one vehicle has been. */
export class ExplorationMap {
  readonly cell: number
  readonly n: number
  readonly points: readonly PointOfInterest[]
  private readonly half: number
  private readonly visits: Uint16Array
  private readonly failures: Uint8Array
  /** 1 where the cell centre is dry land: the cells `visitedFraction` counts. */
  private readonly land: Uint8Array
  private readonly landCells: number
  /** Index of a point of interest inside each cell, or -1. */
  private readonly poiAt: Int32Array
  private last = -1

  constructor(private readonly terrain: Terrain, options: ExplorationOptions = {}) {
    this.cell = options.cellSize ?? 64
    this.n = Math.max(1, Math.floor(terrain.size / this.cell))
    this.half = terrain.size / 2
    const cells = this.n * this.n
    this.visits = new Uint16Array(cells)
    this.failures = new Uint8Array(cells)
    this.land = new Uint8Array(cells)
    this.poiAt = new Int32Array(cells).fill(-1)
    let land = 0
    for (let c = 0; c < cells; c++) {
      if (dry(terrain, this.centreX(c), this.centreZ(c))) { this.land[c] = 1; land++ }
    }
    this.landCells = land
    this.points = options.points ?? pointsOfInterest(terrain)
    this.points.forEach((p, i) => {
      const c = this.cellAt(p.x, p.z)
      if (c >= 0 && this.poiAt[c] < 0) this.poiAt[c] = i
    })
  }

  private centreX(c: number) { return -this.half + ((c % this.n) + 0.5) * this.cell }
  private centreZ(c: number) { return -this.half + (Math.floor(c / this.n) + 0.5) * this.cell }

  /** Cell index of a position, or -1 outside the grid. */
  cellAt(x: number, z: number): number {
    const i = Math.floor((x + this.half) / this.cell)
    const j = Math.floor((z + this.half) / this.cell)
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i
  }

  /**
   * Record the vehicle at (x, z). Counts an entry each time it moves into a different cell,
   * so the count does not depend on how often this is called. True on a first visit.
   */
  visit(x: number, z: number): boolean {
    const c = this.cellAt(x, z)
    if (c < 0 || c === this.last) return false
    this.last = c
    const first = this.visits[c] === 0
    if (this.visits[c] < 0xffff) this.visits[c]++
    return first
  }

  /** How many times the vehicle has entered the cell at (x, z). */
  visitsAt(x: number, z: number): number {
    const c = this.cellAt(x, z)
    return c < 0 ? 0 : this.visits[c]
  }

  /** Share of dry land cells visited at least once, 0..1. */
  visitedFraction(): number {
    if (this.landCells === 0) return 1
    let seen = 0
    for (let c = 0; c < this.land.length; c++) if (this.land[c] && this.visits[c] > 0) seen++
    return seen / this.landCells
  }

  /** Remember that a route to (x, z) failed, so it is picked less often. */
  markUnreachable(x: number, z: number): void {
    const c = this.cellAt(x, z)
    if (c >= 0 && this.failures[c] < 0xff) this.failures[c]++
  }

  /** Forget visits and failures. */
  reset(): void {
    this.visits.fill(0)
    this.failures.fill(0)
    this.last = -1
  }

  /**
   * A passable, little visited destination the navigator can reach from `from`, preferring
   * places about PREFERRED_CELLS cells away and points of interest. Shortlists the best scoring cells, picks between
   * them with `random`, and routes to up to ROUTE_TRIES of them. Null when none was reached.
   */
  pickFrontier(from: NavPoint, profile: NavProfile, navigator: Navigator, random: () => number): Frontier | null {
    const here = this.cellAt(from.x, from.z)
    const scored: { c: number; x: number; z: number; score: number }[] = []
    const q = this.cell / 4
    for (let c = 0; c < this.land.length; c++) {
      if (!this.land[c] || c === here) continue
      const poi = this.poiAt[c] >= 0 ? this.points[this.poiAt[c]] : null
      let x = poi ? poi.x : this.centreX(c)
      let z = poi ? poi.z : this.centreZ(c)
      if (!navigator.passable(x, z, profile)) {
        // Try a few fixed spots in the cell before giving up on it.
        const cx = this.centreX(c), cz = this.centreZ(c)
        const spots = [[cx - q, cz - q], [cx + q, cz - q], [cx - q, cz + q], [cx + q, cz + q]]
        const ok = spots.find(([sx, sz]) => navigator.passable(sx, sz, profile))
        if (!ok) continue
        x = ok[0]; z = ok[1]
      }
      const d = Math.hypot(x - from.x, z - from.z)
      const away = Math.abs(d - PREFERRED_CELLS * this.cell) / (6 * this.cell)
      const score = (1 + this.visits[c]) * (1 + 3 * this.failures[c]) * (0.4 + away) * (poi ? 0.5 : 1)
      scored.push({ c, x, z, score })
    }
    scored.sort((a, b) => a.score - b.score || a.c - b.c)
    const shortlist = scored.slice(0, SHORTLIST)
    for (let attempt = 0; attempt < ROUTE_TRIES && shortlist.length > 0; attempt++) {
      // Weighted pick: a lower score is a better place.
      let total = 0
      for (const s of shortlist) total += 1 / s.score
      let r = random() * total
      let k = 0
      for (; k < shortlist.length - 1; k++) { r -= 1 / shortlist[k].score; if (r <= 0) break }
      const pick = shortlist.splice(k, 1)[0]
      const route = navigator.route(from, { x: pick.x, z: pick.z }, profile)
      if (route && route.reached) {
        const poi = this.poiAt[pick.c] >= 0 ? this.points[this.poiAt[pick.c]] : null
        const usedPoi = poi && poi.x === pick.x && poi.z === pick.z ? poi : null
        const y = route.points[route.points.length - 1].y ?? this.terrain.heightAt(pick.x, pick.z)
        return { x: pick.x, z: pick.z, y, kind: usedPoi ? usedPoi.kind : 'frontier', name: usedPoi?.name, route }
      }
      this.failures[pick.c] = Math.min(0xff, this.failures[pick.c] + 1)
    }
    return null
  }
}
