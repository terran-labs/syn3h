import { generateTerrain, type TerrainData } from '../../src/world/terrain/generate'
import type { TerrainSettings } from '../../src/world/terrain/settings'

const worlds = new Map<string, TerrainData>()

/**
 * One generated world per seed and settings for a whole test file, so tests that check
 * different things about the same seeds do not each pay for generating them again. Generation
 * is a pure function of (seed, settings, options), which tests/world/terrain.test.ts and the
 * determinism tests prove by generating twice, so they call generateTerrain directly. The world
 * is shared: read it, never write to it.
 */
export function sharedTerrain(seed: number, settings: TerrainSettings, options?: { resolution?: number }): TerrainData {
  const key = `${seed}|${options?.resolution ?? ''}|${JSON.stringify(settings)}`
  let world = worlds.get(key)
  if (!world) worlds.set(key, (world = generateTerrain(seed, settings, options)))
  return world
}
