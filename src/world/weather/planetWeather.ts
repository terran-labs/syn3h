/**
 * Each planet's weather character: haze density at sea level, how high it reaches, and its
 * tint. Planet recipes spread these into their `values` (src/world/planets.ts), so they
 * travel as ordinary shared sliders. No renderer imports.
 *
 * Every world with air gets plainly visible height fog; an airless world gets none (and,
 * through world.atmosphere, no wind or wind sound either). Densities are chosen so the main
 * volcano stays visible from every spawn pad: tests/weather/fog.test.ts checks it on each
 * world that is generated on this branch.
 */
import type { ParamValue } from '../../../shared/params'
// Registers the sliders the values below set.
import './fog'
import './fogMap'
import './params'

function haze(density: number, height: number, tint: [number, number, number], amount: number): Record<string, ParamValue> {
  return {
    'weather.hazeDensity': density, 'weather.hazeHeight': height,
    'weather.hazeTintR': tint[0], 'weather.hazeTintG': tint[1], 'weather.hazeTintB': tint[2],
    'weather.hazeTintAmount': amount,
  }
}

/**
 * Fog banks (fogMap.ts): strength, bank height (m), coastal and valley weights, and the share
 * that stays all day. Conservative: the dawn coast and the valleys at night are the show.
 */
function banks(strength: number, height: number, coast: number, valley: number, allDay = 0): Record<string, ParamValue> {
  return { 'weather.fogBanks': strength, 'weather.fogBankHeight': height, 'weather.fogCoast': coast, 'weather.fogValley': valley, 'weather.fogAllDay': allDay }
}

export const PLANET_WEATHER: Record<string, Record<string, ParamValue>> = {
  /** Ash haze: grey brown, over the plains, with the cone standing out of it. */
  volcanic: { ...haze(0.0024, 40, [0.72, 0.62, 0.56], 0.35), ...banks(0.3, 25, 0.6, 0.6) },
  /** Warm dust, low and thick over the dunes. */
  desert: { ...haze(0.0022, 35, [1, 0.8, 0.55], 0.45), ...banks(0.15, 20, 1, 0.4) },
  /** Cool valley mist that the peak rises out of. */
  alpine: { ...haze(0.003, 30, [0.84, 0.9, 1], 0.3), ...banks(1, 25, 0.6, 0.9) },
  /** Sea mist hugging the water between the islands, rolling in at dawn. */
  archipelago: { ...haze(0.0024, 26, [0.8, 0.9, 0.95], 0.25), ...banks(1, 30, 1, 0.5) },
  /** Thin, bright ice crystal haze; sea smoke over the frozen sea. */
  ice: { ...haze(0.0012, 45, [0.8, 0.9, 1], 0.4), ...banks(0.8, 20, 1, 1) },
  /** Dark smoke over black glass. */
  obsidian: { ...haze(0.002, 45, [0.45, 0.4, 0.52], 0.4), ...banks(0.2, 25, 0.6, 0.8) },
  /** Ochre dust. */
  badlands: { ...haze(0.002, 45, [1, 0.7, 0.45], 0.45), ...banks(0.15, 20, 0.5, 0.8) },
  /** The Mire's warm green mist, thick and low over the water, there all day. */
  swamp: { ...haze(0.0016, 30, [0.7, 0.9, 0.5], 0.5), ...banks(0.8, 15, 1, 1, 0.25) },
  /** No air: no haze. */
  moon: { ...haze(0, 70, [1, 1, 1], 0), ...banks(0, 25, 0, 0) },
}

/** The weather values for a recipe id; an unknown planet gets the sliders' defaults. */
export function planetWeather(id: string): Record<string, ParamValue> {
  return PLANET_WEATHER[id] ?? {}
}
