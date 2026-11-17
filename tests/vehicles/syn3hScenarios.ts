/**
 * Headless scenarios for the Syn3h buggy, shared by its invariant tests (tests/vehicles/syn3h.test.ts)
 * and the handling report (tools/handling-report.ts). The tests assert what must stay true; the
 * report prints the numbers the owner tunes by feel. Forward is local -Z.
 */
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { FIXED_DT, GROUP_ALL, GROUP_TERRAIN, RAPIER, groups } from '../../src/core/physics'
import { type Bed, makeBed } from './harness'
import type { SurfaceKind } from '../../src/world/terrain/surface'

export const G = 9.81

/** Put every parameter back to its default. */
export const resetParams = () => {
  for (const p of params.all()) params.set(p.def.id, p.def.default)
}

export const speed = (b: Syn3hBuggy) => {
  const v = b.body.linvel()
  return Math.hypot(v.x, v.y, v.z)
}
export const rot = (b: Syn3hBuggy) => {
  const r = b.body.rotation()
  return new THREE.Quaternion(r.x, r.y, r.z, r.w)
}
export const axis = (b: Syn3hBuggy, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(rot(b))
export const pos = (b: Syn3hBuggy) => {
  const t = b.body.translation()
  return new THREE.Vector3(t.x, t.y, t.z)
}

/** What the test bed's ground is made of (terrain.surfaceAt), or undefined for none. */
export const ground: { surface?: SurfaceKind } = {}

export async function spawn(heading = 0, y = 1.5): Promise<{ bed: Bed; b: Syn3hBuggy }> {
  const bed = await makeBed()
  if (ground.surface) { const kind = ground.surface; bed.terrain.surfaceAt = () => kind }
  const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, y, 0), heading))
  b.isLocal = false
  return { bed, b }
}

/** Put the buggy in the air at speed along its nose with wings already open. */
export async function flying(altitude = 60, v = 35): Promise<{ bed: Bed; b: Syn3hBuggy }> {
  const s = await spawn(0, altitude)
  s.b.input.special = true
  s.b.wingState = 1
  s.b.areWingsOpen = true
  s.b.body.setLinvel({ x: 0, y: 0, z: -v }, true)
  return s
}

/** Tilt gravity to stand the flat test bed in for a slope rising toward local -Z. */
export const slope = (bed: Bed, deg: number) => {
  const a = deg * THREE.MathUtils.DEG2RAD
  bed.game.world.gravity = { x: 0, y: -G * Math.cos(a), z: G * Math.sin(a) }
}

/** Cruise at v (m/s) long enough for the smart suspension to settle at its speed setting. */
export const cruise = async (v: number) => {
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
export const ridge = (bed: Bed, b: Syn3hBuggy, x0: number, x1: number, height: number, length: number) => {
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
export const ride = (bed: Bed, b: Syn3hBuggy, seconds: number) => {
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
  return { hop, roll, strikes, upright: axis(b, 0, 1, 0).y }
}

/** The planted suspension settings: firmer bump stop, more travel, slower rebound. */
export const planted = () => {
  params.set('buggy.rebound', 3); params.set('buggy.rideHeight', 0.25); params.set('buggy.bumpStop', 1.5)
}

/** A `height` m ridge (full width, or only the left half when `oneSided`) at 42 m/s. */
export const bump = async (oneSided = false, height = 0.4, seconds = 6) => {
  const { bed, b } = await cruise(42)
  ridge(bed, b, -50, oneSided ? 0 : 50, height, 6)
  return { ...ride(bed, b, seconds), wheels: b.wheelsGrounded }
}

/** Dropped 4 m while cruising at 30 m/s. */
export const drop = async () => {
  const { bed, b } = await cruise(30)
  const p = pos(b)
  b.body.setTranslation({ x: p.x, y: p.y + 4, z: p.z }, true)
  return { ...ride(bed, b, 4), wheels: b.wheelsGrounded }
}

/** Thrown sideways at 20 m/s from rest: how far it goes, when it stops and when it faces its travel. */
export const sideways = async () => {
  const { bed, b } = await spawn()
  bed.run(3)
  const x0 = pos(b).x
  b.body.setLinvel({ x: 20, y: 0, z: 0 }, true)
  let t = 0, stopped = Infinity, faced = Infinity
  bed.run(6, () => {
    t += 0.02
    const v = b.body.linvel(), sp = Math.hypot(v.x, v.z), f = axis(b, 0, 0, -1)
    if (stopped === Infinity && sp < 3) stopped = t
    if (faced === Infinity && sp > 3 && (f.x * v.x + f.z * v.z) / sp > 0.97) faced = t
  })
  return { distance: pos(b).x - x0, stopped, faced, upright: axis(b, 0, 1, 0).y }
}

/** Signed angle (degrees) from the nose to the velocity, positive when it is to the nose's right. */
export const slip = (b: Syn3hBuggy) => {
  const f = axis(b, 0, 0, -1), v = b.body.linvel()
  return Math.atan2(f.z * v.x - f.x * v.z, f.x * v.x + f.z * v.z) * 180 / Math.PI
}

/**
 * Yaw the buggy `angle` degrees off its travel at `speed` m/s, then hold full counter-steer or let
 * go. Seconds until the slide is over for good (Infinity if not within 5 s), and the worst upright.
 */
export const kick = async (speed: number, angle: number, counterSteer: boolean) => {
  const { bed, b } = await spawn()
  bed.run(2)
  b.body.setLinvel({ x: 0, y: 0, z: -speed }, true); b.motorSpeed = speed; b.input.y = 1
  bed.run(1.5, () => { const v = b.body.linvel(); b.body.setLinvel({ x: 0, y: v.y, z: -speed }, true) })
  b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle * Math.PI / 180).multiply(rot(b)), true)
  b.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  let t = 0, recovered = Infinity, upright = 1
  bed.run(5, () => {
    t += 0.02
    const s = slip(b)
    b.input.x = counterSteer && Math.abs(s) > 1 ? Math.sign(s) : 0
    if (recovered === Infinity && Math.abs(s) < 3 && Math.abs(b.body.angvel().y) < 0.3) recovered = t
    else if (Math.abs(s) > 6) recovered = Infinity
    upright = Math.min(upright, axis(b, 0, 1, 0).y)
  })
  return { recovered, upright }
}

/**
 * Open the wings in the air, nose toward -Z, moving 30 m/s toward +X (fully sideways), under
 * flight model `model`. Degrees between the motion and the nose after `seconds`, and the speed.
 */
export const deploy = async (model: number, seconds: number) => {
  params.set('buggy.flightModel', model)
  const { bed, b } = await spawn(0, 200)
  b.body.setLinvel({ x: 30, y: 0, z: 0 }, true)
  b.input.special = true
  bed.run(seconds)
  const v = b.body.linvel(), sp = Math.hypot(v.x, v.y, v.z), f = axis(b, 0, 0, -1)
  return { off: Math.acos(Math.min(1, (f.x * v.x + f.y * v.y + f.z * v.z) / sp)) * 180 / Math.PI, speed: sp }
}

/** Fly at 35 m/s pitched `pitch` radians under flight model `model` for half a second. */
export const pitchedGlide = async (model: number, pitch: number) => {
  params.set('buggy.flightModel', model)
  const { bed, b } = await flying(300, 35)
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch).multiply(rot(b))
  b.body.setRotation(q, true)
  const f = axis(b, 0, 0, -1)
  b.body.setLinvel({ x: f.x * 35, y: f.y * 35, z: f.z * 35 }, true)
  let climb = 0
  bed.run(0.5, () => { climb = b.body.linvel().y })
  return { speed: speed(b), climb }
}

/** Degrees the course has turned one second after full lock at cruise speed `v`, and the upright after two. */
export const courseChange = async (v: number) => {
  const { bed, b } = await cruise(v)
  const course = () => Math.atan2(b.body.linvel().x, -b.body.linvel().z)
  const c0 = course()
  b.input.x = 1
  bed.run(1)
  const after1 = Math.abs(course() - c0) * THREE.MathUtils.RAD2DEG
  bed.run(1)
  return { after1, upright: axis(b, 0, 1, 0).y }
}

/** From rest on a `deg` degree slope under full throttle for 4 s: metres climbed along it. */
export const climb = async (deg: number) => {
  const { bed, b } = await spawn()
  bed.run(1)
  slope(bed, deg)
  b.input.y = 1
  const z0 = pos(b).z
  let motorMin = Infinity
  bed.run(4, () => { motorMin = Math.min(motorMin, b.motorSpeed) })
  return { climbed: z0 - pos(b).z, motorMin }
}

/** A lava pool `depth` m deep over the flat bed for |z| < 30, dry beyond; settled for 4 s. */
export const lavaPool = async (depth: number) => {
  const bed = await makeBed()
  bed.terrain.liquidHeightAt = (_x, z) => (Math.abs(z) < 30 ? depth : -Infinity)
  bed.terrain.liquidKindAt = () => 'lava'
  const b = bed.add(new Syn3hBuggy(bed.game, bed.terrain, new THREE.Vector3(0, depth + 1.5, 0), 0))
  b.isLocal = false
  bed.run(4)
  return { bed, b }
}

/** Seconds under full throttle to leave a lava pool `depth` m deep (Infinity if not within 40 s). */
export const lavaEscape = async (depth: number) => {
  const { bed, b } = await lavaPool(depth)
  b.input.y = 1
  let t = 0
  while (pos(b).z > -31 && t < 40) {
    bed.run(0.5)
    t += 0.5
  }
  return { seconds: pos(b).z <= -31 ? t : Infinity, bed, b }
}

/**
 * Full lock at cruise speed `v` (throttle held) for `seconds`: the course change after one
 * second, and at the end the speed, the turn radius (speed over yaw rate), the lateral g; and
 * over the run the worst upright and the largest slide angle (nose to travel).
 */
export const fullLock = async (v: number, seconds = 2) => {
  const { bed, b } = await cruise(v)
  const course = () => Math.atan2(b.body.linvel().x, -b.body.linvel().z)
  const c0 = course()
  b.input.x = 1
  let t = 0, after1 = 0, upright = 1, worstSlip = 0
  bed.run(seconds, () => {
    t += FIXED_DT
    if (after1 === 0 && t >= 1 - 1e-6) after1 = Math.abs(course() - c0) * THREE.MathUtils.RAD2DEG
    upright = Math.min(upright, axis(b, 0, 1, 0).y)
    worstSlip = Math.max(worstSlip, Math.abs(slip(b)))
  })
  const l = b.body.linvel(), sp = Math.hypot(l.x, l.z), yaw = Math.abs(b.body.angvel().y)
  return { after1, speed: sp, radius: yaw > 1e-6 ? sp / yaw : Infinity, lateralG: (sp * yaw) / G, upright, worstSlip }
}

/**
 * A quick flick at cruise speed `v`: full left for half a second, full right for half a
 * second, then let go for two. The largest slide angle and the worst upright over the run, and
 * the slide angle at the end (near 0: it settled on a line).
 */
export const flick = async (v = 45) => {
  const { bed, b } = await cruise(v)
  let t = 0, upright = 1, worstSlip = 0
  bed.run(3, () => {
    t += FIXED_DT
    b.input.x = t < 0.5 ? -1 : t < 1 ? 1 : 0
    upright = Math.min(upright, axis(b, 0, 1, 0).y)
    worstSlip = Math.max(worstSlip, Math.abs(slip(b)))
  })
  return { worstSlip, upright, endSlip: Math.abs(slip(b)) }
}

/**
 * Off the ground at 30 m/s with the nose yawed `yaw` degrees from its travel (as after a crash),
 * wings shut and hands off: how many degrees the nose turns toward its travel in one second.
 * Only the tail fin acting in the air turns it.
 */
export const airStraighten = async (yaw = 30) => {
  const { bed, b } = await spawn(0, 120)
  b.body.setLinvel({ x: 0, y: 0, z: -30 }, true)
  b.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw * THREE.MathUtils.DEG2RAD), true)
  b.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  const off = () => { const f = axis(b, 0, 0, -1), v = b.body.linvel(); return Math.abs(Math.atan2(f.x * v.z - f.z * v.x, f.x * v.x + f.z * v.z)) * THREE.MathUtils.RAD2DEG }
  const before = off()
  bed.run(1)
  return before - off()
}
