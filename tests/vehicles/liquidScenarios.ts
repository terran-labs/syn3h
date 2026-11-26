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
import { MiraBuggy } from '../../src/vehicles/MiraBuggy'
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

export interface Sample { vy: number; yaw: number; t: number; x: number; y: number; z: number; speed: number; pitch: number; roll: number; depth: number; up: number; /** Planing lift over weight this step (src/vehicles/skip.ts), 0 when not planing. */ skipping: number }
export interface Run { clock: { t: number }; h: ReturnType<typeof harness>; v: Vehicle; basin: Basin; trace: Sample[]; ground: (z: number) => number }

const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3()

export function groundOf(b: Basin): (z: number) => number {
  const t = Math.tan((b.slope * Math.PI) / 180), bank = b.bank ?? 1
  return (z) => Math.min(bank, Math.max(-b.depth, Math.max(z, -b.length - z) * t))
}

/** A basin bed: a heightfield strip along z and the matching terrain callbacks. */
export function basinBed(b: Basin) {
  const h = harness(9.81, false)
  const g = groundOf(b)
  // A heightfield, as the game's terrain is: rows along z every 0.25 m, four cells across 1 km of x, room to drive off sideways.
  const z0 = -b.length - 120, z1 = 120, rows = Math.round((z1 - z0) / 0.25), cols = 4
  const heights = new Float32Array((rows + 1) * (cols + 1))
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) heights[i + j * (rows + 1)] = g(z0 + ((z1 - z0) * i) / rows)
  h.world.createCollider(
    RAPIER.ColliderDesc.heightfield(rows, cols, heights, { x: 1000, y: 1, z: z1 - z0 })
      .setTranslation(0, 0, (z0 + z1) / 2).setFriction(1).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)),
  )
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
  const V = kind === 'buggy' ? MiraBuggy : kind === 'jet' ? Jet : Hovercraft
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
  return { vy: l.y, yaw: a.yaw, t, x: p.x, y: p.y, z: p.z, speed: Math.hypot(l.x, l.z), pitch: a.pitch, roll: a.roll, up: a.up, depth: Number.isFinite(s) ? s - p.y : 0, skipping: run.v.liquidState.skipping }
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
  if (v instanceof MiraBuggy) v.motorSpeed = speed
  throttle(v, kind)
  // Stop on dry land beyond either shore: a hard bank can turn it round.
  let wet = false
  advance(run, seconds, (s) => (wet ||= s.z < 0) && (s.z < -basin.length - 4 || s.z > 4))
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
  const run = fromRest(kind, { liquid, length: 400, depth: 6, slope: 15, waves }, 0, 12)
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

/** True when the run ended on dry land, 4 m beyond either shore. */
export function ashore(run: Run): boolean {
  const last = run.trace[run.trace.length - 1]
  return !!last && (last.z < -run.basin.length - 4 || last.z > 4)
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

export interface Ascent { surfaced: number | null; peakPitchRate: number; peakRollRate: number; breach: number; settledY: number; settled: boolean; minUp: number; finalUp: number; drift: number }

/**
 * Wings opened at the bottom of a `depth` m pool of `liquid`, starting at the given attitude
 * (degrees of pitch and roll) and velocity along the nose. Seconds to reach the surface, peak
 * pitch and roll rates on the way up, the highest the body's centre rises above the surface,
 * and whether it ends floating upright and still at the surface.
 */
export function wingAscent(liquid: Liquid, depth = 3, pitch = 0, roll = 0, speed = 0, seconds = 20, wings = true): Ascent & { run: Run } {
  const { h, g, clock } = basinBed({ liquid, length: 400, depth, slope: 15 })
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * THREE.MathUtils.DEG2RAD, 0, roll * THREE.MathUtils.DEG2RAD, 'YXZ'))
  // Start clear of the bed whatever the attitude: a pitched or rolled hull reaches further down.
  const reach = 1.8 * Math.max(Math.abs(Math.sin(pitch * THREE.MathUtils.DEG2RAD)), Math.abs(Math.sin(roll * THREE.MathUtils.DEG2RAD)))
  const v = makeVehicle('buggy', h, new THREE.Vector3(0, -depth + 1.1 + reach, -200)) as MiraBuggy
  v.body.setRotation(q, true)
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q).multiplyScalar(speed)
  v.body.setLinvel({ x: f.x, y: f.y, z: f.z }, true)
  if (wings) { v.input.special = true; v.wingState = 1; v.areWingsOpen = true }
  const run: Run = { clock, h, v, basin: { liquid, length: 400, depth, slope: 15 }, trace: [], ground: g }
  let surfaced: number | null = null, pr = 0, rr = 0, breach = -Infinity, minUp = 1
  const tmp = new THREE.Quaternion()
  advance(run, seconds, (s) => {
    const r = v.body.rotation(), w = v.body.angvel()
    tmp.set(r.x, r.y, r.z, r.w).invert()
    const lw = new THREE.Vector3(w.x, w.y, w.z).applyQuaternion(tmp)
    if (surfaced === null) { pr = Math.max(pr, Math.abs(lw.x)); rr = Math.max(rr, Math.abs(lw.z)) }
    if (surfaced === null && s.y > -0.4) surfaced = s.t
    if (surfaced !== null) breach = Math.max(breach, s.y)
    minUp = Math.min(minUp, s.up)
    return false
  })
  const tail = run.trace.filter((s) => s.t > run.clock.t - 3)
  const ys = tail.map((s) => s.y)
  const last = run.trace[run.trace.length - 1]
  const settled = Math.max(...ys) - Math.min(...ys) < 0.3 && Math.abs(last.y) < 0.8 && last.up > 0.7
  return {
    run, surfaced, peakPitchRate: pr * THREE.MathUtils.RAD2DEG, peakRollRate: rr * THREE.MathUtils.RAD2DEG, breach,
    settledY: last.y, settled, minUp, finalUp: last.up, drift: Math.hypot(last.x, last.z + 200),
  }
}

export interface Turn { yawRate: number; radius: number; speed: number; to90: number | null; to180: number | null; minUp: number; run: Run }

/**
 * Afloat in a deep (3 m), wide lava or water lake, settled (and, to coast, paddled up to speed
 * first), then `throttle` and `steer` held for
 * `seconds`. Mean yaw rate (deg/s) and speed over the steady part (after 2 s), the turn radius,
 * seconds to turn 90 and 180 degrees, and the lowest the body's up axis got (flip check).
 */
export function turn(kind: Kind, liquid: Liquid, throttle: number, steer: number, seconds = 12): Turn {
  const run = fromRest(kind, { liquid, length: 400, depth: 3, slope: 15 }, 0, 4)
  // Coasting is from cruise: first paddle straight up to speed.
  if (throttle === 0) { run.v.input.y = 1; advance(run, 4) }
  run.trace.length = 0
  run.v.input.y = throttle
  run.v.input.x = steer
  advance(run, seconds)
  let unwrapped = 0, prev = run.trace[0].yaw, to90: number | null = null, to180: number | null = null
  const t0 = run.trace[0].t
  const yaws: number[] = []
  for (const s of run.trace) {
    let d = s.yaw - prev
    if (d > 180) d -= 360
    if (d < -180) d += 360
    unwrapped += d
    prev = s.yaw
    yaws.push(unwrapped)
    if (to90 === null && Math.abs(unwrapped) >= 90) to90 = s.t - t0
    if (to180 === null && Math.abs(unwrapped) >= 180) to180 = s.t - t0
  }
  const steady = run.trace.findIndex((s) => s.t - t0 >= 2)
  const span = run.trace[run.trace.length - 1].t - run.trace[steady].t
  const yawRate = Math.abs(yaws[yaws.length - 1] - yaws[steady]) / span
  const speed = run.trace.slice(steady).reduce((a, s, _, all) => a + s.speed / all.length, 0)
  return { yawRate, radius: yawRate > 0.1 ? speed / (yawRate * Math.PI / 180) : Infinity, speed, to90, to180, minUp: Math.min(...run.trace.map((s) => s.up)), run }
}

/**
 * Turning round to get out: in a 40 m long, 3 m deep pool of `liquid`, start 10 m from the
 * near end facing away from it (the far end is 30 m ahead). Full throttle and full lock until it
 * has turned 160 degrees, then straight, until it is ashore at either end. Seconds to turn 90
 * degrees and to reach dry land.
 */
export function turnOut(liquid: Liquid, steer = 1, seconds = 40): { to90: number | null; out: number | null; backOut: boolean; finite: boolean; minUp: number; run: Run } {
  const basin: Basin = { liquid, length: 40, depth: 3, slope: 15 }
  const bed = basinBed(basin)
  const v = makeVehicle('buggy', bed.h, new THREE.Vector3(0, -basin.depth + 1.2, -10), 0)
  const run: Run = { clock: bed.clock, h: bed.h, v, basin, trace: [], ground: bed.g }
  advance(run, 4)
  run.trace.length = 0
  v.input.y = 1
  v.input.x = steer
  const t0 = run.clock.t
  let unwrapped = 0, prev: number | null = null, to90: number | null = null
  advance(run, seconds, (s) => {
    if (prev !== null) { let d = s.yaw - prev; if (d > 180) d -= 360; if (d < -180) d += 360; unwrapped += d }
    prev = s.yaw
    if (to90 === null && Math.abs(unwrapped) >= 90) to90 = s.t - t0
    if (Math.abs(unwrapped) >= 160) v.input.x = 0
    return s.z > 4 || s.z < -basin.length - 4
  })
  const last = run.trace[run.trace.length - 1]
  const ashore = last.z > 4 || last.z < -basin.length - 4
  return {
    to90, out: ashore ? last.t - t0 : null, backOut: last.z > 4,
    finite: run.trace.every((s) => [s.x, s.y, s.z, s.vy, s.speed].every(Number.isFinite)),
    minUp: Math.min(...run.trace.map((s) => s.up)), run,
  }
}

export interface Coast { run: Run; rest: number | null; distance: number; under: number | null; samples: Sample[] }

/**
 * Coasting in deep (4 m) `liquid`: either arriving over a steep shore at `speed` m/s (held on the
 * run-up) or, with `speed` 0, paddling in at full throttle and on for 6 s. Then the
 * throttle is released (and `brakes` applied if asked). Seconds and metres until it is at rest
 * (under 0.3 m/s), seconds until its top is under the surface, and samples every half second.
 */
export function coast(liquid: Liquid, speed: number, seconds = 12, brakes = false, length = 600): Coast {
  const basin: Basin = { liquid, length, depth: 4, slope: 30 }
  const { h, g, clock } = basinBed(basin)
  const v = makeVehicle('buggy', h, new THREE.Vector3(0, 2, 30))
  const run: Run = { clock, h, v, basin, trace: [], ground: g }
  advance(run, 0.5)
  v.input.y = 1
  // Hold the speed on the run-up (6 m/s to paddle in), then let go at the waterline, or paddle on.
  const hold = speed || 6
  if (v instanceof MiraBuggy) v.motorSpeed = hold
  advance(run, 10, (s) => { const l = v.body.linvel(); v.body.setLinvel({ x: 0, y: l.y, z: -hold }, true); return s.z < 0 })
  if (!speed) advance(run, 6)
  v.input.y = 0
  v.input.brakes = brakes
  run.trace.length = 0
  const t0 = run.clock.t, z0 = v.body.translation().z
  advance(run, seconds)
  const rest = run.trace.find((s) => s.speed < 0.3)
  // The body's top (about 0.5 m above its centre) is under once the centre is 0.5 m down.
  // Under for good: from the first moment after which it stays under.
  let lastAbove = -1
  run.trace.forEach((s, i) => { if (s.depth <= 0.5) lastAbove = i })
  const under = lastAbove < run.trace.length - 1 ? run.trace[lastAbove + 1] : undefined
  const samples = run.trace.filter((s) => Math.round((s.t - t0) * 60) % 30 === 0)
  return { run, rest: rest ? rest.t - t0 : null, distance: Math.abs((rest ?? run.trace[run.trace.length - 1]).z - z0), under: under ? under.t - t0 : null, samples }
}
