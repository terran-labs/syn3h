/**
 * Plasma Thunder never detonates under water or lava (the owner, 26 November 2026: "The red laser
 * should not detonate underwater"). Bugs these catch: a bolt that goes off on the seabed, by its
 * fuse beside a submerged vehicle, or at the nose when fired submerged; a burst the room reports
 * from under the sea drawn for everyone; and, the other way, a bolt that no longer bursts on a
 * vehicle floating with its hull above the water, a burst at the waterline that vanishes for some
 * players, or two clients that disagree on where a bolt went under.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import type { ShotInfo } from '../../shared/protocol'
import { WAVE_MAX_AMPLITUDE } from '../../shared/water/waves'
import type { Game } from '../../src/core/Game'
import { FIXED_DT, RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { Lasers, type LaserHooks } from '../../src/weapons/Lasers'
import { BURST_UNDER_MARGIN, QUENCH_LENGTH, burstKept, fuseSenses, submergedAt, thunderEnding, underLiquid, type ThunderCause, type V3 } from '../../src/weapons/thunderRules'

beforeAll(initPhysics)
afterEach(() => vi.unstubAllGlobals())

const CAUSES: ThunderCause[] = ['contact', 'fuse', 'end']

describe('the rule', () => {
  it('never yields a blast below the surface, and leaves every cause as it was above it', () => {
    let seed = 3
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 500; i++) {
      const level = random() * 20 - 5, at: V3 = [random() * 100, level + (random() - 0.5) * 10, random() * 100]
      for (const cause of CAUSES) {
        const ending = thunderEnding(cause, at, level)
        if (at[1] < level) expect(ending).toBe('quench')
        else expect(ending).toBe(cause)
      }
    }
    // Dry ground (no liquid): never quenched.
    for (const cause of CAUSES) expect(thunderEnding(cause, [0, -100, 0], -Infinity)).toBe(cause)
  })

  it('finds where a flight goes under, including under a crest between its ends', () => {
    const flat = () => 1
    expect(submergedAt([0, 3, 0], [0, 2, -10], flat)).toBeNull()
    expect(submergedAt([0, 0.5, 0], [0, 0.5, -10], flat)).toBe(0)
    const t = submergedAt([0, 2, 0], [0, 0, -10], flat)!
    expect(2 - 2 * t).toBeLessThanOrEqual(1)
    expect(2 - 2 * t).toBeGreaterThan(0.99)
    // Level at both ends, but a crest rises over the middle of the step.
    const crest = (_x: number, z: number) => (z < -4 && z > -6 ? 2.5 : 1)
    expect(submergedAt([0, 2, 0], [0, 2, -10], crest)).not.toBeNull()
  })

  it('keeps every burst the room reports at the waterline, whatever the waves, and drops only one clearly under it', () => {
    const rest = 4
    for (const off of [-WAVE_MAX_AMPLITUDE, -WAVE_MAX_AMPLITUDE / 2, 0, WAVE_MAX_AMPLITUDE / 2, WAVE_MAX_AMPLITUDE, 20]) expect(burstKept([0, rest + off, 0], rest)).toBe(true)
    expect(burstKept([0, rest - WAVE_MAX_AMPLITUDE - BURST_UNDER_MARGIN - 0.01, 0], rest)).toBe(false)
    expect(burstKept([0, -500, 0], -Infinity)).toBe(true)
  })

  it('protects only what is under the surface: a hull above it is not', () => {
    expect(underLiquid([0, 1.2, 0], 1)).toBe(false)
    expect(thunderEnding('contact', [0, 1.2, 0], 1)).toBe('contact')
    expect(thunderEnding('contact', [0, 0.8, 0], 1)).toBe('quench')
    // The fuse senses a vehicle floating at the surface, not one under it.
    expect(fuseSenses([0, 1, 0], 1)).toBe(true)
    expect(fuseSenses([0, 0.4, 0], 1)).toBe(false)
    expect(fuseSenses([0, -50, 0], -Infinity)).toBe(true)
  })
})

const SHOOTER = 7
/** The sea begins 40 m out along -z, 1 m deep over ground at 0. */
const SEA = (_x: number, z: number) => (z < -40 ? 1 : -Infinity)

interface Log { detonations: { cause: string; victim?: number }[]; pushes: number; quenches: { at: THREE.Vector3; nose: boolean }[]; hits: { victim: number; red: boolean }[]; bursts: number }

function world(hooks: Partial<LaserHooks> = {}, sea = SEA) {
  const physics = createWorld(0)
  vi.stubGlobal('window', { performance })
  vi.stubGlobal('document', { pointerLockElement: null })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0))
  const game = { world: physics, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), canvas: {}, time: 0, renderer: { toneMappingExposure: 1 } } as unknown as Game
  const log: Log = { detonations: [], pushes: 0, quenches: [], hits: [], bursts: 0 }
  const terrain = { liquidHeightAt: sea, liquidLevelAt: sea, liquidKindAt: (x: number, z: number) => (Number.isFinite(sea(x, z)) ? 'water' as const : null), heightAt: () => 0, surfaceAt: () => 'rock' as const }
  const lasers = new Lasers(game, {
    bodyOf: () => undefined, judgedId: () => null, isVehicleBody: () => false,
    onHit: (_s, _shot, victim, _at, _dir, red) => log.hits.push({ victim, red }),
    onImpact: (_at, red, share = 1) => { if (red && share >= 1) log.pushes++ },
    onDetonate: (_s, _shot, cause, _at, victim) => log.detonations.push({ cause, victim }),
    onQuench: (_s, at, nose) => log.quenches.push({ at: at.clone(), nose }),
    onBurst: () => { log.bursts++ },
    terrain: () => terrain,
    ownsShot: () => true,
    ...hooks,
  })
  const run = (steps: number) => { for (let i = 0; i < steps; i++) { lasers.fixedUpdate(FIXED_DT); physics.step(); (game as { time: number }).time += FIXED_DT } }
  return { physics, lasers, log, run }
}

/** From 3 m up, falling 0.04 m per metre along -z: it reaches the sea's 1 m surface 50 m out (armed by then). */
const shot = (o: V3 = [0, 3, 0], d: V3 = [0, -0.04, -1]): ShotInfo => ({ id: 1, o, d, boost: 0, t: 0, k: 'red' })

describe('Plasma Thunder meeting the sea', () => {
  it('goes under quietly from above: one splash and fizz, no burst, no push, no report; shooter and onlooker agree', () => {
    const shooter = world(), onlooker = world({ ownsShot: () => false })
    shooter.lasers.spawn(SHOOTER, shot()); onlooker.lasers.spawn(SHOOTER, shot())
    shooter.run(300); onlooker.run(300)
    for (const w of [shooter, onlooker]) {
      expect(w.log.detonations).toEqual([])
      expect(w.log.pushes).toBe(0)
      expect(w.log.bursts).toBe(0)
      expect(w.log.quenches).toHaveLength(1)
      expect(w.log.quenches[0].nose).toBe(false)
      expect(w.log.quenches[0].at.y).toBeLessThanOrEqual(1)
      expect(w.log.quenches[0].at.y).toBeGreaterThan(1 - 0.1)
    }
    expect(onlooker.log.quenches[0].at.toArray()).toEqual(shooter.log.quenches[0].at.toArray())
    // Nothing is left of it a short way under.
    onlooker.lasers.update(0.016, 1)
    expect(onlooker.lasers.drawnSpan(SHOOTER, 1)).toBeNull()
  })

  it('fizzles at the nose when fired under water', () => {
    const w = world({}, () => 1)
    w.lasers.spawn(SHOOTER, shot([0, 0.5, 0], [0, 0, -1]))
    w.run(5)
    expect(w.log.quenches).toEqual([{ at: expect.anything(), nose: true }])
    expect(w.log.detonations).toEqual([])
    expect(w.log.bursts).toBe(0)
  })

  it('does not go off by its fuse beside a submerged vehicle; on dry ground the same pass does', () => {
    // 2 m beyond where it goes under, a little to the side, under the water.
    const judged = () => [{ id: 22, x: 1, y: 0.4, z: -52, clearance: 0.4 }]
    const wet = world({ judged })
    wet.lasers.spawn(SHOOTER, shot()); wet.run(300)
    expect(wet.log.detonations).toEqual([])
    expect(wet.log.quenches).toHaveLength(1)
    const dry = world({ judged }, () => -Infinity)
    dry.lasers.spawn(SHOOTER, shot()); dry.run(300)
    expect(dry.log.detonations[0]).toMatchObject({ cause: 'fuse', victim: 22 })
  })

  it('still tags a vehicle it meets under water before it is quenched, with no burst and no Thunder shove', () => {
    let handle = -1
    const w = world({ judgedId: (h) => (h === handle ? 41 : null) })
    const body = w.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.9, -51.5))
    w.physics.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.4, 0.4), body)
    handle = body.handle
    expect(QUENCH_LENGTH).toBeGreaterThan(1.5)
    w.lasers.spawn(SHOOTER, shot()); w.run(300)
    expect(w.log.hits).toEqual([{ victim: 41, red: false }])
    expect(w.log.detonations).toEqual([])
    expect(w.log.bursts).toBe(0)
  })

  it('bursts as always on a vehicle floating with its hull above the water', () => {
    let handle = -1
    const w = world({ judgedId: (h) => (h === handle ? 51 : null) })
    // Over the sea (1 m), hull from 1.5 to 2.5 m, right in a level path at 2 m.
    const body = w.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 2, -45))
    w.physics.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.5, 1), body)
    handle = body.handle
    w.lasers.spawn(SHOOTER, shot([0, 2, 0], [0, 0, -1])); w.run(60)
    expect(w.log.detonations[0]).toMatchObject({ cause: 'contact', victim: 51 })
    expect(w.log.quenches).toEqual([])
  })

  it('draws a burst the room reports at the waterline, and none reported from clearly under the sea', () => {
    const w = world({ ownsShot: () => false })
    w.lasers.detonated(SHOOTER, 5, new THREE.Vector3(0, 1 - WAVE_MAX_AMPLITUDE, -60), 'contact')
    expect(w.log.bursts).toBe(1)
    w.lasers.detonated(SHOOTER, 6, new THREE.Vector3(0, 1 - WAVE_MAX_AMPLITUDE - BURST_UNDER_MARGIN - 0.5, -60), 'end')
    expect(w.log.bursts).toBe(1)
  })
})
