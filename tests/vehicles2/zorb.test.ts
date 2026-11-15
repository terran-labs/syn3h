/**
 * Zorb mode (src/vehicles/zorb.ts), headless with real Rapier. Port of Mars Explorer
 * Vehicle.js 174-241, VehicleMe.js 80-87 and RamoSphere.js; see zorb.ts for the sources.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { emptyInput } from '../../src/core/Input'
import { createVehicle, type VehicleKind } from '../../src/vehicles'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { ZORB_FLOAT_DEPTH, zorbRadius } from '../../src/vehicles/zorb'
import { params } from '../../shared/params'
import { FLAG_ZORB, decodeState, encodeState } from '../../shared/protocol'
import { harness } from './harness'

beforeAll(initPhysics)
afterEach(() => { for (const id of ['zorb.size', 'zorb.speed', 'zorb.agility', 'zorb.bounce']) params.set(id, params.get(id)!.def.default) })

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
      // Special too: buggy wings and jet flight mode run inside the ball.
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
