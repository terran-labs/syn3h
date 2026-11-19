/**
 * Plasma Thunder in flight (src/weapons/Lasers.ts), on real physics. Bugs these catch: two
 * players seeing a bolt skip in different places, or burst in different places; a bolt that
 * skips for ever or never; a proximity fuse that goes off before it has armed, or on the
 * shooter's own vehicle, or misses a vehicle right beside its path; a contact that waits for
 * arming; a flare that jumps when the world wraps under the player.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import type { ShotInfo } from '../../shared/protocol'
import type { Game } from '../../src/core/Game'
import { FIXED_DT, RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { Lasers, type LaserHooks } from '../../src/weapons/Lasers'
import { thunderSkips } from '../../src/weapons/thunderParams'

beforeAll(initPhysics)
afterEach(() => vi.unstubAllGlobals())

const SHOOTER = 7

interface Log {
  skips: THREE.Vector3[]
  pushes: THREE.Vector3[]
  detonations: { cause: string; at: THREE.Vector3; victim?: number }[]
}

/** A flat world (ground at y 0) with Lasers on it, and the hooks recorded. */
function world(hooks: Partial<LaserHooks> = {}) {
  const physics = createWorld(0)
  vi.stubGlobal('window', { performance })
  vi.stubGlobal('document', { pointerLockElement: null })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0))
  const game = { world: physics, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), canvas: {}, time: 0, renderer: { toneMappingExposure: 1 } } as unknown as Game
  const log: Log = { skips: [], pushes: [], detonations: [] }
  const lasers = new Lasers(game, {
    bodyOf: () => undefined, judgedId: () => null, isVehicleBody: () => false, onHit: () => {},
    onImpact: (at, red, share = 1) => { if (red && share < 1) log.skips.push(at.clone()); else if (red) log.pushes.push(at.clone()) },
    onDetonate: (_s, _shot, cause, at, victim) => log.detonations.push({ cause, at: at.clone(), victim }),
    ...hooks,
  })
  const run = (steps: number) => { for (let i = 0; i < steps; i++) { lasers.fixedUpdate(FIXED_DT); physics.step(); (game as { time: number }).time += FIXED_DT } }
  return { physics, lasers, log, run, game }
}

/** Fired from 3 m up, slightly down, along -z. */
const shot = (d: [number, number, number] = [0, -0.12, -1]): ShotInfo => ({ id: 1, o: [0, 3, 0], d, boost: 0, t: 0, k: 'red' })

describe('Plasma Thunder in flight', () => {
  it('skips the same way for the shooter and an onlooker, and bursts where the shooter says', () => {
    const shooter = world({ ownsShot: () => true })
    const onlooker = world({ ownsShot: () => false })
    shooter.lasers.spawn(SHOOTER, shot()); onlooker.lasers.spawn(SHOOTER, shot())
    shooter.run(900); onlooker.run(900)
    // The set number of skips, at the same places in both worlds.
    expect(shooter.log.skips).toHaveLength(thunderSkips.value)
    expect(onlooker.log.skips.map(v => v.toArray())).toEqual(shooter.log.skips.map(v => v.toArray()))
    // The shooter's client reports the end and pushes at once; the onlooker waits for the room.
    expect(shooter.log.detonations).toHaveLength(1)
    expect(shooter.log.detonations[0].cause).toBe('end')
    expect(shooter.log.pushes).toHaveLength(1)
    expect(onlooker.log.detonations).toHaveLength(0)
    expect(onlooker.log.pushes).toHaveLength(0)
    // The room's word: the onlooker bursts there, once, with its push.
    const at = shooter.log.detonations[0].at
    onlooker.lasers.detonated(SHOOTER, 1, at, 'end'); onlooker.lasers.detonated(SHOOTER, 1, at, 'end')
    expect(onlooker.log.pushes.map(v => v.toArray())).toEqual([at.toArray()])
  })

  it('goes off by its fuse only once armed, never on the shooter\'s own vehicle, and on a vehicle beside its path', () => {
    // 110 m/s: armed after 0.25 s, about 28 m out. One vehicle 2 m beside the path at 10 m
    // (not yet armed), the shooter's own at 40 m, another 2 m beside the path at 70 m.
    const judged = [
      { id: 21, x: 2, y: 3, z: -10, clearance: 3 },
      { id: SHOOTER, x: 1, y: 3, z: -40, clearance: 3 },
      { id: 22, x: 2, y: 3, z: -70, clearance: 3 },
    ]
    const w = world({ ownsShot: () => true, judged: () => judged })
    w.lasers.spawn(SHOOTER, shot([0, 0, -1]))
    w.run(120)
    expect(w.log.detonations).toHaveLength(1)
    expect(w.log.detonations[0]).toMatchObject({ cause: 'fuse', victim: 22 })
    expect(w.log.detonations[0].at.z).toBeCloseTo(-70, 0)
  })

  it('goes off at once on contact with a vehicle, before it has armed', () => {
    // A vehicle this client judges, 8 m ahead, right in the path.
    let vehicle = -1
    const physics0 = world({ ownsShot: () => true, judgedId: (h) => (h === vehicle ? 31 : null) })
    const body = physics0.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 3, -8))
    physics0.physics.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), body)
    vehicle = body.handle
    physics0.lasers.spawn(SHOOTER, shot([0, 0, -1]))
    physics0.run(10)
    expect(physics0.log.detonations).toHaveLength(1)
    expect(physics0.log.detonations[0]).toMatchObject({ cause: 'contact', victim: 31 })
  })

  it('keeps a bolt on course across the world seam: it ends one tile over, exactly', () => {
    const plain = world({ ownsShot: () => true }), wrapped = world({ ownsShot: () => true })
    plain.lasers.spawn(SHOOTER, shot()); wrapped.lasers.spawn(SHOOTER, shot())
    plain.run(30); wrapped.run(30)
    // The player crossed the seam: everything here moves a tile, 1000 m along x.
    wrapped.lasers.shift(1000, 0)
    wrapped.physics.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(1000, -0.5, 0))
    plain.run(900); wrapped.run(900)
    const a = plain.log.detonations[0].at, b = wrapped.log.detonations[0].at
    expect(b.x - a.x).toBeCloseTo(1000, 4); expect(b.y).toBeCloseTo(a.y, 4); expect(b.z).toBeCloseTo(a.z, 4)
  })
})
