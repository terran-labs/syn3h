/** Study selection belongs to lab entries, never to the game entry. */
import { previewTankBody as wear } from '../Tank'
import { round8 } from './round8'
import { round9 } from './round9'
import { round10 } from './round10'

export const TANK_BODIES = [...round10, ...round9, ...round8]
/** Wear a study body by id; no id (or an unknown one) wears the shipped Sherpa. */
export function previewTankBody(id?: string | null): void {
  wear((id && TANK_BODIES.find(d => d.id === id)) || undefined)
}
