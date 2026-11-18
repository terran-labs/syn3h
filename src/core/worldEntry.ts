/**
 * Which world the player is in, to tell entering a different world from the same world
 * rebuilt in place. The owner, on v26.11.1711: "I'm also activating Zorb on one planet,
 * switching to a different planet, and it's still activated when I drop in there. You need
 * to reset full vehicle state."
 *
 * The terrain rebuilds for both. Entering a world (a planet picked in the galaxy, or the room
 * moving everyone to another planet) gives the player a fresh vehicle. A rebuild of the same
 * world (a host dragging sea level or planet size, a seed nudged, a quality change, the
 * terrain worker finishing) only re-seats the vehicle on the new ground, keeping its modes:
 * the player has not gone anywhere.
 *
 * A world is its planet (the look recipe) and its name. The name comes from `world.nameSeed`,
 * which every newly rolled or galaxy world carries; a world with name seed 0 is named by its
 * terrain seed, so there a seed change is a new world.
 */
import { currentPlanet, currentWorldName } from '../world/planets'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Input } from './Input'

export const worldIdentity = (): string => `${currentPlanet().id}|${currentWorldName()}`

/**
 * Call on every terrain rebuild: true when the world is a different one from the last call's
 * (or the first call's own), false for the same world rebuilt.
 */
export function createWorldEntry(identity: () => string = worldIdentity): () => boolean {
  let last = identity()
  return () => {
    const now = identity()
    if (now === last) return false
    last = now
    return true
  }
}

/**
 * The player's vehicle as built, for a different world. Resets: every input including the
 * toggles (wings, jet flight mode, Zorb), the Zorb ball outright, lava heat and the stuck
 * timer, a jet's gear, an autopilot run, an arrival hold. Keeps: kind, colours, name and every
 * parameter (tyre size, units, interface). The caller teleports it to the spawn point next,
 * which clears motion and the controller's mechanisms; the network client drops gear and
 * rescue timers on the same rebuild (net/index.ts onTerrainRegenerated).
 */
export function freshVehicle(
  vehicle: Vehicle, input: Pick<Input, 'releaseAll'>,
  also: { daydream?: { noteActivity(): void }; materialize?: { cancel(vehicle: Vehicle): void } } = {},
): void {
  // An autopilot run ends first, handing back what it borrowed, so nothing restores a toggle after.
  also.daydream?.noteActivity()
  input.releaseAll()
  vehicle.resetForWorld()
  // An arrival still holding the vehicle (a switch a moment ago) would pin it to the old world.
  also.materialize?.cancel(vehicle)
}
