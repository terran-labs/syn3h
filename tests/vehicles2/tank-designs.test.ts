import { describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { round7 } from '../../src/vehicles/tankDesigns/round7'
import { buildExpedition, poseExpeditionArm } from '../../src/vehicles/tankDesigns/expeditionKit'
import { makeMats } from '../../src/vehicles/tankDesigns/kit'

describe('ten exploration tank studies', () => {
  it('has ten distinct silhouettes rather than colour copies', () => {
    expect(new Set(round7.map(d => d.id)).size).toBe(10)
    expect(new Set(round7.map(d => JSON.stringify(d.spec.sections))).size).toBe(10)
  })

  for (const design of round7) it(`${design.name}: finite geometry, original footprint and six independent carriers`, () => {
    const mats = makeMats(design.color, design.accent), root = buildExpedition(mats, design.spec, .34)
    root.updateMatrixWorld(true)
    const box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3())
    expect(size.x).toBeGreaterThan(5)
    expect(size.x).toBeLessThan(5.7)
    expect(size.z).toBeGreaterThan(7.4)
    expect(size.z).toBeLessThan(8.5)
    expect(box.min.y).toBeGreaterThan(-.05)
    expect(box.min.y).toBeLessThan(.1)
    const arms: T.Object3D[] = [], geometries = new Set<T.BufferGeometry>()
    let triangles = 0
    root.traverse(o => {
      if (o.userData.expeditionArm) arms.push(o)
      if (o instanceof T.Mesh) {
        const p = o.geometry.getAttribute('position')
        expect(Array.from(p.array).every(Number.isFinite)).toBe(true)
        triangles += (o.geometry.index?.count ?? p.count) / 3
        geometries.add(o.geometry)
      }
    })
    expect(arms).toHaveLength(6)
    expect(triangles).toBeLessThan(12000)
    for (const arm of arms) {
      const fixedPivot = arm.getWorldPosition(new T.Vector3())
      const pod = arm.children.find(o => o.userData.expeditionPod)!
      expect(pod).toBeDefined()
      expect(pod.children.some(o => o.name === 'Independent fender')).toBe(true)
      const rest = pod.getWorldPosition(new T.Vector3())
      poseExpeditionArm(arm, .16, 0)
      root.updateMatrixWorld(true)
      expect(arm.getWorldPosition(new T.Vector3()).distanceTo(fixedPivot)).toBeLessThan(1e-8)
      expect(pod.getWorldPosition(new T.Vector3()).distanceTo(rest)).toBeGreaterThan(.08)
      expect(Math.abs(new T.Euler().setFromQuaternion(pod.getWorldQuaternion(new T.Quaternion())).x)).toBeLessThan(1e-8)
      poseExpeditionArm(arm, 0, 0)
    }
    const eye = new T.Vector3(...root.userData.eye as [number, number, number])
    expect(box.containsPoint(eye)).toBe(true)
    geometries.forEach(g => g.dispose())
    for (const value of Object.values(mats)) if (value instanceof T.Material) value.dispose()
  })
})
