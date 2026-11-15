import { describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { round7 } from '../../src/vehicles/tankDesigns/round7'
import { round8 } from '../../src/vehicles/tankDesigns/round8'
import { ExpeditionTank, POD_TRAVEL } from '../../src/vehicles/tankDesigns/expeditionKit'
import { mergedSurfaces } from '../../src/vehicles/skins/mergeStatic'
import { roleOf } from '../../src/vehicles/skins/showroom'

/** World matrix of one instance of an instanced mesh. */
const instance = (mesh: T.InstancedMesh, i: number) => { const m = new T.Matrix4(); mesh.getMatrixAt(i, m); return m.premultiply(mesh.matrixWorld) }
const meshes = (root: T.Object3D) => { const out: T.Mesh[] = []; root.traverse(o => { if (o instanceof T.Mesh && o.visible && o.parent?.visible !== false) out.push(o) }); return out }

describe('generated tanks', () => {
  it('has ten distinct silhouettes a round rather than colour copies', () => {
    expect(new Set([...round7, ...round8].map(d => d.id)).size).toBe(20)
    expect(new Set(round7.map(d => JSON.stringify(d.spec.sections))).size).toBe(10)
  })

  for (const design of [...round8, ...round7]) it(`${design.name}: budgets, footprint, roles and six independent treads`, () => {
    const tank = new ExpeditionTank(design.hull(), design.color, design.accent)
    tank.object.updateMatrixWorld(true)
    // PATTERN.md rule 4. The tank is allowed 10 draws up close for its moving assemblies.
    const near = tank.stats(0), mid = tank.stats(1), far = tank.stats(2)
    expect(near.triangles).toBeLessThanOrEqual(12000); expect(near.draws).toBeLessThanOrEqual(10)
    expect(mid.triangles).toBeLessThanOrEqual(2500); expect(mid.draws).toBeLessThanOrEqual(3)
    expect(far.triangles).toBeLessThanOrEqual(500); expect(far.draws).toBe(1)

    // Rule 1: one packed material of tagged surfaces, and the canopy on its own.
    const [nearRoot] = tank.object.children, materials = new Set(meshes(nearRoot).map(m => m.material as T.Material))
    expect(materials.size).toBe(2)
    for (const m of materials) {
      const packed = mergedSurfaces.get(m)
      if (packed) for (const source of packed) { expect(source.userData.showroom).toBeDefined(); expect(source.side).toBe(T.FrontSide); expect(source.map).toBeNull() }
      else expect(roleOf(m)).toBe('canopy')
    }

    // Every vertex is finite, and the near level stands on the ground at the original footprint.
    const box = new T.Box3()
    for (const mesh of meshes(nearRoot)) {
      const p = mesh.geometry.getAttribute('position')
      expect(Array.from(p.array).every(Number.isFinite)).toBe(true)
      const local = new T.Box3().setFromBufferAttribute(p as T.BufferAttribute)
      if (mesh instanceof T.InstancedMesh) for (let i = 0; i < mesh.count; i++) box.union(local.clone().applyMatrix4(instance(mesh, i)))
      else box.union(local.applyMatrix4(mesh.matrixWorld))
    }
    const size = box.getSize(new T.Vector3())
    // The original's footprint: pods at 2 m either side, 2.5 m apart, each 2.1 m long.
    expect(size.x).toBeGreaterThan(4.9); expect(size.x).toBeLessThan(5.7)
    expect(size.z).toBeGreaterThan(7); expect(size.z).toBeLessThan(8.5)
    expect(box.min.y).toBeGreaterThan(-.01); expect(box.min.y).toBeLessThan(.1)
    expect(box.containsPoint(new T.Vector3(...tank.eye))).toBe(true)

    // Six treads, each on its own arm: lifting one moves that pod and its arm and nothing else.
    const pods = meshes(nearRoot).filter((m): m is T.InstancedMesh => m instanceof T.InstancedMesh && /Treads/.test(m.name))
    const arms = meshes(nearRoot).filter((m): m is T.InstancedMesh => m instanceof T.InstancedMesh && /arms/.test(m.name))
    expect(pods.reduce((n, m) => n + m.count, 0)).toBe(6); expect(arms.reduce((n, m) => n + m.count, 0)).toBe(6)
    const all = () => [...pods, ...arms].flatMap(m => Array.from({ length: m.count }, (_, i) => instance(m, i)))
    const rest = all()
    tank.setPod(3, .2, .1, 1.3); tank.pose()
    const moved = all().map((m, i) => !m.equals(rest[i]))
    expect(moved.filter(Boolean)).toHaveLength(2)
    // Right side, middle axle: the pod rose 0.2 m, tilted 0.1 rad, and its arm stayed on its pivot.
    const pod = instance(pods[1], 1), was = rest[pods[0].count + 1]
    expect(pod.elements[13] - was.elements[13]).toBeCloseTo(.2, 5)
    expect(new T.Euler().setFromRotationMatrix(pod).x).toBeCloseTo(.1, 5)
    const armNow = instance(arms[1], 1), armWas = rest[6 + arms[0].count + 1]
    expect(new T.Vector3().setFromMatrixPosition(armNow).distanceTo(new T.Vector3().setFromMatrixPosition(armWas))).toBeLessThan(1e-9)
    // The belt scroll is per pod, wrapped to one lug.
    const belts = pods[1].geometry.getAttribute('trackScroll')
    expect(belts.getX(1)).toBeGreaterThan(0); expect(belts.getX(0)).toBe(0)
    // Travel is limited to what the arm can reach.
    tank.setPod(3, 5, 0, 0); tank.pose()
    expect(instance(pods[1], 1).elements[13] - was.elements[13]).toBeCloseTo(POD_TRAVEL.up, 5)
    tank.setPod(3, -5, 0, 0); tank.pose()
    expect(instance(pods[1], 1).elements[13] - was.elements[13]).toBeCloseTo(-POD_TRAVEL.down, 5)
    tank.dispose()
  })

  it('faces outward: the hull and each pod enclose a positive volume', () => {
    const tank = new ExpeditionTank(round8[0].hull(), round8[0].color, 0xffffff)
    for (const mesh of meshes(tank.object.children[0])) {
      if (mesh.name === 'Cabin windows') continue
      const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal')
      const centre = new T.Box3().setFromBufferAttribute(p as T.BufferAttribute).getCenter(new T.Vector3())
      // Area-weighted: outward faces of a solid point away from its middle far more than toward it.
      let away = 0, toward = 0
      const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), normal = new T.Vector3()
      for (let i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2)
        const area = normal.crossVectors(b.clone().sub(a), c.clone().sub(a)).length()
        // The stored normal agrees with the winding, so back-face culling and lighting agree.
        expect(normal.dot(new T.Vector3().fromBufferAttribute(n, i))).toBeGreaterThanOrEqual(0)
        const d = normal.normalize().dot(a.add(b).add(c).multiplyScalar(1 / 3).sub(centre).normalize())
        if (d > 0) away += area; else toward += area
      }
      expect(away / (away + toward)).toBeGreaterThan(.6)
    }
    tank.dispose()
  })
})
