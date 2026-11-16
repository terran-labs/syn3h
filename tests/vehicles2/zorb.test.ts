/**
 * Zorb mode (src/vehicles/zorb.ts), headless with real Rapier. Port of Mars Explorer
 * Vehicle.js 174-241, VehicleMe.js 80-87 and RamoSphere.js; see zorb.ts for the sources.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { RAPIER, initPhysics } from '../../src/core/physics'
import { emptyInput } from '../../src/core/Input'
import { createVehicle, type VehicleKind } from '../../src/vehicles'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { ZORB_FLOAT_DEPTH, zorbRadius, nextZorbRadius, zorbBoundaryResponse } from '../../src/vehicles/zorb'
import { waterSinking } from '../../src/vehicles/buoyancy'
import { params } from '../../shared/params'
import { FLAG_ZORB, decodeState, encodeState } from '../../shared/protocol'
import { harness } from './harness'

beforeAll(initPhysics)
afterEach(() => { for (const id of ['zorb.size', 'zorb.speed', 'zorb.agility', 'zorb.bounce', 'zorb.skipSpeed', 'zorb.skipAngle', 'water.sinking']) params.set(id, params.get(id)!.def.default) })

const KINDS: VehicleKind[] = ['buggy', 'jet', 'hovercraft', 'tank']
const UP = new THREE.Vector3(0, 1, 0)

/** A chase camera at `yaw` (radians about world up) looking slightly down, as in play. */
function camera(yaw: number, pitch = -0.25): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
}
/** Horizontal camera forward (three.js cameras look down -Z) and right. */
function axes(yaw: number) {
  return {
    forward: new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)),
    right: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
  }
}
const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z)
const finite = (v: Vehicle) => [v.body.translation(), v.body.linvel(), v.body.angvel()].every((p) => Number.isFinite(p.x + p.y + p.z)) && Number.isFinite(v.body.rotation().w)

function spawn(kind: VehicleKind = 'buggy', y = 2) {
  const h = harness()
  const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, y, 0))
  v.isLocal = false
  return { h, v, done() { v.dispose(); h.world.free() } }
}

function massProps(v: Vehicle) {
  const b = v.body
  return { mass: b.mass(), com: vec(b.localCom()), inertia: vec(b.principalInertia()), frame: new THREE.Quaternion().copy(b.principalInertiaLocalFrame()) }
}

describe('zorb ball physics', () => {
  it('leaves mass, centre of mass and inertia exactly as the vehicle set them', () => {
    // The buggies move their own centre of mass with the suspension every step, so compare the
    // body with and without the ball at the same instant, recomputed from its colliders.
    const same = (a: ReturnType<typeof massProps>, b: ReturnType<typeof massProps>) => {
      expect(a.mass).toBeCloseTo(b.mass, 9)
      // Rapier sums in 32 bit floats: an extra zero mass term moves the result by 1e-8 m.
      expect(a.com.distanceTo(b.com)).toBeLessThan(1e-6)
      expect(a.inertia.distanceTo(b.inertia)).toBeLessThan(1e-6 * Math.max(1, b.inertia.length()))
      // Rapier stores rotations as 32 bit floats.
      expect(Math.abs(a.frame.dot(b.frame))).toBeCloseTo(1, 6)
    }
    for (const kind of KINDS) {
      const { h, v, done } = spawn(kind)
      h.step(v, 5)
      v.body.recomputeMassPropertiesFromColliders()
      const before = massProps(v)
      v.input.zorb = true
      v.zorb.sync(true, 0.02)
      v.body.recomputeMassPropertiesFromColliders()
      same(massProps(v), before)
      h.step(v, 300)
      expect(v.zorb.radius).toBeGreaterThan(4)
      expect(v.zorb.collider!.mass()).toBe(0)
      expect(v.zorb.collider!.density()).toBe(0)
      v.body.recomputeMassPropertiesFromColliders()
      const grown = massProps(v)
      v.zorb.remove()
      v.body.recomputeMassPropertiesFromColliders()
      same(massProps(v), grown)
      done()
    }
  })

  it('grows in from zero at the original rate and lifts the vehicle onto the ball', () => {
    const { h, v, done } = spawn('buggy')
    h.step(v, 100)
    const rest = v.body.translation().y
    v.input.zorb = true; h.step(v, 1)
    expect(v.zorb.active).toBe(true)
    expect(v.zorb.radius).toBeLessThan(0.2)
    // Vehicle.js 225: (ramoSpheres * 15 + camOffset) scale on a .5 radius sphere.
    const target = zorbRadius(0.5, 3)
    expect(target).toBeCloseTo(5.25)
    // Lerp by fixedDeltaTime per step: 1 - e^-1 of the way after one second.
    h.step(v, 49)
    expect(v.zorb.radius / target).toBeGreaterThan(0.6)
    expect(v.zorb.radius / target).toBeLessThan(0.66)
    h.step(v, 300)
    expect(v.zorb.radius).toBe(target)
    expect(v.body.translation().y).toBeGreaterThan(rest + 4)
    expect(v.zorb.centre(new THREE.Vector3()).y).toBeCloseTo(target, 1)
    // Hanging upright under the keel.
    expect(UP.clone().applyQuaternion(new THREE.Quaternion().copy(v.body.rotation())).y).toBeGreaterThan(0.99)
    done()
  })

  it('rolls away from the camera on forward input and to its right on right input, spinning the way it travels', () => {
    for (const yaw of [0, 0.7, -2.4]) {
      const { forward, right } = axes(yaw)
      for (const [input, want] of [[{ x: 0, y: 1 }, forward], [{ x: 1, y: 0 }, right], [{ x: 0, y: -1 }, forward.clone().negate()]] as const) {
        const { h, v, done } = spawn('buggy')
        v.input.zorb = true; h.step(v, 250)
        v.zorbView = camera(yaw)
        const start = vec(v.body.translation())
        Object.assign(v.input, input); h.step(v, 100)
        const moved = vec(v.body.translation()).sub(start).setY(0)
        expect(moved.length()).toBeGreaterThan(8)
        expect(moved.normalize().dot(want)).toBeGreaterThan(0.97)
        // A ball rolling with velocity v on the ground spins about up x v. The original torque
        // used the full camera transform, so a camera pitched down also adds some yaw; compare
        // the horizontal part.
        const roll = UP.clone().cross(want).normalize()
        expect(vec(v.body.angvel()).setY(0).normalize().dot(roll)).toBeGreaterThan(0.95)
        done()
      }
    }
  })

  it('agility changes only the sideways push, and speed 0 disables zorbing', () => {
    const sideways = (agility: number) => {
      params.set('zorb.agility', agility)
      const { h, v, done } = spawn('buggy')
      v.input.zorb = true; h.step(v, 250)
      v.zorbView = camera(0); v.input.x = 1; h.step(v, 50)
      const x = v.body.linvel().x; done(); return x
    }
    const normal = sideways(0)
    expect(sideways(7)).toBeGreaterThan(normal * 1.5)
    // max(0, speed + agility) is 0: no push, only the roll torque gripping through friction .1.
    expect(Math.abs(sideways(-7))).toBeLessThan(normal * 0.4)
    params.set('zorb.speed', 0)
    const { h, v, done } = spawn('buggy')
    v.input.zorb = true; h.step(v, 20)
    expect(v.zorb.active).toBe(false)
    done()
  })

  it('bounces higher with zorb.bounce and flares the shield on impact', () => {
    const rebound = (bounce: number) => {
      params.set('zorb.bounce', bounce)
      const { h, v, done } = spawn('buggy')
      v.input.zorb = true; h.step(v, 300)
      v.teleport(new THREE.Vector3(0, 25, 0))
      let falling = true, peak = 0, impacts = 0
      for (let i = 0; i < 300; i++) {
        h.step(v)
        const vy = v.body.linvel().y
        if (falling && vy > 0) { falling = false; impacts = v.zorb.impacts }
        if (!falling) { peak = Math.max(peak, v.body.translation().y); if (vy < 0) break }
      }
      const flare = v.zorb.takeImpact()
      done()
      return { height: peak - v.zorb.radius, impacts, flare }
    }
    const dead = rebound(0), lively = rebound(1)
    expect(lively.height).toBeGreaterThan(dead.height + 2)
    expect(lively.height).toBeGreaterThan(3)
    // RamoSphere.js: normal speed above 3 m/s flares; a 20 m drop lands at about 20 m/s.
    expect(dead.impacts).toBeGreaterThan(0)
    expect(lively.flare).toBeGreaterThan(10)
  })

  it('restores ordinary driving on the wheels after switching off', () => {
    for (const kind of ['buggy'] as const) {
      const { h, v, done } = spawn(kind)
      v.input.zorb = true; h.step(v, 250)
      // Roll about, then let the bottom-heavy ball settle before getting out.
      v.zorbView = camera(0.3); v.input.y = 1; v.input.x = 0.5; h.step(v, 120)
      v.input.y = 0; v.input.x = 0; h.step(v, 600)
      // Switching off shrinks the ball and sets the car down instead of dropping it 5 m.
      v.input.zorb = false
      let fall = 0, steps = 0
      while (v.zorb.active && steps < 200) { h.step(v); steps++; fall = Math.min(fall, v.body.linvel().y) }
      expect(steps * 0.02).toBeLessThan(1.6)
      expect(fall).toBeGreaterThan(-5)
      h.step(v, 200)
      expect(v.wheelsGrounded).toBeGreaterThanOrEqual(3)
      const q = new THREE.Quaternion().copy(v.body.rotation())
      expect(UP.clone().applyQuaternion(q).y).toBeGreaterThan(0.9)
      const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(q).setY(0).normalize()
      v.input.y = 1; h.step(v, 150)
      expect(vec(v.body.linvel()).dot(nose)).toBeGreaterThan(4)
      expect(v.body.translation().y).toBeLessThan(2)
      done()
    }
  })

  it('every vehicle kind can zorb, roll and un-zorb without non-finite state', () => {
    for (const kind of KINDS) {
      const { h, v, done } = spawn(kind)
      const baseline = h.world.colliders.len()
      h.step(v, 50)
      v.input.zorb = true; h.step(v, 250)
      expect(h.world.colliders.len()).toBe(baseline + 1)
      v.zorbView = camera(1.1)
      v.input.y = 1; h.step(v, 100)
      // Special too: inside the ball it hops instead of opening wings or flight mode (zorb-quiet.test.ts).
      v.input.y = 0; v.input.x = -1; v.input.special = true; h.step(v, 100)
      expect(vec(v.body.linvel()).setY(0).length()).toBeGreaterThan(5)
      expect(finite(v)).toBe(true)
      v.input.x = 0; v.input.special = false; v.input.zorb = false; h.step(v, 500)
      expect(h.world.colliders.len()).toBe(baseline)
      expect(finite(v)).toBe(true)
      // Back on the ground, or for the jet held in a low hover by its altitude hold.
      expect(v.body.translation().y).toBeLessThan(kind === 'jet' ? 6 : 3)
      done()
    }
  })

  it('removes the ball collider on dispose and on a size change keeps growing smoothly', () => {
    const { h, v } = spawn('jet')
    // The harness floor is the only collider not on the vehicle's body.
    const floor = 1
    v.input.zorb = true; h.step(v, 400)
    expect(v.zorb.radius).toBe(zorbRadius(0.5, 5))
    params.set('zorb.size', 1); h.step(v, 1)
    const r1 = v.zorb.radius
    expect(r1).toBeGreaterThan(zorbRadius(0.5, 5))
    expect(r1).toBeLessThan(zorbRadius(0.5, 5) + 0.2)
    v.dispose()
    expect(v.zorb.collider).toBeNull()
    expect(h.world.colliders.len()).toBe(floor)
    expect(h.world.bodies.len()).toBe(0)
    h.world.free()
  })

  it('leaves a remote copy undriven: only the owner applies the camera push', () => {
    const speed = (view: THREE.Quaternion | null) => {
      const { h, v, done } = spawn('buggy')
      v.input.zorb = true; h.step(v, 250)
      expect(v.zorb.active).toBe(true)
      v.zorbView = view; v.input.y = 1; h.step(v, 50)
      const s = vec(v.body.linvel()).setY(0).length(); done(); return s
    }
    // Without a camera only the buggy's own airborne pitch control acts, gripping weakly.
    const remote = speed(null), owner = speed(camera(0))
    expect(owner).toBeGreaterThan(5)
    expect(remote).toBeLessThan(owner * 0.2)
  })
})

describe('zorb ball on liquids', () => {
  for (const liquid of ['lava', 'water'] as const) {
    it(`floats on deep ${liquid} without heat or sticking and rolls out`, () => {
      for (const kind of ['buggy', 'tank', 'jet', 'hovercraft'] as VehicleKind[]) {
        const { h, v, done } = spawn(kind)
        const depth = 8
        Object.assign(h.terrain, {
          liquidHeightAt: (x: number) => (Math.abs(x) < 30 ? depth : -Infinity),
          liquidKindAt: (x: number) => (Math.abs(x) < 30 ? liquid : null),
        })
        v.input.zorb = true; h.step(v, 300)
        // Base of the ball rides about ZORB_FLOAT_DEPTH under the surface.
        expect(v.zorb.centre(new THREE.Vector3()).y).toBeCloseTo(depth + v.zorb.radius - ZORB_FLOAT_DEPTH, 0)
        expect(v.stuck).toBe(false)
        expect(v.liquidState.heat).toBe(0)
        v.zorbView = camera(0); v.input.x = 1
        let out = -1
        for (let i = 0; i < 600 && out < 0; i++) { h.step(v); if (v.body.translation().x > 36) out = i }
        expect(out).toBeGreaterThan(0)
        expect(finite(v)).toBe(true)
        done()
      }
    })
  }
})

describe('zorb input and replication', () => {
  it('replicates the zorb flag in the spare state bit without disturbing the others', () => {
    const state = { id: 0, t: 1, p: [0, 1, 2] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], v: [0, 0, 0] as [number, number, number], w: [0, 0, 0] as [number, number, number] }
    const on = encodeState({ ...state, input: { ...emptyInput(), brakes: true, zorb: true } })
    expect(on[67] & FLAG_ZORB).toBe(FLAG_ZORB)
    expect(decodeState(on)!.input).toMatchObject({ brakes: true, special: false, fire: false, zorb: true })
    const off = decodeState(encodeState({ ...state, input: { ...emptyInput(), special: true } }))!
    expect(off.input).toMatchObject({ special: true, zorb: false })
    // A caller that predates the flag still encodes, as zorb off.
    const legacy = decodeState(encodeState({ ...state, input: { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: true } }))!
    expect(legacy.input.zorb).toBe(false)
    expect(legacy.input.fire).toBe(true)
  })
})


/** Contact response alone, with real Rapier integration and no vehicle drive forces. */
function liquidSkipFixture(liquid: 'water' | 'lava', kind: VehicleKind = 'buggy') {
  const h = harness(9.81, false)
  h.terrain.liquidHeightAt = () => 10
  h.terrain.liquidKindAt = () => liquid
  h.terrain.liquidVerticalSpeedAt = () => 0
  const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, 20, 0))
  v.isLocal = false // Simulated bots participate; kinematic remote copies do not.
  v.zorb.sync(true, 1)
  v.body.recomputeMassPropertiesFromColliders()
  v.body.setLinearDamping(0); v.body.setAngularDamping(0)
  const place = (gap: number, x = 0) => {
    const centre = v.zorb.centre(new THREE.Vector3()), body = v.body.translation()
    v.body.setTranslation({ x: body.x + x - centre.x, y: body.y + 10 + v.zorb.radius + gap - centre.y, z: body.z }, true)
  }
  const force = (dt = .02) => {
    v.body.resetForces(true); v.body.resetTorques(true)
    v.zorb.float(h.terrain, v.liquidState, dt)
  }
  return { h, v, place, force, done() { v.dispose(); h.world.free() } }
}

describe('passive Zorb liquid skips', () => {
  for (const liquid of ['water', 'lava'] as const) for (const sinking of [false, true]) {
    it(`${liquid}, sinking=${sinking}: keeps tangent speed and spin over repeated contacts`, () => {
      waterSinking.value = sinking; params.set('zorb.bounce', .8)
      const f = liquidSkipFixture(liquid)
      let control: ReturnType<typeof liquidSkipFixture> | undefined
      try {
        control = liquidSkipFixture(liquid)
        for (const fixture of [f, control]) {
          fixture.place(.2); fixture.v.body.setLinvel({ x: 30, y: -4, z: 0 }, true)
          fixture.v.body.setAngvel({ x: 0, y: 2, z: 0 }, true)
        }
        // With water.sinking=false, the free body reproduced the same changing world-Y
        // spin in all 92 paired samples. The contract is no angular change from float, then the same full
        // xyz evolution as an independent free body, not a constant world-Y component.
        // Identical deterministic setup permits exact equality, with no new tolerance.
        // The control omits float only; its vertical trajectory is allowed to differ.
        const contacts: number[] = []
        let count = 0
        for (let i = 0; i < 250 && contacts.length < 4; i++) {
          const beforeFloat = vec(f.v.body.angvel())
          f.force()
          expect(vec(f.v.body.angvel())).toEqual(beforeFloat)
          control.v.body.resetForces(true); control.v.body.resetTorques(true)
          f.h.world.step(); control.h.world.step()
          expect(vec(f.v.body.angvel())).toEqual(vec(control.v.body.angvel()))
          if (f.v.zorb.skips !== count) {
            count = f.v.zorb.skips
            contacts.push(Math.hypot(f.v.body.linvel().x, f.v.body.linvel().z))
          }
          expect(Math.hypot(f.v.body.linvel().x, f.v.body.linvel().z)).toBeCloseTo(30, 3)
        }
        expect(contacts.length).toBe(4)
        for (const speed of contacts) expect(speed).toBeCloseTo(30, 3)
        expect(f.v.zorb.hops).toBe(0); expect(f.v.zorb.pulse).toBe(0)
        expect(f.v.liquidState.heat).toBe(0); expect(f.v.liquidState.stuck).toBe(false)
      } finally { try { f.done() } finally { control?.done() } }
    })
  }

  it.each(KINDS)('%s responds along the sampled moving surface normal without tangent impulse', kind => {
    const f = liquidSkipFixture('water', kind)
    let t = 0
    // Sloped travelling surface with a known normal and vertical velocity.
    f.h.terrain.liquidHeightAt = x => 10 + .1 * x + t
    f.h.terrain.liquidVerticalSpeedAt = () => 1
    const normal = new THREE.Vector3(-.1, 1, 0).normalize()
    const tangent = new THREE.Vector3(1, .1, 0).normalize()
    const incoming = tangent.clone().multiplyScalar(30).addScaledVector(normal, -3).add(new THREE.Vector3(0, 1, 0))
    const place = (gap: number) => {
      const centre = f.v.zorb.centre(new THREE.Vector3()), body = f.v.body.translation()
      f.v.body.setTranslation({ x: body.x, y: body.y + 10 + .1 * centre.x + t + (f.v.zorb.radius + gap) / normal.y - centre.y, z: body.z }, true)
    }
    try {
      place(.15); f.v.body.setLinvel(incoming, true); f.force()
      t += .02; place(-.02); f.force()
      expect(f.v.zorb.skips).toBe(1)
      const relative = vec(f.v.body.linvel()).sub(new THREE.Vector3(0, 1, 0))
      expect(relative.dot(tangent)).toBeCloseTo(30, 3)
      expect(relative.dot(normal)).toBeCloseTo(1.5, 3)
    } finally { f.done() }
  })

  it.each([[5, -1], [30, -20], [30, 2]])('does not skip slow, steep or separating approach (%s,%s)', (x, y) => {
    const f = liquidSkipFixture('lava')
    try {
      f.place(.15); f.v.body.setLinvel({ x, y, z: 0 }, true); f.force()
      f.place(-.02); f.force()
      expect(f.v.zorb.skips).toBe(0)
    } finally { f.done() }
  })

  it('does not turn initial immersion, teleport, remote ownership or shrink into a contact', () => {
    const f = liquidSkipFixture('water')
    try {
      f.place(-.02); f.v.body.setLinvel({ x: 30, y: -3, z: 0 }, true); f.force()
      expect(f.v.zorb.skips).toBe(0)
      f.place(.15); f.force(); f.place(-.02, 100); f.force()
      expect(f.v.zorb.skips).toBe(0)
      f.v.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
      f.place(.15); f.force(); f.place(-.02); f.force()
      expect(f.v.zorb.skips).toBe(0)
      f.v.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
      f.v.zorb.sync(false, .02); f.place(.15); f.force(); f.place(-.02); f.force()
      expect(f.v.zorb.skips).toBe(0)
    } finally { f.done() }
  })

  it('rearms only after true clearance followed by a fresh inward recross', () => {
    const f = liquidSkipFixture('water')
    try {
      const incoming = { x: 30, y: -3, z: 0 }
      f.place(.15); f.v.body.setLinvel(incoming, true); f.force()
      f.place(-.02); f.force(); expect(f.v.zorb.skips).toBe(1)
      // A tiny outward excursion is not clearance, even if it crosses zero again.
      f.place(.001); f.v.body.setLinvel({ x: 30, y: .5, z: 0 }, true); f.force()
      f.place(-.002); f.v.body.setLinvel(incoming, true); f.force()
      expect(f.v.zorb.skips).toBe(1)
      f.place(.02); f.force(); expect(f.v.zorb.skips).toBe(1)
      f.place(-.002); f.force(); expect(f.v.zorb.skips).toBe(2)
    } finally { f.done() }
  })

  it('requires separation and cooldown, and rejects shoreline-normal discontinuities', () => {
    const f = liquidSkipFixture('water')
    try {
      const incoming = { x: 30, y: -3, z: 0 }
      f.place(.15); f.v.body.setLinvel(incoming, true); f.force()
      f.place(-.02); f.force(); expect(f.v.zorb.skips).toBe(1)
      for (let i = 0; i < 10; i++) { f.v.body.setLinvel(incoming, true); f.force() }
      expect(f.v.zorb.skips).toBe(1)
      f.place(.15); f.force()
      f.h.terrain.liquidKindAt = x => Math.abs(x) > .1 ? null : 'water'
      f.place(-.02); f.force(); expect(f.v.zorb.skips).toBe(1)
    } finally { f.done() }
  })
})


it('classifies relative to flowing water and samples the wave height, not a fixed sea level', () => {
  const f = liquidSkipFixture('water')
  let phase = 0
  f.h.terrain.liquidVerticalSpeedAt = x => .1 * Math.cos(x * .2 + phase)
  f.h.terrain.liquidHeightAt = (x, z) => 10 + Math.sin(x * .2 + phase) + Math.cos(z * .2) * .2
  f.h.terrain.liquidFlowAt = (_x, _z, out) => { out.x = 25; out.z = 0; return out }
  try {
    // The body moves fast in world coordinates but is slow relative to this current.
    const place = (gap: number) => {
      const c = f.v.zorb.centre(new THREE.Vector3()), p = f.v.body.translation()
      const slope = (f.h.terrain.liquidHeightAt!(c.x + .25, c.z) - f.h.terrain.liquidHeightAt!(c.x - .25, c.z)) / .5
      const ny = 1 / Math.sqrt(1 + slope * slope)
      f.v.body.setTranslation({ x: p.x, y: p.y + f.h.terrain.liquidHeightAt!(c.x, c.z) + (f.v.zorb.radius + gap) / ny - c.y, z: p.z }, true)
    }
    place(.15); f.v.body.setLinvel({ x: 30, y: 3, z: 0 }, true); f.force()
    phase += .002; place(-.02); f.force()
    expect(f.v.zorb.skips).toBe(0)
  } finally { f.done() }
})

it('zero bounce leaves continuous flotation and cooldown prevents an immediate second skip', () => {
  const f = liquidSkipFixture('lava')
  try {
    const enter = (dt = .02) => {
      f.place(.15); f.v.body.setLinvel({ x: 30, y: -3, z: 0 }, true); f.force(dt)
      f.place(-.02); f.force(dt)
    }
    params.set('zorb.bounce', 0); enter(); expect(f.v.zorb.skips).toBe(0)
    params.set('zorb.bounce', .5); enter(); expect(f.v.zorb.skips).toBe(1)
    enter(.001); expect(f.v.zorb.skips).toBe(1)
    f.v.body.setEnabled(false); f.force()
    f.v.body.setEnabled(true); f.place(-.02); f.force()
    expect(f.v.zorb.skips).toBe(1)
  } finally { f.done() }
})


for (const liquid of ['water', 'lava'] as const) {
  it(`full vehicle update skips ordinary dry-to-${liquid} shore entry`, () => {
    const f = liquidSkipFixture(liquid, 'hovercraft')
    f.h.terrain.liquidKindAt = x => x < 0 ? null : liquid
    f.h.terrain.liquidHeightAt = x => x < 0 ? -Infinity : 10
    try {
      f.v.input.zorb = true
      f.place(-.02, -.2)
      f.v.body.setLinvel({ x: 30, y: -2, z: 0 }, true)
      f.v.body.setAngvel({ x: 0, y: 2, z: 0 }, true)
      f.h.step(f.v, 2)
      expect(f.v.zorb.skips).toBe(1)
      expect(f.v.body.linvel().x).toBeCloseTo(30, 3)
      expect(f.v.body.angvel().y).toBeCloseTo(2, 3)
      expect(f.v.body.linvel().y).toBeGreaterThan(0)
    } finally { f.done() }
  })

  it(`default full vehicle update retains motion across repeated ${liquid} skips`, () => {
    const f = liquidSkipFixture(liquid, 'hovercraft')
    try {
      expect(params.get('zorb.bounce')!.value).toBe(.5)
      expect(params.get('zorb.skipSpeed')!.value).toBe(10)
      expect(params.get('zorb.skipAngle')!.value).toBe(20)
      f.v.input.zorb = true; f.place(.2)
      f.v.body.setLinvel({ x: 30, y: -8, z: 0 }, true)
      f.v.body.setAngvel({ x: 0, y: 2, z: 0 }, true)
      const speeds: number[] = [], spins: number[] = []
      let previous = 0
      for (let i = 0; i < 250 && speeds.length < 3; i++) {
        f.h.step(f.v)
        if (f.v.zorb.skips > previous) {
          previous = f.v.zorb.skips
          speeds.push(Math.hypot(f.v.body.linvel().x, f.v.body.linvel().z))
          spins.push(f.v.body.angvel().y)
        }
      }
      expect(speeds.length).toBe(3)
      for (const speed of speeds) expect(speed).toBeCloseTo(30, 3)
      for (const spin of spins) expect(spin).toBeCloseTo(2, 3)
      // Include an outward contact step, when an accidental float call would add drag.
      f.h.step(f.v)
      expect(f.v.body.linvel().x).toBeCloseTo(30, 3)
      expect(f.v.zorb.hops).toBe(0)
    } finally { f.done() }
  })
}

it('teleport and materialization explicitly clear even small-position contact history', () => {
  for (const reset of ['teleport', 'materialize'] as const) {
    const f = liquidSkipFixture('water', 'hovercraft')
    try {
      f.v.input.zorb = true; f.place(.15)
      f.v.body.setLinvel({ x: 30, y: -3, z: 0 }, true); f.force()
      f.place(-.02)
      if (reset === 'teleport') f.v.teleport(vec(f.v.body.translation()))
      else {
        f.v.object.userData.materializing = true; f.v.fixedUpdate(.02)
        f.v.object.userData.materializing = false
      }
      f.v.body.setLinvel({ x: 30, y: -3, z: 0 }, true)
      f.h.step(f.v)
      expect(f.v.zorb.skips).toBe(0)
    } finally { f.done() }
  }
})

it('unknown or nonfinite surface velocity cannot qualify a skip', () => {
  for (const query of [undefined, () => NaN, () => Infinity]) {
    const f = liquidSkipFixture('water')
    try {
      f.h.terrain.liquidVerticalSpeedAt = query
      f.place(.15); f.v.body.setLinvel({ x: 30, y: -3, z: 0 }, true); f.force()
      f.place(-.02); f.force()
      expect(f.v.zorb.skips).toBe(0)
    } finally { f.done() }
  }
})

it('fixed steps at an unchanged wave clock use the supplied phase speed without dt division', () => {
  const f = liquidSkipFixture('water')
  f.h.terrain.liquidHeightAt = () => 11
  f.h.terrain.liquidVerticalSpeedAt = () => 1
  const place = (gap: number) => f.place(gap + 1)
  try {
    place(.15); f.v.body.setLinvel({ x: 30, y: -3, z: 0 }, true)
    for (let i = 0; i < 4; i++) f.force()
    place(-.02); f.force()
    expect(f.v.zorb.skips).toBe(1)
    // Relative incoming -4, outgoing +2, plus surface speed1.
    expect(f.v.body.linvel().y).toBeCloseTo(3, 4)
    f.force(); expect(f.v.body.linvel().y).toBeCloseTo(3, 4)
  } finally { f.done() }
})


/** Independent scalar cases use an upward plane so normal work can be calculated directly. */
function boundaryInput() {
  return { centre:{x:0,y:5,z:0}, com:{x:0,y:5,z:0}, velocity:{x:30,y:-3,z:0},
    omega:{x:0,y:2,z:0}, normal:{x:0,y:1,z:0}, surfaceVelocity:{x:0,y:0,z:0},
    radius:5,target:5,dt:.02,mass:30,bounce:.5 }
}

describe('growth-aware liquid response budget', () => {
  it('preserves steady-radius restitution and separates growth and moving-surface work', () => {
    // Expected speeds come from u=-3-heave-growth and uAfter=-.5*u, not the helper outputs.
    for (const [target,heave,growth,expectedImpulse,expectedAfter] of [
      [5,0,0,135,1.5], [5.25,0,.25,146.25,1.875], [5.25,1,.25,191.25,3.375],
    ]) {
      const input=boundaryInput();input.target=target;input.surfaceVelocity.y=heave
      const result=zorbBoundaryResponse(input)!
      expect(result).not.toBeNull();expect(result.impulse).not.toBeNull()
      expect(result.growthRate).toBeCloseTo(growth,12)
      expect(result.impulse!).toBeCloseTo(expectedImpulse,10)
      const after=-3+result.impulse!/30
      expect(after).toBeCloseTo(expectedAfter,12)
      const kinetic=.5*30*(after*after-9)
      const surfaceWork=expectedImpulse*heave,growthWork=expectedImpulse*growth
      const loss=.5*30*(1-.5*.5)*(-3-heave-growth)**2
      expect(kinetic).toBeCloseTo(surfaceWork+growthWork-loss,10)
    }
  })

  it('uses the exact next growth and snap recurrence, not the preceding increment', () => {
    expect(nextZorbRadius(5,5.25,.02)).toBeCloseTo(5.005,14)
    expect(nextZorbRadius(5.245,5.25,.02)).toBe(5.25)
    expect(nextZorbRadius(5.25,5.25,.02)).toBe(5.25)
    expect(nextZorbRadius(0,5.25,1)).toBe(5.25)
    const input=boundaryInput();input.target=5.25
    input.radius=nextZorbRadius(5,5.25,.02)
    expect(zorbBoundaryResponse(input)!.growthRate).toBeCloseTo(.245,12)
    input.radius=5.245
    expect(zorbBoundaryResponse(input)!.growthRate).toBeCloseTo(.25,12)
  })

  it('uses actual centre offset and rejects spin-funded restitution without a capped impulse', () => {
    const input=boundaryInput();input.com={x:0,y:0,z:0};input.centre={x:1,y:0,z:0}
    input.omega={x:0,y:0,z:1}
    const allowed=zorbBoundaryResponse(input)!
    expect(allowed.boundarySpeed).toBe(-2);expect(allowed.impulse).toBe(90)
    input.omega.z=-2
    const rejected=zorbBoundaryResponse(input)!
    expect(rejected.boundarySpeed).toBe(-5);expect(rejected.budget).toBe(180)
    expect(rejected.impulse).toBeNull() // J0=225 would exceed the actual energy budget.
    input.velocity.y=.1;input.omega.z=0;input.target=5.25
    expect(zorbBoundaryResponse(input)!.boundarySpeed).toBeCloseTo(-.15,12)
  })

  it('rejects invalid mass, step, geometry and vectors before returning an impulse', () => {
    for (const [field,value] of [['mass',0],['mass',-1],['mass',Infinity],['dt',0],['dt',NaN],['dt',.2],
      ['radius',NaN],['target',Infinity],['bounce',NaN]] as const) {
      const input=boundaryInput();input[field]=value
      expect(zorbBoundaryResponse(input)).toBeNull()
    }
    for (const field of ['centre','com','velocity','omega','normal','surfaceVelocity'] as const) {
      const input=boundaryInput();input[field].x=NaN
      expect(zorbBoundaryResponse(input)).toBeNull()
    }
    const input=boundaryInput();input.normal.y=2
    expect(zorbBoundaryResponse(input)).toBeNull()
  })

  it('uses ordinary flotation on a budget refusal without an impulse, count or coasting', () => {
    const f=liquidSkipFixture('lava')
    try {
      f.v.body.setRotation({x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2},true)
      f.v.body.setAngvel({x:0,y:0,z:20},true)
      f.place(.15);f.v.body.setLinvel({x:30,y:-3,z:0},true);f.force()
      f.place(-.02)
      const velocity={...f.v.body.linvel()},omega={...f.v.body.angvel()}
      f.force()
      expect(f.v.zorb.skips).toBe(0)
      expect(f.v.body.linvel()).toEqual(velocity);expect(f.v.body.angvel()).toEqual(omega)
      expect(f.v.body.userForce().x).toBeLessThan(0)
      expect(f.v.body.userForce().y).toBeGreaterThan(0)
      // A second still-immersed call must continue floating, not perform a deferred skip.
      f.force();expect(f.v.zorb.skips).toBe(0);expect(f.v.body.userForce().x).toBeLessThan(0)
    } finally {f.done()}
  })
})

for (const growing of [false,true]) {
  it(`${growing?'growing':'steady'} centred Rapier sphere clears the plane between three real contacts`, () => {
    const h=harness(9.81,false),target=5.25,dt=.02
    let radius=growing?target*.95:target
    const body=h.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,radius+.2,0))
    const collider=h.world.createCollider(RAPIER.ColliderDesc.ball(radius).setMass(30),body)
    body.recomputeMassPropertiesFromColliders()
    body.setLinvel({x:30,y:-3,z:0},true);body.setAngvel({x:0,y:2,z:0},true)
    let priorGap=.2,cleared=true
    const contacts:number[]=[]
    try {
      // Centred isotropic body has no controller. This independently integrates the production
      // response; the native Buggy case below additionally exercises Zorb's actual state machine.
      for(let tick=0;tick<600&&contacts.length<3;tick++) {
        body.resetForces(true);body.resetTorques(true)
        radius=nextZorbRadius(radius,target,dt);collider.setRadius(radius)
        const centre=body.translation(),gap=centre.y-radius
        if(gap>.01)cleared=true
        if(priorGap>0&&gap<=0) {
          expect(cleared).toBe(true)
          const before={...body.linvel()},spin={...body.angvel()},mass=body.mass()
          const response=zorbBoundaryResponse({centre,com:body.worldCom(),velocity:before,omega:spin,
            normal:{x:0,y:1,z:0},surfaceVelocity:{x:0,y:0,z:0},radius,target,dt,mass,bounce:.5})!
          expect(Math.hypot(before.x,before.z)).toBeGreaterThanOrEqual(10)
          expect(Math.atan2(-before.y,Math.hypot(before.x,before.z))).toBeLessThanOrEqual(20*Math.PI/180)
          expect(response).not.toBeNull();expect(response.impulse).not.toBeNull()
          body.applyImpulse({x:0,y:response.impulse!,z:0},true)
          expect(body.linvel().x).toBe(before.x);expect(body.linvel().z).toBe(before.z)
          expect(body.angvel()).toEqual(spin)
          const after=body.linvel(),work=.5*mass*(after.y**2-before.y**2)
          // Float32 velocity storage bounds this independent work comparison.
          const error=16*2**-23*mass*Math.max(1,before.y**2,after.y**2)
          expect(work).toBeLessThanOrEqual(response.impulse!*response.growthRate+error)
          if(contacts.length)expect((tick-contacts.at(-1)!)*dt).toBeGreaterThanOrEqual(.02)
          contacts.push(tick);cleared=false
        }
        priorGap=gap
        h.world.step()
        expect([body.translation().y,body.linvel().y,body.angvel().y].every(Number.isFinite)).toBe(true)
      }
      expect(contacts.length).toBe(3)
    } finally {h.world.free()}
  })

  it(`${growing?'growing':'steady'} native Buggy shallow approach requires three genuinely separated skips`, () => {
    const h=harness(9.81,false)
    h.terrain.heightAt=()=>-60;h.terrain.liquidHeightAt=()=>0
    h.terrain.liquidKindAt=()=> 'lava';h.terrain.liquidVerticalSpeedAt=()=>0
    const v=createVehicle(h.game,h.terrain,'buggy',new THREE.Vector3(0,20,0));v.isLocal=false
    try {
      v.input.zorb=true
      // Grow through normal sync calls before the sole initial placement, never assign radius.
      v.zorb.sync(true,growing ? .02 : 1)
      for(let warm=0;growing&&v.zorb.radius<v.zorb.target*.95&&warm<300;warm++)v.zorb.sync(true,.02)
      expect(v.zorb.radius).toBeGreaterThanOrEqual(v.zorb.target*.95)
      const c=v.zorb.centre(new THREE.Vector3()),p=v.body.translation()
      v.body.setTranslation({x:p.x-c.x,y:p.y+v.zorb.radius+.2-c.y,z:p.z-c.z},true)
      v.body.setLinvel({x:30,y:-3,z:0},true);v.body.setAngvel({x:0,y:2,z:0},true)
      let count=v.zorb.skips,cleared=true
      const contacts:number[]=[]
      for(let tick=0;tick<600&&contacts.length<3;tick++) {
        const beforeGap=v.zorb.centre(new THREE.Vector3()).y-v.zorb.radius
        if(beforeGap>.01)cleared=true
        v.fixedUpdate(.02)
        if(v.zorb.skips>count) {
          expect(v.zorb.skips-count).toBe(1);expect(cleared).toBe(true)
          expect(v.zorb.centre(new THREE.Vector3()).y-v.zorb.radius).toBeLessThanOrEqual(0)
          if(contacts.length)expect((tick-contacts.at(-1)!)*.02).toBeGreaterThanOrEqual(.02)
          contacts.push(tick);count=v.zorb.skips;cleared=false
        }
        h.world.step();v.postPhysics(.02)
        expect(finite(v)).toBe(true);expect(v.liquidState.stuck).toBe(false);expect(v.zorb.hops).toBe(0)
      }
      expect(contacts.length).toBe(3)
      // This count does not certify whole-window speed/spin retention under native forces.
    } finally {v.dispose();h.world.free()}
  })
}
