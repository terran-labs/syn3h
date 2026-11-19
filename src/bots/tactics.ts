/**
 * The bots' game tactics as plain maths, free of the game so they can be tested: where to
 * head to meet a moving target (interception), how two pursuers split so they do not share
 * one line (a pincer), where to aim a shot with lead and a deliberate error, and who chases
 * whom (target assignment with a cap per person).
 *
 * The owner, 18 November 2026: "they should be pretty smart about it. For example, trying to
 * cut me off based on my current velocity rather than just always driving towards my current
 * location."
 */

export interface Flat { x: number; z: number }
export interface Point3 { x: number; y: number; z: number }

/**
 * Where a pursuer at `from`, able to make `speed` m/s, should head to meet a target at `at`
 * moving at `velocity`: the earliest time t with |at + velocity t - from| = speed t, capped
 * at `horizon` seconds (a far target's future is a guess). `skill` blends from the target's
 * position (0, the plain chase) to the full intercept point (1). A target it can never catch
 * (faster and running away) gets the point at the horizon, which still cuts the corner.
 */
export function interceptPoint(from: Flat, speed: number, at: Flat, velocity: Flat, skill: number, horizon = 4): Flat {
  const s = Math.max(0, Math.min(1, skill))
  if (s === 0) return { x: at.x, z: at.z }
  const rx = at.x - from.x, rz = at.z - from.z
  // |r + v t|^2 = (speed t)^2  ->  (v.v - speed^2) t^2 + 2 (r.v) t + r.r = 0
  const a = velocity.x ** 2 + velocity.z ** 2 - speed ** 2, b = 2 * (rx * velocity.x + rz * velocity.z), c = rx * rx + rz * rz
  let t = horizon
  if (Math.abs(a) < 1e-6) {
    if (b < 0) t = -c / b
  } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const root = Math.sqrt(disc), t1 = (-b - root) / (2 * a), t2 = (-b + root) / (2 * a)
      const best = [t1, t2].filter(x => x > 0).sort((p, q) => p - q)[0]
      if (best !== undefined) t = best
    }
  }
  t = Math.max(0, Math.min(horizon, t)) * s
  return { x: at.x + velocity.x * t, z: at.z + velocity.z * t }
}

/**
 * Sideways offset, in metres, for the `slot`th of `of` pursuers on one target: 0 for a single
 * pursuer, then alternately either side of the line, so two come at the target from both
 * flanks. It shrinks to nothing within `close` metres, so every one of them can still touch.
 */
export function pincerOffset(slot: number, of: number, distance: number, width = 14, close = 10): number {
  if (of <= 1) return 0
  const side = slot % 2 === 0 ? -1 : 1, rank = Math.floor(slot / 2) + (of % 2 === 0 ? 0.5 : slot === 0 ? 0 : 0.5)
  const fade = Math.max(0, Math.min(1, (distance - close) / (2 * close)))
  return side * rank * width * fade
}

/** A standard normal sample from a uniform source (Box-Muller). */
export function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random()), v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * The direction to fire from `from` at a target at `at` moving at `velocity`, for a shot of
 * `shotSpeed` m/s (Infinity for a beam that arrives at once): the lead point, then turned by
 * an error drawn from a normal distribution with standard deviation `errorDeg` degrees, both
 * across (yaw) and up and down (pitch, at half the spread: vehicles are wider than tall).
 * Returns a unit vector.
 */
export function aimDirection(from: Point3, at: Point3, velocity: Point3, shotSpeed: number, errorDeg: number, random: () => number): [number, number, number] {
  let dx = at.x - from.x, dy = at.y - from.y, dz = at.z - from.z
  if (Number.isFinite(shotSpeed) && shotSpeed > 0) {
    const t = Math.min(2, Math.hypot(dx, dy, dz) / shotSpeed)
    dx += velocity.x * t; dy += velocity.y * t; dz += velocity.z * t
  }
  const length = Math.hypot(dx, dy, dz) || 1
  dx /= length; dy /= length; dz /= length
  const sigma = Math.max(0, errorDeg) * Math.PI / 180
  if (sigma === 0) return [dx, dy, dz]
  const yaw = gaussian(random) * sigma, pitch = gaussian(random) * sigma * 0.5
  // Yaw about world up, then pitch about the horizontal axis across the shot.
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  let x = dx * cy + dz * sy, z = -dx * sy + dz * cy, y = dy
  const h = Math.hypot(x, z) || 1, cp = Math.cos(pitch), sp = Math.sin(pitch)
  const nh = h * cp - y * sp, ny = h * sp + y * cp
  x = x / h * nh; z = z / h * nh; y = ny
  const n = Math.hypot(x, y, z) || 1
  return [x / n, y / n, z / n]
}

/** The angle between two directions, in degrees. */
export function angleBetween(a: readonly number[], b: readonly number[]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2], la = Math.hypot(a[0], a[1], a[2]), lb = Math.hypot(b[0], b[1], b[2])
  return Math.acos(Math.max(-1, Math.min(1, dot / (la * lb || 1)))) * 180 / Math.PI
}

export interface Candidate {
  readonly id: string
  readonly position: Flat
  /** A person (anyone not a bot). The cap applies to people only. */
  readonly person: boolean
  /** May be chased right now (not materializing, paused, recently tagged...). */
  readonly available: boolean
  /** A preference in metres, taken off its distance (the hill's holder, Tag's "it"). */
  readonly weight?: number
}

/**
 * Who each bot goes after: the nearest available candidate, people preferred by `personBias`
 * metres, with at most `cap` bots on any one person. Bots never pick themselves; a bot left
 * over once every person is full takes the nearest other bot. Keeps a bot's current target
 * when it is still allowed and not much farther than the best, so targets do not flicker.
 * Deterministic: bots are assigned in the order given.
 */
export function assignTargets(bots: readonly { id: string; position: Flat; current?: string | null }[], candidates: readonly Candidate[], cap: number, distance: (a: Flat, b: Flat) => number, personBias = 25, stickiness = 15): Map<string, string | null> {
  const out = new Map<string, string | null>(), load = new Map<string, number>()
  for (const bot of bots) {
    let best: Candidate | null = null, bestScore = Infinity, current: Candidate | null = null, currentScore = Infinity
    for (const c of candidates) {
      if (c.id === bot.id || !c.available) continue
      if (c.person && (load.get(c.id) ?? 0) >= cap) continue
      const score = distance(bot.position, c.position) - (c.person ? personBias : 0) - (c.weight ?? 0)
      if (score < bestScore) { bestScore = score; best = c }
      if (c.id === bot.current) { current = c; currentScore = score }
    }
    const pick = current && currentScore <= bestScore + stickiness ? current : best
    out.set(bot.id, pick?.id ?? null)
    if (pick?.person) load.set(pick.id, (load.get(pick.id) ?? 0) + 1)
  }
  return out
}
