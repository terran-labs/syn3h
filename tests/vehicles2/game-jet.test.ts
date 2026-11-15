import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { GameJet } from '../../src/vehicles/jetgen/GameJet'
import { Builder, GROUND_Y } from '../../src/vehicles/jetgen/shapes'
import { roleOf } from '../../src/vehicles/skins/showroom'

function visibleCost(root: THREE.Object3D) {
  let triangles = 0, draws = 0
  root.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh)) return
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3
    draws++
    for (const a of ['position', 'normal']) {
      expect(Array.from(o.geometry.attributes[a].array).every(Number.isFinite)).toBe(true)
    }
  })
  return { triangles, draws }
}

describe('approved Mk2 game model', () => {
  it('meets geometry and draw budgets with gear up, moving and down at every detail level', () => {
    const jet = new GameJet()
    for (const gear of [0, .25, .75, 1]) {
      jet.update(gear, .3, -.2, .8)
      for (const level of [0, 1, 2] as const) {
        jet.setLevel(level)
        const cost = visibleCost(jet.object)
        expect(cost.triangles).toBeLessThanOrEqual([12000, 2500, 500][level])
        expect(cost.draws).toBeLessThanOrEqual([10, 3, 1][level])
      }
    }
    for (const y of jet.near.footHeights()) expect(y).toBeCloseTo(GROUND_Y, 2)
    jet.dispose()
  })

  it('keeps the pilot clear, uses shared materials and preserves the far ring opening', () => {
    const jet = new GameJet()
    expect(jet.near.clearance).toBeGreaterThanOrEqual(.25)
    expect(jet.near.object.userData.cockpit).toBe(true)
    expect(roleOf(jet.near.materials.glass)).toBe('canopy')
    expect(roleOf(jet.near.materials.glow)).toBe('glow')
    jet.update(1, .2, -.2, 1)
    expect(jet.near.vector.toArray()).toEqual([.2, -.2])
    // Through the ring above the fuselage: silhouette must not fill the hole with a cap.
    jet.far.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, .65, 4), new THREE.Vector3(0, 0, -1), 0, 2)
    expect(ray.intersectObject(jet.far)).toHaveLength(0)
    jet.setColors('#123456', '#abcdef')
    expect((jet.far.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456')
    jet.dispose()
  })

  it('smooths aerodynamic normals without changing their outline', () => {
    const keys = [[1.5, -.02, .9, 1.5, .07], [2.4, .1, .36, 1.16, .062], [3.3, .2, -.18, .82, .055], [3.55, -.05, -.14, .74, .055]]
    const flat = new Builder(.6, true), smooth = new Builder(.6, true, true)
    flat.surf(keys); smooth.surf(keys)
    for (let i = 0; i < flat.pieces.length; i++) {
      const a = flat.pieces[i].geometry, b = smooth.pieces[i].geometry
      const expanded = b.toNonIndexed()
      expect(Array.from(expanded.attributes.position.array)).toEqual(Array.from(a.attributes.position.array))
      expect(Array.from(expanded.attributes.normal.array)).not.toEqual(Array.from(a.attributes.normal.array))
      expanded.dispose(); a.dispose(); b.dispose()
    }
  })
})

it('switches remote models with hysteresis and unregisters on disposal', () => {
  const owner = new THREE.Group(), callbacks = new Set<(distance: number, remote: boolean, level: number) => void>()
  owner.userData.registerVehicleDetail = (callback: (distance: number, remote: boolean, level: number) => void) => {
    callbacks.add(callback); return () => callbacks.delete(callback)
  }
  const jet = new GameJet(); owner.add(jet.object); jet.attach()
  const move = (distance: number, remote = true) => callbacks.forEach(f => f(distance, remote, 3))
  move(150); expect(jet.far.visible).toBe(true)
  move(118); expect(jet.far.visible).toBe(true)
  move(110); expect(jet.medium[0].object.visible).toBe(true)
  move(28); expect(jet.medium[0].object.visible).toBe(true)
  move(24); expect(jet.near.object.visible).toBe(true)
  move(500, false); expect(jet.near.object.visible).toBe(true)
  jet.dispose(); expect(callbacks.size).toBe(0)
})
