import * as THREE from 'three/webgpu'
import { abs, float, materialColor, max, mix, mx_noise_float, smoothstep, time, uv, vec3 } from 'three/tsl'
import { DROP_FALL, findDrops, riverSpeed, type LavaFeatures, type RiverDrop } from '../terrain/lava'
import { KIND_VOLCANIC } from '../terrain/settings'
import { waterWaves } from './params'

type Point = { x: number; y: number; z: number }
type Ground = { heightAt(x: number, z: number): number }

/** Water depth over the carved channel bed (lava.ts RIVER_LAVA_DEPTH) plus sampling slack. */
export const RIVER_DRAPE_DEPTH = 1.7

/**
 * Where a water river is, drawn and floated on alike (drapedRivers; physics reads it through
 * ProceduralTerrain.waterRivers). The planned surface (`points[].y`) never rises, but the ground under it can fall away faster: a mouth pool carved into a
 * bowl, or a cliff the channel carve could not follow on the 4 m grid. Drawn at the planned
 * height there, the ribbon is a level slab hanging in the air. Unsupported water falls, so
 * each point is lowered to sit no more than RIVER_DRAPE_DEPTH above the ground under it, or
 * on the receiving water (`waterAt`: lake, pool or sea surface, -Infinity where there is
 * none), whichever is higher. The tail that lies on the receiving water is cut one point in,
 * so the ribbon meets that surface instead of lying flat on it.
 */
export function drapeRiver(ground: Ground, points: readonly Point[], waterAt: (x: number, z: number) => number): Point[] {
  // On the ribbon's own 3 m spacing, so no vertex the ribbon adds lies between drape samples.
  const dense: Point[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / DRAPE_STEP))
    for (let k = 0; k < n; k++) dense.push(lerp(a, b, k / n))
  }
  dense.push(points[points.length - 1])
  const out: Point[] = []
  const held = (p: Point, y: number) => Math.min(y, Math.max(ground.heightAt(p.x, p.z) + RIVER_DRAPE_DEPTH, waterAt(p.x, p.z)))
  for (const p of dense) {
    const y = held(p, p.y)
    const prev = out[out.length - 1]
    if (prev && prev.y - y > RIVER_DRAPE_DEPTH) {
      // Support ends somewhere in this step: carry the water level to that edge, the lip.
      let lo = 0, hi = 1
      for (let k = 0; k < 8; k++) {
        const t = (lo + hi) / 2
        if (held(lerp(prev, p, t), prev.y) >= prev.y - .05) lo = t; else hi = t
      }
      if (lo > .02) out.push({ ...lerp(prev, p, lo), y: prev.y })
    }
    out.push({ x: p.x, y, z: p.z })
    // Once the river reaches still water it has arrived: stop one point inside.
    if (out.length > 1 && y <= waterAt(p.x, p.z) + .05) break
  }
  return out
}

const DRAPE_STEP = 2.5

/** The water a river's mouth runs into: the lake, a pool or the sea, -Infinity where there is none. */
export function receivingWater(lava: LavaFeatures, sea: number): (x: number, z: number) => number {
  const bodies = lava.lake ? [lava.lake, ...lava.pools] : lava.pools
  return (x, z) => {
    let y = sea
    for (const b of bodies) if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.radius ** 2) y = Math.max(y, b.surface)
    return y
  }
}

/** Per world, the drapes for the last few sea levels: physics reads the live, gliding level and
 * grass the target one, and one slot would make them push each other out on every call. */
const draped = new WeakMap<LavaFeatures, { sea: number; ground: Ground; rivers: readonly (readonly Point[])[] }[]>()
const DRAPES_KEPT = 4

/**
 * Every river's draped centre line (`drapeRiver`), in `lava.rivers` order: the surface water
 * rivers are drawn at and float things at. A pure function of the world (its rivers, its ground)
 * and the sea level, so every client computes the same line. Memoised per world and sea level;
 * the sea gliding to a new level recomputes it, a few milliseconds.
 */
export function drapedRivers(lava: LavaFeatures, ground: Ground, sea: number): readonly (readonly Point[])[] {
  let kept = draped.get(lava)
  if (!kept) draped.set(lava, (kept = []))
  const known = kept.find((k) => k.sea === sea && k.ground === ground)
  if (known) return known.rivers
  const waterAt = receivingWater(lava, sea)
  const rivers = lava.rivers.map((r) => (r.points.length < 2 ? [] : drapeRiver(ground, r.points, waterAt)))
  kept.unshift({ sea, ground, rivers })
  kept.length = Math.min(kept.length, DRAPES_KEPT)
  return rivers
}

/**
 * The river lines water is drawn and floated at, for anything that asks where a world's water
 * is (physics, the minimap's colours, where grass grows): the draped lines when water rivers are
 * drawn draped (the new water, water.waves, on a world whose rivers are water), else undefined,
 * meaning each river's planned line (lava rivers, and the old water, are drawn on those).
 */
export function waterRiverLines(data: { lava: LavaFeatures; settings: { kind: number; dry: number } }, ground: Ground, sea: number): readonly (readonly Point[])[] | undefined {
  if (data.settings.kind === KIND_VOLCANIC || !waterWaves.value) return undefined
  return drapedRivers(data.lava, ground, data.settings.dry ? -Infinity : sea)
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

export interface RiverPieces {
  /** The draped centre line for the ribbon. */
  points: Point[]
  /** Steep runs of the draped line, for the mist at their feet. */
  drops: RiverDrop[]
  /** Free-falling sheets, at most one per drop. */
  sheets: THREE.BufferGeometry[]
}

/**
 * Everything drawn for one river: the draped ribbon line, and for each steep run of it a
 * falling sheet. A long steep run may contain a short ledge without enough current to leap
 * the whole run, so the full arc is tried first, then its individual ledges, tallest first.
 */
export function riverPieces(
  ground: Ground, points: readonly Point[], width: number, waterAt: (x: number, z: number) => number,
  gravity: number, maxSpeed: number,
  /** The drape already made (drapedRivers), so drawing uses exactly what physics floats on. */
  ready?: readonly Point[],
): RiverPieces {
  const draped = ready ? [...ready] : drapeRiver(ground, points, waterAt)
  const drops = findDrops(draped)
  const sheets: THREE.BufferGeometry[] = []
  const covered: number[] = []
  // Sheer edges: one step falls further than a drop does over its whole run. The water
  // leaves the lip at the speed of the stretch above it and lands that far out.
  for (let i = 1; i + 1 < draped.length; i++) {
    const before = draped[i - 1], lip = draped[i], below = draped[i + 1]
    const drop = lip.y - below.y
    if (drop <= DROP_FALL) continue
    const run = Math.hypot(lip.x - before.x, lip.z - before.z)
    const along = Math.hypot(below.x - lip.x, below.z - lip.z) || 1
    const speed = riverSpeed(run > 0 ? Math.max(0, before.y - lip.y) / run : 0, maxSpeed)
    const throw_ = Math.max(.5, speed * Math.sqrt(2 * drop / gravity))
    const fx = lip.x + (below.x - lip.x) / along * throw_, fz = lip.z + (below.z - lip.z) / along * throw_
    // It lands on the receiving water where there is some, else at the level below the edge.
    const foot = { x: fx, y: Math.min(lip.y, Math.max(below.y, waterAt(fx, fz))), z: fz }
    const sheet = buildFallSheet(ground, lip, foot, width, gravity, maxSpeed)
    if (sheet) { sheets.push(sheet); covered.push(i) }
  }
  // Steep runs: the full arc first, then its individual ledges, tallest first.
  for (const drop of drops) {
    const s = drop.steepest
    if (covered.some((i) => i >= drop.start && i <= drop.end)) continue
    const ledges = Array.from({ length: s.end - s.start }, (_, i) => [s.start + i, s.start + i + 1] as const)
      .sort(([a, b], [c, d]) => (draped[c].y - draped[d].y) - (draped[a].y - draped[b].y))
    for (const [a, b] of [[s.start, s.end], ...ledges]) {
      const sheet = buildFallSheet(ground, draped[a], draped[b], width, gravity, maxSpeed)
      if (sheet) { sheets.push(sheet); break }
    }
  }
  return { points: draped, drops, sheets }
}

/** A horizontal launch under gravity, joining the lip to the receiving stream.
 * Reject shallow runs, impossible launch speeds and arcs that cut through a bank.
 * Terrain and liquid queries remain unchanged: this is a thin visual sheet above a cascade.
 */
export function buildFallSheet(
  ground: { heightAt(x: number, z: number): number },
  lip: Point, foot: Point, width: number, gravity: number, maxSpeed: number,
): THREE.BufferGeometry | null {
  const dx = foot.x - lip.x, dz = foot.z - lip.z
  const run = Math.hypot(dx, dz), drop = lip.y - foot.y
  if (![run, drop, width, gravity, maxSpeed].every(Number.isFinite) ||
      run < .1 || drop < 2 || drop / run < .8 || width <= 0 || gravity <= 0) return null
  const duration = Math.sqrt(2 * drop / gravity)
  if (run / duration > maxSpeed) return null
  const sx = -dz / run, sz = dx / run
  const positions: number[] = [], uvs: number[] = [], indices: number[] = []
  const segments = Math.min(32, Math.max(8, Math.ceil(drop)))
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const x = lip.x + dx * t, z = lip.z + dz * t, y = lip.y - drop * t * t
    // A slight narrowing suggests acceleration without opening holes at either end.
    const half = width * .5 * (1 - .2 * Math.sin(Math.PI * t))
    for (const sign of [-1, 1]) {
      const px = x + sx * half * sign, pz = z + sz * half * sign
      if (i > 0 && i < segments && ground.heightAt(px, pz) > y - .05) return null
      positions.push(px, y + .04, pz)
      uvs.push((sign + 1) / 2, t * duration)
    }
    if (i < segments) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.name = 'waterfall-sheet'
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Procedural streaks move in flight-time coordinates, accelerating as the sheet falls. */
export function createFallMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: .3 })
  // Falling water: white ropes running down the sheet between clearer strands, at a scale that
  // still reads from across a valley (0.8 m strands averaged to a milky slab), carried down at
  // the fall's speed. Its sides fade over a fifth of its width, so it has no hard edge.
  const p = uv(), travel = p.y.sub(time.mul(1.2))
  const rope = (n: THREE.Node<'float'>) => { const r = float(1).sub(abs(n)); return r.mul(r).mul(r) }
  const ropes = max(rope(mx_noise_float(vec3(p.x.mul(7), travel.mul(0.6), time.mul(0.2)))), rope(mx_noise_float(vec3(p.x.mul(17), travel.mul(1.3), time.mul(0.3).add(5)))).mul(0.8))
  const foam = smoothstep(.3, .75, ropes)
  material.colorNode = mix(materialColor.rgb, vec3(.9, .97, 1), foam)
  const edge = smoothstep(0, .2, p.x).mul(float(1).sub(smoothstep(.8, 1, p.x)))
  material.opacityNode = edge.mul(foam.mul(.55).add(.3))
  return material
}
