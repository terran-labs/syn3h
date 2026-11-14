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

/** 'buggy' is an alias for the classic Mars Explorer buggy. */
export type VehicleKind = 'buggy' | 'buggy-classic' | 'buggy-syn3h'

export function createVehicle(
  game: Game,
  terrain: Terrain,
  kind: VehicleKind,
  position: THREE.Vector3,
  heading = 0,
): Vehicle {
  // Both buggies share the original physics; the kind only selects the skin (wired next).
  switch (kind) {
    case 'buggy':
    case 'buggy-classic':
    case 'buggy-syn3h':
      return new Buggy(game, terrain, position, heading)
  }
}
