/**
 * Seam: vehicle construction. Networking calls this for remote players too, so a vehicle
 * must not assume it is the local player's.
 * Owner: vehicle work.
 */
import type * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { ClassicBuggy } from './ClassicBuggy'
import { Hovercraft } from './Hovercraft'
import { Jet } from './Jet'
import { Tank } from './Tank'
import { ClassicBuggySkin, Syn3hBuggySkin } from './skins'
import { Syn3hBuggy } from './Syn3hBuggy'
import type { Vehicle } from './Vehicle'

/**
 * 'buggy' and 'buggy-syn3h' are the Syn3h buggy, the default. 'buggy-classic' is the Mars
 * Explorer buggy with its own physics and model.
 */
export type VehicleKind = 'buggy' | 'buggy-classic' | 'buggy-syn3h' | 'jet' | 'hovercraft' | 'tank'

/**
 * Every vehicle `createVehicle` builds, with a display name, for tools that list them (the
 * vehicle lab shows each one automatically). 'buggy-syn3h' is an alias of 'buggy' and is left
 * out. Add a new kind here and to the switch below.
 */
export const VEHICLE_KINDS: readonly { kind: VehicleKind; name: string }[] = [
  { kind: 'buggy', name: 'Syn3h buggy' },
  { kind: 'buggy-classic', name: 'Mars Explorer buggy' },
  { kind: 'jet', name: 'Jet' },
  { kind: 'hovercraft', name: 'Hovercraft' },
  { kind: 'tank', name: 'Tank' },
]

/** Models load over HTTP, so only in a browser. Headless tests keep the primitive visuals. */
const hasDom = typeof document !== 'undefined'

export function createVehicle(
  game: Game,
  terrain: Terrain,
  kind: VehicleKind,
  position: THREE.Vector3,
  heading = 0,
): Vehicle {
  switch (kind) {
    case 'buggy-classic':
      return new ClassicBuggy(game, terrain, position, heading, hasDom ? () => new ClassicBuggySkin() : undefined)
    case 'jet':
      return new Jet(game, terrain, position, heading)
    // The Mars Explorer tank. Syn3h had none, so it is reachable by ?vehicle=tank only.
    case 'tank':
      return new Tank(game, terrain, position, heading)
    case 'hovercraft':
      return new Hovercraft(game, terrain, position, heading)
    case 'buggy':
    case 'buggy-syn3h':
    default:
      return new Syn3hBuggy(game, terrain, position, heading, kind === 'buggy-syn3h' ? kind : 'buggy',
        hasDom ? () => new Syn3hBuggySkin() : undefined)
  }
}
