/**
 * Bots are playful company by default. These tests pin the defaults the owner asked for: in
 * free play a bot never uses a tag beam or any other gear on anyone unless the room turns it
 * on (bots.tagBeams). In the games (Tag, King of the Hill) the owner asked for gear on
 * 18 November 2026, under its own switch (bots.gameGear), which a host can turn off.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Scene, Vector3 } from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import { MiraBuggy } from '../../src/vehicles/MiraBuggy'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import type { Terrain } from '../../src/world/Terrain'
import { BotBrain, type BotMatch } from '../../src/bots/BotBrain'
import type { BotGearHooks } from '../../src/bots/gear'
import { params } from '../../shared/params'
import '../../src/bots/params'

const SIZE = 400
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

function touching(a: Vehicle, b: Vehicle): boolean {
  let hit = false
  for (let i = 0; i < a.body.numColliders(); i++) for (let j = 0; j < b.body.numColliders(); j++) {
    world.contactPair(a.body.collider(i), b.body.collider(j), m => { if (m.numContacts() > 0) hit = true })
  }
  return hit
}

/**
 * A scripted session: the player drives slow loops round the middle of the map with four
 * bots in tow, for `seconds`. Returns how often any bot asked to fire or used gear.
 */
function session(mode: 'free' | 'tag-player-it' | 'tag-bot-it' | 'hill', seconds: number) {
  const game = { world, scene: new Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  const player = new MiraBuggy(game, terrain, new Vector3(0, 1, 0)); player.id = 'player'; player.isLocal = false
  const bots: Vehicle[] = [], brains: BotBrain[] = []
  let gearUses = 0, beams = 0, farthest = 0, travelled = 0
  // Gear the room would offer if it allowed: every kind, in range of anything.
  const hooks: BotGearHooks = {
    available: () => [{ id: 'pester', range: 500, cooldown: 1 }, { id: 'yoink', range: 500, cooldown: 1 }, { id: 'red', range: 500, cooldown: 1, chargeSeconds: 0.5 }, { id: 'bungee', range: 500, cooldown: 1 }],
    threats: () => [],
    act: (_vehicle, action) => { if (action.phase === 'press') gearUses++ },
  }
  for (let i = 0; i < 4; i++) {
    const bot = new MiraBuggy(game, terrain, new Vector3(Math.cos(i * 1.6) * 30, 1, Math.sin(i * 1.6) * 30)); bot.id = `bot-${i}`
    const brain = new BotBrain(game, terrain, bot, player, i)
    brain.setGear(hooks); brain.setTargets([player]); brain.setPeers(bots)
    bots.push(bot); brains.push(brain)
  }
  const match: BotMatch | null = mode === 'free' ? null : mode === 'hill' ? { mode: 'hill', zone: { x: 40, z: 40, radius: 12 } } : { mode: 'tag', it: mode === 'tag-player-it' ? player : bots[0] }
  for (const brain of brains) {
    brain.match = match
    // The bot manager's game targets: in tag everyone goes for "it"; on the hill nobody is in the zone.
    if (match?.mode === 'tag' && match.it !== brain.vehicle) brain.gameTarget = match.it ?? null
  }
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT
    // The player drives slow loops that stay on the map, and stops now and then.
    Object.assign(player.input, emptyInput(), { y: t % 40 < 32 ? 0.2 : 0, brakes: t % 40 >= 32, x: 0.35 + Math.sin(t * 0.4) * 0.2 })
    for (const brain of brains) { brain.fixedUpdate(DT); if (brain.vehicle.input.fire) beams++ }
    player.fixedUpdate(DT); for (const bot of bots) bot.fixedUpdate(DT)
    world.step()
    player.postPhysics(DT); for (const bot of bots) bot.postPhysics(DT)
    // In tag the room passes "it" on contact (server/room.ts onRam). Do the same here, so a
    // bot that is "it" does not stay glued to the player's bumper for five minutes.
    if (match?.mode === 'tag' && match.it !== player && touching(match.it!, player)) match.it = player
    const q = player.body.translation(), v = player.body.linvel()
    farthest = Math.max(farthest, Math.hypot(q.x, q.z)); travelled += Math.hypot(v.x, v.z) * DT
  }
  return { beams, gearUses, farthest, travelled }
}

describe('bots do not fire by default', () => {
  it('the tag beam setting is off by default, under an id old saved worlds do not carry', () => {
    expect(params.get('bots.tagBeams')?.def.default).toBe(false)
    // The old id is gone: a stored 'bots.canFire: true' is an unknown value and is ignored.
    expect(params.get('bots.canFire')).toBeUndefined()
    params.applySnapshot({ 'bots.canFire': true }, 'remote')
    expect(params.get('bots.tagBeams')?.value).toBe(false)
  })

  it('free play: no beam and no gear across five minutes', () => {
    const mode = 'free'
    const r = session(mode, 300)
    // The session is real: the player drives hundreds of metres and stays on the map.
    expect(r.travelled, JSON.stringify(r)).toBeGreaterThan(300)
    expect(r.farthest, JSON.stringify(r)).toBeLessThan(SIZE / 2 - 10)
    expect({ beams: r.beams, gearUses: r.gearUses }).toEqual({ beams: 0, gearUses: 0 })
  }, 120000)

  it.each(['tag-player-it', 'tag-bot-it', 'hill'] as const)('%s with game gear off: no beam and no gear across five minutes', (mode) => {
    params.set('bots.gameGear', false)
    const r = session(mode, 300)
    expect(r.travelled, JSON.stringify(r)).toBeGreaterThan(300)
    expect({ beams: r.beams, gearUses: r.gearUses }).toEqual({ beams: 0, gearUses: 0 })
  }, 120000)

  it('game gear is on by default, under its own id, and in tag the bots use it on "it"', () => {
    expect(params.get('bots.gameGear')?.def.default).toBe(true)
    const r = session('tag-player-it', 60)
    expect(r.gearUses).toBeGreaterThan(0)
  }, 60000)

  it('with tag beams turned on, the same session does fire: the test can see it', () => {
    params.set('bots.tagBeams', true)
    const r = session('free', 30)
    expect(r.beams + r.gearUses).toBeGreaterThan(0)
  }, 60000)
})
