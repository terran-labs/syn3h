/**
 * Seam: the one place that decides which terrain the game uses.
 * Owner: terrain work. Replace the placeholder with the procedural world.
 */
import type { Game } from '../core/Game'
import { type Terrain, createPlaceholderTerrain } from './Terrain'

export function createTerrain(game: Game, seed: number): Terrain {
  return createPlaceholderTerrain(game, seed)
}
