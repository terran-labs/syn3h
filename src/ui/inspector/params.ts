/**
 * The inspector's own settings, and the looks of the display shown while the cursor is
 * captured. Personal, never sent to the room. They appear in the inspector under You.
 */
import { defineParam } from '../../../shared/params'

export const focusStyle = defineParam<number>({ id: 'hud.focusStyle', label: 'Focus display: 0 Arc, 1 Horizon, 2 Telemetry', group: 'Interface', scope: 'client', default: 0, min: 0, max: 2, step: 1 })
export const reticleStyle = defineParam<number>({ id: 'hud.reticle', label: 'Reticle: 0 Dot, 1 Ring, 2 Bracket', group: 'Interface', scope: 'client', default: 1, min: 0, max: 2, step: 1 })
export { glassStyle } from '../../../shared/params'

/**
 * How much interface shows over the world while playing on a desktop. Full is the normal
 * free-cursor view with the panels. Driving is exactly the view shown while the cursor is
 * captured, with no panels. Hidden shows nothing but the world, for pictures. The key in
 * src/ui/interfaceMode.ts cycles them and Escape always returns to Full. Touch devices keep
 * their own tap toggle between the panels and the driving view, so this has no effect there.
 */
export const interfaceMode = defineParam<number>({ id: 'hud.mode', label: 'Interface: 0 Full, 1 Driving, 2 Hidden', group: 'Interface', scope: 'client', default: 0, min: 0, max: 2, step: 1 })

/**
 * The minimap's orientation. Off (the default): heading up, the map turns with the camera so
 * up is the way you look and the N travels round the rim. On: north up, a fixed map.
 */
export const mapNorthUp = defineParam({ id: 'hud.mapNorthUp', label: 'Minimap north up', group: 'Interface', scope: 'client', default: false })

export const diagnostics = defineParam({ id: 'hud.diagnostics', label: 'Connection diagnostics', group: 'Interface', scope: 'client', default: false })
