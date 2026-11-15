/** Wadeable lava, speed-dependent water floating and wings that push along the nose in liquid. */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics, RAPIER, groups, GROUP_TERRAIN, GROUP_ALL } from '../../src/core/physics'
import { params } from '../../shared/params'
import { createVehicle } from '../../src/vehicles'
import { applyWaterForces, planingShare } from '../../src/vehicles/buoyancy'
import { applyVehicleLiquid, createLiquidState, lavaVelocityStep, liquidWetness, wingLiquidAcceleration, wingAttitudeHold, liquidWingLift, lavaDrivePower, lavaViscosity } from '../../src/vehicles/lava'
import { harness } from '../vehicles2/harness'
beforeAll(initPhysics)
beforeEach(() => { params.set('liquid.legacyEscape', false) })
afterEach(() => { for (const p of params.all()) params.set(p.def.id, p.def.default) })
const G = 9.81
const pitched = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg * Math.PI / 180)

describe('wings in liquid', () => {
  it('push along the nose with no vertical component when level and at rest', () => {
    const out = wingLiquidAcceleration(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), 0, 1, G, new THREE.Vector3())
    expect(out.z).toBeCloseTo(-liquidWingLift.value)
    expect(out.y).toBe(0)
    expect(out.x).toBe(0)
  })
  it('climb only when the nose is raised, along the nose', () => {
    const q = pitched(20), f = new THREE.Vector3(0, 0, -1).applyQuaternion(q), u = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
    const out = wingLiquidAcceleration(f, u, 0, 1, G, new THREE.Vector3())
    expect(out.clone().normalize().dot(f)).toBeCloseTo(1, 6)
    expect(out.y).toBeCloseTo(liquidWingLift.value * Math.sin(20 * Math.PI / 180), 4)
    // Never a pure vertical hover: the horizontal part always dominates at 20 degrees.
    expect(Math.hypot(out.x, out.z)).toBeGreaterThan(2 * out.y)
  })
  it('lift grows with forward speed and push fades, both continuous', () => {
    const f = new THREE.Vector3(0, 0, -1), u = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3()
    let last = wingLiquidAcceleration(f, u, 0, 1, G, new THREE.Vector3()).clone()
    for (let s = .01; s <= 30; s += .01) {
      wingLiquidAcceleration(f, u, s, 1, G, a)
      expect(a.distanceTo(last)).toBeLessThan(.05)
      last.copy(a)
    }
    expect(a.z).toBeCloseTo(0, 6)
    expect(a.y).toBeLessThan(G)
  })
  it('a level buggy surges forward in both liquids rather than hovering up', () => {
    for (const [liquid, surface] of [['water', 8], ['lava', 4]] as const) for (const kind of ['buggy'] as const) {
      const h = harness(); h.terrain.liquidHeightAt = () => surface; h.terrain.liquidKindAt = () => liquid
      const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, surface - (liquid === 'water' ? 1 : .45), 0)); v.isLocal = false
      try {
        v.input.special = true; h.step(v, 120)
        const p = v.body.translation()
        expect(p.z).toBeLessThan(-4)
        expect(p.y).toBeLessThan(surface + 1)
        expect(v.liquidState.wingLiftSurface).toBe(-Infinity)
      } finally { v.dispose(); h.world.free() }
    }
  })
})

describe('wing attitude in liquid', () => {
  const start = (kind: 'buggy', liquid: 'water' | 'lava', pitch: number) => {
    const surface = liquid === 'water' ? 8 : 4
    const h = harness(); h.terrain.liquidHeightAt = () => surface; h.terrain.liquidKindAt = () => liquid
    const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, surface - (liquid === 'water' ? 1 : .45), 0)); v.isLocal = false
    v.body.setRotation(pitched(pitch), true); v.input.special = true
    return { h, v, surface }
  }
  it('the hold pulls pitch and roll rates to the command and leaves yaw', () => {
    const right = new THREE.Vector3(1, 0, 0), fwd = new THREE.Vector3(0, 0, -1), out = new THREE.Vector3()
    const w = new THREE.Vector3(-2, .5, 1)
    for (let i = 0; i < 120; i++) wingAttitudeHold(w, right, fwd, 0, 1, 1 / 60, out), w.copy(out)
    expect(Math.abs(w.x)).toBeLessThan(1e-4); expect(Math.abs(w.z)).toBeLessThan(1e-4); expect(w.y).toBe(.5)
    // Forward input lowers the nose; no wetness, no hold.
    for (let i = 0; i < 120; i++) wingAttitudeHold(w, right, fwd, 1, 1, 1 / 60, out), w.copy(out)
    expect(w.x).toBeLessThan(-.9)
    expect(wingAttitudeHold(new THREE.Vector3(3, 0, 0), right, fwd, 0, 0, 1 / 60, out).x).toBe(3)
  })
  for (const kind of ['buggy'] as const) for (const [liquid, limit] of [['water', 3], ['lava', 5]] as const) {
    it(`${kind}: 20 degrees nose up climbs out of ${liquid} within ${limit} s, without a jolt`, () => {
      const { h, v, surface } = start(kind, liquid, 20)
      try {
        let clear = -1, last = v.body.linvel(), lastA = new THREE.Vector3(), end = limit * 60
        const change: number[] = []
        for (let i = 1; i <= end; i++) {
          h.step(v); const l = v.body.linvel(), a = new THREE.Vector3(l.x - last.x, l.y - last.y, l.z - last.z).multiplyScalar(60); last = l
          change.push(a.distanceTo(lastA)); lastA.copy(a)
          if (clear < 0 && v.body.translation().y > surface + .25) { clear = i; end = Math.min(end, i + 30) }
        }
        expect(clear).toBeGreaterThan(0)
        // The handover: from a quarter second before the hull leaves to half a second after.
        // A jolt is a jump in acceleration between steps. (The flight controller's own snap of
        // velocity onto the nose at 4 m/s, earlier in the climb, is outside this pass.)
        const jolt = Math.max(...change.slice(Math.max(0, clear - 16), clear + 30))
        console.log(kind, liquid, 'clear', clear / 60, 'handover jolt', jolt)
        expect(jolt).toBeLessThan(20)
        // It went along the nose, not straight up.
        expect(-v.body.translation().z).toBeGreaterThan(v.body.translation().y - surface)
      } finally { v.dispose(); h.world.free() }
    })
    it(`${kind}: nose down drives deeper into ${liquid}`, () => {
      const { h, v, surface } = start(kind, liquid, -20)
      const y0 = v.body.translation().y
      try { h.step(v, 120); expect(v.body.translation().y).toBeLessThan(y0 - .3); expect(v.body.translation().y).toBeLessThan(surface) } finally { v.dispose(); h.world.free() }
    })
  }
})

describe('continuity', () => {
  it('wetness is smooth through submersion 0 and 1', () => {
    let last = liquidWetness(-.1)
    for (let d = -.1; d <= .7; d += .001) { const w = liquidWetness(d); expect(Math.abs(w - last)).toBeLessThan(.004); last = w }
    expect(liquidWetness(0)).toBe(0); expect(liquidWetness(.5)).toBe(1)
  })
  it('lava response is continuous in wetness and stable at long frames', () => {
    const v = { x: 0, y: 0, z: -2 }, out = { x: 0, y: 0, z: 0 }, wing = { x: 0, y: 0, z: 0 }
    let last = lavaVelocityStep(v, { x: 0, z: -1 }, 1, 0, .45, 0, wing, 1 / 60, { x: 0, y: 0, z: 0 }).z
    for (let w = .001; w <= 1; w += .001) {
      lavaVelocityStep(v, { x: 0, z: -1 }, 1, w, .45, 0, wing, 1 / 60, out)
      expect(Math.abs(out.z - last)).toBeLessThan(.01); last = out.z
    }
    for (const dt of [1 / 60, 1 / 30, .25]) {
      const s = { x: 0, y: 0, z: 0 }
      let peak = 0
      for (let t = 0; t < 10; t += dt) { lavaVelocityStep(s, { x: 0, z: -1 }, 1, 1, .45, 0, wing, dt, s); peak = Math.max(peak, -s.z) }
      // Terminal speed is crawl / (viscosity (1 + depth)), 3 m/s, with no overshoot at any step.
      expect(-s.z).toBeCloseTo(lavaDrivePower.value / (lavaViscosity.value * 1.45), 2)
      expect(peak).toBeLessThanOrEqual(lavaDrivePower.value / (lavaViscosity.value * 1.45) + 1e-6)
    }
  })
  it('planing share is continuous in speed', () => {
    let last = 0
    for (let s = 0; s < 40; s += .01) { const p = planingShare(s, 8); expect(Math.abs(p - last)).toBeLessThan(.01); last = p }
    expect(planingShare(7.9, 8)).toBe(0); expect(planingShare(12, 8)).toBe(1)
  })
  it('water force has no step as a hull sweeps through the surface', () => {
    const h = harness(); h.terrain.liquidHeightAt = () => 10; h.terrain.liquidKindAt = () => 'water'
    const b = h.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 12, 0))
    h.world.createCollider(RAPIER.ColliderDesc.cuboid(.8, .5, 1.2), b)
    const f = { x: 0, y: 0, z: 0 }, weight = b.mass() * G
    let last = NaN
    try {
      for (let y = 11; y >= 8; y -= .005) {
        b.setTranslation({ x: 0, y, z: 0 }, true); b.setLinvel({ x: 0, y: 0, z: -10 }, true); b.resetForces(true)
        applyWaterForces(b, h.world, h.terrain, 'buggy', 1 / 60)
        const fy = b.userForce(f).y / weight
        if (Number.isFinite(last)) expect(Math.abs(fy - last)).toBeLessThan(.05)
        last = fy
      }
    } finally { h.world.free() }
  })
})

describe('water floats only fast arrivals', () => {
  for (const kind of ['buggy'] as const) {
    it(`${kind}: a slow entry sinks to the bed and drives along it`, () => {
      const h = harness(); h.terrain.liquidHeightAt = () => 8; h.terrain.liquidKindAt = () => 'water'
      const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, 8.6, 0)); v.isLocal = false
      try {
        v.body.setLinvel({ x: 0, y: 0, z: -2 }, true); h.step(v, 480)
        expect(v.body.translation().y).toBeLessThan(2)
        const z = v.body.translation().z; v.input.y = 1; h.step(v, 300)
        expect(v.body.translation().z).toBeLessThan(z - 2)
      } finally { v.dispose(); h.world.free() }
    })
    it(`${kind}: a fast entry planes, then settles and sinks`, () => {
      const h = harness(); h.terrain.liquidHeightAt = () => 8; h.terrain.liquidKindAt = () => 'water'
      const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, 8.6, 0)); v.isLocal = false
      try {
        v.body.setLinvel({ x: 0, y: 0, z: -25 }, true)
        let low = Infinity
        for (let i = 0; i < 120; i++) { h.step(v); low = Math.min(low, v.body.translation().y) }
        expect(low).toBeGreaterThan(7.3)
        expect(v.body.translation().z).toBeLessThan(-35)
        h.step(v, 600)
        expect(v.body.translation().y).toBeLessThan(3)
      } finally { v.dispose(); h.world.free() }
    })
  }
  it('stays finite and settles at a 1/30 s step', () => {
    const h = harness(); h.terrain.liquidHeightAt = () => 10; h.terrain.liquidKindAt = () => 'water'
    h.world.timestep = 1 / 30
    const b = h.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0))
    h.world.createCollider(RAPIER.ColliderDesc.cuboid(.8, .5, 1.2), b)
    try {
      for (let i = 0; i < 600; i++) { b.resetForces(true); applyWaterForces(b, h.world, h.terrain, 'hovercraft', 1 / 30); h.world.step() }
      expect(Number.isFinite(b.translation().y)).toBe(true)
      expect(Math.abs(b.linvel().y)).toBeLessThan(.1)
    } finally { h.world.free() }
  })
})

describe('lava is wadeable', () => {
  for (const kind of ['buggy', 'jet', 'hovercraft', 'tank'] as const) {
    it(`${kind} drives out of deep lava from a standstill up a nine degree shore`, () => {
      const h = harness(9.81, false), slope = Math.tan(9 * Math.PI / 180)
      h.terrain.heightAt = (_x, z) => -z * slope
      h.terrain.liquidHeightAt = () => 0
      h.terrain.liquidKindAt = (_x, z) => z > 0 ? 'lava' : null
      h.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array([-200, 200 * slope, -200, 200, 200 * slope, -200, -200, -200 * slope, 200, 200, -200 * slope, 200]), new Uint32Array([0, 2, 1, 1, 2, 3])).setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)))
      // 30 m out the bed is 4.75 m down: the vehicle rests at its sink depth, wheels far off the bed.
      const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, -.45, 30)); v.isLocal = false
      try {
        h.step(v, 60); v.input.y = 1; v.input.z = 1
        let maxDepth = 0, out = -1
        for (let i = 0; i < 60 * 40 && out < 0; i++) { h.step(v); maxDepth = Math.max(maxDepth, v.lavaDepth); if (v.body.translation().z < -6) out = i / 60 }
        expect(out).toBeGreaterThan(0)
        expect(v.lavaDepth).toBe(0); expect(v.stuck).toBe(false)
        if (kind !== 'hovercraft') expect(maxDepth).toBeGreaterThan(.3)
      } finally { v.dispose(); h.world.free() }
    })
  }
})


describe('liquid mode compatibility', () => {
  it('defaults to the approved legacy handling', () => {
    const mode = params.get('liquid.legacyEscape')!
    expect(mode.def.default).toBe(true)
    expect(mode.def.scope).toBe('world')
    // The optional drive power must not alter the legacy crawl parameter.
    expect(params.get('lava.crawlPower')!.value).toBe(3)
  })
  for (const liquid of ['water', 'lava'] as const) for (const held of ['kinematic', 'disabled'] as const) {
    it(`leaves ${held} bodies unchanged in ${liquid}`, () => {
      const h = harness()
      h.terrain.liquidHeightAt = () => 8
      h.terrain.liquidKindAt = () => liquid
      const desc = held === 'kinematic' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic()
      const b = h.world.createRigidBody(desc.setTranslation(0, 7, 0))
      h.world.createCollider(RAPIER.ColliderDesc.cuboid(.8, .5, 1.2), b)
      if (held === 'disabled') b.setEnabled(false)
      const state = createLiquidState()
      const before = { position: { ...b.translation() }, velocity: { ...b.linvel() }, rotation: { ...b.rotation() } }
      try {
        applyVehicleLiquid(b, h.world, h.terrain, { x: 1, y: 1, z: 1 }, 'buggy', state, 1 / 60, true)
        expect({ position: { ...b.translation() }, velocity: { ...b.linvel() }, rotation: { ...b.rotation() } }).toEqual(before)
        expect(b.isEnabled()).toBe(held !== 'disabled')
        const force = b.userForce(new THREE.Vector3()), torque = b.userTorque(new THREE.Vector3())
        expect(Math.hypot(force.x, force.y, force.z)).toBe(0)
        expect(Math.hypot(torque.x, torque.y, torque.z)).toBe(0)
      } finally { h.world.free() }
    })
  }
})
