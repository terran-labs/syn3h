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
import { params, type ParamSource, type ParamValue, worldSeed } from '../../shared/params'
import { SKY_PRESETS } from './sky/presets'
// Imported for their side effect: they register the sliders the recipes set.
import './sky/skyParams'
import './terrain/settings'

export interface PlanetRecipe {
  id: string
  /** Shown in the lobby. */
  label: string
  /** One line for the lobby card. */
  blurb: string
  /** What stands at the centre of the island. */
  centre: string
  /** Two colours for a lobby sphere before the real map is painted: land, sea. */
  swatch: [number, number]
  /** Parameter values by id. Anything not listed keeps its default. */
  values: Record<string, ParamValue>
}

/** Island size presets: a coast radius in metres, inside the 2 km square. */
export const ISLAND_SIZES = { small: 520, medium: 680, large: 824 } as const
export type IslandSize = keyof typeof ISLAND_SIZES

const MARS: Record<string, ParamValue> = {
  ...SKY_PRESETS['Mars day'],
  'terrain.kind': 0, 'world.seaKind': 0, 'world.lavaAltitude': 0,
  'terrain.islandRadius': 800, 'terrain.coastWobble': 0.2,
  'terrain.volcanoHeight': 540, 'terrain.volcanoRadius': 360, 'terrain.calderaSize': 62,
  'terrain.mesaHeight': 120, 'terrain.cragDensity': 0.34, 'terrain.spireHeight': 190,
  'terrain.duneHeight': 4, 'terrain.roughness': 0.5, 'terrain.treeCover': 0,
}

export const PLANETS: readonly PlanetRecipe[] = [
  {
    id: 'volcanic', label: 'Volcanic', centre: 'A volcano with a lava lake in its crater',
    blurb: 'Rust plains and black spires round a live volcano, in a sea of glowing lava.',
    swatch: [0xc24a22, 0xff7a1a], values: MARS,
  },
  {
    id: 'desert', label: 'Desert', centre: 'A great mesa with an oasis on top',
    blurb: 'Gold dunes and sandstone buttes round a towering mesa, in a warm shallow sea.',
    swatch: [0xe6b866, 0x2fb7b0],
    values: {
      ...SKY_PRESETS['Earthlike'], 'sky.turbidity': 5, 'weather.cloudCoverage': 0.12, 'weather.fogDensity': 0.00022,
      'terrain.kind': 1, 'world.seaKind': 1, 'world.lavaAltitude': 0,
      'terrain.islandRadius': 800, 'terrain.coastWobble': 0.26,
      'terrain.volcanoHeight': 230, 'terrain.volcanoRadius': 420, 'terrain.calderaSize': 70, 'terrain.treeCover': 0,
      'terrain.mesaHeight': 95, 'terrain.cragDensity': 0.22, 'terrain.spireHeight': 120,
      'terrain.duneHeight': 16, 'terrain.roughness': 0.3,
    },
  },
  {
    id: 'alpine', label: 'Alpine', centre: 'A snow peak with a tarn at its summit',
    blurb: 'Pine forest and granite ranges under a snow peak, in a cold blue sea.',
    swatch: [0x5f8a3a, 0x1c5f9a],
    values: {
      ...SKY_PRESETS['Earthlike'], 'weather.cloudCoverage': 0.45, 'weather.fogDensity': 0.00025,
      'terrain.kind': 2, 'world.seaKind': 1, 'world.lavaAltitude': 0,
      'terrain.islandRadius': 800, 'terrain.coastWobble': 0.3,
      'terrain.volcanoHeight': 600, 'terrain.volcanoRadius': 380, 'terrain.calderaSize': 55,
      'terrain.mesaHeight': 200, 'terrain.cragDensity': 0.5, 'terrain.spireHeight': 90,
      'terrain.duneHeight': 0, 'terrain.roughness': 0.6, 'terrain.treeCover': 0.75,
    },
  },
]

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
  id: string, seed: number = randomSeed(), options: { size?: IslandSize; source?: ParamSource } = {},
): number {
  const recipe = planetById(id) ?? PLANETS[0]
  const source = options.source ?? 'local'
  params.applySnapshot(recipe.values, source)
  if (options.size) params.set('terrain.islandRadius', ISLAND_SIZES[options.size], source)
  params.set(worldSeed.def.id, seed, source)
  return seed
}

/** The recipe whose kind matches the current world, for labels. */
export function currentPlanet(): PlanetRecipe {
  const kind = params.get('terrain.kind')?.value
  return PLANETS.find((p) => p.values['terrain.kind'] === kind) ?? PLANETS[0]
}

// ---------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------

const STARTS = ['Tho', 'Xy', 'Lu', 'Am', 'Ymi', 'Va', 'Mira', 'Ke', 'Ory', 'Sa', 'Zeph', 'Ika', 'No', 'Bry', 'Eli', 'Quo', 'Ash', 'Ve', 'Dra', 'Ula', 'Ha', 'Pyr', 'Cae', 'Io']
const MIDDLES = ['', '', 'la', 'ri', 'no', 've', 'da', 'mi', 'ko', 'the', 'ra', 'li']
const ENDS = ['lus', 'lia', 'cidar', 'mir', 'r', 'lerius', 'dor', 'x', 'th', 'ron', 'ra', 'nis', 'gard', 'phon', 'rix', 'ne', 'tis', 'von', 'mos', 'lune']

function mix32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** A pronounceable planet name for a seed, the same on every client: "Xylia", "Tholus IV". */
export function planetName(seed: number): string {
  const a = mix32(seed | 0)
  const b = mix32(a)
  const c = mix32(b)
  let name = STARTS[a % STARTS.length] + MIDDLES[b % MIDDLES.length] + ENDS[c % ENDS.length]
  name = name[0].toUpperCase() + name.slice(1).toLowerCase()
  const numeral = ['', '', '', ' II', ' III', ' IV', ' V', ' VII', ' IX'][(c >>> 8) % 9]
  return name + numeral
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
