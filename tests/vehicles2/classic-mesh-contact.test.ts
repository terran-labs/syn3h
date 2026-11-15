import { beforeAll, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics, RAPIER, GROUP_TERRAIN, GROUP_ALL, groups } from '../../src/core/physics'
import { ClassicBuggy } from '../../src/vehicles/ClassicBuggy'
import { harness } from './harness'

beforeAll(initPhysics)

function onMesh(reverseOrder = false) {
  const h = harness(9.81, false)
  h.terrain.heightAt = () => 50
  const mesh = () => h.world.createCollider(RAPIER.ColliderDesc.trimesh(
    new Float32Array([-200, 50, -200, 200, 50, -200, -200, 50, 200, 200, 50, 200]),
    new Uint32Array([0, 2, 1, 1, 2, 3]),
  ).setFriction(1).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)))
  if (!reverseOrder) mesh()
  const v = new ClassicBuggy(h.game, h.terrain, new THREE.Vector3(0, 51.5, 0))
  v.isLocal = false // Exercise contacts without the local player's recovery assist.
  if (reverseOrder) mesh()
  h.step(v, 150)
  return { h, v }
}

it.each([false, true])('clears an inverted flag on mesh ground regardless of collider creation order (%s)', reverse => {
  const { h, v } = onMesh(reverse)
  try {
    // The classic suspension does not consult isInverted. Put its chassis on the
    // mesh so this specifically exercises OnCollisionStay, rather than a wheel ray.
    v.isInverted = true
    v.body.setTranslation({ x: 0, y: 50.19, z: 0 }, true)
    v.body.setLinvel({ x: 0, y: -1, z: 0 }, true)
    h.step(v, 100)
    expect(v.isInverted).toBe(false)
    expect(v.body.translation().y).toBeGreaterThan(50.4)
    const z = v.body.translation().z
    v.input.y = 1
    h.step(v, 150)
    expect(v.body.translation().z).toBeLessThan(z - 10)
  } finally {
    v.dispose()
    h.world.free()
  }
})

it('detects its roof touching a terrain mesh and returns upright', () => {
  const { h, v } = onMesh()
  try {
    v.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * 0.9), true)
    v.body.setTranslation({ x: 0, y: 52, z: 0 }, true)
    let inverted = false
    for (let i = 0; i < 250; i++) {
      h.step(v)
      inverted ||= v.isInverted
    }
    expect(inverted).toBe(true)
    const q = v.body.rotation()
    expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.9)
    // Its suspension can catch it before the upright chassis touches again. The
    // legacy flag clears on chassis contact, which the preceding test verifies.
  } finally {
    v.dispose()
    h.world.free()
  }
})
