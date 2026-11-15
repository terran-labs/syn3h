/**
 * The real generated island, headless: the same heights, roads, liquid and physics collider
 * the game uses, without a renderer. Lets a bot drive minutes of real terrain in a fraction
 * of a second, so driving behaviour can be judged without a browser capture.
 */
import { Vector3 } from 'three/webgpu'
import type { RAPIER } from '../../src/core/physics'
import type { BotTerrain } from '../../src/bots/BotBrain'
import { createTerrainCollider } from '../../src/world/terrain/collider'
import { generateTerrain } from '../../src/world/terrain/generate'
import { lavaSurfaceAt } from '../../src/world/terrain/lava'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { defaultTerrainSettings, type TerrainSettings } from '../../src/world/terrain/settings'
import { spawnPointAt } from '../../src/world/terrain/spawn'

export function island(world: RAPIER.World, seed = 1, settings: Partial<TerrainSettings> = {}, seaLevel = 0, wrap = false): BotTerrain {
  const data = generateTerrain(seed, { ...defaultTerrainSettings(), ...settings })
  const sampler = new HeightSampler(data)
  createTerrainCollider(world, data)
  const rim = data.roads.find(r => r.kind === 'rim'), v = data.layout.volcano
  return {
    size: data.size,
    // The game's worlds always wrap now; tests opt in, so the plain island stays available.
    ...(wrap ? { wrapSize: data.size } : {}),
    heightAt: (x, z) => sampler.heightAt(x, z),
    normalAt: (x, z, out) => sampler.normalAt(x, z, out),
    liquidHeightAt: (x, z) => lavaSurfaceAt(data.lava, x, z, seaLevel),
    spawnPoint: i => { const s = spawnPointAt(sampler, i); return { position: new Vector3(s.x, s.y, s.z), heading: s.heading } },
    roadPaths: () => data.roads,
    summit: () => rim ? {
      x: v.x, z: v.z,
      rimRadius: rim.points.reduce((sum, p) => sum + Math.hypot(p.x - v.x, p.z - v.z), 0) / rim.points.length,
      rimHeight: rim.points.reduce((sum, p) => sum + p.y, 0) / rim.points.length,
      lake: data.lava.lake ? { radius: data.lava.lake.radius, surface: data.lava.lake.surface } : null,
    } : null,
    dispose() {},
  } as BotTerrain
}
