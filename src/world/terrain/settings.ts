/**
 * Terrain parameters. Shared by the room (scope 'world') and applied on slider release
 * (`deferred`) because regenerating the mesh and collider is a visible hitch.
 */
import { defineParam, type Param, worldSeed } from '../../../shared/params'

const P = { scope: 'world', group: 'Terrain', deferred: true } as const

export const terrainVolcanoHeight = defineParam({
  ...P, id: 'terrain.volcanoHeight', label: 'Volcano height', default: 540, min: 120, max: 640, step: 5,
})
export const terrainVolcanoRadius = defineParam({
  ...P, id: 'terrain.volcanoRadius', label: 'Volcano radius', default: 360, min: 220, max: 480, step: 5,
})
export const terrainCalderaSize = defineParam({
  ...P, id: 'terrain.calderaSize', label: 'Caldera size', default: 62, min: 30, max: 120, step: 1,
})
export const terrainDuneHeight = defineParam({
  ...P, id: 'terrain.duneHeight', label: 'Dune height', default: 4, min: 0, max: 20, step: 0.5,
})
export const terrainRoughness = defineParam({
  ...P, id: 'terrain.roughness', label: 'Roughness', default: 0.5, min: 0, max: 1, step: 0.01,
})
export const terrainMesaHeight = defineParam({
  ...P, id: 'terrain.mesaHeight', label: 'Mountain height', default: 120, min: 0, max: 220, step: 2,
})
export const terrainIslandRadius = defineParam({
  ...P, id: 'terrain.islandRadius', label: 'Island size (radius)', default: 800, min: 480, max: 824, step: 4,
})
export const terrainCoastWobble = defineParam({
  ...P, id: 'terrain.coastWobble', label: 'Coast capes and bays', default: 0.2, min: 0, max: 0.35, step: 0.01,
})
export const terrainCragDensity = defineParam({
  ...P, id: 'terrain.cragDensity', label: 'Mountain cover', default: 0.34, min: 0, max: 0.7, step: 0.01,
})
export const terrainSpireHeight = defineParam({
  ...P, id: 'terrain.spireHeight', label: 'Spire height', default: 190, min: 0, max: 300, step: 5,
})

export const terrainTreeCover = defineParam({
  ...P, id: 'terrain.treeCover', label: 'Forest cover', default: 0, min: 0, max: 1, step: 0.01,
})
/**
 * What kind of world this is: it picks the shape of the centre, what fills its lake, and
 * the colours of the ground. 0 volcanic (Mars), 1 desert, 2 alpine. See shared/planets.ts
 * for the recipes that set this together with everything else.
 */
export const terrainKind = defineParam({
  ...P, id: 'terrain.kind', label: 'World kind: 0 volcanic, 1 desert, 2 alpine', default: 0, min: 0, max: 2, step: 1,
})
/** What the sea is made of. A look and feel choice: it does not change the shape of the land. */
export const worldSeaKind = defineParam({
  id: 'world.seaKind', label: 'Sea: 0 lava, 1 water', group: 'World', scope: 'world', default: 0, min: 0, max: 1, step: 1,
})
export const KIND_VOLCANIC = 0
export const KIND_DESERT = 1
export const KIND_ALPINE = 2

/** Everything generation depends on besides the seed. Plain data so tests need no registry. */
export interface TerrainSettings {
  volcanoHeight: number
  volcanoRadius: number
  calderaSize: number
  duneHeight: number
  roughness: number
  /** Height of the mountain massifs. The id keeps its old name so saved rooms still load. */
  mesaHeight: number
  islandRadius: number
  coastWobble: number
  cragDensity: number
  spireHeight: number
  /** KIND_VOLCANIC, KIND_DESERT or KIND_ALPINE. */
  kind: number
  /** 0..1 share of the land in forest. */
  treeCover: number
}

export const TERRAIN_PARAMS: Record<keyof TerrainSettings, Param<number>> = {
  volcanoHeight: terrainVolcanoHeight,
  volcanoRadius: terrainVolcanoRadius,
  calderaSize: terrainCalderaSize,
  duneHeight: terrainDuneHeight,
  roughness: terrainRoughness,
  mesaHeight: terrainMesaHeight,
  islandRadius: terrainIslandRadius,
  coastWobble: terrainCoastWobble,
  cragDensity: terrainCragDensity,
  spireHeight: terrainSpireHeight,
  kind: terrainKind,
  treeCover: terrainTreeCover,
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
