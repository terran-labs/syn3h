import { expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { vehicleShading } from '../../src/core/quality'
import { createLiquidState } from '../../src/vehicles/lava'
import { LOD_FAR, LOD_NEAR, type VehicleDetail } from '../../src/vehicles/skins/mergeStatic'
import { MotorSparks } from '../../src/vehicles/skins/motorSparks'
import { MiraBuggySkin } from '../../src/vehicles/skins/MiraBuggySkin'

it('shares stator materials while each buggy keeps its own wheel glow and disposal', async () => {
  const previous = vehicleShading.value
  params.set(vehicleShading.def.id, 2)
  const a = new MiraBuggySkin()
  const b = new MiraBuggySkin()
  try {
    await Promise.all([a.ready, b.ready])
    const left = a.object.getObjectByName('Stators') as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>
    const right = b.object.getObjectByName('Stators') as typeof left
    const showroom = left.material
    expect(showroom).toBe(right.material)
    params.set(vehicleShading.def.id, 0)
    const plain = left.material
    expect(plain).toBe(right.material)
    expect(plain).not.toBe(showroom)

    // Different paint, load and regeneration must still reach the two actual instance buffers.
    a.setColors(0x333333, 0xff0000)
    b.setColors(0x333333, 0x0000ff)
    a.setDrive(0, 1)
    b.setDrive(0, .5, true)
    const l = left.geometry.getAttribute('statorGlow')
    const r = right.geometry.getAttribute('statorGlow')
    expect(l).not.toBe(r)
    expect([l.getX(0), l.getY(0), l.getZ(0)]).toEqual([1, 0, 0])
    expect(r.getZ(0)).toBeCloseTo(.1125)
    expect(r.getX(0)).toBeCloseTo(.05625)

    let disposed = 0
    showroom.addEventListener('dispose', () => disposed++)
    plain.addEventListener('dispose', () => disposed++)
    a.dispose()
    expect(disposed).toBe(0)
    expect(right.material).toBe(plain)
    params.set(vehicleShading.def.id, 2)
    expect(right.material).toBe(showroom)
    b.dispose()
    expect(disposed).toBe(2)
  } finally {
    a.dispose()
    b.dispose()
    params.set(vehicleShading.def.id, previous)
  }
})

it('shares distance graphs without mixing buggy paint, wing geometry or wheel matrices', async () => {
  const previous = vehicleShading.value
  params.set(vehicleShading.def.id, 2)
  const make = () => {
    const owner = new THREE.Group(), callbacks = new Set<VehicleDetail>()
    owner.userData.vehicleHeat = createLiquidState()
    owner.userData.registerVehicleDetail = (fn: VehicleDetail) => { callbacks.add(fn); return () => callbacks.delete(fn) }
    const skin = new MiraBuggySkin()
    owner.add(skin.object)
    return { skin, distance: (meters: number) => callbacks.forEach(fn => fn(meters, true, 2)) }
  }
  const a = make(), b = make()
  type DistanceMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>
  const piece = (skin: MiraBuggySkin, name: string) => {
    const part = skin.object.getObjectByName(name)!
    return (part instanceof THREE.Mesh ? part : part.children[0]) as DistanceMesh
  }
  const colorsFor = (mesh: DistanceMesh) => {
    const colors: THREE.Color[] = []
    mesh.material.colorNode!.traverse(node => {
      if (node.updateType !== 'object' || !('isUniformNode' in node)) return
      const uniform = node as unknown as { update(frame: { material: THREE.Material }): void; value: THREE.Color }
      uniform.update({ material: mesh.material })
      colors.push(uniform.value)
    })
    return colors.map(color => color.getHex())
  }
  try {
    await Promise.all([a.skin.ready, b.skin.ready])
    a.skin.setColors(0x123456, 0xff4400)
    b.skin.setColors(0x654321, 0x44ff00)
    params.set(vehicleShading.def.id, 0)
    a.distance(8)
    b.distance(8)
    for (const name of ['Suspension arms', 'Shocks', 'Smooth tyres and chrome rings', 'Merged static surfaces']) {
      const left = piece(a.skin, name), right = piece(b.skin, name)
      expect(left.material.colorNode).toBe(right.material.colorNode)
      expect(left.material.emissiveNode).toBe(right.material.emissiveNode)
    }
    expect(colorsFor(piece(a.skin, 'Merged static surfaces'))).toContain(0x123456)
    expect(colorsFor(piece(b.skin, 'Merged static surfaces'))).toContain(0x654321)
    params.set(vehicleShading.def.id, 2)
    a.distance(LOD_NEAR + 10)
    b.distance(LOD_NEAR + 10)
    for (const name of ['Box arm mid body', 'Mid suspension', 'Mid tyres']) {
      const left = piece(a.skin, name), right = piece(b.skin, name)
      expect(left.material).not.toBe(right.material)
      expect(left.material.colorNode).toBe(right.material.colorNode)
      expect(left.material.emissiveNode).toBe(right.material.emissiveNode)
      expect(left.material.customProgramCacheKey()).toBe(right.material.customProgramCacheKey())
    }
    const midA = piece(a.skin, 'Box arm mid body'), midB = piece(b.skin, 'Box arm mid body')
    expect(colorsFor(midA)).toEqual(expect.arrayContaining([0x123456, 0xff4400]))
    expect(colorsFor(midB)).toEqual(expect.arrayContaining([0x654321, 0x44ff00]))

    const wheelA = piece(a.skin, 'Mid tyres')
    const wheelB = piece(b.skin, 'Mid tyres')
    if (!(wheelA instanceof THREE.InstancedMesh) || !(wheelB instanceof THREE.InstancedMesh)) throw new Error('Expected instanced mid-distance tyres')
    const before = new THREE.Matrix4(), next = new THREE.Matrix4()
    expect(wheelA.instanceMatrix).not.toBe(wheelB.instanceMatrix)
    wheelB.getMatrixAt(0, before)
    a.skin.setWheel(0, new THREE.Vector3(-1.1, -.4, -1.3), .4, 1.2)
    wheelA.getMatrixAt(0, next)
    expect(next.equals(before)).toBe(false)
    wheelB.getMatrixAt(0, next)
    expect(next.equals(before)).toBe(true)

    a.distance(LOD_FAR + 10)
    b.distance(LOD_FAR + 10)
    const farA = piece(a.skin, 'Box arm silhouette'), farB = piece(b.skin, 'Box arm silhouette')
    expect(farA.material.customProgramCacheKey()).toBe(farB.material.customProgramCacheKey())
    expect(farA.material.colorNode).toBe(farB.material.colorNode)
    expect(colorsFor(farB)).toEqual(expect.arrayContaining([0x654321, 0x44ff00]))
    expect(farA.geometry).not.toBe(farB.geometry)
    const folded = new THREE.Box3().setFromObject(farB)
    a.skin.setWings(1, 0, 0)
    expect(new THREE.Box3().setFromObject(farA).max.x).toBeGreaterThan(folded.max.x)
    expect(new THREE.Box3().setFromObject(farB).equals(folded)).toBe(true)

    let disposed = false
    farB.material.addEventListener('dispose', () => { disposed = true })
    a.skin.dispose()
    expect(disposed).toBe(false)
    expect(colorsFor(farB)).toEqual(expect.arrayContaining([0x654321, 0x44ff00]))
  } finally {
    a.skin.dispose()
    b.skin.dispose()
    params.set(vehicleShading.def.id, previous)
  }
})

it('reads the spark clock of each drawn mesh and disposes the shared graph only at last release', () => {
  const a = new MotorSparks(1, 2)
  const b = new MotorSparks(1, 2)
  try {
    const material = a.mesh.material
    expect(material).toBe(b.mesh.material)
    a.commit(4, true)
    b.commit(12, true)
    a.emit(0, 0, 0, 1, 0, 0, 1, .1, 1, 0, 0)
    b.emit(0, 0, 0, 0, 1, 0, 2, .1, 0, 0, 1)
    a.commit(4.5, true)
    b.commit(12.25, true)
    expect(a.mesh.geometry.getAttribute('sparkInfo').getX(1)).toBe(4)
    expect(b.mesh.geometry.getAttribute('sparkInfo').getX(1)).toBe(12)
    expect(a.mesh.geometry.getAttribute('sparkTint').getX(1)).toBe(1)
    expect(b.mesh.geometry.getAttribute('sparkTint').getZ(1)).toBe(1)

    const clockFor = (object: THREE.Object3D) => {
      const values = new Set<number>()
      material.opacityNode!.traverse(node => {
        if (node.updateType !== 'object' || !('isUniformNode' in node)) return
        const uniform = node as unknown as { update(frame: { object: THREE.Object3D }): void; value: number }
        uniform.update({ object })
        values.add(uniform.value)
      })
      return [...values]
    }
    expect(clockFor(a.mesh)).toEqual([4.5])
    expect(clockFor(b.mesh)).toEqual([12.25])
    expect(clockFor(a.mesh)).toEqual([4.5])

    let disposed = 0, releasedMesh = 0, releasedGeometry = 0
    material.addEventListener('dispose', () => disposed++)
    a.mesh.addEventListener('dispose', () => releasedMesh++)
    a.mesh.geometry.addEventListener('dispose', () => releasedGeometry++)
    a.dispose()
    expect([releasedMesh, releasedGeometry, disposed]).toEqual([1, 1, 0])
    expect(clockFor(b.mesh)).toEqual([12.25])
    b.dispose()
    b.dispose()
    expect(disposed).toBe(1)
  } finally {
    a.dispose()
    b.dispose()
  }
})
