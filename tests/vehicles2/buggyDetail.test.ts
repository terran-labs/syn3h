import { readFile } from 'node:fs/promises'
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { expect, it, vi } from 'vitest'
import { LoadedBuggySkin } from '../../src/vehicles/skins/LoadedBuggySkin'
import { setModelTransport } from '../../src/vehicles/skins/modelLoader'
import type { VehicleDetail } from '../../src/vehicles/skins/mergeStatic'

function counts(root: THREE.Object3D) {
  let triangles = 0, draws = 0
  root.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh)) return
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o instanceof THREE.InstancedMesh ? o.count : 1)
    draws += Array.isArray(o.material) ? o.geometry.groups.length : 1
  })
  return { triangles, draws }
}

it.each([false, true])('loads real assets within each budget with foreign loader constructors=%s', async (foreignConstructors) => {
  setModelTransport({ fetch: async url => new Response(Uint8Array.from(await readFile(`public${url}`)), { status: 200 }) })
  const parse = GLTFLoader.prototype.parseAsync
  const loader = vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockImplementation(async function(this: GLTFLoader, data, path) {
    const gltf = await parse.call(this, data, path)
    if (foreignConstructors) {
      // Match a loader from another Three module: same mesh API, different prototype identity.
      const prototype = Object.create(THREE.Object3D.prototype, Object.getOwnPropertyDescriptors(THREE.Mesh.prototype))
      gltf.scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          Object.setPrototypeOf(object, prototype)
          expect(object instanceof THREE.Mesh).toBe(false)
        }
      })
    }
    return gltf
  })
  const root = new THREE.Group()
  const callbacks = new Set<VehicleDetail>()
  const detail: VehicleDetail = (distance, remote, level) => callbacks.forEach(fn => fn(distance, remote, level))
  root.userData.registerVehicleDetail = (fn: VehicleDetail) => { callbacks.add(fn); return () => callbacks.delete(fn) }
  const skin = new LoadedBuggySkin(); root.add(skin.object)
  try {
    await skin.ready
    detail(0, false, 2)
    expect(counts(root).triangles).toBeLessThanOrEqual(12000)
    expect(counts(root).draws).toBeLessThanOrEqual(6)
    const tyres = skin.object.getObjectByName('Smooth tyres and chrome rings') as THREE.InstancedMesh
    skin.setWheel(0, new THREE.Vector3(-1.1, -.35, -1.3), .4, 1.2)
    const actual = new THREE.Matrix4(); tyres.getMatrixAt(0, actual)
    expect(new THREE.Vector3().setFromMatrixPosition(actual).y).toBeCloseTo(-.35)
    // Each shock runs from its foot on the swinging arm to an anchor fixed in the body, at any
    // wheel travel: its top never leaves the body and its spring never inverts.
    const shocks = skin.object.getObjectByName('Shocks') as THREE.InstancedMesh
    expect(shocks.visible).toBe(true)
    const tops: THREE.Vector3[] = []
    for (const [i, x, z] of [[0, -1.1, -1.3], [1, 1.1, -1.3], [2, -1.1, 1.3], [3, 1.1, 1.3]] as const) {
      const lengths: number[] = []
      for (const y of [-.2, .1, .5]) {
        skin.setWheel(i, new THREE.Vector3(x, y, z), .3, 0)
        const m = new THREE.Matrix4(); shocks.getMatrixAt(i, m)
        const foot = new THREE.Vector3().setFromMatrixPosition(m), top = new THREE.Vector3(0, 1, 0).applyMatrix4(m)
        if (y === -.2) tops.push(top.clone())
        expect(top.distanceTo(tops[i])).toBeLessThan(1e-5)
        lengths.push(top.distanceTo(foot))
        // Unit radius: only the length scales.
        expect(new THREE.Vector3().setFromMatrixColumn(m, 0).length()).toBeCloseTo(1)
        expect(new THREE.Vector3().setFromMatrixColumn(m, 2).length()).toBeCloseTo(1)
      }
      // Longest with the wheel hanging, shortest with it pushed up, never collapsed.
      expect(lengths[0]).toBeGreaterThan(lengths[1])
      expect(lengths[1]).toBeGreaterThan(lengths[2])
      expect(lengths[2]).toBeGreaterThan(.15)
      expect(lengths[0]).toBeLessThan(1)
    }
    // Anchors mirror left to right and sit inside the body's outline.
    expect(tops[0].x).toBeCloseTo(-tops[1].x, 3)
    expect(tops[2].x).toBeCloseTo(-tops[3].x, 3)
    expect(tops[0].z).toBeLessThan(0)
    expect(tops[2].z).toBeGreaterThan(0)
    for (const t of tops) expect(Math.abs(t.x)).toBeLessThan(.95)
    detail(60, true, 2)
    expect(shocks.visible).toBe(false)
    expect(counts(root).triangles).toBeLessThanOrEqual(2500)
    expect(counts(root).draws).toBeLessThanOrEqual(3)
    skin.setWings(1, 0, 0)
    detail(150, true, 2)
    expect(counts(root).triangles).toBeLessThanOrEqual(500)
    expect(counts(root).draws).toBe(1)
    const farBounds = new THREE.Box3().setFromObject(skin.object.getObjectByName('Box arm silhouette')!)
    expect(farBounds.max.x).toBeCloseTo(7.9728508)
    expect(farBounds.min.z).toBeCloseTo(-5.3277035)
    detail(150, false, 2)
    expect(tyres.visible).toBe(true)
    expect(counts(root).triangles).toBeLessThanOrEqual(12000)
    // Deployed force-field wings add two passes; powered motor glow can add one more.
    expect(counts(root).draws).toBeLessThanOrEqual(8)
  } finally { skin.dispose(); loader.mockRestore(); setModelTransport() }
})
