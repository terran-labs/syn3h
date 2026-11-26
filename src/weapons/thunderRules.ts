/**
 * Plasma Thunder's rules as pure functions (thunderParams.ts holds the numbers): what a contact
 * with the ground does to the bolt, when its proximity fuse is armed and how far it reaches,
 * and what each kind of detonation does in each mode. No Three.js and no physics, so the room
 * server and every client apply exactly the same rule, and tests can pin it.
 */
import { WAVE_MAX_AMPLITUDE } from '../../shared/water/waves'

export type V3 = [number, number, number]

/** Why a bolt ended. contact: it touched a vehicle. fuse: it passed close to one. end: ground, steep contact or old age. */
export type ThunderCause = 'contact' | 'fuse' | 'end'

export interface SkipRule {
  /** Skips left before this contact. */
  left: number
  /** Steepest angle that still skips, degrees from the surface. */
  maxAngle: number
  /** Share of speed along the surface kept. */
  keep: number
  /** Share of speed off the surface kept (the bounce). */
  bounce: number
}

/**
 * The bolt, at speed `v`, meets ground whose unit normal is `n`. It skips if it has skips left
 * and came in at less than `maxAngle` to the surface: the speed into the surface comes back out
 * at `bounce` of itself and the speed along it keeps `keep`. Otherwise it detonates. Returns
 * the new velocity, or null to detonate.
 */
export function skipOff(v: Readonly<V3>, n: Readonly<V3>, rule: SkipRule): V3 | null {
  if (!(rule.left > 0)) return null
  const speed = Math.hypot(v[0], v[1], v[2])
  if (!(speed > 1e-6)) return null
  const into = v[0] * n[0] + v[1] * n[1] + v[2] * n[2]
  // Moving away from the surface (grazing out of it): nothing to skip.
  if (into >= 0) return null
  const angle = Math.asin(Math.min(1, -into / speed)) * 180 / Math.PI
  if (angle >= rule.maxAngle) return null
  const along: V3 = [v[0] - into * n[0], v[1] - into * n[1], v[2] - into * n[2]]
  const out = -into * rule.bounce
  return [along[0] * rule.keep + n[0] * out, along[1] * rule.keep + n[1] * out, along[2] * rule.keep + n[2] * out]
}

/** True once the bolt has flown long enough for its proximity fuse. */
export function fuseArmed(age: number, arm: number): boolean {
  return age >= Math.max(0, arm)
}

/** The fuse's reach against a vehicle `clearance` metres above the ground. */
export function fuseRadius(clearance: number, rule: { ground: number; air: number; airHeight: number }): number {
  return clearance > rule.airHeight ? rule.air : rule.ground
}

/**
 * How close the segment from `a` to `b` passes to `c`, and the point on it nearest `c`: the
 * fuse's test for one physics step of flight.
 */
export function nearestOnSegment(a: Readonly<V3>, b: Readonly<V3>, c: Readonly<V3>): { distance: number; point: V3 } {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / len2)) : 0
  const point: V3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
  return { distance: Math.hypot(c[0] - point[0], c[1] - point[1], c[2] - point[2]), point }
}

/** What a detonation does to the vehicle it was set off by, in a mode. */
export interface DetonationEffect {
  /** Counts as a tag (the tag rules then decide whether it scores). */
  tag: boolean
  /** Counts as contact by the shooter for King of the Hill's dunks. */
  contact: boolean
}

/** Contact tags and is contact, as a hit always was. A fuse never tags; it is a knock. An end catches nobody. */
export function detonationEffect(cause: ThunderCause): DetonationEffect {
  if (cause === 'contact') return { tag: true, contact: true }
  if (cause === 'fuse') return { tag: false, contact: true }
  return { tag: false, contact: false }
}

/**
 * Who may report a detonation to the room. contact and fuse: the client that judges the vehicle
 * it caught (its own client; the host for a bot), as for any hit. end: the shooter's client (the
 * host for a bot's shot), which flies its own bolt from the exact launch.
 */
export function mayReport(cause: ThunderCause, reporter: number, shooter: number, victim: number | undefined, host: number, isBot: (id: number) => boolean): boolean {
  if (cause === 'end') return reporter === shooter || (isBot(shooter) && reporter === host)
  if (victim === undefined || victim === shooter) return false
  return reporter === victim || (isBot(victim) && reporter === host)
}

/**
 * The firework a detonation makes, chosen from the shot so every client draws the same one.
 * A simple integer hash of the shooter and the shot id, into the list of shapes.
 */
export const FIREWORK_SHAPES = ['peony', 'chrysanthemum', 'ring', 'willow', 'palm', 'crossette'] as const
export type FireworkShape = (typeof FIREWORK_SHAPES)[number]
export function fireworkSeed(shooter: number, shot: number): number {
  let h = (Math.imul(shooter | 0, 0x9e3779b1) ^ Math.imul(shot | 0, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
export function fireworkShape(seed: number): FireworkShape {
  return FIREWORK_SHAPES[seed % FIREWORK_SHAPES.length]
}

/** Metres of slack around the world for a reported burst point (thunder detonations). */
export const BURST_MARGIN = 200

/**
 * Whether a reported detonation point is somewhere a Thunder shot could have gone off: inside
 * the world's tile (positions arrive canonical, within half a tile of its centre) and no higher
 * than the planet's radius plus the flare height, with BURST_MARGIN to spare either way. The room
 * refuses any other, so a report cannot hang a firework at 1e30. The radius is the one the world
 * is drawn with (src/world/curve.ts planetRadius: size / (2 sqrt(pi))).
 */
export function burstPointPlausible(at: V3, size: number, flareHeight: number): boolean {
  const half = size / 2 + BURST_MARGIN, ceiling = size / (2 * Math.sqrt(Math.PI)) + flareHeight + BURST_MARGIN
  return at.every(Number.isFinite) && Math.abs(at[0]) <= half && Math.abs(at[2]) <= half && at[1] >= -BURST_MARGIN && at[1] <= ceiling
}

/**
 * Plasma Thunder never detonates under water or lava (the owner, 26 November 2026: "The red laser
 * should not detonate underwater"). Its rays pass through liquids, so on its own it would fly on
 * and go off on the bed, on a fuse beside a submerged vehicle, or at old age below the surface.
 * Instead a bolt that goes under is quenched: it makes its splash where it crossed and runs on
 * QUENCH_LENGTH metres, fading, then dies with no burst, firework, flare or shove. A direct catch
 * on a vehicle in that run still tags, as a tag beam's hit would. Everything is decided from the
 * bolt's position and the shared wave height (terrain.liquidHeightAt, the function the impact
 * splash and the floating code read), so every client and the host's bots agree.
 */
/** Metres a quenched bolt runs on under the surface while it fades out. */
export const QUENCH_LENGTH = 3

/** Below a liquid surface `level` (the shared wave height there; -Infinity where dry) by more than `margin` metres. */
export function underLiquid(at: Readonly<V3>, level: number, margin = 0): boolean {
  return Number.isFinite(level) && at[1] < level - margin
}

/**
 * Where a bolt's flight from `a` to `b` first goes below a liquid surface, as the fraction (0 to 1)
 * of the segment, or null if it stays above it. `level(x, z)` is the surface there. Sampled at
 * `samples` points so a crest between the ends is caught, then narrowed by bisection.
 */
export function submergedAt(a: Readonly<V3>, b: Readonly<V3>, level: (x: number, z: number) => number, samples = 4): number | null {
  const at = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  const below = (t: number) => { const p = at(t); return underLiquid(p, level(p[0], p[2])) }
  if (below(0)) return 0
  let prev = 0
  for (let i = 1; i <= samples; i++) {
    const t = i / samples
    if (below(t)) {
      let lo = prev, hi = t
      for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (below(mid)) hi = mid; else lo = mid }
      return hi
    }
    prev = t
  }
  return null
}

/**
 * Whether the proximity fuse senses a vehicle at `at` (its centre) over a liquid surface `level`:
 * not when the vehicle is under the surface. Without this a bolt going under right beside a
 * submerged vehicle would go off at the waterline and shove it. A floating vehicle, centre at or
 * above the surface, is sensed as before.
 */
export function fuseSenses(at: Readonly<V3>, level: number): boolean {
  return !underLiquid(at, level)
}

/**
 * What ends a bolt at `at`, with the liquid surface `level` there: today's cause above the
 * surface; under it, a quench, which is no detonation at all (no blast, no firework, no push).
 */
export type ThunderEnding = ThunderCause | 'quench'
export function thunderEnding(cause: ThunderCause, at: Readonly<V3>, level: number): ThunderEnding {
  return underLiquid(at, level) ? 'quench' : cause
}

/**
 * Metres of slack below the deepest wave trough before a burst the room reports is dropped. Each
 * client tests a reported point against the liquid's level at REST (no waves), less the largest
 * possible wave (WAVE_MAX_AMPLITUDE) and this: so a burst at the waterline, on a floating vehicle
 * or a beach, is kept by everyone whatever the waves were doing on the reporter's screen, and only
 * a point clearly under the surface (from a client that predates this rule) is dropped.
 */
export const BURST_UNDER_MARGIN = 0.5
/** Whether every client should draw a burst the room reports at `at`, over a liquid resting at `rest` (-Infinity where dry). */
export function burstKept(at: Readonly<V3>, rest: number): boolean {
  return !underLiquid(at, rest, WAVE_MAX_AMPLITUDE + BURST_UNDER_MARGIN)
}
