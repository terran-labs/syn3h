/**
 * Seam: vehicle construction. Networking calls this for remote players too, so a vehicle
 * must not assume it is the local player's.
 * Owner: vehicle work. Replace the placeholder with the buggy.
 */
import type * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { PlaceholderVehicle, type Vehicle } from './Vehicle'

export type VehicleKind = 'buggy'

export function createVehicle(
  game: Game,
  terrain: Terrain,
  _kind: VehicleKind,
  position: THREE.Vector3,
  heading = 0,
): Vehicle {
  return new PlaceholderVehicle(game, terrain, position, heading)
}
