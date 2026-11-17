/**
 * The sea level as drawn and simulated: `world.lavaAltitude`, eased.
 *
 * The setting itself is shared by the room and jumps when someone moves the slider. Every
 * client then glides its own sea to the new level over GLIDE_SECONDS, so the coast floods
 * or drains in front of you instead of snapping. Nothing extra is sent: each player's sea
 * follows the shared value a moment after it arrives.
 *
 * The glide is a cubic from the current level and speed to the target at rest, so it is
 * continuous in level and speed. A new target while it is still moving (the slider is being
 * dragged) starts a new cubic from wherever the sea is, so it never jumps.
 *
 * Cheap parts follow the glide every frame (the sea meshes, shoreline shading, buoyancy,
 * liquid queries, fog and wind). Heavier parts that bake the level in (the river mouths
 * and the water's bed texture, the bots' wet cells) rebuild once, when it settles: listen
 * with `onSeaSettled`. A terrain regeneration (a new planet or seed) snaps it with
 * `snapSeaLevel`, because the ground under it is new.
 *
 * No renderer imports, so physics and tests can use it.
 */
import { params, worldLavaAltitude } from '../../shared/params'

/** How long the sea takes to reach a new level, in seconds. */
export const GLIDE_SECONDS = 1.5

let clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000

let from: number = worldLavaAltitude.value
let fromSpeed = 0
let target: number = worldLavaAltitude.value
let start = 0
let moving = false
let settleTimer: ReturnType<typeof setTimeout> | undefined
const settled = new Set<() => void>()

/** Where the glide is at time t: level and speed in metres and metres per second. */
function at(t: number, out: { level: number; speed: number }): { level: number; speed: number } {
  const s = (t - start) / GLIDE_SECONDS
  if (!moving || s >= 1) { out.level = target; out.speed = 0; return out }
  const u = Math.max(0, s)
  // Cubic Hermite: from `from` with speed `fromSpeed`, to `target` at rest.
  const m0 = fromSpeed * GLIDE_SECONDS
  const u2 = u * u, u3 = u2 * u
  out.level = (2 * u3 - 3 * u2 + 1) * from + (u3 - 2 * u2 + u) * m0 + (3 * u2 - 2 * u3) * target
  out.speed = ((6 * u2 - 6 * u) * from + (3 * u2 - 4 * u + 1) * m0 + (6 * u - 6 * u2) * target) / GLIDE_SECONDS
  return out
}
const scratch = { level: 0, speed: 0 }

/** The sea level to draw and simulate now, in metres. Equal to the setting once settled. */
export function seaLevel(): number {
  if (!moving) return target
  return at(clock(), scratch).level
}

/** How fast the sea level is rising now, metres per second (negative while it falls). */
export function seaLevelSpeed(): number {
  if (!moving) return 0
  return at(clock(), scratch).speed
}

/** True once the sea has reached the setting. */
export function seaSettled(): boolean {
  if (moving && clock() - start >= GLIDE_SECONDS) finish()
  return !moving
}

/** Called once each time the sea comes to rest at a new level. Returns an unsubscribe. */
export function onSeaSettled(listener: () => void): () => void {
  settled.add(listener)
  return () => settled.delete(listener)
}

/** Jump straight to the setting: the terrain under the sea has been replaced. */
export function snapSeaLevel(): void {
  const wasMoving = moving
  target = worldLavaAltitude.value as number
  from = target; fromSpeed = 0; moving = false
  clearTimeout(settleTimer)
  if (wasMoving) for (const l of settled) l()
}

function finish(): void {
  if (!moving) return
  moving = false
  from = target; fromSpeed = 0
  clearTimeout(settleTimer)
  for (const l of settled) l()
}

/** Start gliding from wherever the sea is now to a new level. */
function retarget(level: number): void {
  const t = clock()
  at(t, scratch)
  from = scratch.level; fromSpeed = scratch.speed
  target = level; start = t
  moving = from !== target || fromSpeed !== 0
  clearTimeout(settleTimer)
  if (moving) settleTimer = setTimeout(() => seaSettled(), GLIDE_SECONDS * 1000 + 20)
}

params.onChange((id, value) => { if (id === worldLavaAltitude.def.id) retarget(Number(value)) })

/** Tests only: drive the glide from a fake clock in seconds. Pass nothing to restore. */
export function setSeaClock(next?: () => number): void {
  clock = next ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000)
}
