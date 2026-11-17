/**
 * How a world looks from space besides its painted map, for the lobby. Read from the same
 * recipe values the world itself uses, so the lobby cannot drift from the world. No renderer
 * imports and no terrain generation: cheap enough for the lobby's first frame and for tests.
 */
import { params } from '../../shared/params'
import { PLANETS, planetById, type PlanetRecipe } from './planets'
import { paletteFor } from './terrain/palettes'
import { defaultTerrainSettings, KIND_VOLCANIC, type TerrainSettings } from './terrain/settings'

function settingsOf(values: PlanetRecipe['values']): TerrainSettings {
  const s = defaultTerrainSettings()
  for (const [id, value] of Object.entries(values)) {
    const key = id.slice('terrain.'.length) as keyof TerrainSettings
    if (id.startsWith('terrain.') && key in s && typeof value === 'number') s[key] = value
  }
  return s
}


/**
 * What the lobby needs to draw a world as it is, read from the same recipe values the world
 * itself uses: the colour and depth of its air (from its sky's scattering and its haze), its
 * cloud cover and the cloud's tint, how glossy its ground is, what glows on its night side,
 * and the palette ball to show until its map is painted. Plain numbers, so tests read it too.
 */
export interface LobbyLook {
  /** Ground and sea for the ball shown before the map: 0xRRGGBB. A dry world's sea is its ground. */
  land: number; sea: number
  /** Share of the surface that is land, for that ball. */
  landShare: number
  /** The limb's colour, 0..1, and how deep the air is: 0 for none (the Moon), about 1 for Earth's. */
  air: [number, number, number]; airDepth: number
  /** Cloud cover from space, 0..1, and its tint. */
  cloud: number; cloudTint: [number, number, number]
  /** Glint of the dry ground: 0 matt dust, up to 1 for glass. Water always glints. */
  gloss: number
  /** What lights the night side: 0 nothing, 1 lava, 2 the glowcaps of a wetland. */
  night: number
}

export function lobbyLook(recipeId: string, overrides: PlanetRecipe['values'] = {}): LobbyLook {
  const base = planetById(recipeId) ?? PLANETS[0]
  const values = { ...base.values, ...overrides }
  const num = (id: string) => { const v = values[id] ?? params.get(id)?.def.default; return typeof v === 'number' ? v : Number(v ?? 0) }
  const settings = settingsOf(values)
  const pal = paletteFor(settings.look)
  const lava = num('world.seaKind') === 0
  const dry = settings.dry > 0
  const air = num('world.atmosphere') * Math.min(1.6, num('sky.rayleigh'))
  // Rayleigh scattering is strongest in the colours with the largest coefficients: the sky's
  // own colour, normalised. Haze (turbidity and the weather's tint) greys and warms it.
  const beta = [num('sky.rayleighR'), num('sky.rayleighG'), num('sky.rayleighB')], top = Math.max(...beta, 1e-6)
  const haze = [num('weather.hazeTintR') || 1, num('weather.hazeTintG') || 1, num('weather.hazeTintB') || 1]
  const murk = Math.min(0.6, num('sky.turbidity') / 12 + num('weather.hazeTintAmount') * 0.4)
  // Seen edge on from space the air is paler than its sky: a third of the way to grey.
  const tint = beta.map((b, i) => ((0.25 + 0.75 * b / top) * (1 - murk) + haze[i] * murk) * 0.67 + 0.22) as [number, number, number]
  const mixHex = (a: number, b: number, t: number) => [16, 8, 0].reduce((c, k) => c | Math.round(((a >> k) & 255) * (1 - t) + ((b >> k) & 255) * t) << k, 0)
  const ground = mixHex(pal.groundDark, pal.groundLight, 0.5)
  return {
    land: settings.snowLine < 0.2 ? mixHex(ground, pal.snow, 0.7) : ground,
    sea: dry ? mixHex(pal.groundDark, pal.darkRockA, 0.5) : lava ? 0x5a1406 : mixHex(pal.seaDeep, pal.seaShallow, 0.3),
    landShare: dry ? 1 : settings.landShare,
    air: tint, airDepth: air,
    cloud: air > 0 ? Math.min(1, num('weather.cloudCoverage')) : 0,
    // Cloud is white where the air is clean, and takes the haze's colour, and dims, where it is murky.
    cloudTint: [0.94, 0.95, 0.97].map((white, i) => (white * (1 - murk * 0.6) + haze[i] * murk * 0.6) * (1 - murk * 0.55)) as [number, number, number],
    gloss: Math.min(1, pal.gloss * 3.5),
    night: lava || settings.kind === KIND_VOLCANIC && !dry ? 1 : settings.look === 8 ? 2 : 0,
  }
}

