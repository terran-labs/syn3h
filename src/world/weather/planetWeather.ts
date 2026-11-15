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
import './params'

function haze(density: number, height: number, tint: [number, number, number], amount: number): Record<string, ParamValue> {
  return {
    'weather.hazeDensity': density, 'weather.hazeHeight': height,
    'weather.hazeTintR': tint[0], 'weather.hazeTintG': tint[1], 'weather.hazeTintB': tint[2],
    'weather.hazeTintAmount': amount,
  }
}

export const PLANET_WEATHER: Record<string, Record<string, ParamValue>> = {
  /** Ash haze: grey brown, over the plains, with the cone standing out of it. */
  volcanic: haze(0.0024, 40, [0.72, 0.62, 0.56], 0.35),
  /** Warm dust, low and thick over the dunes. */
  desert: haze(0.0022, 35, [1, 0.8, 0.55], 0.45),
  /** Cool valley mist that the peak rises out of. */
  alpine: haze(0.003, 30, [0.84, 0.9, 1], 0.3),
  /** Sea mist hugging the water between the islands. */
  archipelago: haze(0.0024, 26, [0.8, 0.9, 0.95], 0.25),
  /** Thin, bright ice crystal haze. */
  ice: haze(0.0012, 45, [0.8, 0.9, 1], 0.4),
  /** Dark smoke over black glass. */
  obsidian: haze(0.002, 45, [0.45, 0.4, 0.52], 0.4),
  /** Ochre dust. */
  badlands: haze(0.002, 45, [1, 0.7, 0.45], 0.45),
  /** Thick green methane murk, low over the water. */
  swamp: haze(0.0016, 30, [0.7, 0.9, 0.5], 0.5),
  /** No air: no haze. */
  moon: haze(0, 70, [1, 1, 1], 0),
}

/** The weather values for a recipe id; an unknown planet gets the sliders' defaults. */
export function planetWeather(id: string): Record<string, ParamValue> {
  return PLANET_WEATHER[id] ?? {}
}
