/**
 * Terrain parameters. Shared by the room (scope 'world') and applied on slider release
 * (`deferred`) because regenerating the mesh and collider is a visible hitch.
 */
import { defineParam, type Param, worldSeed } from '../../../shared/params'
import { BIOME_NAMES } from '../../../shared/recipes'

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
  ...P, id: 'terrain.duneHeight', label: 'Dune height (m)', default: 4, min: 0, max: 20, step: 0.5,
})
export const terrainRoughness = defineParam({
  ...P, id: 'terrain.roughness', label: 'Roughness', default: 0.5, min: 0, max: 1, step: 0.01,
})
export const terrainMesaHeight = defineParam({
  ...P, id: 'terrain.mesaHeight', label: 'Mountain height (m)', default: 120, min: 0, max: 360, step: 2,
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
  ...P, id: 'terrain.spireHeight', label: 'Spire height (m)', default: 190, min: 0, max: 300, step: 5,
})

export const terrainLandShare = defineParam({
  ...P, id: 'terrain.landShare', label: 'Land share (0 all sea, 1 all land)', default: 0.5, min: 0.3, max: 0.85, step: 0.01,
})
/**
 * Landforms (landforms.ts): extra mountains on land, their kinds drawn from the seed with
 * odds set by the biome, and extra islands in the sea. Both clear of the central mountain,
 * the spawn pads and the roads in.
 */
export const terrainLandforms = defineParam({
  ...P, id: 'terrain.landforms', label: 'Extra mountains', default: 4, min: 0, max: 12, step: 1,
})
export const terrainIsles = defineParam({
  ...P, id: 'terrain.isles', label: 'Extra islands', default: 0, min: 0, max: 12, step: 1,
})
/**
 * The world's tile, stored as a power of two: 1024 × 2^value metres (shared/protocol.ts
 * tileSize), so the three old sizes 0, 1 and 2 are still exactly 1024, 2048 and 4096 m and
 * saved rooms and links keep their size. Shown and set in metres, in 256 m steps.
 */
export const terrainPlanetSize = defineParam({
  ...P, id: 'terrain.planetSize', label: 'Planet size (m)', default: 1, min: 0, max: 2, step: 0.0001,
  display: { offset: 0, scale: 1024, power: 2, step: 256 },
})
/**
 * Fords: on water worlds, rivers carry on across the roads as shallow fords and run down to
 * the sea, instead of stopping in a pool above each road. Enabled by default for water
 * rivers; lava rivers never ford. Players can restore the old river layout with the slider.
 */
export const terrainFords = defineParam({
  ...P, id: 'terrain.fords', label: 'Rivers ford the roads (0 off, 1 on)', default: 1, min: 0, max: 1, step: 1,
})
export const terrainTreeCover = defineParam({
  ...P, id: 'terrain.treeCover', label: 'Plant cover (off: no worlds grow trees or cacti)', default: 0, min: 0, max: 1, step: 0.01,
})
/**
 * How much air the world has, 0 to 1. Read by the weather (wind force, wind sound, fog):
 * 1 is a full atmosphere, 0 is a vacuum with no wind, no wind sound and no fog (the Moon).
 */
export const worldAtmosphere = defineParam({
  id: 'world.atmosphere', label: 'Atmosphere (0 vacuum, 1 full)', group: 'World', scope: 'world', default: 1, min: 0, max: 1, step: 0.01,
})
/**
 * How roads are drawn: 0 as the planet's palette says (a made road on alpine worlds, worn
 * tracks elsewhere), 1 always a made road, 2 always a track. A look only: the road bed
 * under it, and how it drives, are the same.
 */
export const terrainRoadStyle = defineParam({
  id: 'terrain.roadStyle', label: 'Roads: 0 by planet, 1 made road, 2 worn track', group: 'Terrain', scope: 'world', default: 0, min: 0, max: 2, step: 1,
})
/** How much grass and small flowers grow. Read by groundcover.ts; not a regeneration. */
export const terrainGroundCover = defineParam({
  id: 'terrain.groundCover', label: 'Grass and flowers', group: 'Terrain', scope: 'world', default: 1, min: 0, max: 1, step: 0.05,
})
/**
 * A planet's own meadow. All four are looks only, read by groundcover.ts: none regenerates
 * the terrain, and all are shared, so every player in a room sees the same plants.
 */
/** Share of the planet's flowers and other small plants that grow; the grass is `terrain.groundCover`. */
export const terrainFlowers = defineParam({
  id: 'terrain.flowers', label: 'Flowers', group: 'Terrain', scope: 'world', default: 1, min: 0, max: 1, step: 0.05,
})
/** Turns every plant's colour round the colour wheel, in degrees: 0 keeps the planet's own palette. */
export const terrainFloraHue = defineParam({
  id: 'terrain.floraHue', label: 'Plant colour shift', group: 'Terrain', scope: 'world', default: 0, min: -180, max: 180, step: 5,
})
/** Reshuffles where plants grow and which colours they pick, without changing the ground: 0 is the planet's own. */
export const terrainFloraSeed = defineParam({
  id: 'terrain.floraSeed', label: 'Plant seed', group: 'Terrain', scope: 'world', default: 0, min: 0, max: 999, step: 1,
})
/** Fireflies and glowing spores after dark, on the planets that have them. */
export const terrainNightLife = defineParam({
  id: 'terrain.nightLife', label: 'Fireflies and spores at night', group: 'Terrain', scope: 'world', default: 1, min: 0, max: 1, step: 0.05,
})
/**
 * The SHAPE of the world: 0 a cone with a crater (lava lake, rivers and vents unless the
 * world is dry), 1 a great mesa with buttes, 2 a horn peak with ridged ranges. The colours
 * are a separate choice, the biome (`terrain.look`), so a planet is a shape plus a biome plus sliders.
 * See world/planets.ts for the recipes.
 */
export const terrainKind = defineParam({
  ...P, id: 'terrain.kind', label: 'Shape: 0 volcano, 1 mesa, 2 horn peak', default: 0, min: 0, max: 2, step: 1,
})
/**
 * The biome: the ground's palette, an index into terrain/palettes.ts. Also names the planet.
 * Players see it as "Biome"; the id keeps its old name so saved rooms and links still load.
 * The label lists the choices (names from shared/recipes.ts BIOME_NAMES) so the inspector
 * draws named buttons, not a 0 to 8 slider.
 */
export const terrainLook = defineParam({
  ...P, id: 'terrain.look',
  label: `Biome: ${BIOME_NAMES.map((name, i) => `${i} ${name}`).join(', ')}`,
  default: 0, min: 0, max: 8, step: 1,
})
/** Where snow starts, as a fraction of the summit's height. 2 is above everything: no snow. */
export const terrainSnowLine = defineParam({
  ...P, id: 'terrain.snowLine', label: 'Snow line (share of summit height, 2 none)', default: 2, min: 0, max: 2, step: 0.01,
})
/** A dry world has no lake, rivers, pools or vents. Sink the sea level below -60 to drain the sea too. */
export const terrainDry = defineParam({
  ...P, id: 'terrain.dry', label: 'Dry world: no lake or rivers (0 off, 1 on)', default: 0, min: 0, max: 1, step: 1,
})
/** Impact craters over the open ground: 0 none, 1 saturated. */
export const terrainCraters = defineParam({
  ...P, id: 'terrain.craters', label: 'Impact craters', default: 0, min: 0, max: 1, step: 0.01,
})
/** What the sea is made of. A look and feel choice: it does not change the shape of the land. */
export const worldSeaKind = defineParam({
  id: 'world.seaKind', label: 'Sea: 0 lava, 1 water', group: 'World', scope: 'world', default: 0, min: 0, max: 1, step: 1,
})
export const KIND_VOLCANIC = 0
export const KIND_DESERT = 1
export const KIND_ALPINE = 2
/** The look whose ground carries alpine tundra and painted meadow flowers. */
export const LOOK_ALPINE = 2

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
  /** The shape: KIND_VOLCANIC (cone), KIND_DESERT (mesa) or KIND_ALPINE (horn). */
  kind: number
  /** Palette index, see palettes.ts. */
  look: number
  /** Snow starts at this fraction of the summit height; 2 or more means none. */
  snowLine: number
  /** 1: no lake, rivers, pools or vents. */
  dry: number
  /** 0..1 density and depth of impact craters. */
  craters: number
  /** 0..1 share of the tile that is land. */
  landShare: number
  /** How many extra mountains stand on land (landforms.ts). */
  landforms: number
  /** How many extra islands stand in the sea (landforms.ts). */
  isles: number
  /** The tile as a power of two: 1024 × 2^planetSize metres (0, 1, 2 are 1, 2, 4 km). */
  planetSize: number
  /** 0..1 share of the land in forest. */
  treeCover: number
  /** 1 when rivers ford the roads and reach the sea (water worlds only). */
  fords: number
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
  look: terrainLook,
  snowLine: terrainSnowLine,
  dry: terrainDry,
  craters: terrainCraters,
  landShare: terrainLandShare,
  landforms: terrainLandforms,
  isles: terrainIsles,
  planetSize: terrainPlanetSize,
  treeCover: terrainTreeCover,
  fords: terrainFords,
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
