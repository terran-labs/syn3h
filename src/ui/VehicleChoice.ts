import type { VehicleKind } from '../vehicles'
import { isVehicleAvailable } from '../vehicles/available'

export interface VehicleChoice {
  vehicleKind: VehicleKind
  bodyColor: string
  accentColor: string
}
/**
 * The vehicles a player can choose, in play only: the lobby offers planets, not vehicles
 * (owner's ruling, 15 November 2026). A new player lands in the Buggy; a returning player
 * lands in the one they last chose.
 */
export const PLAY_VEHICLES: readonly { id: VehicleKind; label: string; glyph: string }[] = [
  // Side views in a 24 by 14 box, one path each, filled with the text colour (no images).
  { id: 'buggy-syn3h', label: 'Buggy', glyph: 'M2 8.6 4.6 5.2h5.2l2-2.4h3.6l2.4 2.4H21l1.4 3.4-1.6.8a2.9 2.9 0 0 0-5.6 0H9.4a2.9 2.9 0 0 0-5.6 0ZM6.6 8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Zm11.4 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z' },
  { id: 'jet', label: 'Jet', glyph: 'M1.5 7.4 4 6.6h5.4L13.6 2h2.2l-2 4.6h4.4l2.6-2.8h1.6l-1 3.4 1.4.4v.8l-1.4.4 1 3.4h-1.6l-2.6-2.8h-4.4l2 4.6h-2.2L9.4 9.4H4l-2.5-.8Z' },
  { id: 'hovercraft', label: 'Hovercraft', glyph: 'M5.2 6.4C6.6 3.8 9 2.6 12 2.6s5.4 1.2 6.8 3.8l.6 1.2H4.6ZM2.4 8.6h19.2c.8 0 1.2.8.8 1.5L21.2 12H2.8l-1.2-1.9c-.4-.7 0-1.5.8-1.5Z' },
  { id: 'tank', label: 'Tank', glyph: 'M6 3.4h8l1.6 2.2H21v1.2h-5.4l.4 1H20l2 2-2 2.4H4l-2-2.4 2-2h2Z' },
].filter(vehicle => isVehicleAvailable(vehicle.id)) as readonly { id: VehicleKind; label: string; glyph: string }[]
const defaults: VehicleChoice = { vehicleKind: 'buggy-syn3h', bodyColor: '#1768b4', accentColor: '#49e6ff' }
export function sanitizeVehicleChoice(value: Partial<VehicleChoice> | null): VehicleChoice {
  const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
  // One design each. Older saved values for the retired buggies, and a saved choice of a
  // vehicle now hidden (the tank), land in the Buggy.
  const kind = PLAY_VEHICLES.some(vehicle => vehicle.id === value?.vehicleKind) ? value!.vehicleKind! : 'buggy-syn3h'
  return { vehicleKind: kind, bodyColor: color(value?.bodyColor, defaults.bodyColor), accentColor: color(value?.accentColor, defaults.accentColor) }
}
export function readVehicleChoice(): VehicleChoice {
  try { return sanitizeVehicleChoice(JSON.parse(localStorage.getItem('syn3h.vehicle') || 'null')) } catch { return { ...defaults } }
}
export function saveVehicleChoice(choice: VehicleChoice): void {
  try { localStorage.setItem('syn3h.vehicle', JSON.stringify(choice)) } catch { /* Storage is optional. */ }
}
