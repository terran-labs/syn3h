/**
 * Baby duck following (src/bots/duck.ts): bots with minds trail the player in a loose line,
 * hurry to catch up, gather behind at a polite distance when the player stops, and get out
 * of the way when the player backs up. Flat ground, real Rapier buggies, real minds.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Scene, Vector3 } from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import { MiraBuggy } from '../../src/vehicles/MiraBuggy'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { BotBrain, type BotTerrain } from '../../src/bots/BotBrain'
import { Mind } from '../../src/bots/mind/Mind'
import { createPilot } from '../../src/bots/pilot'
import { GATHER_RADIUS } from '../../src/bots/duck'
import { params } from '../../shared/params'
import '../../src/bots/params'

const SIZE = 2000
const terrain = {
  size: SIZE, heightAt: () => 0, normalAt: (_x: number, _z: number, out: Vector3) => out.set(0, 1, 0),
  spawnPoint: (i: number) => ({ position: new Vector3(i * 6, 1, 0), heading: 0 }), dispose() {},
} as unknown as BotTerrain
let world: RAPIER.World
beforeAll(initPhysics)
beforeEach(() => {
  for (const p of params.all().filter(p => p.def.group === 'Bots')) params.set(p.def.id, p.def.default)
  world = createWorld(9.81)
  world.createCollider(RAPIER.ColliderDesc.cuboid(SIZE / 2, 0.5, SIZE / 2).setTranslation(0, -0.5, 0))
})
afterEach(() => world.free())

const DT = 0.02
type Script = (t: number) => Partial<ReturnType<typeof emptyInput>>

function touching(a: Vehicle, b: Vehicle): boolean {
  let hit = false
  for (let i = 0; i < a.body.numColliders(); i++) for (let j = 0; j < b.body.numColliders(); j++) {
    world.contactPair(a.body.collider(i), b.body.collider(j), m => { if (m.numContacts() > 0) hit = true })
  }
  return hit
}

/** The player (heading -z) drives `script`; bots start where `starts` puts them. */
function outing(script: Script, seconds: number, starts: { x: number; z: number }[], sample: (t: number, you: Vehicle, bots: Vehicle[], brains: BotBrain[]) => void) {
  const game = { world, scene: new Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  const you = new MiraBuggy(game, terrain, new Vector3(0, 1, 0)); you.id = 'player'; you.isLocal = false
  const bots: Vehicle[] = [], brains: BotBrain[] = []
  starts.forEach((s, i) => {
    const bot = new MiraBuggy(game, terrain, new Vector3(s.x, 1, s.z)); bot.id = `bot-${i}`; bot.isLocal = false
    const brain = new BotBrain(game, terrain, bot, you, i)
    brain.mind = new Mind(bot, terrain, createPilot(bot, terrain)!, { seed: `duck:${i}`, others: () => [you, ...bots] })
    brain.setTargets([you]); brain.setPeers(bots)
    bots.push(bot); brains.push(brain)
  })
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT
    Object.assign(you.input, emptyInput(), script(t))
    for (const brain of brains) brain.fixedUpdate(DT)
    you.fixedUpdate(DT); for (const bot of bots) bot.fixedUpdate(DT)
    world.step()
    you.postPhysics(DT); for (const bot of bots) bot.postPhysics(DT)
    sample(t, you, bots, brains)
  }
}

/** Where `bot` is relative to the player: distance, and the angle off the player's nose. */
function relative(you: Vehicle, bot: Vehicle) {
  const p = you.body.translation(), q = bot.body.translation(), r = you.body.rotation()
  const fx = -2 * (r.x * r.z + r.w * r.y), fz = -(1 - 2 * (r.x * r.x + r.y * r.y)), fl = Math.hypot(fx, fz) || 1
  const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz) || 1
  return { distance: d, offNose: Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (d * fl)))) }
}

const ring = (n: number, r: number) => Array.from({ length: n }, (_, i) => ({ x: Math.cos(i * 2.4) * r, z: 20 + Math.sin(i * 2.4) * r }))

describe('baby duck following', () => {
  it('follows by default: most of the time close by, and behind rather than in front', () => {
    let near = 0, samples = 0, blocking = 0
    outing(t => ({ y: 0.2, x: Math.sin(t * 0.15) * 0.4 }), 120, ring(4, 15), (t, you, bots) => {
      if (t < 10) return
      for (const bot of bots) {
        const r = relative(you, bot)
        samples++
        if (r.distance < 35) near++
        // In the player's path: close and within 30 degrees of the nose.
        if (r.distance < 15 && r.offNose < Math.PI / 6) blocking++
      }
    })
    // Default bots.followYou is 0.8, with short distractions between.
    expect(near / samples, `blocking ${blocking / samples}`).toBeGreaterThan(0.6)
    // Out of the way: a following bot does not park itself in the player's path. Measured on
    // 26 November 2026 over 15 small variations of this weave, the share ranged 0 to 11.1%
    // (medians 1.2% Balanced, 0.9% Assisted), so the old 2% limit was a coin flip on any
    // handling change. A bot that really sits in the way reads 30% or more.
    expect(blocking / samples, `near ${near / samples}`).toBeLessThan(0.15)
  }, 120000)

  it('hurries to catch up from far behind', () => {
    params.set('bots.followYou', 1)
    let first = Infinity, last = Infinity, fastest = 0, leader = 0
    outing(() => ({ y: 0.2 }), 40, [{ x: 0, z: 110 }], (t, you, bots) => {
      const r = relative(you, bots[0]), v = bots[0].body.linvel(), u = you.body.linvel()
      if (t < 0.1) first = r.distance
      if (t > 35) last = Math.min(last, r.distance)
      fastest = Math.max(fastest, Math.hypot(v.x, v.z)); leader = Math.max(leader, Math.hypot(u.x, u.z))
    })
    expect(first).toBeGreaterThan(100)
    expect(last).toBeLessThan(25)
    // Hurrying: faster than the player ever went.
    expect(fastest).toBeGreaterThan(leader + 2)
  }, 60000)

  it('gathers behind at a polite distance when the player stops, leaving the way ahead clear', () => {
    params.set('bots.followYou', 1)
    const end: { distance: number; offNose: number }[] = []
    outing(t => t < 25 ? { y: 0.2 } : { brakes: true }, 50, ring(5, 12), (t, you, bots) => {
      if (t > 49.9) for (const bot of bots) end.push(relative(you, bot))
    })
    for (const r of end) {
      expect(r.distance, JSON.stringify(end)).toBeGreaterThan(GATHER_RADIUS - 5)
      expect(r.distance, JSON.stringify(end)).toBeLessThan(GATHER_RADIUS + 10)
      // Nobody parks in front: at least 60 degrees off the player's nose.
      expect(r.offNose, JSON.stringify(end)).toBeGreaterThan(Math.PI / 3)
    }
  }, 60000)

  it('gives way when the player reverses into the gathered line', () => {
    params.set('bots.followYou', 1)
    let contacts = 0, bumpedWhileBacking = 0
    const was: boolean[] = []
    outing(t => t < 20 ? { y: 0.2 } : t < 35 ? { brakes: true } : { y: -0.3 }, 42, ring(4, 12), (t, you, bots) => {
      bots.forEach((bot, b) => {
        const now = touching(bot, you)
        if (now && !was[b]) { contacts++; if (t >= 35) bumpedWhileBacking++ }
        was[b] = now
      })
    })
    expect(bumpedWhileBacking).toBe(0)
    expect(contacts).toBe(0)
  }, 60000)
})
