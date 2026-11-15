/**
 * Shoves that cross the network.
 *
 * Each client simulates only its own vehicle. When A rams B, A's client collides with its
 * copy of B, but B is moved only if A's copy on B's screen then hits the real B. In a chase
 * it never does: A bounces off a copy that trails the real B, so on B's screen A's copy stops
 * short and B feels nothing (measured: no shove in five of five chases, at any latency).
 *
 * So the rammer works out the push it would have given and sends it with its ram report. The
 * server checks and relays it to the rammed player, whose client waits until its own playback
 * has reached the moment of the ram: if its own physics felt the hit, the push is dropped;
 * if not, it is applied. Either way the rammed vehicle is shoved once.
 */

export type Vec3 = readonly [number, number, number]

/** Share of the closing speed handed to the rammed vehicle: equal masses, a fairly dead
 * bounce (restitution 0.3 gives (1 + 0.3) / 2). */
export const SHOVE_SHARE = 0.65
/** Closing speeds under this are a nudge, not a ram, m/s. */
export const MIN_CLOSING = 2
/** The most a relayed push may change a vehicle's velocity, m/s. Also the server's limit. */
export const MAX_SHOVE = 30
/** How long after its own contact a client treats a relayed push as already felt, seconds. */
export const FELT_WINDOW = 0.6
/** Extra wait past the playback delay before deciding the hit was not felt, seconds. */
export const SHOVE_MARGIN = 0.1

/**
 * The velocity change A's ram would give B: along the horizontal line from A to B, in
 * proportion to how fast A was closing on B just before contact. Null if A was not closing.
 */
export function shoveFor(posA: Vec3, posB: Vec3, velA: Vec3, velB: Vec3): [number, number, number] | null {
  let nx = posB[0] - posA[0]
  let nz = posB[2] - posA[2]
  const d = Math.hypot(nx, nz)
  if (d < 1e-3) return null
  nx /= d
  nz /= d
  const closing = (velA[0] - velB[0]) * nx + (velA[2] - velB[2]) * nz
  if (closing < MIN_CLOSING) return null
  const dv = Math.min(MAX_SHOVE, closing * SHOVE_SHARE)
  return [nx * dv, 0, nz * dv]
}

/** A push as it arrived off the wire, made safe: three finite numbers, clamped in length. */
export function cleanShove(raw: unknown): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [x, y, z] = raw as number[]
  const len = Math.hypot(x, y, z)
  if (len < 1e-3) return null
  const k = len > MAX_SHOVE ? MAX_SHOVE / len : 1
  return [x * k, y * k, z * k]
}

/** A remainder under this is not worth a jolt, m/s. */
export const MIN_REMAINDER = 1

interface Pending {
  from: number
  push: [number, number, number]
  /** Game time the push arrived, and when to decide. */
  arrived: number
  due: number
  /** Our velocity when the push arrived, and a little earlier, before any contact. */
  velAtArrival: Vec3
  velBefore: Vec3
}

/** Relayed pushes waiting for this client's playback to reach the ram. */
export class ShoveQueue {
  private readonly pending: Pending[] = []

  /**
   * `delay` is the playback delay of the rammer's copy here, seconds. `velNow` is our
   * velocity now and `velBefore` what it was about FELT_WINDOW ago.
   */
  add(from: number, push: [number, number, number], now: number, delay: number, velNow: Vec3 = [0, 0, 0], velBefore: Vec3 = velNow): void {
    // One push per rammer at a time: a repeat while one waits replaces it.
    const i = this.pending.findIndex((p) => p.from === from)
    const entry = { from, push, arrived: now, due: now + delay + SHOVE_MARGIN, velAtArrival: velNow, velBefore }
    if (i >= 0) this.pending[i] = entry
    else this.pending.push(entry)
  }

  /**
   * The pushes to apply now, each reduced by what our own physics already delivered.
   *
   * Touching the rammer's copy is not the same as being shoved by it: under loss the copy
   * often only grazes us, late and already slowing. So the test is our velocity: how much we
   * have gained along the push since before the ram. The reference is our velocity when the
   * push arrived, or, if we touched the rammer's copy shortly before that (`lastContact`,
   * game time, -Infinity if never), our velocity from before that contact. Only the
   * shortfall is returned, so a ram our physics felt in full is dropped and one it felt in
   * part is topped up: once shoved, never twice.
   */
  take(now: number, lastContact: (from: number) => number, velNow: Vec3 = [0, 0, 0]): { from: number; push: [number, number, number] }[] {
    const out: { from: number; push: [number, number, number] }[] = []
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]
      if (now < p.due) continue
      this.pending.splice(i, 1)
      const len = Math.hypot(...p.push)
      const n = [p.push[0] / len, p.push[1] / len, p.push[2] / len]
      const touchedBefore = lastContact(p.from) >= p.arrived - FELT_WINDOW && lastContact(p.from) <= p.arrived
      const ref = touchedBefore ? p.velBefore : p.velAtArrival
      const gained = (velNow[0] - ref[0]) * n[0] + (velNow[1] - ref[1]) * n[1] + (velNow[2] - ref[2]) * n[2]
      const rest = Math.min(len, len - gained)
      if (rest < MIN_REMAINDER) continue
      out.push({ from: p.from, push: [n[0] * rest, n[1] * rest, n[2] * rest] })
    }
    return out
  }

  get size(): number {
    return this.pending.length
  }
}
