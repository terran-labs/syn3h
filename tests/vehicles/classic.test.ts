/**
 * Headless tests for the Buggy port. These guard the handedness conversion: forward is local
 * -Z, positive yaw is a left turn, so every direction is asserted with its sign.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { GROUP_ALL, GROUP_VEHICLE, RAPIER, groups } from '../../src/core/physics'
import { ClassicBuggy as Buggy } from '../../src/vehicles/ClassicBuggy'
import { buggySmartSuspension, buggySpeed } from '../../src/vehicles/buggyParams'
import { createVehicle } from '../../src/vehicles'
import { type Bed, makeBed } from './harness'

const speed = (b: Buggy) => {
  const v = b.body.linvel()
  return Math.hypot(v.x, v.y, v.z)
}
const rot = (b: Buggy) => {
  const r = b.body.rotation()
  return new THREE.Quaternion(r.x, r.y, r.z, r.w)
}
const forwardOf = (b: Buggy) => new THREE.Vector3(0, 0, -1).applyQuaternion(rot(b))
const upOf = (b: Buggy) => new THREE.Vector3(0, 1, 0).applyQuaternion(rot(b))
const pos = (b: Buggy) => {
  const t = b.body.translation()
  return new THREE.Vector3(t.x, t.y, t.z)
}

async function spawn(heading = 0, y = 1): Promise<{ bed: Bed; b: Buggy }> {
  const bed = await makeBed()
  const b = bed.add(new Buggy(bed.game, bed.terrain, new THREE.Vector3(0, y, 0), heading))
  b.isLocal = false
  return { bed, b }
}

afterEach(() => {
  for (const p of params.all()) params.set(p.def.id, p.def.default)
})

describe('ClassicBuggy', () => {
  test('factory returns a Buggy with the original mass and centre of mass', async () => {
    const bed = await makeBed()
    const v = createVehicle(bed.game, bed.terrain, 'buggy-classic', new THREE.Vector3(0, 1, 0))
    expect(v).toBeInstanceOf(Buggy)
    expect(v.body.mass()).toBeCloseTo(30, 3)
    // Unity centerOfMass.z = +0.2 is forward, so ours is -0.2.
    expect(v.body.localCom().z).toBeCloseTo(-0.2, 4)
  })

  test('settles on flat ground without sinking or jitter', async () => {
    const { bed, b } = await spawn()
    bed.run(3)
    const ys: number[] = []
    let maxVy = 0
    let maxW = 0
    bed.run(1, () => {
      ys.push(pos(b).y)
      maxVy = Math.max(maxVy, Math.abs(b.body.linvel().y))
      const w = b.body.angvel()
      maxW = Math.max(maxW, Math.hypot(w.x, w.y, w.z))
    })
    expect(b.hitDistance.every((d) => d > 0)).toBe(true)
    // Static ride height: 4 * compression * 20 * mass = m * g puts the mounts about 0.61 up.
    expect(ys.at(-1)!).toBeGreaterThan(0.55)
    expect(ys.at(-1)!).toBeLessThan(0.65)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.005)
    expect(maxVy).toBeLessThan(0.01)
    expect(maxW).toBeLessThan(0.02)
    expect(upOf(b).y).toBeGreaterThan(0.999)
    // Chassis bottom (hull y -0.203) stays well clear of the ground.
    expect(ys.at(-1)! - 0.203).toBeGreaterThan(0.3)
  })

  test('front heavy centre of mass pitches the nose down, so it creeps forward with no input', async () => {
    // A property of the original equations (forward CG plus suspension along chassis up), kept
    // on purpose. It also guards the CG handedness: a mirrored CG would creep backward.
    const { bed, b } = await spawn()
    bed.run(5)
    expect(b.hitDistance[0]).toBeLessThan(b.hitDistance[2])
    expect(b.body.linvel().z).toBeLessThan(-0.5)
    expect(speed(b)).toBeLessThan(2)
  })

  test('holding brakes parks it completely', async () => {
    const { bed, b } = await spawn()
    bed.run(2)
    b.input.brakes = true
    bed.run(1)
    const p0 = pos(b)
    bed.run(2)
    expect(speed(b)).toBeLessThan(1e-3)
    expect(pos(b).distanceTo(p0)).toBeLessThan(0.01)
  })

  test.each([0, Math.PI / 2, -2.5])('throttle drives toward local -Z (heading %f)', async (heading) => {
    const { bed, b } = await spawn(heading)
    bed.run(1)
    const p0 = pos(b)
    const fwd = forwardOf(b)
    b.input.y = 1
    bed.run(3)
    const d = pos(b).sub(p0)
    const along = d.dot(fwd)
    expect(along).toBeGreaterThan(20)
    // Mostly straight: the sideways drift is small next to the distance covered.
    expect(Math.abs(d.clone().addScaledVector(fwd, -along).setY(0).length())).toBeLessThan(along * 0.1)
    expect(new THREE.Vector3().copy(b.body.linvel() as THREE.Vector3).dot(forwardOf(b))).toBeGreaterThan(10)
    expect(b.motorSpeed).toBeGreaterThan(0)
  })

  test('reverse drives toward local +Z', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    const z0 = pos(b).z
    b.input.y = -1
    bed.run(2)
    expect(pos(b).z - z0).toBeGreaterThan(5)
    expect(b.motorSpeed).toBeLessThan(0)
  })

  test('top speed approaches the virtual motor equilibrium set by buggySpeed', async () => {
    // Buggy.js 393-396 at full throttle settle where 30 * power * (1 - x)^2 = speed * x, with
    // motorSpeed = 10 * buggySpeed * x. For buggySpeed 5 that is 33.3 m/s.
    params.set(buggySpeed.def.id, 5)
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    let peak = 0
    bed.run(40, () => { peak = Math.max(peak, speed(b)) })
    expect(speed(b)).toBeGreaterThan(33.3 * 0.9)
    expect(peak).toBeLessThan(33.4)

    // A higher buggySpeed is faster over the same time.
    params.set(buggySpeed.def.id, 55)
    const fast = await spawn()
    fast.bed.run(1)
    fast.b.input.y = 1
    fast.bed.run(10)
    expect(speed(fast.b)).toBeGreaterThan(speed(b) * 1.5)
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
    // Positive yaw about +Y is counter clockwise seen from above: a left turn.
    expect(Math.sign(b.body.angvel().y)).toBe(sign)
    expect(Math.abs(b.body.angvel().y)).toBeGreaterThan(0.5)
    // Front wheels point into the turn, rears counter steer.
    expect(Math.sign(b.steer[0])).toBe(sign)
    expect(Math.sign(b.steer[2])).toBe(-sign)
    bed.run(0.5)
    // Heading has swung toward -X for left, +X for right.
    expect(Math.sign(forwardOf(b).x)).toBe(-sign)
  })

  test('brakes stop it from speed', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    bed.run(3)
    expect(speed(b)).toBeGreaterThan(15)
    b.input.y = 0
    b.input.brakes = true
    bed.run(2.5)
    expect(speed(b)).toBeLessThan(0.01)
  })

  test('wheel rays never hit the buggy itself', async () => {
    const { bed, b } = await spawn(0, 50)
    bed.run(0.2)
    expect(b.hitDistance).toEqual([-1, -1, -1, -1])
    expect(b.crashing).toBe(true)
  })

  test('rights itself when resting upside down', async () => {
    const { bed, b } = await spawn(0, 1.2)
    b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * 0.9), true)
    bed.run(0.5)
    expect(b.isInverted).toBe(true)
    bed.run(2.5)
    expect(upOf(b).y).toBeGreaterThan(0.99)
    expect(b.hitDistance.every((d) => d > 0)).toBe(true)
  })

  test('rides along on a moving rigid body', async () => {
    const { bed, b } = await spawn(0.7, 1.7)
    const world = bed.game.world
    const plat = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.5, 0))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 0.5, 4).setMass(2000).setFriction(1)
        .setCollisionGroups(groups(GROUP_VEHICLE, GROUP_ALL)),
      plat,
    )
    bed.run(2)
    const rel0 = pos(b).sub(plat.translation() as THREE.Vector3)
    bed.run(4, () => plat.setLinvel({ x: 3, y: plat.linvel().y, z: 0 }, true))
    const rel = pos(b).sub(plat.translation() as THREE.Vector3)
    expect(rel.distanceTo(rel0)).toBeLessThan(1)
    expect(b.body.linvel().x).toBeGreaterThan(2.5)
  })

  test('smart suspension shortens with motor speed, and the toggle acts live', async () => {
    const { bed, b } = await spawn()
    bed.run(3)
    expect(b.suspensionRange).toBeGreaterThan(0.38)
    b.input.y = 1
    bed.run(4)
    expect(b.suspensionRange).toBeLessThan(0.21)
    params.set(buggySmartSuspension.def.id, false)
    bed.run(0.02)
    expect(b.suspensionRange).toBe(0.4)
  })

  test('a remote buggy ignores the local keyboard and follows its own input', async () => {
    const { bed, b } = await spawn()
    bed.game.input.state.y = 1
    bed.run(2)
    expect(speed(b)).toBeLessThan(1.5)
    b.input.y = 1
    bed.run(2)
    expect(speed(b)).toBeGreaterThan(10)
  })

  test('a local buggy copies the player input', async () => {
    const { bed, b } = await spawn()
    b.isLocal = true
    bed.game.input.state.y = 1
    bed.run(2)
    expect(b.input.y).toBe(1)
    expect(speed(b)).toBeGreaterThan(10)
  })

  test('is deterministic', async () => {
    const run = async () => {
      const { bed, b } = await spawn(0.3)
      b.input.y = 1
      bed.run(2)
      b.input.x = -0.6
      bed.run(2)
      b.input.brakes = true
      bed.run(1)
      return b.getState()
    }
    expect(await run()).toEqual(await run())
  })
})
