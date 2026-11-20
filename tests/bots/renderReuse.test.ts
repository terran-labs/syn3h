import { beforeAll, expect, it, vi } from 'vitest'
import { Mesh, Object3D, Scene, Vector3, type Material } from 'three/webgpu'
import { BotRenderWarm } from '../../src/bots/BotRenderWarm'
import type { Game } from '../../src/core/Game'
import { createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import type { Terrain } from '../../src/world/Terrain'

beforeAll(initPhysics)

function firstMaterial(vehicle: Vehicle): Material | Material[] {
  let mesh: Mesh | undefined
  vehicle.object.traverse(node => { if (!mesh && node instanceof Mesh) mesh = node })
  if (!mesh) throw new Error('Expected a real hovercraft render mesh')
  return mesh.material
}

it('retains the render graph for a clean actor lifetime without lending live or fading vehicles', () => {
  const world = createWorld(9.81)
  const scene = new Scene()
  const clock = { frames: 1, world, scene, precompile() {} }
  const terrain: Terrain = {
    size: 200, heightAt: () => 0, normalAt: (_x, _z, out) => out.set(0, 1, 0),
    spawnPoint: () => ({ position: new Vector3(0, 2, 0), heading: 0 }), dispose() {},
  }
  const pool = new BotRenderWarm(clock as unknown as Game, terrain)
  const active = new Set<Vehicle>()
  const acquire = (at: Vector3) => {
    const vehicle = pool.acquire('hovercraft', at, 0)
    active.add(vehicle)
    return vehicle
  }
  const release = (vehicle: Vehicle) => {
    expect(pool.release(vehicle)).toBe(true)
    active.delete(vehicle)
  }
  try {
    const first = acquire(new Vector3(0, 2, 0))
    const graph = firstMaterial(first)
    const second = acquire(new Vector3(10, 2, 0))
    expect(second).not.toBe(first)
    expect(second.input).not.toBe(first.input)
    expect(second.object).not.toBe(first.object)
    expect(second.body).not.toBe(first.body)

    first.id = 'bot-old'
    first.name = 'Old actor'
    first.input.brakes = true
    first.wind.set(1, 2, 3)
    first.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false)
    first.body.setLinvel({ x: 10, y: 0, z: 0 }, false)
    const ghost = new Object3D()
    ghost.userData.arrivalGhost = true
    first.object.add(ghost)
    release(first)
    expect(first.object.parent).toBeNull()
    expect(first.body.isEnabled()).toBe(false)
    expect(pool.release(first)).toBe(false)

    clock.frames += 2
    const overlapping = acquire(new Vector3(20, 2, 0))
    expect(overlapping).not.toBe(first)
    ghost.removeFromParent()

    const reused = acquire(new Vector3(30, 2, 0))
    expect(reused).toBe(first)
    expect(firstMaterial(reused)).toBe(graph)
    expect(reused.body.isEnabled()).toBe(true)
    expect(reused.body.bodyType()).toBe(RAPIER.RigidBodyType.Dynamic)
    expect(reused.body.linvel()).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(reused.body.translation()).toMatchObject({ x: 30, y: 2, z: 0 })
    expect(reused.wind.lengthSq()).toBe(0)
    expect(reused.input.brakes).toBe(false)
    expect(reused.id).toBe('')
    expect(reused.name).toBe('')

    const dispose = vi.spyOn(reused, 'dispose')
    release(reused)
    pool.dispose()
    pool.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(second.body.isValid()).toBe(true)
    expect(overlapping.body.isValid()).toBe(true)
  } finally {
    pool.dispose()
    for (const vehicle of active) vehicle.dispose()
    world.free()
  }
})
