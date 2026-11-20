/**
 * Seam: vehicle construction. Networking calls this for remote players too, so a vehicle
 * must not assume it is the local player's.
 * Owner: vehicle work.
 */
import type * as THREE from 'three/webgpu'
import { longFrames } from '../core/longFrames'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { Hovercraft } from './Hovercraft'
import { Jet } from './Jet'
import { Tank } from './Tank'
import { isVehicleAvailable } from './available'
export { TANK_AVAILABLE, isVehicleAvailable } from './available'
import { Syn3hBuggySkin } from './skins'
import { Syn3hBuggy } from './Syn3hBuggy'
import type { Vehicle } from './Vehicle'

/**
 * 'buggy' and 'buggy-syn3h' are the Syn3h buggy, the default. 'buggy-classic' was the Mars
 * Explorer buggy with its own physics and model.
 */
export type VehicleKind = 'buggy' | 'buggy-classic' | 'buggy-syn3h' | 'jet' | 'hovercraft' | 'tank'

/**
 * Every vehicle `createVehicle` builds, with a display name, for tools that list them (the
 * vehicle lab shows each one automatically). 'buggy-syn3h' is an alias of 'buggy' and is left
 * out, and so is a hidden kind (./available.ts). Add a new kind here and to the switch below.
 */
export const VEHICLE_KINDS: readonly { kind: VehicleKind; name: string }[] = [
  { kind: 'buggy', name: 'Buggy' },
  { kind: 'jet', name: 'Jet' },
  { kind: 'hovercraft', name: 'Hovercraft' },
  { kind: 'tank', name: 'Tank' },
].filter(vehicle => isVehicleAvailable(vehicle.kind)) as readonly { kind: VehicleKind; name: string }[]

/** Models load over HTTP, so only in a browser. Headless tests keep the primitive visuals. */
const hasDom = typeof document !== 'undefined'

/**
 * The kind `createVehicle` really builds for a requested kind. The Mars Explorer buggy was
 * retired on 15 November 2026, but its name is still out there: in saved lobby choices, shared
 * links (?vehicle=buggy-classic), resume snapshots, and the hello of an older client in the
 * same room. Each of those gets the Syn3h buggy. So does any kind this build does not know,
 * so a newer client's vehicle is never drawn as nothing.
 */
export function canonicalVehicleKind(kind: string | null | undefined): VehicleKind {
  // A hidden kind (src/vehicles/available.ts) is drawn as the buggy.
  return kind === 'jet' || kind === 'hovercraft' || (kind === 'tank' && isVehicleAvailable(kind)) ? kind : 'buggy'
}

export function createVehicle(
  game: Game,
  terrain: Terrain,
  kind: VehicleKind,
  position: THREE.Vector3,
  heading = 0,
): Vehicle {
  const spanStart = longFrames.start()
  try {
    longFrames.event('vehicle.create')
    switch (kind) {
      case 'jet':
        return new Jet(game, terrain, position, heading)
      // The Mars Explorer tank, while it is offered (src/vehicles/available.ts); a hidden tank
      // is built as the buggy below, whoever asked for it.
      case 'tank':
        if (isVehicleAvailable(kind)) return new Tank(game, terrain, position, heading)
        return new Syn3hBuggy(game, terrain, position, heading, 'buggy', hasDom ? () => new Syn3hBuggySkin() : undefined)
      case 'hovercraft':
        return new Hovercraft(game, terrain, position, heading)
      // 'buggy-classic' and anything unknown land here too: see `canonicalVehicleKind`.
      case 'buggy':
      case 'buggy-syn3h':
      default:
        return new Syn3hBuggy(game, terrain, position, heading, kind === 'buggy-syn3h' ? kind : 'buggy',
          hasDom ? () => new Syn3hBuggySkin() : undefined)
    }
  } finally {
    longFrames.end('vehicle.create', spanStart)
  }
}
