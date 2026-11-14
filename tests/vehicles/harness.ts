/**
 * Headless vehicle test bed: a Rapier world, a flat ground slab, and just enough of `Game`
 * for a vehicle to run. No renderer. Steps exactly like Game.frame does.
 */
import * as THREE from 'three/webgpu'
import { emptyInput } from '../../src/core/Input'
import type { Game } from '../../src/core/Game'
import { FIXED_DT, GROUP_ALL, GROUP_TERRAIN, RAPIER, createWorld, groups, initPhysics } from '../../src/core/physics'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import type { Terrain } from '../../src/world/Terrain'

export interface Bed {
  game: Game
  terrain: Terrain
  /** Run `seconds` of fixed steps through every added vehicle. */
  run(seconds: number, each?: () => void): void
  add<T extends Vehicle>(v: T): T
}

export async function makeBed(): Promise<Bed> {
  await initPhysics()
  const world = createWorld(9.81)
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20000, 1, 20000)
      .setTranslation(0, -1, 0)
      .setFriction(1)
      .setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)),
  )
  const game = { world, scene: new THREE.Scene(), input: { state: emptyInput() } } as unknown as Game
  const terrain: Terrain = {
    size: 40000,
    heightAt: () => 0,
    normalAt: (_x, _z, out) => out.set(0, 1, 0),
    spawnPoint: () => ({ position: new THREE.Vector3(0, 1, 0), heading: 0 }),
    dispose() {},
  }
  const vehicles: Vehicle[] = []
  return {
    game,
    terrain,
    add(v) {
      vehicles.push(v)
      return v
    },
    run(seconds, each) {
      const steps = Math.round(seconds / FIXED_DT)
      for (let i = 0; i < steps; i++) {
        for (const v of vehicles) v.fixedUpdate(FIXED_DT)
        world.step()
        for (const v of vehicles) v.postPhysics(FIXED_DT)
        each?.()
      }
    },
  }
}
