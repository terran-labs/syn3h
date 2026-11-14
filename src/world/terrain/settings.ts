/**
 * Terrain parameters. Shared by the room (scope 'world') and applied on slider release
 * (`deferred`) because regenerating the mesh and collider is a visible hitch.
 */
import { defineParam, type Param, worldSeed } from '../../../shared/params'

const P = { scope: 'world', group: 'Terrain', deferred: true } as const

export const terrainVolcanoHeight = defineParam({
  ...P, id: 'terrain.volcanoHeight', label: 'Volcano height', default: 260, min: 80, max: 450, step: 5,
})
export const terrainVolcanoRadius = defineParam({
  ...P, id: 'terrain.volcanoRadius', label: 'Volcano radius', default: 420, min: 220, max: 600, step: 5,
})
export const terrainCalderaSize = defineParam({
  ...P, id: 'terrain.calderaSize', label: 'Caldera size', default: 85, min: 30, max: 180, step: 1,
})
export const terrainDuneHeight = defineParam({
  ...P, id: 'terrain.duneHeight', label: 'Dune height', default: 7, min: 0, max: 25, step: 0.5,
})
export const terrainRoughness = defineParam({
  ...P, id: 'terrain.roughness', label: 'Roughness', default: 0.5, min: 0, max: 1, step: 0.01,
})
export const terrainMesaHeight = defineParam({
  ...P, id: 'terrain.mesaHeight', label: 'Mesa height', default: 38, min: 0, max: 90, step: 1,
})

/** Everything generation depends on besides the seed. Plain data so tests need no registry. */
export interface TerrainSettings {
  volcanoHeight: number
  volcanoRadius: number
  calderaSize: number
  duneHeight: number
  roughness: number
  mesaHeight: number
}

export const TERRAIN_PARAMS: Record<keyof TerrainSettings, Param<number>> = {
  volcanoHeight: terrainVolcanoHeight,
  volcanoRadius: terrainVolcanoRadius,
  calderaSize: terrainCalderaSize,
  duneHeight: terrainDuneHeight,
  roughness: terrainRoughness,
  mesaHeight: terrainMesaHeight,
}

/** Param ids whose change regenerates the terrain. */
export const TERRAIN_PARAM_IDS: ReadonlySet<string> = new Set<string>([
  worldSeed.def.id,
  ...Object.values(TERRAIN_PARAMS).map((p) => p.def.id),
])

export function defaultTerrainSettings(): TerrainSettings {
  const out = {} as TerrainSettings
  for (const k in TERRAIN_PARAMS) {
    const key = k as keyof TerrainSettings
    out[key] = TERRAIN_PARAMS[key].def.default
  }
  return out
}

export function currentTerrainSettings(): TerrainSettings {
  const out = {} as TerrainSettings
  for (const k in TERRAIN_PARAMS) {
    const key = k as keyof TerrainSettings
    out[key] = TERRAIN_PARAMS[key].value as number
  }
  return out
}
