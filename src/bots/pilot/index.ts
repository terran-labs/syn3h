import type { Vehicle } from '../../vehicles/Vehicle'
import type { Terrain } from '../../world/Terrain'
import { createGroundPilot } from './ground'
import type { Pilot } from './types'

export * from './types'

/**
 * The pilot for a vehicle, or null when nothing can drive that kind yet. Callers must treat
 * null as "leave this vehicle alone", never as a reason to fall back to the wrong controls.
 */
export function createPilot(vehicle: Vehicle, _terrain: Terrain): Pilot | null {
  switch (vehicle.kind) {
    // The jet and hovercraft pilots land with the flight work; until then they stay manual.
    case 'jet':
    case 'hovercraft':
      return null
    default:
      return createGroundPilot(vehicle)
  }
}
