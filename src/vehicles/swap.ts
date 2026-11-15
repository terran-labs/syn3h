/**
 * Change the player's vehicle in place: same spot, same heading, same speed, no reload.
 *
 * This is an instant swap. The synchronized materialize and dissolve phases are a later
 * layer on top of it and are not implemented.
 *
 * What carries over, and why:
 *  - Position (x, z) and heading. The new vehicle is set level: a swap from a rolled or
 *    overturned vehicle should not hand the player a new one on its roof.
 *  - Height, raised by SWAP_LIFT and never below the ground or the liquid surface plus that
 *    lift. Vehicles sit at different heights above their wheels, tracks or hover cushion, so
 *    the new hull is given room and settles, instead of starting inside the terrain.
 *  - Linear velocity. Angular velocity is dropped: it belonged to a body with a different
 *    shape and inertia.
 *  - Identity: id, name, colours, spawn slot, ownership and the wind acting on it.
 *  - Control state, so a held throttle or an open zorb ball continues.
 *
 * Order matters. The old vehicle's effects are detached before it is disposed (the effects
 * contract), listeners on the slot run while the old vehicle is still intact so they can
 * unhook from it, and the old body leaves the world before the next physics step, so the two
 * overlapping bodies never meet in the solver.
 */
import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { attachVehicleEffects } from './effects'
import { canonicalVehicleKind, createVehicle, type VehicleKind } from './index'
import type { PlayerSlot } from './PlayerSlot'
import type { Vehicle } from './Vehicle'

/** Metres the new vehicle starts above the old one's origin, and at least above the surface. */
export const SWAP_LIFT = 0.5

const position = new THREE.Vector3()
const forward = new THREE.Vector3()
const rotation = new THREE.Quaternion()

export interface VehicleSwapper {
  /**
   * Put the player in a `kind` vehicle where they are now. Returns the vehicle now being
   * driven: a new one, or the current one untouched when it is already that kind.
   */
  swap(kind: VehicleKind): Vehicle
  /** Detach the current vehicle's effects. The vehicle itself stays with whoever added it. */
  dispose(): void
}

/**
 * `attach` gives a vehicle its effects and returns the disposer; the default is the game's
 * own, with the real headlight a local vehicle gets. The swapper attaches them to the slot's
 * current vehicle straight away, so do not attach effects to the player elsewhere.
 */
export function createVehicleSwapper(
  game: Game,
  terrain: Terrain,
  slot: PlayerSlot,
  attach: (vehicle: Vehicle) => () => void = (vehicle) => attachVehicleEffects(game, terrain, vehicle, { local: true }),
): VehicleSwapper {
  let detach = attach(slot.current)
  return {
    swap(kind) {
      const previous = slot.current
      // Aliases and retired names all build the buggy: asking for one while driving it is no change.
      if (canonicalVehicleKind(kind) === canonicalVehicleKind(previous.kind)) return previous
      const body = previous.body
      const t = body.translation(), r = body.rotation(), v = body.linvel()
      // Heading from the nose projected on the ground; from the roof when the nose points
      // straight up or down. The same rule as Vehicle.uprightRescue.
      rotation.set(r.x, r.y, r.z, r.w)
      forward.set(0, 0, -1).applyQuaternion(rotation)
      if (forward.x * forward.x + forward.z * forward.z < 0.01) forward.set(0, 1, 0).applyQuaternion(rotation).negate()
      const heading = Math.atan2(-forward.x, -forward.z)
      const surface = Math.max(terrain.heightAt(t.x, t.z), terrain.liquidHeightAt?.(t.x, t.z) ?? -Infinity)
      position.set(t.x, Math.max(t.y, surface) + SWAP_LIFT, t.z)

      detach()
      const next = createVehicle(game, terrain, kind, position, heading)
      next.isLocal = previous.isLocal
      next.id = previous.id
      next.name = previous.name
      next.spawnSlot = previous.spawnSlot
      next.setColors(previous.colors.body, previous.colors.accent)
      next.wind.copy(previous.wind)
      Object.assign(next.input, previous.input)
      next.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true)
      game.add(next)
      detach = attach(next)
      try {
        slot.set(next)
      } finally {
        // Even if a listener failed: a disposed vehicle left in the game would be stepped.
        game.remove(previous)
      }
      return next
    },
    dispose() {
      detach()
      detach = () => {}
    },
  }
}
