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
