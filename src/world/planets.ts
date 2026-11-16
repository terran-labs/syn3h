/**
 * Planet recipes: the kinds of world a player can pick in the lobby.
 *
 * A world is three small things: a recipe id, a seed, and any slider the host has moved
 * since. All of it travels as ordinary shared parameters, so every client rebuilds the
 * identical island locally and nothing is downloaded. A recipe is just a named set of
 * parameter values: picking one applies them through the registry, exactly as if the host
 * had dragged each slider.
 *
 * No renderer imports: the lobby, the server and tests can all use this file.
 */
import { recipeIdForLook } from '../../shared/recipes'
import { params, type ParamSource, type ParamValue, worldNameSeed, worldSeed } from '../../shared/params'
import { randomNameSeed, seedName, worldName } from './worldName'
import { SKY_PRESETS } from './sky/presets'
// Imported for their side effect: they register the sliders the recipes set.
import './sky/skyParams'
import './terrain/settings'
import { planetWeather } from './weather/planetWeather'

/**
 * A world as a body in the lobby's solar system. Both are read by the galaxy to lay the
 * system out, so a new recipe takes its place by what it is, not by its name.
 *  - size: its radius relative to an ordinary planet (1). A moon is well under half.
 *  - heat: 0 for a frozen world to 1 for a molten one. Orbits are ordered by it, hottest
 *    nearest the sun, so the icy worlds are the farthest out. It follows what the world is:
 *    molten and glassy worlds inside, then the hot dry ones, the living wet worlds in the
 *    temperate band, snow and ice beyond.
 *  - parent: a moon's planet, by recipe id. A moon circles its planet, not the sun, and
 *    shares its planet's distance from the sun; its own heat is then not used for its place.
 */
export interface PlanetBody { size: number; heat: number; parent?: string }
export const ORDINARY_BODY: PlanetBody = { size: 1, heat: 0.5 }
export interface PlanetRecipe {
  id: string
  /** The biome's name, shown to players: on a world's label under its own name, in lower case. */
  label: string
  /** One line for the lobby card. */
  blurb: string
  /** What stands at the centre of the island. */
  centre: string
  /** Two colours for a lobby sphere before the real map is painted: land, sea. */
  swatch: [number, number]
  /** The body as the lobby's solar system shows it. Left out, it is an ordinary temperate planet. */
  body?: PlanetBody
  /** Parameter values by id. Anything not listed keeps its default. */
  values: Record<string, ParamValue>
}

/** Island size presets: a coast radius in metres, inside the 2 km square. */
export const ISLAND_SIZES = { small: 520, medium: 680, large: 824 } as const
export type IslandSize = keyof typeof ISLAND_SIZES

/**
 * The warm wetland's name (recipe id 'swamp', look 8), chosen by the owner on 16 November
 * 2026; it was "Methane swamp". Players see only this; ids and stored values are unchanged.
 */
export const MIRE_LABEL = 'Mire'

const MARS: Record<string, ParamValue> = {
  ...SKY_PRESETS['Mars day'],
  'terrain.kind': 0, 'terrain.look': 0, 'world.seaKind': 0, 'world.lavaAltitude': 0,
  'terrain.islandRadius': 800, 'terrain.coastWobble': 0.2,
  'terrain.volcanoHeight': 540, 'terrain.volcanoRadius': 360, 'terrain.calderaSize': 62,
  'terrain.mesaHeight': 120, 'terrain.cragDensity': 0.34, 'terrain.spireHeight': 190,
  'terrain.duneHeight': 4, 'terrain.roughness': 0.5, 'terrain.treeCover': 0,
  ...planetWeather('volcanic'),
}

export const PLANETS: readonly PlanetRecipe[] = [
  {
    id: 'volcanic', label: 'Volcanic', centre: 'A volcano with a lava lake in its crater',
    blurb: 'Rust plains and black spires round a live volcano, in a sea of glowing lava.',
    swatch: [0xc24a22, 0xff7a1a], body: { size: 0.9, heat: 1.0 }, values: MARS,
  },
  {
    id: 'desert', label: 'Desert', centre: 'A great mesa with an oasis on top',
    blurb: 'Gold dunes and sandstone buttes round a towering mesa, in a warm shallow sea.',
    swatch: [0xe6b866, 0x2fb7b0], body: { size: 1.0, heat: 0.75 },
    values: {
      ...planetWeather('desert'),
      ...SKY_PRESETS['Earthlike'], 'sky.turbidity': 5, 'weather.cloudCoverage': 0.12, 'weather.fogDensity': 0.00022,
      'terrain.kind': 1, 'terrain.look': 1, 'world.seaKind': 1, 'world.lavaAltitude': 0,
      'terrain.islandRadius': 800, 'terrain.coastWobble': 0.26,
      'terrain.volcanoHeight': 230, 'terrain.volcanoRadius': 420, 'terrain.calderaSize': 70, 'terrain.treeCover': 0,
      'terrain.mesaHeight': 95, 'terrain.cragDensity': 0.22, 'terrain.spireHeight': 120,
      'terrain.duneHeight': 16, 'terrain.roughness': 0.3,
    },
  },
  {
    id: 'alpine', label: 'Alpine', centre: 'A snow peak with a tarn at its summit',
    blurb: 'Pine forest and granite ranges under a snow peak, in a cold blue sea.',
    swatch: [0x5f8a3a, 0x1c5f9a], body: { size: 1.0, heat: 0.4 },
    values: {
      ...planetWeather('alpine'),
      ...SKY_PRESETS['Earthlike'], 'weather.cloudCoverage': 0.45, 'weather.fogDensity': 0.0003,
      'terrain.kind': 2, 'terrain.look': 2, 'terrain.snowLine': 0.36, 'world.seaKind': 1, 'world.lavaAltitude': 0,
      'terrain.islandRadius': 800, 'terrain.coastWobble': 0.3,
      'terrain.volcanoHeight': 600, 'terrain.volcanoRadius': 380, 'terrain.calderaSize': 55,
      'terrain.mesaHeight': 330, 'terrain.cragDensity': 0.56, 'terrain.spireHeight': 0,
      'terrain.duneHeight': 0, 'terrain.roughness': 0.5, 'terrain.treeCover': 0,
    },
  },
  {
    id: 'archipelago', label: 'Archipelago', centre: 'A low green mesa over a turquoise lagoon',
    blurb: 'A small world of sandy islands in turquoise shallows. Bring a hovercraft or a jet.',
    swatch: [0xa6c95e, 0x58ecd8], body: { size: 0.9, heat: 0.5 },
    values: {
      ...planetWeather('archipelago'),
      ...SKY_PRESETS['Earthlike'], 'weather.cloudCoverage': 0.3, 'weather.fogDensity': 0.00016,
      'terrain.kind': 1, 'terrain.look': 3, 'world.seaKind': 1, 'world.lavaAltitude': 0,
      'terrain.planetSize': 0, 'terrain.landShare': 0.3,
      'terrain.islandRadius': 640, 'terrain.coastWobble': 0.35,
      'terrain.volcanoHeight': 150, 'terrain.volcanoRadius': 300, 'terrain.calderaSize': 80,
      'terrain.mesaHeight': 34, 'terrain.cragDensity': 0.14, 'terrain.spireHeight': 0,
      'terrain.duneHeight': 3, 'terrain.roughness': 0.25, 'terrain.treeCover': 0,
    },
  },
  {
    id: 'ice', label: 'Ice moon', centre: 'A frozen horn with a tarn at its summit',
    blurb: 'Blue-white ice plains and pale cliffs over a dark, cold sea, under a violet dusk.',
    swatch: [0xd6e8f4, 0x1f5f8a], body: { size: 0.5, heat: 0.05 },
    values: {
      ...planetWeather('ice'),
      ...SKY_PRESETS['Violet dusk'], 'weather.cloudCoverage': 0.2, 'sun.timeOfDay': 16.6,
      'terrain.kind': 2, 'terrain.look': 4, 'terrain.snowLine': 0.03, 'world.seaKind': 1, 'world.lavaAltitude': 0,
      'terrain.islandRadius': 800, 'terrain.coastWobble': 0.24,
      'terrain.volcanoHeight': 520, 'terrain.volcanoRadius': 400, 'terrain.calderaSize': 70,
      'terrain.mesaHeight': 240, 'terrain.cragDensity': 0.4, 'terrain.spireHeight': 90,
      'terrain.duneHeight': 2, 'terrain.roughness': 0.45, 'terrain.treeCover': 0,
      'terrain.groundCover': 0,
    },
  },
  {
    id: 'obsidian', label: 'Obsidian', centre: 'A glass volcano ringed by giant shards',
    blurb: 'Black glass and needle spires veined with magenta, standing in a sea of lava.',
    swatch: [0x262130, 0xff5a1a], body: { size: 0.8, heat: 0.9 },
    values: {
      ...planetWeather('obsidian'),
      ...SKY_PRESETS['Violet dusk'], 'weather.cloudCoverage': 0.12, 'sun.timeOfDay': 16.3,
      'terrain.kind': 0, 'terrain.look': 5, 'world.seaKind': 0, 'world.lavaAltitude': 0,
      'terrain.islandRadius': 800, 'terrain.coastWobble': 0.28,
      'terrain.volcanoHeight': 600, 'terrain.volcanoRadius': 330, 'terrain.calderaSize': 62,
      'terrain.mesaHeight': 150, 'terrain.cragDensity': 0.3, 'terrain.spireHeight': 300,
      'terrain.duneHeight': 0, 'terrain.roughness': 0.8, 'terrain.treeCover': 0,
    },
  },
  {
    id: 'badlands', label: 'Badlands', centre: 'The tallest butte, with a road spiralling up it',
    blurb: 'Almost all land: a maze of banded red buttes and canyons, with rivers at the bottom.',
    swatch: [0xd27a4a, 0x3fb0a0], body: { size: 1.05, heat: 0.65 },
    values: {
      ...planetWeather('badlands'),
      ...SKY_PRESETS['Mars day'], 'sky.turbidity': 4, 'weather.cloudCoverage': 0.2, 'sun.timeOfDay': 15.5,
      'terrain.kind': 1, 'terrain.look': 6, 'world.seaKind': 1, 'world.lavaAltitude': 0,
      'terrain.landShare': 0.85, 'terrain.fords': 1,
      'terrain.islandRadius': 824, 'terrain.coastWobble': 0.3,
      'terrain.volcanoHeight': 330, 'terrain.volcanoRadius': 400, 'terrain.calderaSize': 60,
      'terrain.mesaHeight': 210, 'terrain.cragDensity': 0.58, 'terrain.spireHeight': 150,
      'terrain.duneHeight': 2, 'terrain.roughness': 0.6, 'terrain.treeCover': 0,
    },
  },
  {
    id: 'moon', label: 'Moon', centre: 'A giant impact crater with a central peak',
    blurb: 'Grey dust and craters under a black sky, in one sixth of the gravity. Jump.',
    swatch: [0xa6a6a8, 0x3a3a3e], body: { size: 0.42, heat: 0.32, parent: 'alpine' },
    values: {
      ...planetWeather('moon'),
      'sky.rayleighR': 5.8, 'sky.rayleighG': 13.5, 'sky.rayleighB': 30, 'sky.rayleigh': 0,
      'sky.turbidity': 0, 'sky.mieCoefficient': 0, 'sky.mieDirectionalG': 0.8,
      'sky.nightBrightness': 3, 'weather.cloudCoverage': 0, 'weather.fogDensity': 0,
      'sun.timeOfDay': 15.2,
      // No sky to meter from: a black sky would push the auto exposure until the dust burns white.
      'sky.autoExposure': 0, 'sky.exposure': 0.28,
      'world.gravity': 1.62, 'world.atmosphere': 0,
      'terrain.kind': 0, 'terrain.look': 7, 'terrain.dry': 1, 'terrain.craters': 0.7,
      'world.seaKind': 1, 'world.lavaAltitude': -80,
      'terrain.landShare': 0.7,
      'terrain.islandRadius': 800, 'terrain.coastWobble': 0.2,
      'terrain.volcanoHeight': 170, 'terrain.volcanoRadius': 460, 'terrain.calderaSize': 120,
      'terrain.mesaHeight': 70, 'terrain.cragDensity': 0.12, 'terrain.spireHeight': 0,
      'terrain.duneHeight': 0, 'terrain.roughness': 0.3, 'terrain.treeCover': 0,
      'terrain.groundCover': 0,
    },
  },
  {
    id: 'swamp', label: MIRE_LABEL, centre: 'A low reed plateau in the mist',
    blurb: 'Olive mud flats, reed beds and low mesas in warm green haze, round murky water.',
    // Warm and wet: the inner edge of the temperate band, between the dry worlds and the sea.
    swatch: [0x8c8a3a, 0x4a5228], body: { size: 1.25, heat: 0.58 },
    values: {
      ...planetWeather('swamp'),
      ...SKY_PRESETS['Mire green'], 'weather.cloudCoverage': 0.7, 'weather.fogDensity': 0.0011,
      'terrain.kind': 1, 'terrain.look': 8, 'world.seaKind': 1, 'world.lavaAltitude': 0,
      'terrain.landShare': 0.6,
      'terrain.islandRadius': 800, 'terrain.coastWobble': 0.35,
      'terrain.volcanoHeight': 140, 'terrain.volcanoRadius': 440, 'terrain.calderaSize': 90,
      'terrain.mesaHeight': 46, 'terrain.cragDensity': 0.3, 'terrain.spireHeight': 40,
      'terrain.duneHeight': 1, 'terrain.roughness': 0.35, 'terrain.treeCover': 0,
    },
  },
]

/**
 * Every parameter any recipe sets. Picking a planet first puts all of these back to their
 * registered defaults, so a slider one planet moves (the Moon's gravity, a small tile, a
 * dry world) does not leak into the next planet, which never mentions it.
 */
const RECIPE_KEYS: readonly string[] = [...new Set(PLANETS.flatMap((p) => Object.keys(p.values)))]

export function planetById(id: string | null | undefined): PlanetRecipe | undefined {
  return PLANETS.find((p) => p.id === id)
}

/** A fresh seed for a newly picked planet. Not used for generation itself, so Math.random is fine. */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999998)
}

/**
 * Make the current world this planet: apply the recipe, then the seed, through the
 * registry, so sliders, the terrain and the network all see it. Returns the seed used.
 */
export function applyPlanet(
  id: string, seed?: number, options: { size?: IslandSize; source?: ParamSource; nameSeed?: number } = {},
): number {
  // A newly rolled world gets a name of its own. A given seed (a link, a saved session)
  // keeps the name that seed has always given, unless the caller names it.
  const nameSeed = options.nameSeed ?? (seed === undefined ? randomNameSeed() : 0)
  seed ??= randomSeed()
  const recipe = planetById(id) ?? PLANETS[0]
  const source = options.source ?? 'local'
  // One snapshot: defaults for everything a recipe could have moved, then this recipe.
  const values: Record<string, ParamValue> = {}
  for (const id of RECIPE_KEYS) {
    const def = params.get(id)?.def
    if (def) values[id] = def.default as ParamValue
  }
  params.applySnapshot({ ...values, ...recipe.values }, source)
  if (options.size) params.set('terrain.islandRadius', ISLAND_SIZES[options.size], source)
  params.set(worldSeed.def.id, seed, source)
  params.set(worldNameSeed.def.id, nameSeed, source)
  return seed
}

/** The recipe whose look matches the current world, for labels and share links. */
export function currentPlanet(): PlanetRecipe {
  const look = params.get('terrain.look')?.value
  return PLANETS.find((p) => p.id === recipeIdForLook(look)) ?? PLANETS[0]
}

// ---------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------

/** The name a terrain seed gave before names had their own setting. Prefer `currentWorldName`. */
export const planetName = seedName

/** The current world's name, from its name setting (see `world.nameSeed`). */
export function currentWorldName(): string {
  return worldName(worldNameSeed.value, worldSeed.value)
}

/** A biome's name as the second line under a world's name: "alpine", "mire". */
export function biomeLine(recipe: PlanetRecipe): string {
  return recipe.label.toLowerCase()
}

// ---------------------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------------------

/**
 * The current world as a short string for a link: the recipe id, the seed, and only the
 * shared sliders that differ from the recipe. "volcanic.4821" or
 * "alpine.90210.terrain.islandRadius=520,world.lavaAltitude=12".
 */
export function encodeWorld(): string {
  const recipe = currentPlanet()
  const world = params.snapshot('world')
  const changed: string[] = []
  for (const id of Object.keys(world).sort()) {
    if (id === worldSeed.def.id) continue
    const def = params.get(id)!.def
    const base = id in recipe.values ? recipe.values[id] : def.default
    if (world[id] !== base) changed.push(`${id}=${world[id]}`)
  }
  return [recipe.id, worldSeed.value, ...(changed.length ? [changed.join(',')] : [])].join('.')
    // The overrides contain dots (parameter ids): keep the first two fields unambiguous.
    .replace(/^([^.]+)\.(\d+)\./, '$1.$2~')
}

/** Apply a string made by `encodeWorld`. Returns false if it is not one. */
export function decodeWorld(text: string, source: ParamSource = 'preset'): boolean {
  const m = /^([a-z]+)\.(\d+)(?:~(.*))?$/.exec(text.trim())
  if (!m || !planetById(m[1])) return false
  applyPlanet(m[1], Number(m[2]), { source })
  if (m[3]) {
    for (const pair of m[3].split(',')) {
      const i = pair.indexOf('=')
      if (i <= 0) continue
      const id = pair.slice(0, i)
      const raw = pair.slice(i + 1)
      // Only shared world sliders may come from a link.
      if (params.get(id)?.def.scope !== 'world') continue
      params.set(id, raw === 'true' ? true : raw === 'false' ? false : Number(raw), source)
    }
  }
  return true
}

/** A link that opens this exact world. */
export function shareLink(base: string = typeof location !== 'undefined' ? location.origin + location.pathname : ''): string {
  return `${base}?world=${encodeURIComponent(encodeWorld())}`
}
