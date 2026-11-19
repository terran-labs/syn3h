/**
 * The owner's rule of 18 November 2026 (AGENTS.md): this is a non-violent game about
 * exploration, and nothing but physics moves a player's vehicle because of where they drove.
 *
 * Bugs caught: the Hill sending a player in lava back to their pad; the hovercraft's hull
 * guard shooting a sunk craft 59 m up to the surface; a resume refusing a pose in liquid; a
 * same-world rebuild sending the player to a spawn pad; a bot's self-recovery hop moving a
 * vehicle a person drives.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Input } from '../../src/core/Input'
import type { Game } from '../../src/core/Game'
import { params } from '../../shared/params'
import { createVehicle, VEHICLE_KINDS, type VehicleKind } from '../../src/vehicles'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { LocalRescue } from '../../src/modes/Koth'
import { BoundsGuard } from '../../src/modes/Tag'
import { BotBrain } from '../../src/bots/BotBrain'
import { reseatPosition } from '../../src/core/worldEntry'
import { harness } from './harness'

beforeAll(initPhysics)
afterEach(() => { for (const p of params.all()) params.set(p.def.id, p.def.default) })

/** A pool 20 m deep over flat ground: deep enough that nothing touches the bed while floating. */
const SURFACE = 20

/**
 * Every non-physics write of the vehicle's position, with what made it. The hovercraft's hull
 * guard is part of how it glides: it keeps the hull a few tenths of a metre clear of the
 * surface each step, so a correction under a metre from it is its own handling, not a move.
 */
function watchWrites(v: Vehicle): string[] {
  const writes: string[] = []
  const set = v.body.setTranslation.bind(v.body)
  v.body.setTranslation = (p, wake) => {
    const at = new Error().stack?.split('\n')[2]?.trim() ?? 'setTranslation', was = v.body.translation()
    const glide = at.includes('Hovercraft.postPhysics') && Math.hypot(p.x - was.x, p.y - was.y, p.z - was.z) < 1
    if (!glide) writes.push(at)
    set(p, wake)
  }
  const teleport = v.teleport.bind(v)
  v.teleport = (p, h) => { writes.push(`teleport ${new Error().stack?.split('\n')[2]?.trim()}`); teleport(p, h) }
  return writes
}

/** The player's vehicle held in a liquid, hands off, with the Hill rescue and the bounds guard running as in play. */
function holdIn(kind: VehicleKind, liquid: 'lava' | 'water', start: 'floating' | 'sunk', seconds: number) {
  const h = harness()
  h.terrain.liquidHeightAt = () => SURFACE
  h.terrain.liquidKindAt = () => liquid
  const input = new Input(new EventTarget() as unknown as Window)
  const game = h.game as unknown as { input: Input; time: number }
  game.input = input; game.time = 0
  const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, start === 'floating' ? SURFACE + 1 : 1.5, 0))
  v.isLocal = true
  const rescue = new LocalRescue(h.game as unknown as Game, h.terrain, v)
  const bounds = new BoundsGuard(v, h.terrain)
  const writes = watchWrites(v)
  for (let i = 0; i < Math.round(seconds / 0.02); i++) {
    h.step(v)
    game.time += 0.02
    rescue.check()
    bounds.postPhysics()
  }
  return { v, writes, rescue }
}

const KINDS: VehicleKind[] = VEHICLE_KINDS.map(vehicle => vehicle.kind)

describe('a player in a liquid is moved by nothing but physics', () => {
  for (const liquid of ['lava', 'water'] as const) for (const start of ['floating', 'sunk'] as const) {
    it.each(KINDS)(`%s held ${start} in deep ${liquid} for a minute`, (kind) => {
      const { v, writes, rescue } = holdIn(kind, liquid, start, 60)
      expect(writes).toEqual([])
      const p = v.body.translation()
      expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true)
      // In lava the Hill counts the player as stuck (off the hill) for as long as it stays in.
      if (liquid === 'lava' && p.y < SURFACE) expect(rescue.stuck).toBe(true)
    }, 60_000)
  }
})

describe('a player on its roof in a shallow pool is moved by nothing but physics', () => {
  // The owner's report on v26.11.1802: he fell into a lava pool and the game "reset" him. It
  // was the automatic uprighting, which measured from the bed, firing under the lava. Lava
  // also held a flipped buggy on its roof for good until the hull's capsize moment
  // (liquidHull.ts, CAPSIZE).
  for (const liquid of ['lava', 'water'] as const) it(`a buggy on its roof in shallow ${liquid} for a minute`, () => {
    const h = harness()
    h.terrain.liquidHeightAt = () => 0.8
    h.terrain.liquidKindAt = () => liquid
    const input = new Input(new EventTarget() as unknown as Window)
    ;(h.game as unknown as { input: Input }).input = input
    const v = createVehicle(h.game, h.terrain, 'buggy', new THREE.Vector3(0, 0.7, 0))
    v.isLocal = true
    v.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI), true)
    const writes = watchWrites(v)
    h.step(v, 3000)
    expect(writes).toEqual([])
    // And the liquid rolls it back onto its wheels, by physics: Flip upright is a convenience.
    const r = v.body.rotation()
    expect(1 - 2 * (r.x * r.x + r.z * r.z)).toBeGreaterThan(0.9)
  }, 60_000)

  it('Flip upright on U still works there, as the player\'s own choice', () => {
    const h = harness()
    h.terrain.liquidHeightAt = () => 0.8
    h.terrain.liquidKindAt = () => 'lava'
    const input = new Input(new EventTarget() as unknown as Window)
    ;(h.game as unknown as { input: Input }).input = input
    const v = createVehicle(h.game, h.terrain, 'buggy', new THREE.Vector3(0, 0.7, 0))
    v.isLocal = true
    v.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI), true)
    h.step(v, 200)
    input.requestFlip()
    h.step(v, 2)
    const r = v.body.rotation()
    expect(1 - 2 * (r.x * r.x + r.z * r.z)).toBeGreaterThan(0.95)
  })
})

describe('every vehicle leaves a pool under its own power', () => {
  // Bugs caught: the jet held on a lava bed by the lava's grip with its lift discarded; any
  // vehicle a player could only leave by being moved. A round pool over a level bed and shore,
  // so this measures the liquid alone. The bound is the pool's radius at walking pace (1 m/s):
  // a vehicle slower than a person walking out has not escaped under its own power.
  const RADIUS = 25, BOUND_S = RADIUS / 1
  for (const liquid of ['lava', 'water'] as const) for (const depth of [1.5, 4, 12]) for (const start of ['surface', 'bed'] as const) {
    it.each(KINDS)(`%s from the ${start} of ${depth} m of ${liquid}`, (kind) => {
      const h = harness()
      h.terrain.liquidHeightAt = (x, z) => Math.hypot(x, z) < RADIUS ? depth : -Infinity
      h.terrain.liquidKindAt = (x, z) => Math.hypot(x, z) < RADIUS ? liquid : null
      const input = new Input(new EventTarget() as unknown as Window)
      ;(h.game as unknown as { input: Input }).input = input
      const v = createVehicle(h.game, h.terrain, kind, new THREE.Vector3(0, start === 'surface' ? depth + 1 : 1.2, 0))
      v.isLocal = true
      h.step(v, 150)
      // Full ahead; the jet climbs on its lift (E) and then pitches forward, as a player flies out.
      let out = Infinity
      for (let i = 0; i < BOUND_S / 0.02 && out === Infinity; i++) {
        Object.assign(input.state, kind === 'jet' ? { y: i < 150 ? 0 : 0.4, z: 1 } : { y: 1 })
        h.step(v)
        const p = v.body.translation()
        if (Math.hypot(p.x, p.z) > RADIUS + 2) out = i * 0.02
      }
      expect(out).toBeLessThan(BOUND_S)
    })
  }
})

describe('nets that may move a player are for broken states only', () => {
  it('a same-world rebuild re-seats the player where it is, on the ground or the liquid, whichever is higher', () => {
    const terrain = { heightAt: () => 4, liquidHeightAt: () => 9 }
    const p = reseatPosition({ x: 120, z: -40 }, terrain)
    expect([p.x, p.z]).toEqual([120, -40])
    expect(p.y).toBeGreaterThan(9)
    expect(p.y).toBeLessThan(12)
    expect(reseatPosition({ x: 0, z: 0 }, { heightAt: () => 4 }).y).toBeGreaterThan(4)
  })

  it('a bot recovery hop never moves a vehicle a person drives', () => {
    const h = harness()
    const you = createVehicle(h.game, h.terrain, 'buggy', new THREE.Vector3(0, 1.5, 0))
    const brain = new BotBrain(h.game, h.terrain, you, you, 0)
    // A brain marks the vehicle it is built for as a bot's; here a person has it again.
    you.isLocal = true
    brain.requestRecovery = () => { you.teleport(new THREE.Vector3(50, 2, 50)); return true }
    const writes = watchWrites(you)
    brain.recover()
    expect(writes).toEqual([])
  })
})
