import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { beamAimDirection } from '../../src/weapons/aim'

beforeAll(initPhysics)
afterEach(() => vi.unstubAllGlobals())

describe('player tag beam aim', () => {
  it('keeps vehicle aim when the cursor is free or captured by another element', () => {
    const canvas = {}
    const game = { canvas } as unknown as Game
    for (const pointerLockElement of [null, {}]) {
      vi.stubGlobal('document', { pointerLockElement })
      expect(beamAimDirection(game, {} as RAPIER.RigidBody)).toBeUndefined()
    }
  })

  it('aims from the muzzle at the camera target, excluding the launching body', () => {
    const world = createWorld(0)
    try {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
      world.createCollider(RAPIER.ColliderDesc.ball(2), body)
      world.createCollider(RAPIER.ColliderDesc.ball(2).setTranslation(15, 4, -40))
      world.step()
      const camera = new THREE.PerspectiveCamera()
      camera.position.set(0, 4, 10)
      camera.lookAt(15, 4, -40)
      camera.updateMatrixWorld()
      const canvas = {}
      vi.stubGlobal('document', { pointerLockElement: canvas })
      const game = { canvas, camera, world } as unknown as Game
      const direction = beamAimDirection(game, body)!
      expect(Math.hypot(...direction)).toBeCloseTo(1)
      expect(direction[0]).toBeGreaterThan(0.3)
      const muzzle = new THREE.Vector3(0, 0.4, -2.4)
      const ray = new THREE.Ray(muzzle, new THREE.Vector3(...direction))
      expect(ray.distanceToPoint(new THREE.Vector3(15, 4, -40))).toBeLessThan(2)
    } finally {
      world.free()
    }
  })
})
