import { readFile } from 'node:fs/promises'
import * as T from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { expect, it, vi } from 'vitest'
import { params } from '../../shared/params'
import { graphicsLevel } from '../../src/core/quality'
import { RAPIER } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { LoadedBuggySkin } from '../../src/vehicles/skins/LoadedBuggySkin'
import { BuggyHeadlights } from '../../src/vehicles/skins/buggyHeadlights'
import { mergedSurfaces } from '../../src/vehicles/skins/mergeStatic'
import { makeBed } from '../vehicles/harness'

/** Independent check against triangles still present in the rendered merged model. */
function lampDistance(skin: LoadedBuggySkin, vehicle: Syn3hBuggy, point: T.Vector3): number {
  vehicle.object.updateWorldMatrix(true, true)
  const inverse = vehicle.object.matrixWorld.clone().invert(), triangle = new T.Triangle(), closest = new T.Vector3()
  let distance = Infinity
  skin.object.traverseVisible(object => {
    const mesh = object as T.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const surfaces = mergedSurfaces.get(mesh.material)
    const ids = mesh.geometry.getAttribute('surfaceId')
    if (!surfaces || !ids) return
    const p = mesh.geometry.getAttribute('position'), index = mesh.geometry.index
    const matrix = inverse.clone().multiply(mesh.matrixWorld)
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2
      if (!/headlight/i.test(surfaces[ids.getX(a)]?.name ?? '')) continue
      triangle.a.fromBufferAttribute(p, a).applyMatrix4(matrix)
      triangle.b.fromBufferAttribute(p, b).applyMatrix4(matrix)
      triangle.c.fromBufferAttribute(p, c).applyMatrix4(matrix)
      triangle.closestPointToPoint(point, closest)
      distance = Math.min(distance, closest.distanceTo(point))
    }
  })
  return distance
}

it.each(['local', 'remote', 'bot'] as const)('%s headlights use active lamp faces and canonical far anchors', async role => {
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
    const bytes = await readFile(`public${url}`)
    return new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')
  })
  const bed = await makeBed(), skin = new LoadedBuggySkin()
  const buggy = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new T.Vector3(13, 30, -17), .7, 'buggy', () => skin))
  buggy.isLocal = role === 'local'
  if (role === 'remote') buggy.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  Object.assign(bed.game, { camera: new T.PerspectiveCamera() })
  const source = buggy.object.userData.headlights as {
    count: number; sample(i: number, p: T.Vector3, d: T.Vector3, c: T.Color): boolean; needsGlow(): boolean
  }
  const p = new T.Vector3(), d = new T.Vector3(), color = new T.Color(), oldLevel = graphicsLevel.value
  try {
    expect(source.count).toBe(2)
    expect(source.sample(0, p, d, color)).toBe(false)
    await skin.ready
    skin.object.position.set(.2, .1, -.15)
    skin.object.rotation.set(.1, .15, -.08)
    skin.object.scale.set(1.15, .9, 1.05)
    const near = [new T.Vector3(), new T.Vector3()]
    for (const level of [0, 1, 2, 3, 4, 5]) {
      params.set(graphicsLevel.def.id, level)
      for (const distance of [0, 60, 150, 60, 0]) {
        bed.game.camera.position.set(13 + distance, 30, -17)
        buggy.update(.02, 1)
        const far = role !== 'local' && distance === 150
        expect(source.needsGlow()).toBe(far)
        for (let side = 0; side < 2; side++) {
          expect(source.sample(side, p, d, color)).toBe(true)
          expect(d.length()).toBeCloseTo(1, 6)
          expect(d.z).toBeLessThan(-.5)
          expect(color.r + color.g + color.b).toBeGreaterThan(0)
          if (distance === 0) near[side].copy(p)
          if (far) expect(p.distanceTo(near[side])).toBeLessThan(1e-6)
          else expect(lampDistance(skin, buggy, p)).toBeLessThan(.1)
        }
      }
    }
    expect(source.sample(-1, p, d, color)).toBe(false)
    expect(source.sample(2, p, d, color)).toBe(false)
    skin.object.visible = false
    expect(source.sample(0, p, d, color)).toBe(false)
  } finally {
    buggy.dispose(); bed.game.world.free(); loader.mockRestore()
    params.set(graphicsLevel.def.id, oldLevel)
  }
  expect(buggy.object.userData.headlights).toBeUndefined()
  expect(source.sample(0, p, d, color)).toBe(false)
})

it('extracts front faces from transformed indexed geometry and ignores rear fittings', () => {
  const root = new T.Group(), front = new T.Mesh(new T.BoxGeometry(.4, .2, .1), new T.MeshStandardMaterial({ color: 0xabcdef }))
  front.position.set(-2, 1, -3); front.rotation.y = .2; front.scale.set(1.5, .75, 2)
  root.add(front)
  const rear = front.clone(); rear.position.z = 2; root.add(rear)
  const lamps = new BuggyHeadlights(root, root, () => true)
  const p = new T.Vector3(), d = new T.Vector3(), c = new T.Color()
  expect(lamps.sample(0, p, d, c)).toBe(true)
  const expected = new T.Vector3(0, 0, -.05).applyMatrix4(front.matrix)
  const expectedNormal = new T.Vector3(0, 0, -1).applyNormalMatrix(new T.Matrix3().getNormalMatrix(front.matrix))
  expect(p.distanceTo(expected)).toBeLessThan(1e-6)
  expect(d.distanceTo(expectedNormal)).toBeLessThan(1e-6)
  expect(c.getHex()).toBe(0xabcdef)
  expect(lamps.sample(1, p, d, c)).toBe(false)
  front.geometry.dispose(); (front.material as T.Material).dispose()
})
