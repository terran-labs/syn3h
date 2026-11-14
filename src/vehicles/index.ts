/**
 * Seam: vehicle construction. Networking calls this for remote players too, so a vehicle
 * must not assume it is the local player's.
 * Owner: vehicle work.
 */
import type * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { Buggy } from './Buggy'
import type { Vehicle } from './Vehicle'

export type VehicleKind = 'buggy'

export function createVehicle(
  game: Game,
  terrain: Terrain,
  kind: VehicleKind,
  position: THREE.Vector3,
  heading = 0,
): Vehicle {
  switch (kind) {
    case 'buggy':
      return new Buggy(game, terrain, position, heading)
  }
}
