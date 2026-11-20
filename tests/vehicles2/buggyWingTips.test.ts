import * as T from 'three/webgpu'
import { expect, it, vi } from 'vitest'
import { RAPIER } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { Syn3hBuggySkin } from '../../src/vehicles/skins/Syn3hBuggySkin'
import { mergedSurfaces } from '../../src/vehicles/skins/mergeStatic'
import { WingTipAnchors } from '../../src/vehicles/skins/wingTips'
import { makeBed } from '../vehicles/harness'

/** Independently inspect the rendered field, excluding hull vertices in merged distant draws. */
function renderedWingVertices(skin: Syn3hBuggySkin, vehicle: Syn3hBuggy): T.Vector3[] {
  vehicle.object.updateWorldMatrix(true, true)
  const inverse = vehicle.object.matrixWorld.clone().invert(), points: T.Vector3[] = []
  skin.object.traverseVisible(object => {
    if (!(object instanceof T.Mesh)) return
    const geometry = object.geometry, position = geometry.getAttribute('position')
    const surfaces = mergedSurfaces.get(object.material as T.Material)
    const wing = surfaces?.findIndex(m => m.name === 'Buggy flight wing') ?? -1
    if (!geometry.hasAttribute('wingPlan') && wing < 0) return
    const ids = geometry.getAttribute('surfaceId')
    const matrix = inverse.clone().multiply(object.matrixWorld)
    for (let i = 0; i < position.count; i++) {
      if (wing >= 0 && ids.getX(i) !== wing) continue
      points.push(new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix))
    }
  })
  return points
}

it.each(['local', 'remote', 'bot'] as const)('%s buggy effects stay on drawn tips through deployment, flex and detail changes', async role => {
  const bed = await makeBed(), skin = new Syn3hBuggySkin()
  const buggy = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new T.Vector3(13, 30, -17), .7, 'buggy', () => skin))
  buggy.isLocal = role === 'local'
  if (role === 'remote') buggy.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  Object.assign(bed.game, { camera: new T.PerspectiveCamera() })
  const out = new T.Vector3()
  try {
    expect(buggy.getWingTip(-1, out)).toBe(false)
    await skin.ready
    // A non-identity skin transform catches accidentally returning mesh-local or world space.
    skin.object.position.set(.2, .1, -.15)
    skin.object.scale.set(1.15, .9, 1.05)
    for (const distance of [0, 60, 150, 60, 0]) {
      bed.game.camera.position.set(13 + distance, 30, -17)
      for (const open of [0, .01, .25, .5, .99, 1, .5, 0]) for (const steer of [-1, 0, 1]) for (const pitch of [-1, 0, 1]) {
        buggy.wingState = open; buggy.inputSmoothed.x = steer; buggy.motorInputSmoothed = pitch
        buggy.update(.02, 1)
        const points = renderedWingVertices(skin, buggy)
        for (const side of [-1, 1] as const) {
          expect(buggy.getWingTip(side, out)).toBe(open > 0)
          if (!open) continue
          expect(points.length).toBeGreaterThan(0)
          const extreme = Math.max(...points.map(p => side * p.x))
          const tipVertices = points.filter(p => Math.abs(side * p.x - extreme) < 1e-5)
          expect(Math.min(...tipVertices.map(p => out.distanceTo(p)))).toBeLessThan(.1)
        }
      }
    }
  } finally { buggy.dispose(); bed.game.world.free() }
})

it('tip anchors follow resized geometry and transformed surfaces, without stale points when hidden', () => {
  const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([-2, 0, 1, 3, 1, 2, 0, 0, -4], 3))
  const mesh = new T.Mesh(geometry), root = new T.Group(); root.add(mesh)
  const tips = new WingTipAnchors(mesh), out = new T.Vector3()
  expect(tips.get(1, root, out)).toBe(true); expect(out.x).toBe(3)
  geometry.scale(2, 1, 1)
  expect(tips.get(-1, root, out)).toBe(true); expect(out.x).toBe(-4)
  mesh.rotation.y = Math.PI / 2
  expect(tips.get(-1, root, out)).toBe(true); expect(out.x).toBeCloseTo(-4)
  mesh.visible = false; expect(tips.get(1, root, out)).toBe(false)
  geometry.dispose(); (mesh.material as T.Material).dispose()
})

it('writes ribbon endpoints at the real tips and resets history across unavailable wings', async () => {
  const { attachVehicleEffects } = await import('../../src/vehicles/effects')
  const { graphicsLevel } = await import('../../src/core/quality')
  const { params } = await import('../../shared/params')
  const previousLevel = graphicsLevel.value
  params.set(graphicsLevel.def.id, 2)
  const bed = await makeBed(), skin = new Syn3hBuggySkin()
  const buggy = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new T.Vector3(0, 30, 0), .7, 'buggy', () => skin))
  type EffectSystem = { update(dt: number): void; dispose(): void }
  const systems = new Set<EffectSystem>()
  Object.assign(bed.game, {
    camera: new T.PerspectiveCamera(),
    add: (system: EffectSystem) => { systems.add(system); return system },
    remove: (system: EffectSystem) => { systems.delete(system); system.dispose() },
  })
  const detach = attachVehicleEffects(bed.game, bed.terrain, buggy, { local: false })
  const trail = bed.game.scene.children.find(o => o instanceof T.Mesh && o.geometry.getAttribute('fxAge') && o.geometry.index?.count === 256 * 6) as T.Mesh
  const count = () => trail.geometry.drawRange.count
  const tick = () => {
    buggy.update(.1, 1)
    for (const system of systems) system.update(.1)
  }
  const move = (z: number) => {
    buggy.teleport(new T.Vector3(0, 30, z), .7)
    buggy.wingsOpen = true; buggy.wingState = 1
  }
  try {
    buggy.wingsOpen = true; buggy.wingState = 1
    tick(); expect(count()).toBe(0) // Geometry has not loaded yet.
    await skin.ready
    tick(); expect(count()).toBe(0) // First available anchor starts fresh history.
    move(-1)
    tick(); expect(count()).toBe(12)
    const positions = trail.geometry.getAttribute('position'), expected = new T.Vector3()
    for (const [i, side] of ([-1, 1] as const).entries()) {
      expect(buggy.getWingTip(side, expected)).toBe(true)
      expected.applyQuaternion(buggy.object.quaternion).add(buggy.object.position)
      const end = new T.Vector3().fromBufferAttribute(positions, i * 4 + 2)
        .add(new T.Vector3().fromBufferAttribute(positions, i * 4 + 3)).multiplyScalar(.5)
      expect(end.distanceTo(expected)).toBeLessThan(.1)
    }
    skin.object.visible = false; tick(); expect(count()).toBe(12)
    skin.object.visible = true
    move(-2)
    tick(); expect(count()).toBe(12) // No bridge across a missing wing.
    move(-3)
    tick(); expect(count()).toBe(24)
    buggy.wingsOpen = false; buggy.wingState = 0; tick()
    buggy.wingsOpen = true; buggy.wingState = 1; tick()
    expect(count()).toBe(24) // Closing also discards the old endpoint.
  } finally {
    detach(); buggy.dispose(); bed.game.world.free()
    params.set(graphicsLevel.def.id, previousLevel)
  }
})
