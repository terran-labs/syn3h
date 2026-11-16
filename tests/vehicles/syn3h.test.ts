/**
 * Invariant tests for the Syn3h buggy: what a player would call a bug if it broke. Directions are
 * strict: forward is local -Z, positive yaw is a left turn, pitch and roll are checked by where
 * the nose and the right side point.
 *
 * Handling the owner tunes by feel (speeds, braking g, turn rates, hop heights, slide and recovery
 * times, wing swing times) is not pinned here. It is measured by tools/handling-report.ts from the
 * same scenarios (./syn3hScenarios.ts). Distances below are "it moved", not "it moved this far".
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { createVehicle } from '../../src/vehicles'
import { buggyIdleHold, buggyNextGen, buggyRegen } from '../../src/vehicles/buggyParams'
import { waterSinking } from '../../src/vehicles/buoyancy'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../../src/core/physics'
import { type Bed, makeBed } from './harness'
import {
  G, axis, bump, cruise, deploy, drop, flying, kick, lavaEscape, lavaPool, pitchedGlide, planted, pos, resetParams,
  sideways, slope, spawn, speed,
} from './syn3hScenarios'

/** Skid plate bottom, in body coordinates. */
const SKID_BOTTOM = -0.085

afterEach(resetParams)

describe('Syn3hBuggy', () => {
  test('is the default kind, with the prefab mass and the Syn3h centre of mass', async () => {
    const bed = await makeBed()
    for (const kind of ['buggy', 'buggy-syn3h'] as const) {
      const v = createVehicle(bed.game, bed.terrain, kind, new THREE.Vector3(0, 2, 0))
      expect(v).toBeInstanceOf(Syn3hBuggy)
      expect(v.kind).toBe(kind)
      expect(v.body.mass()).toBeCloseTo(30, 3)
      expect(v.body.localCom().z).toBeCloseTo(-0.2, 4)
    }
  })

  test('sits level on four wheels and parks itself at rest', async () => {
    const { bed, b } = await spawn()
    bed.run(4)
    expect(b.wheelsGrounded).toBe(4)
    expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.999)
    // Next-gen parks on the drivetrain hold, not the brakes.
    expect(b.brakes).toBe(false)
    expect(b.drive).toBe('hold')
    const p0 = pos(b)
    bed.run(2)
    // No creep along the ground. The body is still rising a millimetre a second while the
    // smart suspension finishes extending to its rest length.
    const v = b.body.linvel()
    expect(Math.hypot(v.x, v.z)).toBeLessThan(1e-3)
    expect(Math.abs(v.y)).toBeLessThan(3e-3)
    expect(pos(b).distanceTo(p0)).toBeLessThan(0.01)
    // The body is on its suspension, not the ground.
    expect(p0.y + SKID_BOTTOM).toBeGreaterThan(0.05)
  })

  test('classic parks on its auto brake (VhiclMe)', async () => {
    params.set(buggyNextGen.def.id, false)
    const { bed, b } = await spawn()
    bed.run(4)
    expect(b.brakes).toBe(true)
  })

  test('with idle hold off it rolls freely like the original', async () => {
    params.set(buggyIdleHold.def.id, false)
    const { bed, b } = await spawn()
    bed.run(6)
    expect(b.brakes).toBe(false)
    // Forward centre of mass tilts the nose down and the suspension pushes it forward.
    expect(b.body.linvel().z).toBeLessThan(0)
  })

  test.each([0, Math.PI / 2, -2.5])('throttle drives toward local -Z (heading %f)', async (heading) => {
    const { bed, b } = await spawn(heading)
    bed.run(1)
    const p0 = pos(b)
    const fwd = axis(b, 0, 0, -1)
    b.input.y = 1
    bed.run(3)
    const d = pos(b).sub(p0)
    const along = d.dot(fwd)
    expect(along).toBeGreaterThan(1)
    expect(d.clone().addScaledVector(fwd, -along).setY(0).length()).toBeLessThan(along * 0.1)
    expect(b.brakes).toBe(false)
  })

  test('reverse drives toward local +Z', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    const z0 = pos(b).z
    b.input.y = -1
    bed.run(2)
    expect(pos(b).z - z0).toBeGreaterThan(0.5)
  })

  test.each([
    [-1, 'left', 1],
    [1, 'right', -1],
  ])('input.x %i turns %s', async (x, _name, sign) => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    bed.run(1)
    b.input.x = x
    bed.run(0.5)
    expect(Math.sign(b.body.angvel().y)).toBe(sign)
    expect(Math.sign(b.steer[0])).toBe(sign)
    expect(Math.sign(b.steer[2])).toBe(-sign)
    bed.run(0.5)
    expect(Math.sign(axis(b, 0, 0, -1).x)).toBe(-sign)
  })

  test('classic brakes freeze it from speed (drag states, VB 498-515)', async () => {
    params.set(buggyNextGen.def.id, false)
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    bed.run(3)
    expect(speed(b)).toBeGreaterThan(5)
    b.input.y = 0
    b.input.brakes = true
    bed.run(3)
    expect(speed(b)).toBeLessThan(0.01)
  })

  test('next-gen brakes stop it from speed, then it holds', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    bed.run(3)
    expect(speed(b)).toBeGreaterThan(5)
    b.input.y = 0
    b.input.brakes = true
    bed.run(5)
    expect(speed(b)).toBeLessThan(0.5)
    const p0 = pos(b)
    bed.run(1)
    expect(pos(b).distanceTo(p0)).toBeLessThan(0.05)
  })

  test('next-gen parks on a 25 degree slope with no keys pressed', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    // Drivetrain hold and the tyres' static friction, no brakes and no drag freeze.
    slope(bed, 25)
    bed.run(0.5)
    const z0 = pos(b).z
    bed.run(3)
    expect(Math.abs(pos(b).z - z0)).toBeLessThan(0.05)
    expect(b.brakes).toBe(false)
  })

  test('next-gen coasts off throttle at speed instead of holding or braking', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    bed.run(3)
    const v0 = speed(b)
    b.input.y = 0
    bed.run(2)
    expect(b.drive).toBe('coast')
    expect(speed(b)).toBeGreaterThan(v0 / 2)
  })

  test('next-gen reverse key regenerates at the regen setting to a stop, then reverses', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    while (speed(b) < 20) bed.run(0.02)
    b.input.y = -1
    bed.run(0.5)
    expect(b.drive).toBe('regen')
    const v0 = -b.body.linvel().z
    bed.run(1)
    const decel = v0 - -b.body.linvel().z
    // The slider is in g at full key: what it says is what the player gets, within rolling losses.
    const regen = buggyRegen.value * G
    expect(decel).toBeGreaterThan(regen * 0.8)
    expect(decel).toBeLessThan(regen * 1.35)
    bed.run(4)
    expect(b.drive).toBe('drive')
    expect(b.body.linvel().z).toBeGreaterThan(0)
  })

  test('next-gen runs straight under full throttle (no sideways pull)', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    bed.run(6)
    const p = pos(b)
    expect(-p.z).toBeGreaterThan(10)
    expect(Math.abs(p.x)).toBeLessThan(-p.z * 0.02)
  })

  test.each([[false, false], [true, false], [false, true]])('after a bump at speed it ends up back on its wheels (planted %s, one sided %s)', async (isPlanted, oneSided) => {
    if (isPlanted) planted()
    // Whether it lands upright depends on the tail fin, which is tuned; that it does not stay
    // on its roof is the invariant (it rights itself). Landing is in the handling report.
    const r = await bump(oneSided, 0.4, 14)
    expect(r.upright).toBeGreaterThan(0.9)
  })

  test('thrown broadside at speed, next-gen stays upright', async () => {
    expect((await sideways()).upright).toBeGreaterThan(0.9)
  })

  test.each([false, true])('next-gen lands a 4 m drop at 30 m/s on its wheels (planted settings %s)', async (isPlanted) => {
    if (isPlanted) planted()
    const r = await drop()
    expect(r.wheels).toBe(4)
    expect(r.upright).toBeGreaterThan(0.95)
  })

  /**
   * Flat triangle mesh ground at height y, like the game terrain. Rapier reports contacts with
   * a mesh differently from a box, which once hid them from the self righting check.
   */
  const meshGround = (bed: Bed, y: number) => {
    const n = 40, size = 400
    const v: number[] = [], idx: number[] = []
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) v.push((i / n - 0.5) * size, y, (j / n - 0.5) * size)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = i * (n + 1) + j, c = a + n + 1
        idx.push(a, a + 1, c, a + 1, c + 1, c)
      }
    }
    bed.game.world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(v), new Uint32Array(idx)).setFriction(1).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)),
    )
  }
  const onMesh = async () => {
    const bed = await makeBed()
    meshGround(bed, 50)
    const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, 51.5, 0), 0))
    b.isLocal = false
    bed.run(3)
    return { bed, b }
  }
  const planar = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)

  test.each([true, false])('drives off after a teleport from its roof on mesh ground (next-gen %s)', async (nextGen) => {
    params.set(buggyNextGen.def.id, nextGen)
    const { bed, b } = await onMesh()
    // On its roof with the throttle held, as a bot that keeps trying.
    b.input.y = 1
    b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI), true)
    b.body.setTranslation({ x: 0, y: 51.5, z: 0 }, true)
    bed.run(0.5)
    expect(b.isInverted).toBe(true)
    b.teleport(new THREE.Vector3(20, 51.2, 20), 1)
    expect(b.isInverted).toBe(false)
    expect(b.motorSpeed).toBe(0)
    const p0 = pos(b)
    bed.run(4)
    expect(b.isInverted).toBe(false)
    expect(planar(pos(b), p0)).toBeGreaterThan(1)
  })

  test('a wrongly set inverted flag clears on mesh ground instead of stranding it on its skid plate', async () => {
    const { bed, b } = await onMesh()
    b.isInverted = true
    bed.run(1.5)
    expect(b.isInverted).toBe(false)
    // Back up on its suspension, the skid plate clear of the ground.
    expect(pos(b).y - 50 + SKID_BOTTOM).toBeGreaterThan(0.05)
    const p0 = pos(b)
    b.input.y = 1
    bed.run(3)
    expect(planar(pos(b), p0)).toBeGreaterThan(1)
  })

  test('rights itself from upside down on mesh ground', async () => {
    const { bed, b } = await onMesh()
    b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * 0.9), true)
    b.body.setTranslation({ x: 0, y: 52, z: 0 }, true)
    bed.run(0.5)
    expect(b.isInverted).toBe(true)
    bed.run(3)
    expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.95)
    expect(b.isInverted).toBe(false)
  })

  test.each(['drive', 'regen', 'coast', 'hold', 'wings'])('teleport while in %s returns it to a just spawned state', async (state) => {
    const { bed, b } = await onMesh()
    b.input.y = 1
    bed.run(3)
    if (state === 'regen') b.input.y = -1
    if (state === 'coast') b.input.y = 0
    if (state === 'hold') { b.input.y = 0; b.input.brakes = true; bed.run(3); b.input.brakes = false }
    if (state === 'wings') b.input.special = true
    bed.run(0.5)
    if (state !== 'wings') expect(b.drive).toBe(state)
    b.input.y = 0
    b.input.special = false
    b.teleport(new THREE.Vector3(-30, 51.2, 30), 2)
    expect(b.motorSpeed).toBe(0)
    expect(b.wingsOpen).toBe(false)
    expect(b.suspensionRange).toBeCloseTo(0.4, 5)
    bed.run(2)
    // Parked where it landed, on its wheels.
    expect(b.wheelsGrounded).toBe(4)
    expect(planar(pos(b), new THREE.Vector3(-30, 0, 30))).toBeLessThan(0.3)
    expect(pos(b).y - 50 + SKID_BOTTOM).toBeGreaterThan(0.05)
    const p0 = pos(b)
    b.input.y = 1
    bed.run(3)
    expect(planar(pos(b), p0)).toBeGreaterThan(1)
  })

  test('crawls out of shallow lava under power and drives away', async () => {
    const { seconds, bed, b } = await lavaEscape(0.6)
    expect(seconds).toBeLessThan(Infinity)
    bed.run(3)
    expect(speed(b)).toBeGreaterThan(1)
  })

  test('the hold does not pin it in deeper lava: it crawls whenever the throttle is pressed', async () => {
    const { bed, b } = await lavaPool(1)
    expect(b.lavaDepth).toBeGreaterThan(0)
    expect(b.stuck).toBe(true)
    expect(b.drive).toBe('hold')
    for (let i = 0; i < 2; i++) {
      const z0 = pos(b).z
      b.input.y = 1
      bed.run(5)
      expect(z0 - pos(b).z).toBeGreaterThan(0.2)
      b.input.y = 0
      bed.run(3)
      expect(speed(b)).toBeLessThan(0.05)
    }
  })

  test('the motor does not spin up unloaded while floating in deep lava', async () => {
    const { bed, b } = await lavaPool(2)
    expect(b.wheelsGrounded).toBe(0)
    b.input.y = 1
    let motorMax = 0
    bed.run(20, () => { motorMax = Math.max(motorMax, Math.abs(b.motorSpeed)) })
    // A runaway motor races far past any speed the buggy reaches on land.
    expect(motorMax).toBeLessThan(15)
    expect(-pos(b).z).toBeGreaterThan(0.5)
  })

  test('the motor stays near the body speed with legacy water paddling', async () => {
    // Paddling belongs to the retained float controller, bypassed by sinking physics.
    params.set(waterSinking.def.id, false)
    const bed = await makeBed()
    bed.terrain.liquidHeightAt = () => 4
    bed.terrain.liquidKindAt = () => 'water'
    const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, 5, 0), 0))
    b.isLocal = false
    bed.run(3)
    expect(b.inLiquid).toBe(true)
    b.input.y = 1
    let motorMax = 0
    bed.run(10, () => { motorMax = Math.max(motorMax, Math.abs(b.motorSpeed)) })
    // Paddling still works, and the wheels are not racing when they reach a beach.
    expect(-pos(b).z).toBeGreaterThan(1)
    // Unloaded it used to reach 114 m/s.
    expect(motorMax).toBeLessThan(40)
  })

  test('a vehicle landing on its roof side does not flag an upright buggy as inverted', async () => {
    const { bed, b } = await onMesh()
    const top = bed.add(new Syn3hBuggy(bed.game, bed.terrain, pos(b).add(new THREE.Vector3(0.4, 1.6, 0.3)), 0.5))
    top.isLocal = false
    let flagged = 0, touched = false
    const w = bed.game.world
    bed.run(3, () => {
      if (b.isInverted) flagged++
      w.contactPair(b.hull, top.hull, () => { touched = true })
      w.contactPair(b.hull, top.skid, () => { touched = true })
    })
    expect(touched).toBe(true)
    expect(flagged).toBe(0)
    // Still on its suspension under the load, and able to drive out from under it.
    expect(b.wheelsGrounded).toBe(4)
    const p0 = pos(b)
    b.input.y = 1
    bed.run(3)
    expect(planar(pos(b), p0)).toBeGreaterThan(1)
  })

  test.each([25, 45])('next-gen stays upright at full lock at %i m/s', async (v) => {
    const { bed, b } = await cruise(v)
    b.input.x = 1
    bed.run(2)
    expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.9)
  })

  test.each([30, 40])('next-gen never winds its wheels backward climbing a %i degree slope under throttle', async (deg) => {
    const { bed, b } = await spawn()
    bed.run(1)
    slope(bed, deg)
    b.input.y = 1
    let motorMin = Infinity
    bed.run(4, () => { motorMin = Math.min(motorMin, b.motorSpeed) })
    expect(motorMin).toBeGreaterThan(0)
  })

  test('next-gen wheels keep spinning forward when it rolls back down a hill under throttle', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    // Already rolling backward at 6 m/s on a 30 degree slope when the driver floors it.
    slope(bed, 30)
    b.body.setLinvel({ x: 0, y: 0, z: 6 }, true)
    b.input.y = 1
    let motorMin = Infinity, t = 0
    bed.run(4, () => { t += 0.02; if (t > 0.3) motorMin = Math.min(motorMin, b.motorSpeed) })
    expect(b.drive).toBe('drive')
    expect(motorMin).toBeGreaterThan(0)
  })

  test('next-gen spins its wheels forward on a slope too steep to grip', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    slope(bed, 62)
    b.input.y = 1
    let motorMin = Infinity, t = 0
    bed.run(3, () => { t += 0.02; if (t > 0.3) motorMin = Math.min(motorMin, b.motorSpeed) })
    // Sliding back, but never with the wheels wound backward.
    expect(b.body.linvel().z).toBeGreaterThan(0)
    expect(motorMin).toBeGreaterThan(0)
  })

  test('wheel rays ignore other vehicles', async () => {
    const { bed, b } = await spawn()
    bed.run(3)
    const top = bed.add(new Syn3hBuggy(bed.game, bed.terrain, pos(b).add(new THREE.Vector3(0, 1.0, 0))))
    top.isLocal = false
    top.suspensionRange = 0.4
    bed.run(0.02)
    expect(top.hitDistance).toEqual([-1, -1, -1, -1])
  })

  test('rights itself from upside down', async () => {
    const { bed, b } = await spawn(0, 2)
    b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * 0.9), true)
    bed.run(0.5)
    expect(b.isInverted).toBe(true)
    bed.run(3)
    expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.95)
    expect(b.isInverted).toBe(false)
    expect(b.wheelsGrounded).toBe(4)
  })

  test('wings open on the special key, report wingsOpen, and close when it is let go', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.special = true
    bed.run(0.1)
    expect(b.wingsOpen).toBe(true)
    expect(b.wingState).toBeGreaterThan(0)
    bed.run(1)
    expect(b.wingState).toBe(1)
    b.input.special = false
    bed.run(1)
    expect(b.wingState).toBe(0)
    expect(b.wingsOpen).toBe(false)
  })

  test('flies with wings open at speed, its velocity along the nose', async () => {
    const { bed, b } = await flying()
    bed.run(3)
    expect(speed(b)).toBeGreaterThan(1)
    expect(axis(b, 0, 0, -1).dot(b.body.linvel() as THREE.Vector3) / speed(b)).toBeGreaterThan(0.9)
  })

  test.each([
    [1, 'pushes the nose down', -1],
    [-1, 'pulls the nose up', 1],
  ])('in flight input.y %i %s', async (y, _name, sign) => {
    const { bed, b } = await flying()
    bed.run(0.2)
    const before = axis(b, 0, 0, -1).y
    b.input.y = y
    bed.run(0.6)
    expect(Math.sign(axis(b, 0, 0, -1).y - before)).toBe(sign)
    expect(Math.abs(axis(b, 0, 0, -1).y - before)).toBeGreaterThan(0.01)
  })

  test.each([
    [1, 'right', -1],
    [-1, 'left', 1],
  ])('in flight input.x %i rolls %s', async (x, _name, sign) => {
    const { bed, b } = await flying()
    bed.run(0.2)
    b.input.x = x
    bed.run(0.4)
    // Rolling right drops the right side: local +X points down.
    expect(Math.sign(axis(b, 1, 0, 0).y)).toBe(sign)
    expect(Math.abs(axis(b, 1, 0, 0).y)).toBeGreaterThan(0.02)
  })

  test('stalls nose down when too slow', async () => {
    const { bed, b } = await flying(80, 2)
    bed.run(0.6)
    expect(axis(b, 0, 0, -1).y).toBeLessThan(0)
    expect(b.body.linvel().y).toBeLessThan(0)
  })

  test('glides down and lands on its wheels', async () => {
    const { bed, b } = await flying(25, 30)
    bed.run(4)
    b.input.special = false
    bed.run(6)
    expect(b.wingsOpen).toBe(false)
    expect(b.wheelsGrounded).toBe(4)
    expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.95)
  })

  test('is deterministic', async () => {
    const run = async () => {
      const { bed, b } = await spawn(0.3)
      b.input.y = 1
      bed.run(2)
      b.input.x = -0.6
      bed.run(2)
      b.input.special = true
      bed.run(1)
      return b.getState()
    }
    expect(await run()).toEqual(await run())
  })
})

/**
 * A slide at speed must be catchable. The buggy is yawed off its direction of travel at speed
 * and the driver holds full counter-steer (toward the travel direction) or lets go. Before 15
 * November 2026 holding counter-steer held the slide: the steering limit is measured from the
 * body, so the front wheels could not reach the direction of travel. How fast it recovers is in
 * the handling report; here it only has to recover, upright, within the five second window.
 */
describe('Syn3hBuggy slide recovery', () => {
  test.each([[30, 40], [45, 40], [60, 5], [45, 90]])('at %i m/s a %i degree slide is caught with full counter-steer held', async (v, angle) => {
    const r = await kick(v, angle, true)
    expect(r.recovered).toBeLessThan(Infinity)
    expect(r.upright).toBeGreaterThan(0.9)
  })

  test.each([[30, 40], [45, 90], [60, 70]])('at %i m/s a %i degree slide straightens with the steering let go', async (v, angle) => {
    const r = await kick(v, angle, false)
    expect(r.recovered).toBeLessThan(Infinity)
    expect(r.upright).toBeGreaterThan(0.9)
  })
})

/**
 * Opening the wings while moving across the nose. The buggy is in the air, nose toward -Z,
 * moving at 30 m/s toward +X (fully sideways), and the wings open. Each model's rule is checked;
 * how long the swing takes is in the handling report.
 */
describe('Syn3hBuggy wing flight models', () => {
  // Each model's own rule. Stall blending, when on, replaces the model while the motion is more
  // than 10 degrees off the nose, so it is off here.
  beforeEach(() => params.set('buggy.flightSlip', false))
  test('Classic points the speed down the nose at once', async () => {
    const r = await deploy(0, 0.1)
    expect(r.off).toBeLessThan(2)
    expect(r.speed).toBeGreaterThan(15)
  })

  test.each([[1, 'Catch'], [2, 'Glide']])('model %i (%s) swings the motion round to the nose gradually', async (model) => {
    const early = await deploy(model, 0.3)
    const late = await deploy(model, 2.5)
    // Not at once, as Classic does, but it gets there.
    expect(early.off).toBeGreaterThan(10)
    expect(late.off).toBeLessThan(early.off)
    expect(late.off).toBeLessThan(10)
  })

  test('Glide loses speed in a climb and gains it in a dive; Classic does neither', async () => {
    const up = await pitchedGlide(2, 0.5), down = await pitchedGlide(2, -0.5)
    expect(up.climb).toBeGreaterThan(0)
    expect(down.climb).toBeLessThan(0)
    expect(up.speed).toBeLessThan(down.speed)
    const classicUp = await pitchedGlide(0, 0.5), classicDown = await pitchedGlide(0, -0.5)
    expect(Math.abs(classicUp.speed - classicDown.speed)).toBeLessThan(Math.abs(up.speed - down.speed))
  })
})
