import type { BotGearOption } from '../bots/gear'
/**
 * Bot replication helpers. The bot manager owns its vehicles and may remove one between any
 * two frames (bots.count lowered, graphics level capped), so networking never assumes a bot
 * body it saw last frame still exists.
 */
import { BOT_ID_BASE, MAX_BOTS } from '../../shared/protocol'

export interface BodyLookup {
  getRigidBody(handle: number): unknown
}

export interface HasBody {
  body: { handle: number }
}

/** True while the vehicle's body is still in the physics world (not removed or replaced). */
export function bodyAlive(world: BodyLookup, v: HasBody): boolean {
  return world.getRigidBody(v.body.handle) === v.body
}

/** Host side: the bots to replicate, with their wire ids, skipping any whose body is gone. */
export function liveBots<T extends HasBody>(vehicles: readonly T[], world: BodyLookup): [number, T][] {
  const out: [number, T][] = []
  for (let i = 0; i < vehicles.length && i < MAX_BOTS; i++) {
    if (bodyAlive(world, vehicles[i])) out.push([BOT_ID_BASE + i, vehicles[i]])
  }
  return out
}

/**
 * The vehicles other than our own that should make sound: every remote player and bot
 * replica, plus the bots this client simulates itself (`ownBots`: the host's, or everyone's
 * when offline). A vehicle stuck in the lava is still there and still heard. Feeds
 * `audio.setVehicles`.
 */
export function audibleVehicles<T extends HasBody>(
  remotes: Iterable<[number, T]>,
  ownBots: readonly T[],
  world: BodyLookup,
  into: T[] = [],
): T[] {
  into.length = 0
  for (const [, v] of remotes) into.push(v)
  for (const [, v] of liveBots(ownBots, world)) into.push(v)
  return into
}

/** What the host's bots are told about the game (the bot manager's `setMatch`). */
export type BotMatchInfo<V> =
  | { mode: 'tag'; it: V | null }
  | { mode: 'hill'; zone: { x: number; z: number; radius: number } | null; ring?: { x: number; z: number; inner: number; outer: number } | null; holder?: V | null }

/**
 * The place bots should hold for a King of the Hill zone, as a point and a radius. The zone
 * is usually a ring (the rim road round the lava lake), and its centre is the lake: sending
 * bots to the centre would park them in the lava. So for a ring they are sent to the point
 * on its mid line nearest `near` (the host), with half the ring's width as the radius; a
 * disc zone is held at its centre.
 */
export function hillHold(
  zone: { x: number; z: number; inner: number; outer: number },
  near: { x: number; z: number },
): { x: number; z: number; radius: number } {
  if (zone.inner <= 1) return { x: zone.x, z: zone.z, radius: zone.outer }
  const mid = (zone.inner + zone.outer) / 2
  let dx = near.x - zone.x
  let dz = near.z - zone.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-3) { dx = 1; dz = 0 } else { dx /= d; dz /= d }
  return { x: zone.x + dx * mid, z: zone.z + dz * mid, radius: (zone.outer - zone.inner) / 2 }
}

/**
 * What a host's bot may use in each game (the owner, 18 November 2026), from the gear the room
 * allows (`allowed`, weapons/BotGear.ts botGearOptions):
 *   tag   Plasma Tag at `fireRate` a minute, and Plasma Thunder (its share is chosen when firing)
 *   hill  the Grapple only, at `grappleRate` a minute, kept on two seconds to drag the holder
 *         off. Never Yoink, which "would be too overpowered"; nor Thunder or Chaser.
 *   free  whatever the room allows (bots.tagBeams decides whether bots use any of it).
 * `jitter` (about 1) spreads the waits so bots do not fire in step.
 */
export function botGameOptions(
  game: 'tag' | 'hill' | 'free',
  allowed: readonly BotGearOption[],
  s: { fireRate: number; grappleRate: number; thunderShare: number; lasers: boolean; jitter: number },
): BotGearOption[] {
  if (game === 'hill') {
    if (!(s.grappleRate > 0)) return []
    return allowed.filter(o => o.id === 'bungee').map(o => ({ ...o, range: Math.min(o.range, 60), cooldown: Math.max(o.cooldown, 60 / s.grappleRate * s.jitter), hold: 2 }))
  }
  if (game === 'tag') {
    if (!(s.fireRate > 0)) return []
    const every = 60 / s.fireRate * s.jitter
    const out: BotGearOption[] = []
    if (s.lasers) out.push({ id: 'beam', range: 120, cooldown: every })
    const red = allowed.find(o => o.id === 'red')
    if (red && s.thunderShare > 0) out.push({ ...red, range: 160, cooldown: Math.max(red.cooldown, every) })
    return out
  }
  return [...allowed]
}
