/**
 * Weather: wind as a real force, its numbers for the wind sound, and (later) fog.
 *
 * Wiring, for main.ts:
 *   setWeatherClock(() => connection.clock.now())
 *   game.add(new WeatherSystem(() => terrain, () => [player, ...bots.vehicles]))
 *   applyWeatherQuery(location.search)   // optional: ?weather=0.5 sets storminess
 */
import { params } from '../../../shared/params'
import { storminess } from './params'

export * from './params'
export * from './wind'
export * from './drag'
export * from './clouds'
export { WeatherSystem, type WindVehicle } from './WeatherSystem'

/** `?weather=<0..1>` sets the storminess locally (the room then shares it), for trying it out. */
export function applyWeatherQuery(search: string): void {
  const raw = new URLSearchParams(search).get('weather')
  if (raw === null) return
  const n = raw === '' ? 0.5 : Number(raw)
  if (Number.isFinite(n)) params.set(storminess.def.id, n)
}
