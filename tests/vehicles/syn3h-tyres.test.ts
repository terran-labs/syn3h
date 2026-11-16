/**
 * Tyre size (buggy.tyreSize) invariants: at every size the buggy stands on its tyres, drives,
 * steers, stays finite, and a change of size while driving neither flips nor launches it. How it
 * handles at each size is tuned by feel and only reported (tools/handling-report.ts).
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { FIXED_DT, RAPIER } from '../../src/core/physics'
import { REST_HEIGHT } from '../../src/vehicles/Vehicle'
import { axis, cruise, pos, resetParams, spawn, speed } from './syn3hScenarios'
import type { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import type { Bed } from './harness'

const SIZES = [0.6, 1, 2, 3]
const setSize = (k: number) => params.set('buggy.tyreSize', k)

afterEach(resetParams)

/** True when every number the body and the wheels expose is finite. */
function finite(b: Syn3hBuggy): boolean {
  const t = b.body.translation(), r = b.body.rotation(), v = b.body.linvel(), w = b.body.angvel()
  return [t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z, b.motorSpeed, b.wheelRadius, ...b.hitCompress].every(Number.isFinite)
}

/** Whether the hull or skid plate is pressed on anything this step. */
function bodyTouching(bed: Bed, b: Syn3hBuggy): boolean {
  const w = bed.game.world
  let c = false
  for (const col of [b.hull, b.skid]) w.contactPairsWith(col, (o) => w.contactPair(col, o, (m) => { if (m.numSolverContacts() > 0) c = true }))
  return c
}

describe('Syn3hBuggy tyre size', () => {
  for (const k of SIZES) {
    test(`at tyre size ${k} it rests upright on its tyres, neither sunk nor hovering`, async () => {
      setSize(k)
      const { bed, b } = await spawn()
      bed.run(4)
      expect(finite(b)).toBe(true)
      expect(b.tyreSize).toBe(k)
      expect(b.wheelsGrounded).toBe(4)
      expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.999)
      // Each spring is part way through its travel: neither topped out (hovering on a ray that
      // barely reaches) nor bottomed out (the tyre pushed up into the body).
      for (const c of b.hitCompress) {
        expect(c).toBeGreaterThan(0.02)
        expect(c).toBeLessThan(0.9)
      }
      // The body stands as much higher than the standard stance as the tyres are bigger.
      const extra = b.wheelRadius - 0.5
      expect(Math.abs(pos(b).y - (REST_HEIGHT.buggy + extra))).toBeLessThan(0.1 * b.wheelRadius)
      expect(bodyTouching(bed, b)).toBe(false)
    })

    test(`at tyre size ${k} it accelerates and steers`, async () => {
      setSize(k)
      const { bed, b } = await spawn()
      bed.run(1)
      b.input.y = 1
      bed.run(3)
      expect(speed(b)).toBeGreaterThan(5)
      // Half lock: big tyres raise the centre of gravity, and whether full lock rolls the buggy
      // is handling (reported), not a bug.
      const course = () => Math.atan2(b.body.linvel().x, -b.body.linvel().z)
      const c0 = course()
      b.input.x = 0.5
      let ok = true
      bed.run(1, () => { ok &&= finite(b) })
      expect(ok).toBe(true)
      expect(Math.abs(course() - c0) * THREE.MathUtils.RAD2DEG).toBeGreaterThan(5)
    })
  }

  for (const [from, to] of [[1, 3], [3, 0.6], [0.6, 2]]) {
    test(`changing tyre size ${from} to ${to} at 30 m/s does not flip or launch it`, async () => {
      setSize(from)
      const { bed, b } = await cruise(30)
      setSize(to)
      let upright = 1, climb = 0, ok = true
      bed.run(3, () => {
        upright = Math.min(upright, axis(b, 0, 1, 0).y)
        climb = Math.max(climb, b.body.linvel().y)
        ok &&= finite(b)
      })
      expect(ok).toBe(true)
      expect(b.tyreSize).toBe(to)
      expect(upright).toBeGreaterThan(0.9)
      // The lift is a move of the body, not a push: it never gains a jump's worth of upward speed.
      expect(climb).toBeLessThan(2)
      expect(b.wheelsGrounded).toBe(4)
      expect(pos(b).y).toBeLessThan(REST_HEIGHT.buggy + b.wheelRadius)
    })
  }

  test('a distant remote copy takes the same tyre size', async () => {
    const { bed, b } = await spawn()
    bed.run(2)
    const at = b.body.translation()
    b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
    setSize(2.5)
    let t = 0
    bed.run(2, () => {
      t += FIXED_DT
      b.body.setNextKinematicTranslation({ x: at.x, y: at.y + 1, z: at.z - 10 * t })
    })
    expect(b.tyreSize).toBe(2.5)
    expect(b.wheelRadius).toBeCloseTo(1.25, 6)
    expect(finite(b)).toBe(true)
  })
})
