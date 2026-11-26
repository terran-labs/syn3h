/**
 * Wingtip trails (effects/index.ts, effects/RibbonBatch.ts `trail`). Each test names the bug
 * it catches.
 */
import { describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { RibbonBatch } from '../../src/vehicles/effects/RibbonBatch'
import { NextJet } from '../../src/vehicles/jetgen/NextJet'
import { MK2_FITTINGS, SHIPPED_JET } from '../../src/vehicles/jetgen/shipped'

const facing = (capacity: number) => new RibbonBatch(capacity, undefined, true, 1, { facing: true, keepLive: true })
const read = (r: RibbonBatch) => Array.from(r.mesh.geometry.attributes.position.array as Float32Array)

describe('wingtip trails', () => {
  // Bug: with more vehicles trailing than the ring holds, new quads took over visible ones and
  // pieces of trail blinked out of the middle of the sky.
  it('never overwrites a visible trail quad; a full ring refuses until one expires', () => {
    const r = facing(4), c = new T.Color(1, 1, 1)
    for (let i = 0; i < 4; i++) expect(r.trail(new T.Vector3(i, 0, 0), 0, .2, new T.Vector3(i, 0, 1), .2, .1, .8, c)).toBeGreaterThanOrEqual(0)
    const before = read(r)
    expect(r.trail(new T.Vector3(9, 0, 0), 0, .2, new T.Vector3(9, 0, 1), .2, .1, .8, c)).toBe(-1)
    expect(read(r)).toEqual(before)
    expect(r.used).toBe(4); expect(r.refused).toBe(1)
    // Once the oldest has faded out, the ring takes new quads again.
    r.clock.value = 1; r.expire()
    expect(r.trail(new T.Vector3(9, 0, 0), 1, .2, new T.Vector3(9, 0, 1), .2, .1, .8, c)).toBeGreaterThanOrEqual(0)
    r.dispose()
  })

  // Bug: the trail's head jumped forward a whole segment at each emission. The newest quad is
  // stretched in place every frame, in its own slot, from its laid end to the tip.
  it('stretches the newest quad in place, keeping its laid end and birth', () => {
    const r = facing(8), c = new T.Color(1, 1, 1), a = new T.Vector3(0, 0, 0)
    const id = r.trail(a, 0, .1, new T.Vector3(0, 0, -1), .2, .1, .8, c)
    r.clock.value = .02
    expect(r.trail(a, 0, .1, new T.Vector3(0, 0, -2), .2, .1, .8, c, id)).toBe(id)
    expect(r.used).toBe(1)
    const p = r.mesh.geometry.attributes.position, d = r.mesh.geometry.attributes.fxAge
    expect([p.getZ(0), p.getZ(2)]).toEqual([0, -2])
    expect([d.getX(0), d.getX(2)].map((x) => +x.toFixed(3))).toEqual([0, .02])
    r.dispose()
  })

  // Bug: a trail facing the camera only when laid turned edge-on, or flipped, as the chase
  // camera moved. Facing trails store the centre line and their axis; the width is the
  // shader's, toward this frame's camera.
  it('stores the centre line and the axis, not a width fixed when laid', () => {
    const r = facing(2), c = new T.Color(1, 1, 1)
    r.trail(new T.Vector3(1, 2, 3), 0, .2, new T.Vector3(1, 2, 5), .2, .4, .8, c)
    const p = r.mesh.geometry.attributes.position, s = r.mesh.geometry.attributes.fxSide
    expect([p.getX(0), p.getX(1)]).toEqual([1, 1])
    expect([s.getX(0), s.getY(0), s.getZ(0)]).toEqual([0, 0, 1])
    expect([s.getW(0), s.getW(1)].map((x) => +x.toFixed(3))).toEqual([.2, -.2])
    r.dispose()
  })

  // Bug: the jet's trail came from the old prefab's tip (3.85, .13, 1.14), off the Mk2's wing.
  it('starts at the true wingtip: the trailing corner of each drooped tip plate', () => {
    const jet = new NextJet(SHIPPED_JET, .6); jet.setGear(0); jet.object.updateMatrixWorld(true)
    const v = new T.Vector3(), outer: T.Vector3[] = []
    let maxX = -Infinity
    jet.object.traverse((o) => {
      const m = o as T.Mesh
      if (!m.isMesh || !m.visible) return
      const p = m.geometry.attributes.position
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); if (v.x > 3) outer.push(v.clone()); maxX = Math.max(maxX, v.x) }
    })
    const tip = outer.filter((p) => p.x > maxX - .06).reduce((a, p) => (p.z > a.z ? p : a))
    const [left, right] = MK2_FITTINGS.wingTips
    expect(new T.Vector3(right.x, right.y, right.z).distanceTo(tip)).toBeLessThan(.02)
    expect([left.x, left.y, left.z]).toEqual([-right.x, right.y, right.z])
    jet.dispose()
  })
})
