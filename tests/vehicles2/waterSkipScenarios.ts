/**
 * Headless water-skip scenarios for every vehicle (src/vehicles/skip.ts): a vehicle launched
 * across open water at a chosen speed and entry angle, coasting with no input, shared by the skip
 * invariants (water-skip.test.ts) and the handling report. The water surface is y = 0 (plus its
 * waves when asked for) and the vehicle travels toward -Z.
 */
import * as THREE from 'three/webgpu'
import { FIXED_DT } from '../../src/core/physics'
import { Tank } from '../../src/vehicles/Tank'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { planingPatch, planingSpeed, skipFriction } from '../../src/vehicles/skip'
import { planingFactor } from '../../src/vehicles/buoyancy'
import { hullBottom } from '../../src/vehicles/liquidHull'
import { basinBed, makeVehicle } from '../vehicles/liquidScenarios'

export type SkipKind = 'buggy' | 'hovercraft' | 'jet' | 'tank'
export const SKIP_KINDS: readonly SkipKind[] = ['buggy', 'hovercraft', 'jet', 'tank']

export interface SkipSample {
  t: number
  /** Lowest corner of the planing patch above the water surface under it, metres (negative wet). */
  gap: number
  /** Horizontal speed, m/s. */
  speed: number
  /** Kinetic (linear and turning) plus height energy per kilogram, J/kg. */
  energy: number
  /** Planing lift over weight this step (0 when not planing). */
  skipping: number
  /** Body height, metres. */
  y: number
  /** Body position along the run, metres (the launch heads toward -Z). */
  z: number
  finite: boolean
}
export interface SkipRun { v: Vehicle; kind: SkipKind; trace: SkipSample[]; step(n?: number): void; dispose(): void; planing: number; clock: { t: number }; /** Throttle held each step (input y); 0 or unset leaves the input alone. */ throttle?: number }

const corner = new THREE.Vector3(), q = new THREE.Quaternion(), w = new THREE.Vector3(), inertia = new THREE.Vector3()

function build(kind: SkipKind, h: ReturnType<typeof basinBed>['h'], at: THREE.Vector3): Vehicle {
  if (kind === 'tank') { const t = new Tank(h.game, h.terrain, at, 0); t.isLocal = false; return t }
  return makeVehicle(kind, h, at, 0)
}

/** A vehicle's planing speed (skip.ts), from its real mass and footprint. */
export function planingOf(v: Vehicle, kind: string, g: number): number {
  const p = planingPatch(v.body as never)
  return p ? planingSpeed(v.body.mass(), p.area, g, planingFactor(kind)) : Infinity
}

/**
 * `kind` over open water, its patch's lowest corner `clearance` metres above the surface, level,
 * moving at `speed` m/s along -Z and `angle` degrees down toward the surface. `speed` and the
 * returned run's `planing` let a scenario be set as a multiple of the vehicle's planing speed.
 * `speed` may be a function of that planing speed.
 */
export function skipLaunch(kind: SkipKind, speed: number | ((planing: number) => number), angle: number, opts: { depth?: number; waves?: 'sea' | 'inland'; clearance?: number; /** Held throttle (input y), 0 coasting. */ throttle?: number } = {}): SkipRun {
  const { h, clock } = basinBed({ liquid: 'water', length: 2400, depth: opts.depth ?? 40, slope: 30, waves: opts.waves })
  const v = build(kind, h, new THREE.Vector3(0, 20, -60))
  const g = -h.world.gravity.y
  const planing = planingOf(v, kind, g)
  const u = typeof speed === 'function' ? speed(planing) : speed
  const patch = planingPatch(v.body as never)!
  // Where the hull meets the water: the buggy's tyres, else its patch's bottom (as skip.ts reads it).
  const bottom = kind === 'buggy' ? hullBottom(v.liquidState.wheel) : patch.bottom
  const a = (angle * Math.PI) / 180
  // Level, its patch bottom just clear of the still surface.
  v.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
  v.body.setTranslation({ x: 0, y: (opts.clearance ?? 0.3) - bottom, z: -60 }, true)
  v.body.setLinvel({ x: 0, y: -u * Math.sin(a), z: -u * Math.cos(a) }, true)
  v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  const trace: SkipSample[] = []
  const run: SkipRun = {
    v, kind, trace, planing, clock, throttle: opts.throttle,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        if (run.throttle) v.input.y = run.throttle
        h.step(v)
        clock.t += FIXED_DT
        const p = v.body.translation(), r = v.body.rotation(), l = v.body.linvel(), av = v.body.angvel()
        q.set(r.x, r.y, r.z, r.w)
        let gap = Infinity
        for (let k = 0; k < 4; k++) {
          corner.set(k & 1 ? patch.maxX : patch.minX, bottom, k & 2 ? patch.maxZ : patch.minZ).applyQuaternion(q).add(p as THREE.Vector3)
          const s = h.terrain.liquidHeightAt!(corner.x, corner.z)
          gap = Math.min(gap, corner.y - (Number.isFinite(s) ? s : 0))
        }
        // Turning energy about the principal axes, per kilogram.
        const inv = v.body.principalInertia()
        w.set(av.x, av.y, av.z).applyQuaternion(q.clone().invert())
        inertia.set(inv.x, inv.y, inv.z)
        const turning = 0.5 * (inertia.x * w.x * w.x + inertia.y * w.y * w.y + inertia.z * w.z * w.z) / v.body.mass()
        const energy = 0.5 * (l.x * l.x + l.y * l.y + l.z * l.z) + turning + g * p.y
        trace.push({ t: clock.t, gap, speed: Math.hypot(l.x, l.z), energy, skipping: v.liquidState.skipping, y: p.y, z: p.z, finite: Number.isFinite(gap + energy + l.x + l.y + l.z + av.x + av.y + av.z) })
      }
    },
    dispose() { v.dispose(); h.world.free() },
  }
  return run
}

/** The buggy's planing speed on the default world, from a buggy built for the purpose. */
export function buggyPlaning(): number {
  const { h } = basinBed({ liquid: 'water', length: 60, depth: 4, slope: 30 })
  const v = build('buggy', h, new THREE.Vector3(0, 5, -20))
  try { return planingOf(v, 'buggy', -h.world.gravity.y) } finally { v.dispose(); h.world.free() }
}

/**
 * Seconds within which skipping and planing must have ended from an entry at `speed` (m/s):
 * above its planing speed nothing drives a hull, and the skip's friction alone sheds at least
 * water.skip.friction times g.
 */
export function planingEndsWithin(speed: number, planing: number, g = 9.81): number {
  return Math.max(0, speed - planing) / Math.max(1e-3, skipFriction.value * g)
}

/** Step until `seconds` have passed. */
export const coastFor = (run: SkipRun, seconds: number) => run.step(Math.round(seconds / FIXED_DT))

/**
 * Times the vehicle left the water after touching it: its lowest patch corner rose `gap` metres
 * clear of the surface. A skip, not the bob of a hull floating on a wave.
 */
export function skipCount(trace: SkipSample[], gap = 0.2): number {
  let wet = false, n = 0
  for (const s of trace) {
    if (s.gap <= 0) wet = true
    else if (wet && s.gap > gap) { n++; wet = false }
  }
  return n
}

/** Each skip as (time it left, speed as it left), and the time of the first touch. */
export function skipsOf(trace: SkipSample[], gap = 0.2): { first: number | null; skips: { t: number; speed: number }[] } {
  let wet = false, first: number | null = null
  const skips: { t: number; speed: number }[] = []
  for (const s of trace) {
    if (s.gap <= 0) { if (first === null) first = s.t; wet = true }
    else if (wet && s.gap > gap) { skips.push({ t: s.t, speed: s.speed }); wet = false }
  }
  return { first, skips }
}

/**
 * Mechanical energy at each airborne stretch (every corner clear of the water by `gap`), in
 * order: between them the water is the only thing that can add any, so for a vehicle with no
 * powered lift each must be no higher than the one before.
 */
export function airborneEnergies(trace: SkipSample[], gap = 0.2): number[] {
  const out: number[] = []
  let inAir = false
  for (const s of trace) {
    if (s.gap > gap) { if (!inAir) { out.push(s.energy); inAir = true } else out[out.length - 1] = Math.min(out[out.length - 1], s.energy) }
    else inAir = false
  }
  return out
}
