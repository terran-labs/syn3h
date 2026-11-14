/**
 * Seam: the one place that decides which terrain the game uses.
 * Owner: terrain work. The procedural world lives in ./terrain.
 */
import type { Game } from '../core/Game'
import type { Terrain } from './Terrain'
import { ProceduralTerrain } from './terrain/ProceduralTerrain'

export function createTerrain(game: Game, seed: number): Terrain {
  return new ProceduralTerrain(game, seed)
}
