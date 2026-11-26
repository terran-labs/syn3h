/**
 * Plasma Thunder bursts in the air within its airburst time (the owner, 26 November 2026: "The red
 * laser should also detonate within 5 seconds of being fired into the sky"). Bugs these catch: a
 * bolt fired upward that flies on for seconds and bursts out of sight; an airburst the room refuses
 * (so only the shooter sees it); a bolt under the sea that bursts at old age.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import type { ShotInfo } from '../../shared/protocol'
import type { Game } from '../../src/core/Game'
import { FIXED_DT, RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { Lasers, type LaserHooks } from '../../src/weapons/Lasers'
import { bigRedSpeed } from '../../src/weapons/bigRedParams'
import { laserLifetime, laserSpeed } from '../../src/weapons/params'
import { thunderFlareHeight, thunderLife as thunderLifeParam } from '../../src/weapons/thunderParams'
import { burstPointPlausible, thunderLife, type V3 } from '../../src/weapons/thunderRules'

beforeAll(initPhysics)
afterEach(() => vi.unstubAllGlobals())

const SHOOTER = 7
/** The room's tile at the default planet size, and its burst ceiling's reach for a Thunder bolt. */
const SIZE = 2048
const limit = () => thunderLife(laserLifetime(laserSpeed.value), thunderLifeParam.value)
const reach = () => bigRedSpeed.value * limit()

function world(hooks: Partial<LaserHooks> = {}, sea?: number) {
  const physics = createWorld(0)
  vi.stubGlobal('window', { performance })
  vi.stubGlobal('document', { pointerLockElement: null })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0))
  const game = { world: physics, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), canvas: {}, time: 0, renderer: { toneMappingExposure: 1 } } as unknown as Game
  const bursts: { cause: string; at: V3; t: number }[] = []
  const level = () => (sea === undefined ? -Infinity : sea)
  const terrain = { liquidHeightAt: level, liquidLevelAt: level, liquidKindAt: () => (sea === undefined ? null : 'water' as const), heightAt: () => 0, surfaceAt: () => 'rock' as const }
  const lasers = new Lasers(game, {
    bodyOf: () => undefined, judgedId: () => null, isVehicleBody: () => false, onHit: () => {},
    onDetonate: (_s, _shot, cause, at) => bursts.push({ cause, at: [at.x, at.y, at.z], t: (game as { time: number }).time }),
    terrain: () => terrain, ownsShot: () => true,
    ...hooks,
  })
  const run = (seconds: number) => { for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) { lasers.fixedUpdate(FIXED_DT); physics.step(); (game as { time: number }).time += FIXED_DT } }
  return { lasers, bursts, run }
}

const shot = (o: V3, d: V3): ShotInfo => ({ id: 1, o, d, boost: 0, t: 0, k: 'red' })

describe('Plasma Thunder in the sky', () => {
  it('bursts in the air by the limit at any upward angle, and the room accepts the burst', () => {
    expect(limit()).toBeLessThanOrEqual(thunderLifeParam.value)
    for (const degrees of [5, 30, 60, 90]) {
      const a = degrees * Math.PI / 180
      const w = world()
      w.lasers.spawn(SHOOTER, shot([0, 3, 0], [0, Math.sin(a), -Math.cos(a)]))
      w.run(limit() + 0.5)
      expect(w.bursts, `${degrees}°`).toHaveLength(1)
      expect(w.bursts[0].cause).toBe('end')
      expect(w.bursts[0].t).toBeLessThanOrEqual(limit() + FIXED_DT * 1.5)
      expect(burstPointPlausible(w.bursts[0].at, SIZE, thunderFlareHeight.value, reach())).toBe(true)
    }
  })

  it('is accepted by the room from a high start, where the old ceiling refused it, and an absurd point still is not', () => {
    // Fired straight up from 600 m (a peak, a jet): it bursts above the old ceiling.
    const w = world()
    w.lasers.spawn(SHOOTER, shot([0, 600, 0], [0, 1, 0]))
    w.run(limit() + 0.5)
    const at = w.bursts[0].at
    expect(burstPointPlausible(at, SIZE, thunderFlareHeight.value)).toBe(false)
    expect(burstPointPlausible(at, SIZE, thunderFlareHeight.value, reach())).toBe(true)
    expect(burstPointPlausible([0, 1e6, 0], SIZE, thunderFlareHeight.value, reach())).toBe(false)
    expect(burstPointPlausible([1e30, 0, 0], SIZE, thunderFlareHeight.value, reach())).toBe(false)
  })

  it('never bursts when it went into the sea, however long it is left', () => {
    const w = world({}, 1)
    w.lasers.spawn(SHOOTER, shot([0, 3, 0], [0, -0.3, -1]))
    w.run(limit() + 2)
    expect(w.bursts).toEqual([])
  })
})
