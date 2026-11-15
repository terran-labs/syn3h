import type { VehicleKind } from '../vehicles'

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
export const PLAY_VEHICLES: readonly { id: VehicleKind; label: string }[] = [
  { id: 'buggy-syn3h', label: 'Buggy' }, { id: 'jet', label: 'Jet' }, { id: 'hovercraft', label: 'Hovercraft' }, { id: 'tank', label: 'Tank' },
]
const defaults: VehicleChoice = { vehicleKind: 'buggy-syn3h', bodyColor: '#1768b4', accentColor: '#49e6ff' }
export function sanitizeVehicleChoice(value: Partial<VehicleChoice> | null): VehicleChoice {
  const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
  // Four vehicles, one design each. Older saved values for the retired buggies land in the Buggy.
  const kind = PLAY_VEHICLES.some(vehicle => vehicle.id === value?.vehicleKind) ? value!.vehicleKind! : 'buggy-syn3h'
  return { vehicleKind: kind, bodyColor: color(value?.bodyColor, defaults.bodyColor), accentColor: color(value?.accentColor, defaults.accentColor) }
}
export function readVehicleChoice(): VehicleChoice {
  try { return sanitizeVehicleChoice(JSON.parse(localStorage.getItem('syn3h.vehicle') || 'null')) } catch { return { ...defaults } }
}
export function saveVehicleChoice(choice: VehicleChoice): void {
  try { localStorage.setItem('syn3h.vehicle', JSON.stringify(choice)) } catch { /* Storage is optional. */ }
}
