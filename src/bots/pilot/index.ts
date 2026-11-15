import type { Vehicle } from '../../vehicles/Vehicle'
import type { Terrain } from '../../world/Terrain'
import { createGroundPilot } from './ground'
import { createHovercraftPilot } from './hovercraft'
import { createJetPilot } from './jet'
import type { Pilot } from './types'

export * from './types'

/**
 * The pilot for a vehicle, or null when nothing can drive that kind yet. Callers must treat
 * null as "leave this vehicle alone", never as a reason to fall back to the wrong controls.
 */
export function createPilot(vehicle: Vehicle, terrain: Terrain): Pilot | null {
  switch (vehicle.kind) {
    case 'jet': return createJetPilot(vehicle, terrain)
    case 'hovercraft': return createHovercraftPilot(vehicle, terrain)
    default: return createGroundPilot(vehicle)
  }
}
