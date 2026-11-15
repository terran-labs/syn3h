/**
 * Headless tests for the Syn3h buggy. Directions are strict: forward is local -Z, positive yaw
 * is a left turn, pitch and roll are checked by where the nose and the right side point.
 */
import { afterEach, describe, expect, test } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { createVehicle } from '../../src/vehicles'
import { buggyIdleHold, buggyNextGen } from '../../src/vehicles/buggyParams'
import { waterSinking } from '../../src/vehicles/buoyancy'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../../src/core/physics'
import { type Bed, makeBed } from './harness'

const speed = (b: Syn3hBuggy) => {
  const v = b.body.linvel()
  return Math.hypot(v.x, v.y, v.z)
}
const rot = (b: Syn3hBuggy) => {
  const r = b.body.rotation()
  return new THREE.Quaternion(r.x, r.y, r.z, r.w)
}
const axis = (b: Syn3hBuggy, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(rot(b))
const pos = (b: Syn3hBuggy) => {
  const t = b.body.translation()
  return new THREE.Vector3(t.x, t.y, t.z)
}

async function spawn(heading = 0, y = 1.5): Promise<{ bed: Bed; b: Syn3hBuggy }> {
  const bed = await makeBed()
  const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, y, 0), heading))
  b.isLocal = false
  return { bed, b }
}

/** Put the buggy in the air at speed along its nose with wings already open. */
async function flying(altitude = 60, v = 35): Promise<{ bed: Bed; b: Syn3hBuggy }> {
  const s = await spawn(0, altitude)
  s.b.input.special = true
  s.b.wingState = 1
  s.b.areWingsOpen = true
  s.b.body.setLinvel({ x: 0, y: 0, z: -v }, true)
  return s
}

afterEach(() => {
  for (const p of params.all()) params.set(p.def.id, p.def.default)
})

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
    // Body well clear of the ground: skid plate bottom (y -0.085) above it.
    expect(p0.y - 0.085).toBeGreaterThan(0.3)
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
    expect(b.body.linvel().z).toBeLessThan(-0.2)
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
    expect(along).toBeGreaterThan(20)
    expect(d.clone().addScaledVector(fwd, -along).setY(0).length()).toBeLessThan(along * 0.1)
    expect(b.brakes).toBe(false)
  })

  test('reverse drives toward local +Z', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    const z0 = pos(b).z
    b.input.y = -1
    bed.run(2)
    expect(pos(b).z - z0).toBeGreaterThan(5)
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
    expect(Math.abs(b.body.angvel().y)).toBeGreaterThan(0.3)
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
    expect(speed(b)).toBeGreaterThan(15)
    b.input.y = 0
    b.input.brakes = true
    bed.run(3)
    expect(speed(b)).toBeLessThan(0.01)
  })

  test('next-gen brakes stop it on the tyres at well over 1 g, then it holds', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    bed.run(3)
    const v0 = speed(b)
    expect(v0).toBeGreaterThan(15)
    b.input.y = 0
    b.input.brakes = true
    let t = 0
    while (speed(b) > 0.5 && t < 5) {
      bed.run(0.02)
      t += 0.02
    }
    // Harder than low speed grip alone (1.2 g), since grip rises with speed, and no harder
    // than the high speed grip allows (3 g).
    expect(v0 / t).toBeGreaterThan(1.2 * 9.81)
    expect(v0 / t).toBeLessThan(3 * 9.81)
    bed.run(2)
    const p0 = pos(b)
    bed.run(1)
    expect(pos(b).distanceTo(p0)).toBeLessThan(0.05)
  })

  /** Tilt gravity to stand the flat test bed in for a slope rising toward local -Z. */
  const slope = (bed: Bed, deg: number) => {
    const a = deg * THREE.MathUtils.DEG2RAD
    bed.game.world.gravity = { x: 0, y: -9.81 * Math.cos(a), z: 9.81 * Math.sin(a) }
  }

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

  test('next-gen coasts off throttle at speed, so a tapped key holds speed', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    while (speed(b) < 25) bed.run(0.02)
    b.input.y = 0
    bed.run(2)
    expect(b.drive).toBe('coast')
    // Under 0.1 g of slowdown, where the classic motor drag gives nearly 0.1 g on its own.
    expect(speed(b)).toBeGreaterThan(25 - 2 * 0.1 * 9.81)
  })

  test('next-gen reverse key regenerates to a stop, then reverses', async () => {
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
    // buggy.regen is 0.6 g at full key.
    expect(decel).toBeGreaterThan(0.5 * 9.81)
    expect(decel).toBeLessThan(0.8 * 9.81)
    bed.run(4)
    expect(b.drive).toBe('drive')
    expect(b.body.linvel().z).toBeGreaterThan(2)
  })

  test('next-gen runs straight under full throttle (no rightward pull)', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    bed.run(6)
    const p = pos(b)
    expect(-p.z).toBeGreaterThan(100)
    expect(Math.abs(p.x)).toBeLessThan(-p.z * 0.02)
  })

  test('next-gen corners at full lock without sideslip at 15 m/s', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    while (speed(b) < 15) bed.run(0.02)
    b.input.y = 0.3
    b.input.x = 1
    bed.run(2)
    const v = b.body.linvel() as unknown as THREE.Vector3
    const slip = new THREE.Vector3(v.x, 0, v.z).angleTo(axis(b, 0, 0, -1).setY(0)) * THREE.MathUtils.RAD2DEG
    expect(slip).toBeLessThan(3)
    // Lateral acceleration v * yaw rate: at least half a g.
    expect(speed(b) * Math.abs(b.body.angvel().y)).toBeGreaterThan(0.5 * 9.81)
  })

  /** Cruise at v (m/s) long enough for the smart suspension to settle at its speed setting. */
  const cruise = async (v: number) => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.y = 1
    b.motorSpeed = v
    bed.run(4, () => {
      const l = b.body.linvel()
      b.body.setLinvel({ x: 0, y: l.y, z: -v }, true)
    })
    return { bed, b }
  }
  /** Half sine ridge, `height` by `length` m, across x0..x1, starting 6 m ahead of the buggy. */
  const ridge = (bed: Bed, b: Syn3hBuggy, x0: number, x1: number, height: number, length: number) => {
    const z = pos(b).z - 6
    const pts: number[] = []
    for (let i = 0; i <= 16; i++) {
      for (const x of [x0, x1]) pts.push(x, height * Math.sin((Math.PI * i) / 16), z - (length * i) / 16, x, -0.5, z - (length * i) / 16)
    }
    bed.game.world.createCollider(
      RAPIER.ColliderDesc.convexHull(new Float32Array(pts))!.setFriction(1).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)),
    )
  }
  /** Run and report the highest hop above the starting height, the worst roll and body strikes. */
  const ride = (bed: Bed, b: Syn3hBuggy, seconds: number) => {
    const y0 = pos(b).y
    const w = bed.game.world
    let hop = 0, roll = 0, strikes = 0, touching = false
    bed.run(seconds, () => {
      hop = Math.max(hop, pos(b).y - y0)
      roll = Math.max(roll, Math.abs(Math.asin(axis(b, 1, 0, 0).y)) * THREE.MathUtils.RAD2DEG)
      let c = false
      for (const col of [b.hull, b.skid]) {
        w.contactPairsWith(col, (o) => w.contactPair(col, o, (m) => { if (m.numSolverContacts() > 0) c = true }))
      }
      if (c && !touching) strikes++
      touching = c
    })
    return { hop, roll, strikes }
  }

  test('a 0.4 m bump at 42 m/s throws next-gen into the air, and it comes down on its wheels', async () => {
    const { bed, b } = await cruise(42)
    ridge(bed, b, -50, 50, 0.4, 6)
    const r = ride(bed, b, 6)
    // The owner wants hills to launch it, as the original did (about 2 m here), not skip over.
    expect(r.hop).toBeGreaterThan(1.5)
    expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.9)
  })

  test('the planted suspension settings still soak the same bump up', async () => {
    params.set('buggy.rebound', 3); params.set('buggy.rideHeight', 0.25); params.set('buggy.bumpStop', 1.5)
    const { bed, b } = await cruise(42)
    ridge(bed, b, -50, 50, 0.4, 6)
    const r = ride(bed, b, 4)
    expect(r.hop).toBeLessThan(0.7)
    expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.95)
  })

  test('a one sided bump at 42 m/s tips next-gen but it recovers upright', async () => {
    const { bed, b } = await cruise(42)
    ridge(bed, b, -50, 0, 0.4, 6)
    const r = ride(bed, b, 6)
    expect(r.roll).toBeGreaterThan(15)
    expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.9)
  })

  test('landing broadside at speed, next-gen slides on instead of gripping to a stop', async () => {
    const slide = async (sideGrip?: number) => {
      if (sideGrip !== undefined) params.set('buggy.sideGrip', sideGrip)
      const { bed, b } = await spawn()
      bed.run(3)
      const x0 = pos(b).x
      b.body.setLinvel({ x: 20, y: 0, z: 0 }, true)
      let t = 0, stopped = -1
      bed.run(6, () => { t += 0.02; const v = b.body.linvel(); if (stopped < 0 && Math.hypot(v.x, v.z) < 3) stopped = t })
      return { distance: pos(b).x - x0, stopped, upright: axis(b, 0, 1, 0).y }
    }
    const slides = await slide()
    // With broadside grip as high as steering grip it stops in about a second (the old behaviour).
    const bites = await slide(4)
    expect(bites.stopped).toBeLessThan(1.4)
    expect(slides.stopped).toBeGreaterThan(1.8)
    expect(slides.distance).toBeGreaterThan(bites.distance * 1.8)
    expect(slides.upright).toBeGreaterThan(0.9)
  })

  test.each([[false, 1], [true, 0]])('next-gen lands a 4 m drop at 30 m/s on its wheels (planted settings %s: at most %i body strike)', async (planted, strikes) => {
    // The launch-happy defaults let the body touch down once and bounce; the planted settings
    // (firmer stop, more travel) keep it off the ground altogether.
    if (planted) { params.set('buggy.rebound', 3); params.set('buggy.rideHeight', 0.25); params.set('buggy.bumpStop', 1.5) }
    const { bed, b } = await cruise(30)
    const p = pos(b)
    b.body.setTranslation({ x: p.x, y: p.y + 4, z: p.z }, true)
    const r = ride(bed, b, 4)
    expect(r.strikes).toBeLessThanOrEqual(strikes)
    expect(b.wheelsGrounded).toBe(4)
    expect(axis(b, 0, 1, 0).y).toBeGreaterThan(0.95)
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
    expect(planar(pos(b), p0)).toBeGreaterThan(20)
  })

  test('a wrongly set inverted flag clears on mesh ground instead of stranding it on its skid plate', async () => {
    const { bed, b } = await onMesh()
    b.isInverted = true
    bed.run(1.5)
    expect(b.isInverted).toBe(false)
    // Back up on its suspension: the skid plate bottom (y -0.085) well clear of the ground.
    expect(pos(b).y - 50 - 0.085).toBeGreaterThan(0.3)
    const p0 = pos(b)
    b.input.y = 1
    bed.run(3)
    expect(planar(pos(b), p0)).toBeGreaterThan(20)
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
    expect(pos(b).y - 50 - 0.085).toBeGreaterThan(0.3)
    const p0 = pos(b)
    b.input.y = 1
    bed.run(3)
    expect(planar(pos(b), p0)).toBeGreaterThan(20)
  })

  /** A lava pool `depth` m deep over the flat bed for |z| < 30, dry beyond. */
  const lavaPool = async (depth: number) => {
    const bed = await makeBed()
    bed.terrain.liquidHeightAt = (_x, z) => (Math.abs(z) < 30 ? depth : -Infinity)
    bed.terrain.liquidKindAt = () => 'lava'
    const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, depth + 1.5, 0), 0))
    b.isLocal = false
    bed.run(4)
    return { bed, b }
  }

  test('crawls out of shallow lava under power and drives away', async () => {
    const { bed, b } = await lavaPool(0.6)
    b.input.y = 1
    let t = 0
    while (pos(b).z > -31 && t < 40) {
      bed.run(0.5)
      t += 0.5
    }
    expect(t).toBeLessThan(30)
    bed.run(3)
    expect(speed(b)).toBeGreaterThan(15)
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
      expect(z0 - pos(b).z).toBeGreaterThan(1)
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
    expect(motorMax).toBeLessThan(15)
    expect(-pos(b).z).toBeGreaterThan(3)
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
    expect(-pos(b).z).toBeGreaterThan(40)
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
    expect(planar(pos(b), p0)).toBeGreaterThan(10)
  })

  test.each([25, 35, 45])('next-gen changes course at %i m/s at least as fast as classic in the first second', async (v) => {
    const turn = async (nextGen: boolean) => {
      params.set(buggyNextGen.def.id, nextGen)
      const { bed, b } = await cruise(v)
      const course = () => Math.atan2(b.body.linvel().x, -b.body.linvel().z)
      const c0 = course()
      b.input.x = 1
      bed.run(1)
      const after1 = Math.abs(course() - c0) * THREE.MathUtils.RAD2DEG
      bed.run(1)
      return { after1, upright: axis(b, 0, 1, 0).y }
    }
    const classic = await turn(false)
    const next = await turn(true)
    expect(next.after1).toBeGreaterThan(classic.after1 * 0.9)
    expect(next.after1).toBeGreaterThan(20)
    expect(next.upright).toBeGreaterThan(0.95)
  })

  test.each([30, 40])('next-gen climbs a %i degree slope from rest under throttle', async (deg) => {
    const { bed, b } = await spawn()
    bed.run(1)
    slope(bed, deg)
    b.input.y = 1
    const z0 = pos(b).z
    let motorMin = Infinity
    bed.run(4, () => { motorMin = Math.min(motorMin, b.motorSpeed) })
    expect(z0 - pos(b).z).toBeGreaterThan(4)
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
    // It stops the slide and climbs.
    expect(b.body.linvel().z).toBeLessThan(-1)
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

  test('wings deploy at WingOpenSpeed and report wingsOpen', async () => {
    const { bed, b } = await spawn()
    bed.run(1)
    b.input.special = true
    bed.run(0.1)
    expect(b.wingsOpen).toBe(true)
    expect(b.wingState).toBeGreaterThan(0.6)
    bed.run(0.4)
    expect(b.wingState).toBe(1)
    b.input.special = false
    bed.run(0.5)
    expect(b.wingState).toBe(0)
    expect(b.wingsOpen).toBe(false)
  })

  test('sustains flight with wings open at speed', async () => {
    const { bed, b } = await flying()
    const y0 = pos(b).y
    bed.run(3)
    expect(speed(b)).toBeGreaterThan(25)
    expect(pos(b).y).toBeGreaterThan(y0 - 15)
    // Velocity follows the nose.
    expect(axis(b, 0, 0, -1).dot(b.body.linvel() as THREE.Vector3) / speed(b)).toBeGreaterThan(0.99)
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
    expect(Math.abs(axis(b, 0, 0, -1).y - before)).toBeGreaterThan(0.1)
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
    expect(Math.abs(axis(b, 1, 0, 0).y)).toBeGreaterThan(0.2)
  })

  test('stalls nose down when too slow', async () => {
    const { bed, b } = await flying(80, 2)
    bed.run(0.6)
    expect(axis(b, 0, 0, -1).y).toBeLessThan(-0.1)
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
