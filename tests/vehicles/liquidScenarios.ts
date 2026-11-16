/**
 * Headless liquid scenarios: a basin of lava or water with sloping shores, shared by the liquid
 * invariant tests and the handling report's liquids section. Forward is local -Z, so a vehicle
 * spawned at heading 0 drives toward -Z. The liquid surface is y = 0.
 *
 *   ground(z) = clamp(max(z, -L - z) * tan(slope), -depth, bank)
 *
 * The pool spans -L < z < 0 at the surface; the near shore is at z = 0 and the far one at z = -L.
 */
import * as THREE from 'three/webgpu'
import { FIXED_DT, GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { Jet } from '../../src/vehicles/Jet'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { harness } from '../vehicles2/harness'
import { fieldOffset, fieldSpeed, liquidWavesAt, type LiquidBody, type LiquidWaveField } from '../../src/world/water/liquidWaves'

export type Liquid = 'lava' | 'water'
export type Kind = 'buggy' | 'jet' | 'hovercraft'

export interface Basin {
  liquid: Liquid
  /** Pool length at the surface, metres. */
  length: number
  /** Deepest floor below the surface, metres. */
  depth: number
  /** Shore slope, degrees. */
  slope: number
  /** Dry land height above the surface, metres. */
  bank?: number
  /** Real waves from the game's wave field for this kind of body, on the scenario's clock. */
  waves?: 'sea' | 'inland'
}

export interface Sample { yaw: number; t: number; x: number; y: number; z: number; speed: number; pitch: number; roll: number; depth: number; up: number }
export interface Run { clock: { t: number }; h: ReturnType<typeof harness>; v: Vehicle; basin: Basin; trace: Sample[]; ground: (z: number) => number }

const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3()

export function groundOf(b: Basin): (z: number) => number {
  const t = Math.tan((b.slope * Math.PI) / 180), bank = b.bank ?? 1
  return (z) => Math.min(bank, Math.max(-b.depth, Math.max(z, -b.length - z) * t))
}

/** A basin bed: a trimesh strip along z and the matching terrain callbacks. */
export function basinBed(b: Basin) {
  const h = harness(9.81, false)
  const g = groundOf(b)
  const z0 = -b.length - 120, z1 = 120, step = 0.25, rows = Math.round((z1 - z0) / step) + 1
  const verts = new Float32Array(rows * 2 * 3), idx = new Uint32Array((rows - 1) * 6)
  for (let i = 0; i < rows; i++) {
    const z = z0 + i * step, y = g(z)
    verts.set([-80, y, z, 80, y, z], i * 6)
    if (i < rows - 1) idx.set([2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3], i * 6)
  }
  h.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(1).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)))
  h.world.step()
  const wet = (z: number) => g(z) < 0
  const clock = { t: 0 }
  const body: LiquidBody = { kind: b.waves ?? 'sea', liquid: b.liquid, frozen: false }
  let field: LiquidWaveField | null = null, fieldT = Number.NaN
  const waves = () => {
    if (!b.waves) return null
    if (fieldT !== clock.t) { field = liquidWavesAt(body, clock.t, field ?? undefined); fieldT = clock.t }
    return field
  }
  h.terrain.heightAt = (_x, z) => g(z)
  h.terrain.liquidHeightAt = (x, z) => {
    if (!wet(z)) return -Infinity
    const f = waves()
    return f ? fieldOffset(f, x, z, -g(z)) : 0
  }
  h.terrain.liquidVerticalSpeedAt = (x, z) => {
    const f = wet(z) ? waves() : null
    return f ? fieldSpeed(f, x, z, -g(z)) : 0
  }
  h.terrain.liquidKindAt = (_x, z) => (wet(z) ? b.liquid : null)
  return { h, g, clock }
}

export function makeVehicle(kind: Kind, h: ReturnType<typeof harness>, p: THREE.Vector3, heading = 0): Vehicle {
  const V = kind === 'buggy' ? Syn3hBuggy : kind === 'jet' ? Jet : Hovercraft
  const v = new V(h.game, h.terrain, p, heading)
  v.isLocal = false
  return v
}

export function pitchRoll(v: Vehicle) {
  const r = v.body.rotation()
  tmpQ.set(r.x, r.y, r.z, r.w)
  const pitch = Math.asin(THREE.MathUtils.clamp(tmpV.set(0, 0, -1).applyQuaternion(tmpQ).y, -1, 1)) * THREE.MathUtils.RAD2DEG
  const roll = Math.asin(THREE.MathUtils.clamp(tmpV.set(1, 0, 0).applyQuaternion(tmpQ).y, -1, 1)) * THREE.MathUtils.RAD2DEG
  const up = tmpV.set(0, 1, 0).applyQuaternion(tmpQ).y
  const f = tmpV.set(0, 0, -1).applyQuaternion(tmpQ)
  const yaw = Math.atan2(f.x, -f.z) * THREE.MathUtils.RAD2DEG
  return { pitch, roll, up, yaw }
}

function sample(run: Run, t: number): Sample {
  const p = run.v.body.translation(), l = run.v.body.linvel(), a = pitchRoll(run.v)
  const s = run.h.terrain.liquidHeightAt!(p.x, p.z)
  return { yaw: a.yaw, t, x: p.x, y: p.y, z: p.z, speed: Math.hypot(l.x, l.z), pitch: a.pitch, roll: a.roll, up: a.up, depth: Number.isFinite(s) ? s - p.y : 0 }
}

/** Step `seconds`, recording every step, stopping early when `until` returns true. */
export function advance(run: Run, seconds: number, until?: (s: Sample) => boolean): void {
  const n = Math.round(seconds / FIXED_DT)
  for (let i = 1; i <= n; i++) {
    run.h.step(run.v)
    run.clock.t += FIXED_DT
    const s = sample(run, run.clock.t)
    run.trace.push(s)
    if (until?.(s)) return
  }
}

/** Throttle input that drives each kind forward on or near the ground. */
export function throttle(v: Vehicle, kind: Kind, amount = 1): void {
  v.input.y = amount
  if (kind === 'jet') v.input.z = 0
}

export const dispose = (run: Run) => { run.v.dispose(); run.h.world.free() }

/**
 * Drive into the pool from dry land at `speed` m/s at full throttle, toward the far shore.
 * The vehicle starts 30 m back on the bank already moving, with its motor at speed.
 */
export function entry(kind: Kind, basin: Basin, speed: number, seconds = 40): Run {
  const { h, g, clock } = basinBed(basin)
  const bank = basin.bank ?? 1
  const v = makeVehicle(kind, h, new THREE.Vector3(0, bank + 1, 30))
  const run: Run = { clock, h, v, basin, trace: [], ground: g }
  advance(run, 0.5)
  run.trace.length = 0
  v.body.setLinvel({ x: 0, y: 0, z: -speed }, true)
  if (v instanceof Syn3hBuggy) v.motorSpeed = speed
  throttle(v, kind)
  advance(run, seconds, (s) => s.z < -basin.length - 4)
  return run
}

/** At rest in the middle of a flat bottomed pool `depth` m deep, then full throttle to shore. */
export function fromRest(kind: Kind, basin: Basin, seconds = 40, settle = 3): Run {
  const { h, g, clock } = basinBed(basin)
  const v = makeVehicle(kind, h, new THREE.Vector3(0, -basin.depth + 1.2, -basin.length / 2))
  const run: Run = { clock, h, v, basin, trace: [], ground: g }
  advance(run, settle)
  run.trace.length = 0
  throttle(v, kind)
  advance(run, seconds, (s) => s.z < -basin.length - 4)
  return run
}

/** At rest afloat in deep water (or lava) with waves for `seconds`, after settling. */
export function afloat(kind: Kind, liquid: Liquid, waves: 'sea' | 'inland' | undefined, seconds = 20): Run {
  const run = fromRest(kind, { liquid, length: 400, depth: 6, slope: 15, waves }, 0, 4)
  run.v.input.y = 0
  advance(run, seconds)
  return run
}

/** Seconds from the first wet sample until the vehicle is 4 m beyond the far shore, or null. */
export function exitTime(run: Run): number | null {
  const last = run.trace[run.trace.length - 1]
  if (!last || last.z >= -run.basin.length - 4) return null
  const first = run.trace.find((s) => s.z < 0)
  return last.t - (first?.t ?? 0)
}

/** Peak to peak (5th to 95th percentile) and the mean period of crossings of the mean, in a window. */
export function rhythm(trace: Sample[], key: 'pitch' | 'roll' | 'y', from: number, to: number) {
  const xs = trace.filter((s) => s.t >= from && s.t <= to).map((s) => s[key])
  if (xs.length < 10) return { amplitude: 0, period: null as number | null }
  const sorted = [...xs].sort((a, b) => a - b)
  const amplitude = sorted[Math.floor(sorted.length * 0.95)] - sorted[Math.floor(sorted.length * 0.05)]
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  let crossings = 0
  for (let i = 1; i < xs.length; i++) if ((xs[i - 1] - mean) * (xs[i] - mean) < 0) crossings++
  const span = (xs.length - 1) * FIXED_DT
  return { amplitude, period: crossings >= 2 ? (2 * span) / crossings : null }
}

/** Trace rows every `every` seconds, for reading by eye. */
export function table(run: Run, every = 0.5): string {
  const rows = ['   t     z      y   depth  speed  pitch   roll    yaw']
  let next = 0
  for (const s of run.trace) {
    if (s.t + 1e-9 < next) continue
    next += every
    rows.push(`${s.t.toFixed(1).padStart(5)} ${s.z.toFixed(1).padStart(6)} ${s.y.toFixed(2).padStart(6)} ${s.depth.toFixed(2).padStart(6)} ${s.speed.toFixed(1).padStart(6)} ${s.pitch.toFixed(1).padStart(6)} ${s.roll.toFixed(1).padStart(6)} ${s.yaw.toFixed(0).padStart(6)}`)
  }
  return rows.join('\n')
}
