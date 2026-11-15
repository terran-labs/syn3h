/**
 * The inspector's own settings, and the looks of the display shown while the cursor is
 * captured. Personal, never sent to the room. They appear in the inspector under You.
 */
import { defineParam } from '../../../shared/params'

export const focusStyle = defineParam<number>({ id: 'hud.focusStyle', label: 'Focus display: 0 Arc, 1 Horizon, 2 Telemetry', group: 'Interface', scope: 'client', default: 0, min: 0, max: 2, step: 1 })
export const reticleStyle = defineParam<number>({ id: 'hud.reticle', label: 'Reticle: 0 Dot, 1 Ring, 2 Bracket', group: 'Interface', scope: 'client', default: 1, min: 0, max: 2, step: 1 })
export const glassStyle = defineParam<number>({ id: 'hud.glass', label: 'Glass: 0 Clear, 1 Frosted, 2 Deep', group: 'Interface', scope: 'client', default: 1, min: 0, max: 2, step: 1 })
