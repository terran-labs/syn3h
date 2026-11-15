/**
 * Ramming only when aggression is turned up. At the default a chasing bot catches up, matches
 * speed and keeps a small gap; above RAM_AGGRESSION the original pursuit rams.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Scene, Vector3 } from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import type { Terrain } from '../../src/world/Terrain'
import { BotBrain, type BotMatch } from '../../src/bots/BotBrain'
import { RAM_AGGRESSION } from '../../src/bots/params'
import { params } from '../../shared/params'

const SIZE = 500
const terrain: Terrain = {
  size: SIZE, heightAt: () => 0, normalAt: (_x, _z, out) => out.set(0, 1, 0),
  spawnPoint: (i) => ({ position: new Vector3(i * 6, 1, 0), heading: 0 }), dispose() {},
}
let world: RAPIER.World
beforeAll(initPhysics)
beforeEach(() => {
  for (const p of params.all().filter(p => p.def.group === 'Bots')) params.set(p.def.id, p.def.default)
  world = createWorld(9.81)
  world.createCollider(RAPIER.ColliderDesc.cuboid(SIZE / 2, 0.5, SIZE / 2).setTranslation(0, -0.5, 0))
})
afterEach(() => world.free())

const DT = 0.02
/** A contact begun with the bot closing faster than this (about 7 km/h) is a ram, not a nudge. m/s. */
const LOW_CLOSING = 2

function touching(a: Vehicle, b: Vehicle): boolean {
  let hit = false
  for (let i = 0; i < a.body.numColliders(); i++) for (let j = 0; j < b.body.numColliders(); j++) {
    world.contactPair(a.body.collider(i), b.body.collider(j), m => { if (m.numContacts() > 0) hit = true })
  }
  return hit
}

/**
 * Three bots chase the player for `seconds`. The player either sits still or drives a loop
 * that slows, stops and sets off again. Counts contacts each bot began while closing on the
 * player faster than LOW_CLOSING, measured the step before the touch.
 */
function chase(player: 'still' | 'moving', seconds: number, match: (bots: Vehicle[], you: Vehicle) => BotMatch | null = () => null) {
  const game = { world, scene: new Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  const you = new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0)); you.id = 'player'; you.isLocal = false
  const bots: Syn3hBuggy[] = [], brains: BotBrain[] = []
  for (let i = 0; i < 3; i++) {
    const bot = new Syn3hBuggy(game, terrain, new Vector3(Math.cos(i * 2.1) * 40, 1, Math.sin(i * 2.1) * 40)); bot.id = `bot-${i}`
    const brain = new BotBrain(game, terrain, bot, you, i)
    brain.setTargets([you]); brain.setPeers(bots)
    bots.push(bot); brains.push(brain)
  }
  const m = match(bots, you)
  for (const brain of brains) brain.match = m
  let rams = 0, touches = 0, nearest = Infinity
  const was = bots.map(() => false), closing = bots.map(() => 0)
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT
    if (player === 'still') Object.assign(you.input, emptyInput(), { brakes: true })
    else Object.assign(you.input, emptyInput(), { y: t % 20 < 14 ? 0.5 : 0, brakes: t % 20 >= 14, x: t % 20 < 14 ? 0.35 : 0 })
    for (const brain of brains) brain.fixedUpdate(DT)
    you.fixedUpdate(DT); for (const bot of bots) bot.fixedUpdate(DT)
    world.step()
    you.postPhysics(DT); for (const bot of bots) bot.postPhysics(DT)
    const p = you.body.translation()
    bots.forEach((bot, b) => {
      const q = bot.body.translation(), dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz) || 1
      nearest = Math.min(nearest, d)
      const now = touching(bot, you)
      if (now && !was[b]) { touches++; if (closing[b] > LOW_CLOSING) rams++ }
      was[b] = now
      // The bot's own speed toward the player: whose doing a touch is.
      const v = bot.body.linvel(); closing[b] = (v.x * dx + v.z * dz) / d
    })
  }
  return { rams, touches, nearest }
}

describe('bots ram only when aggression is turned up', () => {
  it('the threshold sits above the default aggression', () => {
    expect(params.get('bots.aggression')!.def.default).toBeLessThan(RAM_AGGRESSION)
  })

  it.each(['still', 'moving'] as const)('at default aggression: no rams on a %s player, yet they keep close', (player) => {
    const r = chase(player, 90)
    expect(r.rams, JSON.stringify(r)).toBe(0)
    // Still company: they come within a few lengths.
    expect(r.nearest).toBeLessThan(14)
  }, 120000)

  it('above the threshold the original pursuit rams', () => {
    params.set('bots.aggression', 2)
    const r = chase('still', 30)
    expect(r.rams, JSON.stringify(r)).toBeGreaterThan(0)
  }, 60000)

  it('in tag a bot that is "it" still touches the player, gently', () => {
    const r = chase('still', 60, (bots) => ({ mode: 'tag', it: bots[0] }))
    expect(r.touches, JSON.stringify(r)).toBeGreaterThan(0)
    expect(r.rams, JSON.stringify(r)).toBe(0)
  }, 60000)
})
