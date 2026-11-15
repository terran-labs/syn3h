/**
 * Headless test world for the pilots: real Rapier, a terrain whose `heightAt` is exactly the
 * collider surface (a triangle mesh sampled from a height function, interpolated the same way),
 * and a stepper that runs vehicle, pilot and physics in the game's order.
 */
import * as THREE from 'three/webgpu'
import type { Game } from '../../../src/core/Game'
import { emptyInput } from '../../../src/core/Input'
import { createWorld, FIXED_DT, GROUP_ALL, GROUP_TERRAIN, groups, RAPIER } from '../../../src/core/physics'
import type { Vehicle } from '../../../src/vehicles/Vehicle'
import type { Terrain } from '../../../src/world/Terrain'
import type { DriveGoal, Pilot, PilotStatus } from '../../../src/bots/pilot/types'

export type HeightFn = (x: number, z: number) => number

export interface TestWorld {
  world: RAPIER.World
  game: Game
  terrain: Terrain
  /** One fixed step: pilot writes input, vehicle applies forces, physics steps. */
  step(vehicle: Vehicle, pilot: Pilot, goal: DriveGoal): PilotStatus
  free(): void
}

/**
 * `size` metres square centred on the origin, sampled every `cell` metres. Each cell is split
 * along the same diagonal in the mesh and in `heightAt`, so the two agree to rounding.
 */
export function testWorld(height: HeightFn = () => 0, size = 800, cell = 2, liquid?: HeightFn): TestWorld {
  const world = createWorld(9.81)
  const n = Math.round(size / cell), half = size / 2, row = n + 1
  const grid = new Float32Array(row * row)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) grid[j * row + i] = height(-half + i * cell, -half + j * cell)
  const vertices = new Float32Array(row * row * 3), indices = new Uint32Array(n * n * 6)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = (j * row + i) * 3
    vertices[k] = -half + i * cell; vertices[k + 1] = grid[j * row + i]; vertices[k + 2] = -half + j * cell
  }
  let t = 0
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1
    // Triangles (a, c, b) and (b, c, d): the diagonal runs from b (i+1, j) to c (i, j+1).
    indices.set([a, c, b, b, c, d], t); t += 6
  }
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)))
  const heightAt = (x: number, z: number) => {
    const fx = THREE.MathUtils.clamp((x + half) / cell, 0, n - 1e-6), fz = THREE.MathUtils.clamp((z + half) / cell, 0, n - 1e-6)
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j
    const h00 = grid[j * row + i], h10 = grid[j * row + i + 1], h01 = grid[(j + 1) * row + i], h11 = grid[(j + 1) * row + i + 1]
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v)
  }
  const terrain: Terrain = {
    size, heightAt,
    normalAt: (x, z, out) => out.set(heightAt(x - .5, z) - heightAt(x + .5, z), 1, heightAt(x, z - .5) - heightAt(x, z + .5)).normalize(),
    spawnPoint: () => ({ position: new THREE.Vector3(0, 2, 0), heading: 0 }),
    dispose() {},
  }
  if (liquid) terrain.liquidHeightAt = liquid
  const game = { world, scene: new THREE.Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  // Rapier adds newly created fixed colliders to the broad phase on the first step.
  world.step()
  return {
    world, game, terrain,
    step(vehicle, pilot, goal) {
      const status = pilot.drive(goal, vehicle.input, FIXED_DT)
      vehicle.fixedUpdate(FIXED_DT); world.step(); vehicle.postPhysics(FIXED_DT)
      return status
    },
    free() { world.free() },
  }
}

/** A ridge across the x axis at z = `at`: `peak` metres high, a smooth bump `width` wide. */
export const ridge = (at: number, peak: number, width: number): HeightFn =>
  (_x, z) => peak * Math.exp(-(((z - at) / width) ** 2))

export const surfaceOf = (terrain: Terrain, x: number, z: number) =>
  Math.max(terrain.heightAt(x, z), terrain.liquidHeightAt?.(x, z) ?? -Infinity)
