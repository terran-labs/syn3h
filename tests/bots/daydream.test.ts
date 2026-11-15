import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Quaternion, Scene, Vector3 } from 'three/webgpu'
import type { Game, System } from '../../src/core/Game'
import { emptyInput, type InputState } from '../../src/core/Input'
import { createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import type { Terrain } from '../../src/world/Terrain'
import { Daydream } from '../../src/bots/Daydream'
import { DAYDREAM_OFF_POSITION, daydreamLabel, daydreamPositionFor, daydreamSecondsAt } from '../../src/bots/daydreamControl'
import { Mind } from '../../src/bots/mind/Mind'
import { personalityFor } from '../../src/bots/mind/personality'
import { createGroundPilot } from '../../src/bots/pilot/ground'
import { params } from '../../shared/params'
import '../../src/bots/params'
import { vi } from 'vitest'
vi.mock('../../src/vehicles/effects', () => ({ attachVehicleEffects: () => () => {} }))

const DT = 0.02
const flat = (size: number, extra: Partial<Terrain> = {}): Terrain => ({
  size, heightAt: () => 0, normalAt: (_x, _z, out) => out.set(0, 1, 0),
  spawnPoint: (i) => ({ position: new Vector3(i * 4, 2, 0), heading: 0 }), dispose() {}, ...extra,
})
let world: RAPIER.World
beforeAll(initPhysics)
beforeEach(() => {
  for (const p of params.all().filter(p => ['Bots', 'Daydream'].includes(p.def.group))) params.set(p.def.id, p.def.default)
  world = createWorld(9.81)
  world.createCollider(RAPIER.ColliderDesc.cuboid(600, 0.5, 600).setTranslation(0, -0.5, 0).setFriction(1))
})
afterEach(() => world.free())

function harness() {
  const systems: System[] = []
  const input = { state: emptyInput(), external: {} as Partial<InputState>, suspended: false }
  const game = {
    world, scene: new Scene(), tick: 0, input,
    add<T extends System>(s: T) { systems.push(s); return s },
    remove(s: System) { const i = systems.indexOf(s); if (i >= 0) systems.splice(i, 1); s.dispose?.() },
  } as unknown as Game
  const step = () => { for (const s of systems) s.fixedUpdate?.(DT); world.step(); for (const s of systems) s.postPhysics?.(DT); game.tick++ }
  return { game, input, systems, step }
}
const upY = (v: { body: RAPIER.RigidBody }) => new Vector3(0, 1, 0).applyQuaternion(new Quaternion().copy(v.body.rotation())).y

describe('Daydream slider', () => {
  it('runs 10 seconds at the far left to 5 minutes, with off at the far right', () => {
    expect(daydreamSecondsAt(0)).toBe(10)
    expect(daydreamSecondsAt(DAYDREAM_OFF_POSITION - 1)).toBe(300)
    expect(daydreamSecondsAt(DAYDREAM_OFF_POSITION)).toBe(0)
    let last = 0
    for (let p = 0; p < DAYDREAM_OFF_POSITION; p++) { const s = daydreamSecondsAt(p); expect(s).toBeGreaterThanOrEqual(last); last = s }
  })
  it('maps 30 seconds a third of the way along and round trips', () => {
    expect(daydreamSecondsAt(daydreamPositionFor(30))).toBe(30)
    expect(daydreamPositionFor(30)).toBeGreaterThan(25); expect(daydreamPositionFor(30)).toBeLessThan(40)
    expect(daydreamPositionFor(0)).toBe(DAYDREAM_OFF_POSITION)
    expect(daydreamLabel(0)).toBe('off'); expect(daydreamLabel(30)).toBe('after 30 seconds'); expect(daydreamLabel(120)).toBe('after 2 minutes'); expect(daydreamLabel(95)).toBe('after 1 min 35 s')
  })
})

describe('personality', () => {
  it('is a pure function of its seed and differs between seeds', () => {
    expect(personalityFor('7:bot-1')).toEqual(personalityFor('7:bot-1'))
    const kinds = new Set(Array.from({ length: 40 }, (_, i) => personalityFor(`7:bot-${i}`).archetype))
    expect(kinds.size).toBeGreaterThanOrEqual(4)
    for (let i = 0; i < 40; i++) for (const t of ['boldness', 'curiosity', 'sociability', 'mischief', 'patience'] as const) {
      const v = personalityFor(`s${i}`)[t]; expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('ground pilot', () => {
  it('drives the Syn3h buggy round a square and stops inside the radius', () => {
    const { game, step } = harness(), terrain = flat(800)
    const buggy = game.add(new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0))); buggy.isLocal = false
    const pilot = createGroundPilot(buggy)
    const corners = [[0, -60], [60, -60], [60, 0], [0, 0]]
    let steps = 0
    for (const [x, z] of corners) {
      const last = x === 0 && z === 0
      for (let i = 0; i < 1500; i++, steps++) {
        pilot.drive({ x, z, speed: 12, stopWithin: last ? 4 : undefined }, buggy.input, DT); step()
        const p = buggy.body.translation()
        if (!last && Math.hypot(p.x - x, p.z - z) < 6) break
      }
      const p = buggy.body.translation()
      expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(7)
    }
    for (let i = 0; i < 150; i++) { pilot.drive({ x: 0, z: 0, speed: 12, stopWithin: 4 }, buggy.input, DT); step() }
    const p = buggy.body.translation(), v = buggy.body.linvel()
    expect(Math.hypot(p.x, p.z)).toBeLessThan(4.5); expect(Math.hypot(v.x, v.z)).toBeLessThan(0.5)
    expect(upY(buggy)).toBeGreaterThan(0.8)
    // 240 m of square at about 10 m/s: well under a minute of simulated time.
    expect(steps * DT).toBeLessThan(60)
  })
})

describe('mind', () => {
  it('abandons a removed leader before reading its physics body', () => {
    const { game } = harness(), terrain = flat(400)
    const follower = new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0))
    const leader = new Syn3hBuggy(game, terrain, new Vector3(40, 1, 0))
    const mind = new Mind(follower, terrain, createGroundPilot(follower), { seed: 'removed-leader', others: () => [leader] })
    mind.pursue(leader, 30)
    world.removeRigidBody(leader.body)
    // Trap the invalid read without poisoning Rapier's WASM borrow state for later tests.
    const translation = vi.spyOn(leader.body, 'translation').mockImplementation(() => { throw new Error('Read removed leader') })
    expect(() => mind.step(DT, follower.input)).not.toThrow()
    expect(translation).not.toHaveBeenCalled()
    expect(mind.activity.leader).not.toBe(leader)
    expect(() => world.step()).not.toThrow()
    translation.mockRestore()
  })
  it.each(['a', 'b', 'c'])('explores for 90 seconds without entering liquid or leaving the world (seed %s)', seed => {
    const { game, step } = harness()
    const terrain = flat(400, { liquidHeightAt: (x: number) => x > 70 ? 2 : -Infinity })
    const buggy = game.add(new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0))); buggy.isLocal = false
    const mind = new Mind(buggy, terrain, createGroundPilot(buggy), { seed })
    let maxX = -Infinity, edge = 0, path = 0, last = new Vector3().copy(buggy.body.translation())
    const kinds = new Set<string>()
    for (let i = 0; i < 4500; i++) {
      mind.step(DT, buggy.input); step(); kinds.add(mind.activity.kind)
      const p = buggy.body.translation()
      maxX = Math.max(maxX, p.x); edge = Math.max(edge, Math.abs(p.x), Math.abs(p.z))
      path += Math.hypot(p.x - last.x, p.z - last.z); last.copy(p)
    }
    expect(maxX).toBeLessThan(70); expect(edge).toBeLessThan(198)
    expect(path).toBeGreaterThan(300); expect(kinds.size).toBeGreaterThanOrEqual(2)
    expect(upY(buggy)).toBeGreaterThan(0.5); expect(mind.explored).toBeGreaterThan(0.1)
  })
  it('takes the same drive twice from the same seed', () => {
    const run = () => {
      const w = createWorld(9.81); w.createCollider(RAPIER.ColliderDesc.cuboid(600, 0.5, 600).setTranslation(0, -0.5, 0).setFriction(1))
      const game = { world: w, scene: new Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
      const terrain = flat(400), buggy = new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0)); buggy.isLocal = false
      const mind = new Mind(buggy, terrain, createGroundPilot(buggy), { seed: 'same' })
      for (let i = 0; i < 1000; i++) { mind.step(DT, buggy.input); buggy.fixedUpdate(DT); w.step(); buggy.postPhysics(DT) }
      const p = buggy.body.translation(), out = [p.x, p.z]; w.free(); return out
    }
    expect(run()).toEqual(run())
  })
})

describe('Daydream', () => {
  it('takes over after the idle time, drives, and hands back on input with the wings as they were', () => {
    const { game, input, step } = harness(), terrain = flat(800)
    const player = new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0))
    const daydream = game.add(new Daydream(game, terrain, player)); game.add(player)
    params.set('daydream.seconds', 10)
    const frame = () => { step(); daydream.update(DT) }
    for (let i = 0; i < 450; i++) frame()
    expect(daydream.active).toBe(false)
    for (let i = 0; i < 100; i++) frame()
    expect(daydream.active).toBe(true)
    const start = new Vector3().copy(player.body.translation())
    let path = 0; const last = start.clone()
    for (let i = 0; i < 1500; i++) { frame(); const p = player.body.translation(); path += Math.hypot(p.x - last.x, p.z - last.z); last.copy(p) }
    expect(path).toBeGreaterThan(100)
    expect(input.state.fire).toBe(false)
    daydream.noteActivity(); frame()
    expect(daydream.active).toBe(false); expect(daydream.idleFor).toBe(0)
    expect([input.state.x, input.state.y, input.state.z, input.state.w, input.state.brakes, input.state.special]).toEqual([0, 0, 0, 0, false, false])
    expect([input.external.x, input.external.y, input.external.brakes]).toEqual([0, 0, false])
  })
  it('stays out of it while a key is held, in a menu, when switched off, and for a vehicle with no pilot', () => {
    const { game, input } = harness(), terrain = flat(800)
    const player = new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0))
    const daydream = new Daydream(game, terrain, player)
    params.set('daydream.seconds', 10)
    input.state.y = 1
    for (let i = 0; i < 700; i++) daydream.update(DT)
    expect(daydream.active).toBe(false)
    input.state.y = 0; input.suspended = true
    for (let i = 0; i < 700; i++) daydream.update(DT)
    expect(daydream.active).toBe(false)
    input.suspended = false; params.set('daydream.seconds', 0)
    for (let i = 0; i < 700; i++) daydream.update(DT)
    expect(daydream.active).toBe(false)
    params.set('daydream.seconds', 10)
    const none = new Daydream(game, terrain, player, { pilot: null })
    for (let i = 0; i < 700; i++) none.update(DT)
    expect(none.active).toBe(false)
    for (let i = 0; i < 700; i++) daydream.update(DT)
    expect(daydream.active).toBe(true)
    input.suspended = true; daydream.update(DT)
    expect(daydream.active).toBe(false)
  })
})

describe('bots with a mind', () => {
  const run = async (free: number) => {
    const { BotManager } = await import('../../src/bots/BotManager')
    const { game, step } = harness(), terrain = flat(800)
    const player = new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0)); player.isLocal = false
    player.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    params.set('bots.freeSpirit', free); params.set('bots.count', 4); params.set('bots.tagBeams', false)
    const manager = game.add(new BotManager(game, terrain, player)); manager.update()
    expect(manager.vehicles).toHaveLength(4)
    let nearest = Infinity, farthest = 0
    for (let i = 0; i < 3000; i++) {
      step()
      for (const bot of manager.vehicles) { const p = bot.body.translation(), d = Math.hypot(p.x, p.z); nearest = Math.min(nearest, d); if (i > 1500) farthest = Math.max(farthest, d) }
    }
    manager.dispose()
    return { nearest, farthest }
  }
  it('chases relentlessly at 0 and wanders off on its own agenda at 1', async () => {
    const chase = await run(0), roam = await run(1)
    expect(chase.nearest).toBeLessThan(6)
    expect(chase.farthest).toBeLessThan(60)
    expect(roam.farthest).toBeGreaterThan(90)
  })
})

describe('mixed fleet', () => {
  it('spawns buggies, a hovercraft and a jet, and each drives with its own pilot', async () => {
    const { BotManager } = await import('../../src/bots/BotManager')
    const { game, step } = harness(), terrain = flat(800)
    const player = new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0)); player.isLocal = false
    params.set('bots.fleet', 1); params.set('bots.count', 4); params.set('bots.tagBeams', false); params.set('bots.freeSpirit', 0.5)
    const manager = game.add(new BotManager(game, terrain, player)); manager.update()
    expect(manager.vehicles.map(v => v.kind)).toEqual(['buggy', 'hovercraft', 'buggy', 'jet'])
    const start = manager.vehicles.map(v => new Vector3().copy(v.body.translation()))
    let jetTop = 0
    for (let i = 0; i < 2500; i++) { step(); jetTop = Math.max(jetTop, manager.vehicles[3].body.translation().y) }
    manager.vehicles.forEach((v, i) => {
      const p = v.body.translation()
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
      // The world is 800 m across. A flier may swing a little wide of the edge while turning back.
      expect(Math.abs(p.x)).toBeLessThan(430); expect(Math.abs(p.z)).toBeLessThan(430)
      expect(start[i].distanceTo(new Vector3().copy(p))).toBeGreaterThan(5)
    })
    expect(jetTop).toBeGreaterThan(6)
    manager.dispose()
  })
})

describe('chasing with the route planner', () => {
  it('goes round a lake to reach its target instead of driving in', async () => {
    const { BotBrain } = await import('../../src/bots/BotBrain')
    const { createNavigator } = await import('../../src/bots/nav')
    const { game, step } = harness()
    // A lake 120 m wide lies across the direct line; the dry way is round either end.
    // The shore slopes at 1 in 4, as real shores do: the liquid surface meets the ground at
    // the waterline and is half a metre under it two metres out. A lake with vertical sides
    // would leave the planner's half metre of clearance no width at all.
    const inside = (x: number, z: number) => Math.min(60 - Math.abs(x), -30 - z, z + 70)
    const depth = (x: number, z: number) => inside(x, z) > -2 ? Math.min(2, 0.25 * inside(x, z)) : -Infinity
    const terrain = flat(600, { liquidHeightAt: depth })
    const target = new Syn3hBuggy(game, terrain, new Vector3(0, 1, -100)); target.isLocal = false
    target.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    const bot = new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0)); bot.isLocal = false
    params.set('bots.tagBeams', false)
    const brain = game.add(new BotBrain(game, terrain, bot, target)); game.add(bot)
    brain.navigator = createNavigator(terrain)
    brain.mind = new Mind(bot, terrain, createGroundPilot(bot), { seed: 'chaser', navigator: brain.navigator })
    params.set('bots.freeSpirit', 0)
    let wetTime = 0, nearest = Infinity
    // At default aggression a bot stops a polite gap short of its target (KEEP_GAP, 7 m
    // centre to centre) instead of ramming it: arriving is getting within 10 m.
    for (let i = 0; i < 3000 && nearest > 10; i++) {
      step(); const p = bot.body.translation()
      if (depth(p.x, p.z) > 0.3) wetTime += DT
      nearest = Math.min(nearest, Math.hypot(p.x, p.z + 100))
    }
    expect(wetTime).toBeLessThan(0.5); expect(nearest).toBeLessThan(10); expect(brain.rescues).toBe(0)
  })
})

describe('bots that know the game', () => {
  const setup = async (count: number) => {
    const { BotManager } = await import('../../src/bots/BotManager')
    const h = harness(), terrain = flat(800)
    const player = new Syn3hBuggy(h.game, terrain, new Vector3(0, 1, 0)); player.isLocal = false
    player.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    params.set('bots.count', count); params.set('bots.tagBeams', false)
    const manager = h.game.add(new BotManager(h.game, terrain, player)); manager.update()
    return { ...h, player, manager }
  }
  const far = (v: { body: RAPIER.RigidBody }, x = 0, z = 0) => { const p = v.body.translation(); return Math.hypot(p.x - x, p.z - z) }
  it('competitive tag: bots flee and hunt when following is disabled', async () => {
    params.set('bots.followYou', 0)
    const { step, player, manager } = await setup(3)
    manager.setMatch({ mode: 'tag', it: player })
    for (let i = 0; i < 1000; i++) step()
    // They spawned 24 m from the player; twenty seconds later every one has put distance between them.
    for (const bot of manager.vehicles) expect(far(bot), manager.vehicles.map(v => `${v.kind}:${far(v).toFixed(1)}`).join(', ')).toBeGreaterThan(60)
    const hunter = manager.vehicles[0]
    manager.setMatch({ mode: 'tag', it: hunter })
    let nearest = Infinity
    for (let i = 0; i < 2000; i++) {
      step()
      for (const other of [player, ...manager.vehicles]) if (other !== hunter) { const p = other.body.translation(), q = hunter.body.translation(); nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.z - q.z)) }
    }
    expect(nearest).toBeLessThan(6)
    manager.dispose()
  })
  it('default tag bots stay nearby and follow even when the player or a bot is it', async () => {
    const { step, player, manager } = await setup(3)
    for (const itVehicle of [player, manager.vehicles[0]]) {
      manager.setMatch({ mode: 'tag', it: itVehicle })
      for (let i = 0; i < 1500; i++) step()
      const nearby = manager.vehicles.filter(bot => far(bot) < 40)
      expect(nearby.length, manager.vehicles.map(bot => far(bot).toFixed(1)).join(', ')).toBeGreaterThanOrEqual(2)
      for (const bot of manager.vehicles) expect(bot.input.fire).toBe(false)
    }
    manager.dispose()
  })
  it('hill: most bots go to the zone and stay in it', async () => {
    const { step, manager } = await setup(3)
    const zone = { x: 90, z: -70, radius: 14 }
    manager.setMatch({ mode: 'hill', zone })
    for (let i = 0; i < 2500; i++) step()
    expect(manager.vehicles.filter(bot => far(bot, zone.x, zone.z) < zone.radius).length, manager.vehicles.map(bot => far(bot, zone.x, zone.z).toFixed(0)).join(' ')).toBeGreaterThanOrEqual(2)
    manager.setMatch(null); manager.dispose()
  })
})
