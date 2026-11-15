import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { buildItMarkerGeometry, PART_BEAM, PART_GEM, PART_HALO } from '../../src/net/ItMarker'
import {
  itMarkerTarget, itMarkerVisible, localMarkerLift,
  LOCAL_LIFT_MAX, LOCAL_LIFT_MIN, LOCAL_MIN_CAMERA_DISTANCE, LOCAL_SCREEN_FRACTION,
} from '../../src/net/itMarkerRules'

const me = { name: 'me' }, them = { name: 'them' }
const vehicles = new Map<number, typeof me>([[1, me], [2, them]])
const vehicleOf = (id: number) => vehicles.get(id)

describe('it marker visibility', () => {
  it('shows over the local player when they are it, seen from the chase camera', () => {
    const target = itMarkerTarget(true, 1, vehicleOf)
    expect(target).toBe(me)
    expect(itMarkerVisible(target, me, 9.4)).toBe(true)
  })
  it('hides the local marker when the camera is inside the car (first person)', () => {
    expect(itMarkerVisible(me, me, 0)).toBe(false)
    expect(itMarkerVisible(me, me, LOCAL_MIN_CAMERA_DISTANCE - 0.01)).toBe(false)
  })
  it('shows over a remote player who is it, near or far', () => {
    const target = itMarkerTarget(true, 2, vehicleOf)
    expect(target).toBe(them)
    expect(itMarkerVisible(target, me, 0)).toBe(true)
    expect(itMarkerVisible(target, me, 5000)).toBe(true)
  })
  it('shows nothing when nobody is it, or it is someone we have no vehicle for', () => {
    expect(itMarkerTarget(true, 0, vehicleOf)).toBeNull()
    expect(itMarkerTarget(true, 99, vehicleOf)).toBeNull()
    expect(itMarkerVisible(null, me, 9)).toBe(false)
  })
  it('shows nothing in a mode without tag (king of the hill)', () => {
    expect(itMarkerTarget(false, 1, vehicleOf)).toBeNull()
    expect(itMarkerTarget(false, 2, vehicleOf)).toBeNull()
  })
})

describe('local marker placement', () => {
  // Default chase camera: 3 m clearance plus 6.25 m arm, raised by 0.15 of that.
  const arm = 3 + 6.25, rise = arm * 0.15

  it('sits the set fraction of the half field of view above the camera horizon', () => {
    const lift = localMarkerLift(arm, rise, 80)
    const angle = Math.atan2(lift - rise, arm)
    expect(angle).toBeCloseTo((40 * Math.PI / 180) * LOCAL_SCREEN_FRACTION, 6)
    // Clear of the car (about 1.5 m tall) and well inside the top of the view.
    expect(lift).toBeGreaterThan(4)
    const ndcY = Math.tan(angle) / Math.tan(40 * Math.PI / 180)
    expect(ndcY).toBeGreaterThan(0.3)
    expect(ndcY).toBeLessThan(0.6)
  })
  it('never floats lower than a remote marker nor higher than the cap', () => {
    expect(localMarkerLift(0, 0.95, 80)).toBe(LOCAL_LIFT_MIN)
    expect(localMarkerLift(500, 50, 80)).toBe(LOCAL_LIFT_MAX)
    expect(localMarkerLift(Number.NaN, 1, 80)).toBe(LOCAL_LIFT_MIN)
  })
  it('rises with camera distance and a wider field of view', () => {
    expect(localMarkerLift(12, rise, 80)).toBeGreaterThan(localMarkerLift(9, rise, 80))
    expect(localMarkerLift(9, rise, 100)).toBeGreaterThan(localMarkerLift(9, rise, 60))
  })
})

describe('it marker geometry', () => {
  const g = buildItMarkerGeometry()
  const part = g.getAttribute('itPart'), pos = g.getAttribute('position'), nor = g.getAttribute('normal'), mark = g.getAttribute('itMark')

  it('is one non-indexed buffer holding gem, halo and beam, gem first', () => {
    expect(g.index).toBeNull()
    expect(pos.count % 3).toBe(0)
    const ids = new Set<number>()
    for (let i = 0; i < part.count; i++) ids.add(part.getX(i))
    expect([...ids]).toEqual([PART_GEM, PART_HALO, PART_BEAM])
    expect(g.groups.length).toBe(0) // one material, one draw
  })
  it('winds every triangle so its front face points along its normal', () => {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3()
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2)
      n.fromBufferAttribute(nor, i).add(c.clone().fromBufferAttribute(nor, i + 1)).add(c.clone().fromBufferAttribute(nor, i + 2))
      const face = b.clone().sub(a).cross(c.clone().sub(a))
      expect(face.dot(n)).toBeGreaterThan(0)
    }
  })
  it('runs the beam from 0 at its foot to 1 at the top', () => {
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < part.count; i++) if (part.getX(i) === PART_BEAM) { lo = Math.min(lo, mark.getY(i)); hi = Math.max(hi, mark.getY(i)) }
    expect([lo, hi]).toEqual([0, 1])
  })
})
