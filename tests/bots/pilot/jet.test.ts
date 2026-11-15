/**
 * Jet pilot in hover mode on real Rapier with the real Jet. Every test logs its measurements
 * ("jet pilot:" lines) so a run reports times and errors, not only pass or fail.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { FIXED_DT, initPhysics } from '../../../src/core/physics'
import { Jet } from '../../../src/vehicles/Jet'
import { createJetPilot } from '../../../src/bots/pilot/jet'
import type { DriveGoal, Pilot, PilotStatus } from '../../../src/bots/pilot/types'
import { ridge, surfaceOf, testWorld, type HeightFn, type TestWorld } from './world'

beforeAll(initPhysics)
/** Body origin height when the jet rests on its landing gear; clearance is measured from here. */
const GEAR = 1.3
const report = (name: string, values: Record<string, number | string | boolean>) =>
  console.log(`jet pilot: ${name}: ` + Object.entries(values).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(2) : v}`).join(', '))

interface Flight { w: TestWorld; v: Jet; pilot: Pilot; t: number; status: PilotStatus }
function launch(height: HeightFn, at: THREE.Vector3, heading = 0, size = 800): Flight {
  const w = testWorld(height, size), v = new Jet(w.game, w.terrain, at, heading); v.isLocal = false
  const pilot = createJetPilot(v, w.terrain)
  return { w, v, pilot, t: 0, status: { stuckFor: 0, airborne: false, flipped: false } }
}
const where = (f: Flight) => f.v.body.translation()
const agl = (f: Flight) => { const p = where(f); return p.y - surfaceOf(f.w.terrain, p.x, p.z) }
const up = (f: Flight) => new THREE.Vector3(0, 1, 0).applyQuaternion(f.v.body.rotation())
const distTo = (f: Flight, g: { x: number; z: number }) => { const p = where(f); return Math.hypot(g.x - p.x, g.z - p.z) }
/** Step until `until` is true or `seconds` pass; `each` sees every step. Returns seconds flown. */
function fly(f: Flight, goal: DriveGoal, seconds: number, until?: () => boolean, each?: () => void): number {
  const start = f.t
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    f.status = f.w.step(f.v, f.pilot, goal); f.t += FIXED_DT; each?.()
    if (until?.()) break
  }
  return f.t - start
}

describe('jet pilot, hover mode', () => {
  it('takes off from rest, holds altitude within 3 m over a ridge and keeps clear of the ground', () => {
    const f = launch(ridge(-120, 15, 40), new THREE.Vector3(0, GEAR + .3, 0))
    const goal: DriveGoal = { x: 0, z: -260, speed: 15 }
    // Rest on the gear first: it should report itself on the ground.
    expect(f.status.airborne).toBe(false)
    const takeoff = fly(f, goal, 20, () => agl(f) > 11)
    expect(f.status.airborne).toBe(true)
    let worst = 0, minClear = Infinity, maxTilt = 0, maxGround = 0, speedSum = 0, n = 0
    // Cruise from 15 m before the ridge foot to 60 m past its crest.
    const cruise = fly(f, goal, 60, () => where(f).z < -200, () => {
      const p = where(f)
      if (p.z < -30) { worst = Math.max(worst, Math.abs(agl(f) - 12)); speedSum += Math.hypot(f.v.body.linvel().x, f.v.body.linvel().z); n++ }
      minClear = Math.min(minClear, agl(f) - GEAR)
      maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, up(f).y)) * 180 / Math.PI)
      maxGround = Math.max(maxGround, f.w.terrain.heightAt(p.x, p.z))
    })
    report('ridge', { takeoffTo11m_s: takeoff, cruise_s: cruise, ridgePeak_m: maxGround, worstAltitudeError_m: worst, minClearance_m: minClear, meanSpeed: speedSum / n, maxTilt_deg: maxTilt })
    expect(maxGround).toBeGreaterThan(14)
    expect(worst).toBeLessThan(3)
    expect(minClear).toBeGreaterThan(1)
    expect(speedSum / n).toBeGreaterThan(13)
    expect(f.status.stuckFor).toBe(0)
    f.w.free()
  })

  it('reaches a point 200 m away, then one behind it, facing the way it flies', () => {
    const f = launch(() => 0, new THREE.Vector3(0, GEAR + .3, 0))
    const a = { x: 0, z: -200 }, b = { x: 40, z: 60 }
    const tA = fly(f, { ...a, speed: 15 }, 40, () => distTo(f, a) < 5)
    expect(distTo(f, a)).toBeLessThan(5)
    let minClear = Infinity, misaligned = 0, samples = 0
    const tB = fly(f, { ...b, speed: 15 }, 60, () => distTo(f, b) < 5, () => {
      minClear = Math.min(minClear, agl(f) - GEAR)
      const v = f.v.body.linvel(), s = Math.hypot(v.x, v.z)
      if (s > 10) {
        const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(f.v.body.rotation())
        samples++; if ((fw.x * v.x + fw.z * v.z) / (Math.hypot(fw.x, fw.z) * s) < Math.cos(20 * Math.PI / 180)) misaligned++
      }
    })
    report('two points', { toA_s: tA, toB_s: tB, minClearance_m: minClear, shareOfFastFlightNoseOver20degOffTrack: misaligned / samples })
    expect(distTo(f, b)).toBeLessThan(5)
    expect(tA).toBeLessThan(25); expect(tB).toBeLessThan(35)
    expect(minClear).toBeGreaterThan(1)
    expect(misaligned / samples).toBeLessThan(.15)
    f.w.free()
  })

  it('stops inside the radius and holds there for 10 seconds', () => {
    const f = launch(ridge(-100, 10, 40), new THREE.Vector3(0, GEAR + .3, 0))
    const goal: DriveGoal = { x: 0, z: -200, speed: 15, stopWithin: 4 }
    const arrive = fly(f, goal, 60, () => distTo(f, goal) < 4)
    expect(distTo(f, goal)).toBeLessThan(4)
    let worst = 0, altErr = 0, maxSpeed = 0
    fly(f, goal, 10, undefined, () => {
      worst = Math.max(worst, distTo(f, goal)); altErr = Math.max(altErr, Math.abs(agl(f) - 12))
      maxSpeed = Math.max(maxSpeed, new THREE.Vector3().copy(f.v.body.linvel()).length())
    })
    report('stop and hold', { arrive_s: arrive, worstDistanceIn10s_m: worst, distanceAfter10s_m: distTo(f, goal), worstAltitudeError_m: altErr, maxSpeedWhileHolding: maxSpeed, stuckFor: f.status.stuckFor })
    expect(worst).toBeLessThan(4)
    expect(altErr).toBeLessThan(1.5)
    expect(f.status.stuckFor).toBe(0)
    f.w.free()
  })

  it('honours goal.altitude and treats liquid as the surface', () => {
    // Sea floor 30 m down, water at 0: 8 m above the water, not 8 m above the floor.
    const f = launch(() => -30, new THREE.Vector3(0, 10, 0), 0, 800)
    f.w.terrain.liquidHeightAt = () => 0
    const goal: DriveGoal = { x: 0, z: -120, speed: 12, altitude: 8, stopWithin: 4 }
    fly(f, goal, 30, () => distTo(f, goal) < 4)
    let worst = 0
    fly(f, goal, 5, undefined, () => { worst = Math.max(worst, Math.abs(where(f).y - 8)) })
    report('over water', { worstAltitudeError_m: worst })
    expect(worst).toBeLessThan(1.5)
    f.w.free()
  })

  it('turns round from a 180 degree heading error', () => {
    // Facing +Z (heading pi); the goal is 150 m toward -Z.
    const f = launch(() => 0, new THREE.Vector3(0, 12, 0), Math.PI)
    const goal = { x: 0, z: -150 }
    let turned = NaN
    const t = fly(f, { ...goal, speed: 15 }, 40, () => distTo(f, goal) < 5, () => {
      // Heading only: the nose also leans down while it accelerates.
      const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(f.v.body.rotation())
      if (Number.isNaN(turned) && -fw.z / Math.hypot(fw.x, fw.z) > Math.cos(20 * Math.PI / 180)) turned = f.t
    })
    report('180 degree heading error', { noseWithin20degOfGoal_s: turned, reached_s: t })
    expect(distTo(f, goal)).toBeLessThan(5)
    // Full yaw settles at about 37 degrees a second, so 160 degrees takes at least 4.3 s.
    expect(turned).toBeLessThan(6.5)
    f.w.free()
  })

  it('recovers from a tumble without hitting the ground and reports it was flipped', () => {
    const f = launch(() => 0, new THREE.Vector3(0, 25, 0))
    // Nearly inverted (150 degrees of roll), spinning.
    f.v.body.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, 1, 2.6)), true)
    f.v.body.setAngvel({ x: 1, y: .5, z: -1.5 }, true)
    const goal: DriveGoal = { x: 30, z: -30, speed: 10, stopWithin: 4 }
    fly(f, goal, FIXED_DT)
    expect(f.status.flipped).toBe(true)
    let minClear = Infinity
    const upright = fly(f, goal, 10, () => up(f).y > .95, () => { minClear = Math.min(minClear, agl(f) - GEAR) })
    const arrive = fly(f, goal, 30, () => distTo(f, goal) < 4, () => { minClear = Math.min(minClear, agl(f) - GEAR) })
    report('tumble', { upright_s: upright, thenArrive_s: arrive, minClearance_m: minClear })
    expect(upright).toBeLessThan(3)
    expect(f.status.flipped).toBe(false)
    expect(minClear).toBeGreaterThan(1)
    expect(distTo(f, goal)).toBeLessThan(4)
    f.w.free()
  })

  it('special: forward flight over a ridge is faster than hover and ends in a hover stop', () => {
    const leg = (special: boolean) => {
      const f = launch(ridge(-500, 40, 60), new THREE.Vector3(0, GEAR + .3, 0), 0, 2400)
      const goal: DriveGoal = { x: 300, z: -900, speed: 15, stopWithin: 4, special }
      let flying = 0, minClear = Infinity, flightMin = Infinity
      const t = fly(f, goal, 120, () => distTo(f, goal) < 4 && f.v.body.linvel().y ** 2 + f.v.body.linvel().x ** 2 + f.v.body.linvel().z ** 2 < 1, () => {
        if (f.v.input.special) { flying += FIXED_DT; flightMin = Math.min(flightMin, agl(f)) }
        if (f.t > 3) minClear = Math.min(minClear, agl(f) - GEAR)
      })
      const end = distTo(f, goal); f.w.free()
      return { t, flying, minClear, flightMin, end }
    }
    const hover = leg(false), wings = leg(true)
    report('forward flight 950 m over a 40 m ridge', { hover_s: hover.t, wings_s: wings.t, secondsOnWings: wings.flying, lowestOnWings_m: wings.flightMin, minClearanceAfterTakeoff_m: wings.minClear, endDistance_m: wings.end })
    expect(wings.flying).toBeGreaterThan(15)
    expect(wings.t).toBeLessThan(hover.t * .75)
    expect(wings.flightMin).toBeGreaterThan(12)
    expect(wings.minClear).toBeGreaterThan(5)
    expect(wings.end).toBeLessThan(4)
  }, 30000) // Two long flights; five seconds is not enough on a loaded machine.

  it('special: a sharp change of goal in forward flight turns in hover and flies on', () => {
    const f = launch(() => 0, new THREE.Vector3(0, GEAR + .3, 0), 0, 2400)
    fly(f, { x: 0, z: -1000, speed: 15, special: true }, 20)
    expect(f.v.input.special).toBe(true)
    const goal: DriveGoal = { x: 700, z: -300, speed: 15, stopWithin: 4, special: true }
    let minClear = Infinity, relaunched = NaN, wasHover = false
    const t = fly(f, goal, 90, () => distTo(f, goal) < 4, () => {
      minClear = Math.min(minClear, agl(f) - GEAR)
      if (!f.v.input.special) wasHover = true
      else if (wasHover && Number.isNaN(relaunched)) relaunched = f.t
    })
    report('forward flight sharp turn', { reached_s: t, relaunchedOnWingsAt_s: relaunched, minClearance_m: minClear })
    expect(wasHover).toBe(true)
    expect(relaunched).toBeGreaterThan(0)
    expect(minClear).toBeGreaterThan(8)
    expect(distTo(f, goal)).toBeLessThan(4)
    f.w.free()
  }, 30000) // A long flight; five seconds is not enough on a loaded machine.

  it('writes the same input for the same state and resets cleanly', () => {
    const run = () => {
      const f = launch(() => 0, new THREE.Vector3(0, GEAR + .3, 0))
      fly(f, { x: 20, z: -40, speed: 10 }, 5); const p = where(f), out = [p.x, p.y, p.z, f.v.input.x, f.v.input.y, f.v.input.z, f.v.input.w]
      f.pilot.reset(); expect(f.pilot.drive({ x: 0, z: 0, speed: 0 }, f.v.input, FIXED_DT).stuckFor).toBe(0)
      f.w.free(); return out
    }
    expect(run()).toEqual(run())
  })
})
