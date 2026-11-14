/**
 * Seam: multiplayer. Called once after the local player exists.
 * Owner: networking work. This placeholder runs the game offline.
 */
import type { Game } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'

export interface NetContext {
  game: Game
  terrain: Terrain
  /** The local player's vehicle. */
  player: Vehicle
  /** Room name from the URL (?room=name), or 'lobby'. */
  room: string
  /** Text lines for the HUD (player list, scores, connection state). */
  setStatus(lines: string[]): void
}

export function startNetworking(ctx: NetContext): void {
  ctx.setStatus(['offline'])
}
