/**
 * Carry physics for Yoink, free of Three.js and Rapier so it can be tested alone.
 *
 * A carried vehicle is steered to a point in front of its holder by a damped spring, with
 * its weight held up, and the whole push capped by the grip. Only the carried vehicle's own
 * client pushes it; the holder feels nothing. So there is no loop between two clients for
 * lag to pump, and a late view of the holder only makes the carry trail a little.
 * The holder's pose is carried forward by its lag anyway, so it trails less.
 */

export type V3 = [number, number, number]

export interface HoldTuning {
  /** Spring frequency toward the carry point, rad/s. */
  omega: number
  /** Damping ratio. */
  zeta: number
  /** Most acceleration the carry may give, m/s^2, weight support included. */
  maxAccel: number
  /** Gravity to hold up, m/s^2, positive. */
  gravity: number
}

/** Acceleration for a carried vehicle at `p` moving at `v`, toward `target` moving at `tv`. */
export function holdAccel(p: V3, v: V3, target: V3, tv: V3, t: HoldTuning): V3 {
  const w2 = t.omega * t.omega
  const c = 2 * t.zeta * t.omega
  const a: V3 = [
    w2 * (target[0] - p[0]) + c * (tv[0] - v[0]),
    w2 * (target[1] - p[1]) + c * (tv[1] - v[1]) + t.gravity,
    w2 * (target[2] - p[2]) + c * (tv[2] - v[2]),
  ]
  const m = Math.hypot(a[0], a[1], a[2])
  if (m > t.maxAccel) {
    const k = t.maxAccel / m
    a[0] *= k; a[1] *= k; a[2] *= k
  }
  return a
}

/**
 * The gust's push on a vehicle `d` metres away along unit direction `dir` from the gust,
 * strongest close, nothing at `range`, with a little lift so it pops rather than scrapes.
 */
export function gustPush(dir: V3, d: number, range: number, strength: number): V3 | null {
  if (!(d < range) || strength <= 0) return null
  const k = strength * (1 - d / range)
  return [dir[0] * k, dir[1] * k + k * 0.3, dir[2] * k]
}
