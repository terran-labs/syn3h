import * as THREE from 'three/webgpu'
import { afterEach, expect, it, vi } from 'vitest'
import { Syn3hBuggySkin } from '../../src/vehicles/skins/Syn3hBuggySkin'
import { buggyBody } from '../../src/vehicles/buggygen/body'
import { buildParts } from '../../src/vehicles/buggygen/parts'
import type { VehicleDetail } from '../../src/vehicles/skins/mergeStatic'

afterEach(() => { vi.unstubAllGlobals() })

function finite(root: THREE.Object3D): boolean {
  let ok = true
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    const a = o.geometry.attributes.position.array
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) ok = false
  })
  return ok
}

function triangles(root: THREE.Object3D): number {
  let n = 0
  root.traverseVisible(o => { if (o instanceof THREE.Mesh) n += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o instanceof THREE.InstancedMesh ? o.count : 1) })
  return n
}

// A role the skin cannot map would be drawn as plain trim: the wrong colour in the game.
it('gives every generated piece a role the skin knows, at every detail level', () => {
  const known = ['paint', 'accent', 'glow', 'chrome', 'frame', 'trim', 'canopy', 'lamp']
  for (const detail of [0, 1, 2] as const) {
    for (const p of [...buildParts(detail, buggyBody.build(detail).map(b => b.geometry)).pieces, ...buggyBody.build(detail)]) expect(known, `${p.part} ${p.role}`).toContain(p.role)
  }
})

// The buggy is generated: it must never make a model request, and must come up whole.
it('builds without any network request, with finite geometry, and moves its parts', async () => {
  const fetch = vi.fn(() => Promise.reject(new Error('no network in this test')))
  vi.stubGlobal('fetch', fetch)
  const root = new THREE.Group()
  const callbacks = new Set<VehicleDetail>()
  const detail: VehicleDetail = (distance, remote, level) => callbacks.forEach(fn => fn(distance, remote, level))
  root.userData.registerVehicleDetail = (fn: VehicleDetail) => { callbacks.add(fn); return () => callbacks.delete(fn) }
  const skin = new Syn3hBuggySkin(); root.add(skin.object)
  try {
    await skin.ready
    expect(fetch).not.toHaveBeenCalled()
    expect(skin.object.visible).toBe(true)
    for (const level of [0, 60, 300]) { detail(level, true, 2); expect(finite(root)).toBe(true) }
    // A distant buggy draws less than a near one; otherwise every remote buggy costs full detail.
    detail(0, true, 2); const near = triangles(root)
    detail(60, true, 2); const mid = triangles(root)
    detail(300, true, 2); const far = triangles(root)
    expect(mid).toBeLessThan(near)
    expect(far).toBeLessThanOrEqual(mid)
    detail(0, false, 2)
    // Suspension and wheels follow setWheel.
    skin.setWheel(0, new THREE.Vector3(-1.1, -.35, -1.3), .4, 1.2)
    const tyres = skin.object.getObjectByName('Smooth tyres and chrome rings') as THREE.InstancedMesh
    const m = new THREE.Matrix4(); tyres.getMatrixAt(0, m)
    expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBeCloseTo(-.35)
    // Tyre size (buggy.tyreSize): the tyre and the stator grow by exactly the scale asked for,
    // about the hub, so big tyres do not float off their hubs or sink into the ground.
    skin.setTyreScale(2, 1.5)
    skin.setWheel(0, new THREE.Vector3(-1.1, -.35, -1.3), 0, 0)
    tyres.getMatrixAt(0, m)
    const scale = new THREE.Vector3(), position = new THREE.Vector3()
    m.decompose(position, new THREE.Quaternion(), scale)
    expect(scale.x).toBeCloseTo(1.5); expect(scale.y).toBeCloseTo(2); expect(scale.z).toBeCloseTo(2)
    expect(position.y).toBeCloseTo(-.35)
    const stators = skin.object.getObjectByName('Stators') as THREE.InstancedMesh
    stators.getMatrixAt(0, m); m.decompose(position, new THREE.Quaternion(), scale)
    expect(scale.y).toBeCloseTo(2)
    skin.setTyreScale(1, 1)
    // Wings open, flex and report tips on both sides, staying finite.
    skin.setWings(1, .5, -.5)
    expect(finite(root)).toBe(true)
    const tip = new THREE.Vector3()
    expect(skin.getWingTip(1, tip)).toBe(true)
    expect(tip.x).toBeGreaterThan(0)
    expect(skin.getWingTip(-1, tip)).toBe(true)
    expect(tip.x).toBeLessThan(0)
    skin.setDrive(0, 1); skin.setLights(true); skin.setColors(0xff0000, 0x00ff00)
  } finally {
    skin.dispose()
  }
})
