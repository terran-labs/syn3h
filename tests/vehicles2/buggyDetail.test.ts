import { readFile } from 'node:fs/promises'
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { expect, it, vi } from 'vitest'
import { LoadedBuggySkin } from '../../src/vehicles/skins/LoadedBuggySkin'
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

it('loads the real buggy assets and switches complete animated models within each budget', async () => {
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async function(url) {
    const bytes = await readFile(`public${url}`)
    return new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')
  })
  const root = new THREE.Group()
  const callbacks = new Set<VehicleDetail>()
  const detail: VehicleDetail = (distance, remote, level) => callbacks.forEach(fn => fn(distance, remote, level))
  root.userData.registerVehicleDetail = (fn: VehicleDetail) => { callbacks.add(fn); return () => callbacks.delete(fn) }
  const skin = new LoadedBuggySkin('syn3h'); root.add(skin.object)
  try {
    await skin.ready
    detail(0, false, 2)
    expect(counts(root).triangles).toBeLessThanOrEqual(12000)
    expect(counts(root).draws).toBeLessThanOrEqual(6)
    const tyres = skin.object.getObjectByName('Smooth tyres and chrome rings') as THREE.InstancedMesh
    skin.setWheel(0, new THREE.Vector3(-1.1, -.35, -1.3), .4, 1.2)
    const actual = new THREE.Matrix4(); tyres.getMatrixAt(0, actual)
    expect(new THREE.Vector3().setFromMatrixPosition(actual).y).toBeCloseTo(-.35)
    detail(60, true, 2)
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
  } finally { skin.dispose(); loader.mockRestore() }
})
