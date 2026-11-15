import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { distantBuggyArm, distantBuggyBody, smoothBuggyWheel } from '../../src/vehicles/skins/buggyGeometry'

function triangles(root: THREE.Object3D): number {
  let count = 0
  root.traverse(o => { if (o instanceof THREE.Mesh) count += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 })
  return count
}

describe('generated buggy geometry', () => {
  it('matches the approved tyre dimensions and budget, with outward tread normals', () => {
    const wheel = smoothBuggyWheel(), box = new THREE.Box3().setFromObject(wheel)
    expect(triangles(wheel)).toBe(320)
    expect(box.getSize(new THREE.Vector3()).toArray()).toEqual(expect.arrayContaining([expect.closeTo(.49), expect.closeTo(1.04)]))
    const mesh = wheel.children[0] as THREE.Mesh
    const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal
    for (let i = 0; i < p.count; i++) if (Math.hypot(p.getY(i), p.getZ(i)) > .51) {
      expect(p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i)).toBeGreaterThan(0)
    }
  })
  it('meets the mid and far budgets including all wheels, arms and deployed wings', () => {
    const body = new THREE.Color('blue'), accent = new THREE.Color('cyan')
    const mid = distantBuggyBody(body, accent, false), far = distantBuggyBody(body, accent, true)
    expect(triangles(mid) + 4 * triangles(smoothBuggyWheel(12)) + 4 * triangles(distantBuggyArm())).toBeLessThanOrEqual(2500)
    expect(triangles(far)).toBeLessThanOrEqual(500)
    expect(mid.children).toHaveLength(1); expect(far.children).toHaveLength(1)
    far.userData.setWings(1)
    expect(new THREE.Box3().setFromObject(far).max.x).toBeCloseTo(7.9728508)
    far.userData.setWings(0)
    const folded = new THREE.Box3().setFromObject(far)
    expect(folded.max.x).toBeLessThan(1.4)
    expect(folded.getSize(new THREE.Vector3()).z).toBeCloseTo(4)
  })
})
