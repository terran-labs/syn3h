/**
 * Bungee cord physics, free of Three.js and Rapier so it can be tested on its own.
 *
 * The cord is a spring that only pulls. It is never a rigid link and it never collides, so
 * nothing can wedge or jitter against it. Each client applies the force to the vehicles it
 * simulates, measured toward the other end as that client sees it. The other end of a cord
 * between two players is up to a quarter second old, and a stiff spring fed late positions
 * pumps energy in until the pair flings apart. Three choices keep it calm:
 *
 * 1. The spring is soft: its natural period is several seconds, far longer than the lag.
 * 2. It is damped along the cord, at a ratio set by `zeta`.
 * 3. The pull is capped at `maxAccel`.
 * 4. Each client predicts the other end forward by its known lag from its velocity
 *    (`predict`), which cancels the delay's first order effect: the part that pumps.
 *
 * Stiffness is a natural frequency, not a force per metre, and the force uses the reduced
 * mass of the pair. So a tank and a buggy oscillate at the same rate as two buggies, the
 * buggy does most of the moving (each end gets the same force), and both clients compute
 * the same force from their own views. A ground anchor is an end of infinite mass.
 *
 * tests/weapons/rope.test.ts runs two vehicles on a cord with 250 ms of lag and checks the
 * bounce dies away.
 */

export interface CordTuning {
  /** Natural angular frequency of the stretched cord, rad/s. */
  omega: number
  /** Damping ratio along the cord. 1 is critical. */
  zeta: number
  /** Most acceleration the pull may give the reduced mass, m/s^2. */
  maxAccel: number
}

/** Reduced mass of two ends. Pass Infinity for an anchor. */
export function reducedMass(a: number, b: number): number {
  if (!Number.isFinite(b)) return a
  if (!Number.isFinite(a)) return b
  return (a * b) / (a + b)
}

/**
 * Pull along the cord, in newtons, toward the other end. Never negative: a slack cord does
 * nothing and a taut one never pushes.
 *
 * @param length current distance between the ends, m
 * @param rest   unstretched length, m: what reeling changes
 * @param rate   rate of change of `length`, m/s, positive when the ends separate
 * @param mass   reduced mass of the pair, kg
 */
export function cordPull(length: number, rest: number, rate: number, mass: number, t: CordTuning): number {
  const stretch = length - rest
  if (stretch <= 0) return 0
  // The spring alone is capped; damping keeps half a cap of headroom above it, so a cord
  // pulled to its limit still brakes a separating pair instead of losing all its damping.
  const spring = Math.min(t.maxAccel, t.omega * t.omega * stretch)
  const accel = spring + 2 * t.zeta * t.omega * rate
  return mass * Math.min(t.maxAccel * 1.5, Math.max(0, accel))
}

/**
 * How far a cord of `rest` metres sags at its middle when its ends are `span` metres apart:
 * the parabola of the same arc length, close enough to a catenary for drawing.
 */
export function cordSag(span: number, rest: number): number {
  if (rest <= span) return 0
  return Math.sqrt((3 * span * (rest - span)) / 8)
}

/** Tension as a 0 to 1 glow: 0 slack, 1 at the cap. */
export function cordGlow(pull: number, mass: number, t: CordTuning): number {
  if (!(mass > 0) || !(t.maxAccel > 0)) return 0
  return Math.min(1, pull / (mass * t.maxAccel))
}

/** Where a late-seen end is now, to first order: position plus velocity times its lag. */
export function predict(p: number, v: number, lag: number): number {
  return p + v * Math.max(0, Math.min(0.5, lag))
}
