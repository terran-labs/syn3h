/**
 * What the adaptive score hears of the world around the player, beyond the player's own
 * motion: the other vehicles nearby (a "convoy") and the shape of the ground ahead (its
 * "relief"). Pure functions over plain numbers, so they are tested without a renderer, and
 * they write into arrays the caller keeps, so nothing is allocated while the game runs.
 */
export interface Point { x: number; y: number; z: number }
/** One other vehicle as the listener hears it. */
export interface ConvoyVoice {
  /** Metres from the listener. */
  distance: number
  /** -1 hard left to 1 hard right of where the listener faces. */
  pan: number
  /** Metres per second toward the listener; negative when it is pulling away. */
  closing: number
}
/** Most voices the score is given. The nearest matter; a crowd is one sound. */
export const CONVOY_LIMIT = 12
/** Heights sampled ahead, and the step between them in metres. */
export const RELIEF_SAMPLES = 16
export const RELIEF_STEP = 10

/**
 * Fill `out` with the other vehicles, nearest first. `memory` holds each vehicle's last
 * distance so `closing` can be worked out; `seconds` is the time since the last call.
 * On a wrapping world the caller's positions are already the nearest image of each vehicle.
 */
export function senseConvoy<T extends object>(out: ConvoyVoice[], listener: Point, forward: Point, up: Point, others: readonly T[], where: (other: T) => Point, memory: WeakMap<T, number>, seconds: number): ConvoyVoice[] {
  // right = forward x up
  let rx = forward.y * up.z - forward.z * up.y, ry = forward.z * up.x - forward.x * up.z, rz = forward.x * up.y - forward.y * up.x
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl
  let count = 0
  for (const other of others) {
    const p = where(other), dx = p.x - listener.x, dy = p.y - listener.y, dz = p.z - listener.z
    const distance = Math.hypot(dx, dy, dz)
    if (!Number.isFinite(distance)) continue
    const before = memory.get(other)
    memory.set(other, distance)
    const voice = out[count] ?? (out[count] = { distance: 0, pan: 0, closing: 0 })
    voice.distance = distance
    voice.pan = distance > 0.001 ? Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / distance)) : 0
    voice.closing = before === undefined || !(seconds > 0) ? 0 : (before - distance) / seconds
    count++
  }
  out.length = count
  out.sort((a, b) => a.distance - b.distance)
  if (out.length > CONVOY_LIMIT) out.length = CONVOY_LIMIT
  return out
}

/**
 * The ground ahead: sixteen heights, ten metres apart, along the direction of travel. Returns
 * undefined when the vehicle is all but still, since then there is no "ahead".
 */
export function senseRelief(out: number[], from: Point, velocity: Point, heightAt: (x: number, z: number) => number): number[] | undefined {
  const speed = Math.hypot(velocity.x, velocity.z)
  if (!(speed > 1)) return undefined
  const dx = velocity.x / speed, dz = velocity.z / speed
  for (let i = 0; i < RELIEF_SAMPLES; i++) {
    const height = heightAt(from.x + dx * RELIEF_STEP * (i + 1), from.z + dz * RELIEF_STEP * (i + 1))
    out[i] = Number.isFinite(height) ? height : (i ? out[i - 1] : from.y)
  }
  out.length = RELIEF_SAMPLES
  return out
}
