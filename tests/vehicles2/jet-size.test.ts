/**
 * The jet's size (jetgen/size.ts; the owner: "Size the jet to be 6 meters long"). Each test
 * names the bug it catches.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Jet } from '../../src/vehicles/Jet'
import { GameJet } from '../../src/vehicles/jetgen/GameJet'
import { jetLength, measuredJetLength } from '../../src/vehicles/jetgen/size'
import { harness } from './harness'

beforeAll(initPhysics)

/** The close model's length nose to tail, gear up, as drawn (the plume and lights excluded). */
function builtLength(model: GameJet): number {
  const near = model.near
  near.setGear(0)
  model.object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(near.object, true)
  return box.max.z - box.min.z
}

function withLength<T>(metres: number, run: () => T): T {
  const saved = jetLength.value
  jetLength.value = metres
  try { return run() } finally { jetLength.value = saved }
}

describe('jet size', () => {
  // Bug: the jet drawn at some other length than the registry's (a design change, a scale
  // applied twice, or a level left at the design size).
  it('is built exactly jet.length long, gear up, at the default and after a change', () => {
    expect(builtLength(new GameJet())).toBeCloseTo(jetLength.value, 2)
    expect(Math.abs(builtLength(new GameJet()) - jetLength.value)).toBeLessThan(.01)
    withLength(7.5, () => expect(Math.abs(builtLength(new GameJet()) - 7.5)).toBeLessThan(.01))
    expect(measuredJetLength()).toBeGreaterThan(jetLength.value) // the design is larger than 6 m
  })

  // Bug: the collider or camera left at the design size while the model shrinks.
  it('scales its collider and camera distance with the model', () => {
    const h = harness(0, false)
    const design = withLength(measuredJetLength(), () => new Jet(h.game, h.terrain, new THREE.Vector3(0, 50, 0)))
    const sized = new Jet(h.game, h.terrain, new THREE.Vector3(30, 50, 0))
    const extent = (v: Jet) => { const c = v.body.collider(0); const a = c.shape as unknown as { vertices?: Float32Array }; const zs = [...(a.vertices ?? [])].filter((_, i) => i % 3 === 2); return Math.max(...zs) - Math.min(...zs) }
    expect(extent(sized) / extent(design)).toBeCloseTo(sized.size / design.size, 3)
    expect(sized.camOffset / design.camOffset).toBeCloseTo(sized.size / design.size, 6)
    design.dispose(); sized.dispose(); h.world.free()
  })

  // Bug: a smaller jet handling differently because its mass or inertia shrank with it.
  it('keeps the original mass and inertia at any size', () => {
    const h = harness(0, false)
    const design = withLength(measuredJetLength(), () => new Jet(h.game, h.terrain, new THREE.Vector3(0, 50, 0)))
    const sized = new Jet(h.game, h.terrain, new THREE.Vector3(30, 50, 0))
    expect(sized.body.mass()).toBeCloseTo(200, 6)
    expect(design.body.mass()).toBeCloseTo(200, 6)
    const a = sized.body.principalInertia(), b = design.body.principalInertia()
    for (const k of ['x', 'y', 'z'] as const) expect(a[k]).toBeCloseTo(b[k], 4)
    design.dispose(); sized.dispose(); h.world.free()
  })
})
