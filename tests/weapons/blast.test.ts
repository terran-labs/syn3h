/**
 * Impacts push (src/weapons/blast.ts): the falloff is smooth and monotonic, a bystander at
 * the edge barely moves, the limits hold, and Plasma Thunder fired into the ground under a
 * vehicle at rest throws every kind of vehicle into the air, turning.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { FIXED_DT, createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import { emptyInput } from '../../src/core/Input'
import type { Game } from '../../src/core/Game'
import type { Terrain } from '../../src/world/Terrain'
import { createVehicle } from '../../src/vehicles'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { params } from '../../shared/params'
import { Blast, blastFalloff, blastPush } from '../../src/weapons/blast'
import { BLAST_BUDGET, BLAST_MAX, blastSpec, thunderBlastPush, thunderBlastRadius } from '../../src/weapons/blastParams'

beforeAll(initPhysics)

function flat() {
  const world = createWorld(9.81)
  world.createCollider(RAPIER.ColliderDesc.cuboid(400, 1, 400).setTranslation(0, -1, 0))
  const game = { world, scene: new T.Scene(), input: { state: emptyInput() }, time: 0 } as unknown as Game
  const terrain = { size: 800, heightAt: () => 0, normalAt: (_x: number, _z: number, out: T.Vector3) => out.set(0, 1, 0), spawnPoint: () => ({ position: new T.Vector3(0, 2, 0), heading: 0 }), dispose() {} } as unknown as Terrain
  world.step()
  return { world, game, terrain }
}
const step = (l: ReturnType<typeof flat>, v: Vehicle) => { v.fixedUpdate(FIXED_DT); l.world.step(); v.postPhysics(FIXED_DT); (l.game as { time: number }).time += FIXED_DT }

describe('impact push', () => {
  it('falls off smoothly and monotonically to nothing at the radius', () => {
    expect(blastFalloff(0, 10)).toBe(1)
    expect(blastFalloff(10, 10)).toBe(0)
    expect(blastFalloff(11, 10)).toBe(0)
    let last = 1
    for (let d = 0.1; d <= 10; d += 0.1) {
      const k = blastFalloff(d, 10)
      expect(k).toBeLessThanOrEqual(last)
      last = k
    }
    // A bystander at the edge barely moves.
    const edge = blastPush([13.5, 0, 0], { radius: 14, push: 16, lift: 0.45 })!
    expect(Math.hypot(...edge)).toBeLessThan(0.1)
    expect(blastPush([14, 0, 0], { radius: 14, push: 16, lift: 0.45 })).toBeNull()
  })

  it('points away from the blast with lift, straight up from right on top of it, and never past the limit', () => {
    const side = blastPush([3, 0, 0], { radius: 14, push: 16, lift: 0.45 })!
    expect(side[0]).toBeGreaterThan(0)
    expect(side[1]).toBeGreaterThan(0)
    expect(side[2]).toBe(0)
    const top = blastPush([0, 0, 0], { radius: 14, push: 16, lift: 0.45 })!
    expect(top[0]).toBe(0)
    expect(top[1]).toBeCloseTo(16)
    const huge = blastPush([0, 1, 0], { radius: 14, push: 500, lift: 0 })!
    expect(Math.hypot(...huge)).toBeLessThanOrEqual(BLAST_MAX)
  })

  it('throws every vehicle into the air, turning, when Plasma Thunder lands under it', () => {
    params.set(thunderBlastPush.def.id, thunderBlastPush.def.default)
    params.set(thunderBlastRadius.def.id, thunderBlastRadius.def.default)
    for (const kind of ['buggy', 'jet', 'hovercraft', 'tank'] as const) {
      const l = flat()
      const v = createVehicle(l.game, l.terrain, kind, new T.Vector3(0, 1.5, 0), 0)
      v.isLocal = false
      for (let i = 0; i < 90; i++) step(l, v)
      const rest = v.body.translation().y
      const blast = new Blast(l.game, { vehicleIds: () => [1, 2], bodyOf: id => (id === 1 ? v.body : undefined), owns: id => id === 1, wrapSize: () => 0 })
      // Fired down from the nose: the bolt lands on the ground a little ahead of the centre.
      blast.at('thunder', { x: 0, y: 0, z: -1.5 })
      expect(blast.stats.pushed).toBe(1)
      let top = rest, spin = 0
      for (let i = 0; i < 180; i++) {
        step(l, v)
        const p = v.body.translation(), w = v.body.angvel()
        expect(Number.isFinite(p.y)).toBe(true)
        top = Math.max(top, p.y)
        spin = Math.max(spin, Math.hypot(w.x, w.y, w.z))
      }
      expect(top - rest, `${kind} height`).toBeGreaterThan(4)
      expect(spin, `${kind} spin`).toBeGreaterThan(0.5)
      v.dispose(); l.world.free()
    }
  }, 120000)

  it('pushes only vehicles this client simulates, and caps a pile of impacts', () => {
    const l = flat()
    const mk = (x: number) => l.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 5, 0).setGravityScale(0).setAdditionalMass(500))
    const mine = mk(0), theirs = mk(2)
    // A body's mass is only known to the solver after a step.
    l.world.step()
    const blast = new Blast(l.game, { vehicleIds: () => [1, 2], bodyOf: id => (id === 1 ? mine : theirs), owns: id => id === 1, wrapSize: () => 0 })
    for (let i = 0; i < 10; i++) blast.at('thunder', { x: 0, y: 4, z: 0 })
    const v = mine.linvel(), o = theirs.linvel()
    expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(blastSpec('thunder').push * 0.9)
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(BLAST_BUDGET + 1e-3)
    expect(Math.hypot(o.x, o.y, o.z)).toBe(0)
    // Off for the room: nothing moves.
    params.set('blast.allowed', false)
    const before = blast.stats.blasts
    blast.at('thunder', { x: 0, y: 4, z: 0 })
    expect(blast.stats.blasts).toBe(before)
    params.set('blast.allowed', true)
    l.world.free()
  })

  it('reaches across the seam of a wrapping world', () => {
    const l = flat()
    const body = l.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(499, 5, 0).setGravityScale(0).setAdditionalMass(500))
    l.world.step()
    const blast = new Blast(l.game, { vehicleIds: () => [1], bodyOf: () => body, owns: () => true, wrapSize: () => 1000 })
    blast.at('thunder', { x: -499, y: 5, z: 0 })
    // The blast is 2 m away the short way round, on the far side: pushed in -x.
    expect(body.linvel().x).toBeLessThan(-5)
    l.world.free()
  })
})
