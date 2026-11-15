import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Quaternion, Scene, Vector3 } from 'three/webgpu'
import type { Game, System } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { PlaceholderVehicle } from '../../src/vehicles/Vehicle'
import type { Terrain } from '../../src/world/Terrain'
import { BotBrain } from '../../src/bots/BotBrain'
import { BotManager } from '../../src/bots/BotManager'
import { params } from '../../shared/params'
import '../../src/bots/params'
import { generateName } from '../../src/ui/data/names'
const effects = vi.hoisted(() => ({ attached: [] as { vehicle: { body: { isValid(): boolean } }; local: boolean; disposed: boolean }[] }))
vi.mock('../../src/vehicles/effects', () => ({ attachVehicleEffects: (_game: unknown, _terrain: unknown, vehicle: { body: { isValid(): boolean } }, options: {local: boolean}) => {
  const entry = { vehicle, local: options.local, disposed: false }; effects.attached.push(entry)
  return () => { expect(vehicle.body.isValid()).toBe(true); entry.disposed = true }
} }))
const terrain: Terrain = {
  size: 200, heightAt: () => 0, normalAt: (_x, _z, out) => out.set(0, 1, 0),
  spawnPoint: (i) => ({ position: new Vector3(i * 4, 2, 0), heading: 0 }), dispose() {},
}
let world: RAPIER.World
beforeAll(initPhysics)
beforeEach(() => {
  for (const p of params.all().filter(p => p.def.group === 'Bots')) params.set(p.def.id, p.def.default)
  effects.attached.length = 0
  world = createWorld(9.81)
  world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0))
})
afterEach(() => world.free())
function harness() {
  const systems: System[] = []
  const game = {
    world, scene: new Scene(), tick: 0, input: { state: emptyInput() },
    add<T extends System>(s: T) { systems.push(s); return s },
    remove(s: System) { const i = systems.indexOf(s); if (i >= 0) systems.splice(i, 1); s.dispose?.() },
  } as unknown as Game
  const step = () => { for (const s of systems) s.fixedUpdate?.(0.02); world.step(); for (const s of systems) s.postPhysics?.(0.02); game.tick++ }
  return { game, systems, step }
}
function stationaryTarget(game: Game, position = new Vector3(0, 0.5, 0)) {
  const target = new PlaceholderVehicle(game, terrain, position)
  target.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
  return target
}
describe('bot pursuit', () => {
  it.each(['placeholder', 'syn3h'])('%s closes distance and makes real Rapier contact with a stationary target when aggression allows ramming', kind => {
    params.set('bots.aggression', 2)
    const { game, step } = harness(), target = stationaryTarget(game)
    const bot = kind === 'syn3h' ? new Syn3hBuggy(game, terrain, new Vector3(0, 1, 25)) : new PlaceholderVehicle(game, terrain, new Vector3(0, 0.5, 25))
    const brain = game.add(new BotBrain(game, terrain, bot, target)); game.add(bot)
    let contact = false, nearest = Infinity
    for (let i = 0; i < 750 && !contact; i++) {
      step()
      nearest = Math.min(nearest, new Vector3().copy(bot.body.translation()).distanceTo(target.body.translation()))
      world.contactPair(bot.body.collider(0), target.body.collider(0), manifold => { if (manifold.numContacts() > 0) contact = true })
    }
    expect(brain.target).toBe(target); expect(nearest).toBeLessThan(4); expect(contact).toBe(true)
  })
  it.each([{ x: 10, sign: 1 }, { x: -10, sign: -1 }])('turns toward world x=$x while initially facing away', ({ x, sign }) => {
    const { game, step } = harness()
    const target = stationaryTarget(game, new Vector3(x, 0.5, -20))
    const bot = new PlaceholderVehicle(game, terrain, new Vector3(0, 0.5, 0), Math.PI)
    const brain = game.add(new BotBrain(game, terrain, bot, target)); game.add(bot)
    brain.fixedUpdate(0.02)
    // Facing +Z, world +X lies to the driver's left. Input must therefore be negative.
    expect(Math.sign(bot.input.x)).toBe(-sign)
    for (let i = 0; i < 30; i++) step()
    const forward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion().copy(bot.body.rotation()))
    expect(Math.sign(forward.x)).toBe(sign)
  })
  it('selects nearest supplied target and honors drive and fire switches', () => {
    const { game } = harness(), player = stationaryTarget(game, new Vector3(0, 0.5, -30))
    const remote = stationaryTarget(game, new Vector3(5, 0.5, 0))
    const bot = new PlaceholderVehicle(game, terrain, new Vector3(0, 0.5, 0))
    const brain = new BotBrain(game, terrain, bot, player)
    brain.setTargets([bot, player, remote]); params.set('bots.targetMode', 1)
    params.set('bots.canDrive', false); params.set('bots.tagBeams', false)
    brain.fixedUpdate(2)
    expect(brain.target).toBe(remote); expect(bot.input.x).toBe(0); expect(bot.input.y).toBe(0); expect(bot.input.fire).toBe(false)
    params.set('bots.tagBeams', true); world.step(); brain.fixedUpdate(0.02)
    expect(bot.input.fire).toBe(true)
  })
  it('reverses when stuck and rescues only after the recovery interval', () => {
    const { game } = harness(), target = stationaryTarget(game)
    const bot = new PlaceholderVehicle(game, terrain, new Vector3(0, 0.5, 20))
    const brain = new BotBrain(game, terrain, bot, target)
    for (let i = 0; i < 76; i++) brain.fixedUpdate(0.02)
    expect(bot.input.y).toBeLessThan(0); expect(bot.input.brakes).toBe(true); expect(brain.rescues).toBe(0)
    for (let i = 0; i < 400; i++) brain.fixedUpdate(0.02)
    expect(brain.rescues).toBe(1)
  })
  it('paddles toward dry ground when already floating and rescues a flipped bot', () => {
    const { game } = harness(), target = stationaryTarget(game, new Vector3(0, 0.5, -20))
    const wet = { ...terrain, liquidHeightAt: (_x: number, z: number) => z > -10 ? 2 : -2 }
    const bot = new Syn3hBuggy(game, wet, new Vector3(0, 2, 0))
    const brain = new BotBrain(game, wet, bot, target); brain.fixedUpdate(0.02)
    expect(bot.input.y).toBeGreaterThan(0)
    expect(Math.abs(bot.input.x)).toBeLessThan(0.2)
    bot.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,0,1), Math.PI), true)
    const dryBrain = new BotBrain(game, terrain, bot, target)
    for (let i = 0; i < 210; i++) dryBrain.fixedUpdate(0.02)
    expect(dryBrain.rescues).toBe(1)
  })
  it('reverses before reaching optional lava and refuses underwater spawn positions', () => {
    const { game } = harness(), target = stationaryTarget(game, new Vector3(0, 0.5, -20))
    const wet = { ...terrain, liquidHeightAt: (_x: number, z: number) => z < -2 ? 2 : -2 }
    const bot = new PlaceholderVehicle(game, terrain, new Vector3(0, 0.5, 0))
    const brain = new BotBrain(game, wet, bot, target); brain.fixedUpdate(0.02)
    expect(bot.input.y).toBeLessThan(0)
    params.set('bots.count', 5)
    const manager = new BotManager(game, { ...terrain, liquidHeightAt: () => 10 }, target)
    manager.update(); expect(manager.vehicles).toHaveLength(0)
  })
})
describe('bot population', () => {
  it('returns a stuck bot to dry ground without replacing its body, name or effects', () => {
    const {game,systems,step}=harness(), player=stationaryTarget(game)
    const wet={...terrain,liquidHeightAt:(_x:number,z:number)=>z>10?2:-Infinity}
    const manager=game.add(new BotManager(game,wet,player))
    params.set('bots.count',1);manager.update()
    const bot=manager.vehicles[0],handle=bot.body.handle,id=bot.id,name=bot.name
    bot.teleport(new Vector3(0,1,20));bot.body.setBodyType(RAPIER.RigidBodyType.Fixed,true)
    for(let i=0;i<700;i++)step()
    expect(manager.vehicles[0]).toBe(bot);expect(bot.body.handle).toBe(handle)
    expect(bot.id).toBe(id);expect(bot.name).toBe(name);expect(bot.body.translation().z).toBeLessThan(10)
    expect(effects.attached[0].disposed).toBe(false)
    expect(systems.some(s=>s instanceof BotBrain&&s.rescues>0)).toBe(true)
    manager.dispose()
  })

  it('keeps Rapier usable when graphics and count drop together or in adjacent frames', () => {
    const { game, systems, step } = harness(), player = stationaryTarget(game)
    const manager = game.add(new BotManager(game, terrain, player))
    try {
      for (const separateFrames of [false, true]) {
        params.set('gfx.level', 2); params.set('bots.count', 8); manager.update()
        expect(manager.vehicles).toHaveLength(8)
        for (let i = 0; i < 20; i++) step()
        params.set('gfx.level', 1)
        if (separateFrames) { manager.update(); expect(manager.vehicles).toHaveLength(4); step() }
        params.set('bots.count', 0)
        // Use the real mutable update list, as Game.frame does.
        for (const system of systems) system.update?.(0.02, 1)
        expect(manager.vehicles).toHaveLength(0)
        expect(world.bodies.len()).toBe(1)
        expect(systems).toEqual([manager])
        for (let i = 0; i < 50; i++) step()
        expect(player.body.isValid()).toBe(true)
        expect(effects.attached.every(entry => entry.disposed)).toBe(true)
      }
    } finally { manager.dispose(); params.set('gfx.level', 2) }
  })

  it('follows the player into a vehicle swapped in place: targets, spawn centre and daydream', () => {
    const { game, systems, step } = harness()
    const old = new Syn3hBuggy(game, terrain, new Vector3(0, 1, 0)); game.add(old)
    const manager = game.add(new BotManager(game, terrain, old))
    try {
      params.set('bots.count', 2); params.set('daydream.seconds', 1); manager.update()
      for (let i = 0; i < 10; i++) step()
      // Idle long enough to start daydreaming in the old vehicle.
      for (let i = 0; i < 4; i++) manager.update(0.5)
      expect(manager.daydream.active).toBe(true)
      const brains = systems.filter((s): s is BotBrain => s instanceof BotBrain)
      expect(brains.length).toBe(2)
      expect(brains.every(b => b.target === old)).toBe(true)

      const next = new Syn3hBuggy(game, terrain, new Vector3(60, 1, 60)); game.add(next)
      manager.setPlayer(next)
      // At once: every bot chases the new vehicle, and the daydream built for the old one ends.
      expect(brains.every(b => b.target === next)).toBe(true)
      expect(manager.daydream.active).toBe(false)
      // And it stays so after the bots' own target refresh.
      for (let i = 0; i < 150; i++) step()
      expect(brains.every(b => b.target === next)).toBe(true)
      // New bots spawn round the new vehicle, not the old.
      params.set('bots.count', 3); manager.update()
      const fresh = manager.vehicles[2].body.translation()
      expect(Math.hypot(fresh.x - 60, fresh.z - 60)).toBeLessThan(40)
      // The daydream picks up again, driving the new vehicle.
      for (let i = 0; i < 4; i++) manager.update(0.5)
      expect(manager.daydream.active).toBe(true)
      expect(manager.daydream.mind?.vehicle).toBe(next)
    } finally { manager.dispose(); params.set('daydream.seconds', params.get('daydream.seconds')!.def.default) }
  })

  it('owns no vehicles remotely and creates fresh named bots on takeover', () => {
    const { game, systems } = harness(), player = stationaryTarget(game)
    const manager = new BotManager(game, terrain, player)
    params.set('bots.count', 2); manager.remote = true; manager.update()
    expect(manager.vehicles).toHaveLength(0); expect(systems).toHaveLength(0)
    manager.remote = false; manager.update()
    const old = [...manager.vehicles], ids = old.map(v => v.id)
    expect(new Set(ids).size).toBe(2)
    expect(old[0].name).toBe(generateName(`${params.get('world.seed')!.value}:${old[0].id}`, 'bot'))
    expect(effects.attached.every(e => !e.local)).toBe(true)
    manager.remote = true
    expect(manager.vehicles).toHaveLength(0); expect(systems).toHaveLength(0)
    expect(old.every(v => !v.body.isValid())).toBe(true)
    expect(effects.attached.every(e => e.disposed)).toBe(true)
    manager.update(); expect(manager.vehicles).toHaveLength(0)
    manager.remote = false; manager.update()
    expect(manager.vehicles).toHaveLength(2)
    expect(manager.vehicles.every(v => !ids.includes(v.id))).toBe(true)
    expect(manager.vehicles.every(v => !old.includes(v))).toBe(true)
    manager.dispose(); expect(effects.attached.every(e => e.disposed)).toBe(true)
  })
  it('spawns and removes bodies and systems when count changes', () => {
    const { game, systems } = harness(), player = stationaryTarget(game)
    const manager = new BotManager(game, terrain, player)
    params.set('bots.count', 5); manager.update()
    expect(manager.vehicles).toHaveLength(5); expect(systems).toHaveLength(10)
    expect(world.bodies.len()).toBe(6)
    expect(manager.vehicles.every(v => !v.isLocal)).toBe(true)
    params.set('bots.count', 2); manager.update()
    expect(manager.vehicles).toHaveLength(2); expect(world.bodies.len()).toBe(3); expect(systems).toHaveLength(4)
    manager.dispose(); expect(world.bodies.len()).toBe(1); expect(systems).toHaveLength(0)
  })
})
describe('wrapping world', () => {
  it('chases the nearest image of a target across the seam, and selects by wrapped distance', () => {
    const { game } = harness()
    const wrapping: Terrain = { ...terrain, size: 400, wrapSize: 400 }
    // 20 m apart across the seam at x = +-200; 380 m apart the long way round.
    const near = new PlaceholderVehicle(game, wrapping, new Vector3(-190, 0.5, 0)); near.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    const far = new PlaceholderVehicle(game, wrapping, new Vector3(120, 0.5, 0)); far.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    // Heading 0 faces -Z; -PI/2 about +Y faces +X, toward the seam.
    const bot = new PlaceholderVehicle(game, wrapping, new Vector3(190, 0.5, 0), -Math.PI / 2)
    const brain = new BotBrain(game, wrapping, bot, near)
    brain.setTargets([near, far]); params.set('bots.targetMode', 1); params.set('bots.tagBeams', false); params.set('bots.approachSpread', 0)
    brain.fixedUpdate(0.02)
    expect(brain.target).toBe(near)
    // Straight ahead through the seam: full throttle, no turn back toward the far image.
    expect(bot.input.y).toBeGreaterThan(0); expect(Math.abs(bot.input.x)).toBeLessThan(0.2)
    // The same layout on a world that does not wrap: the other vehicle is nearer, and the
    // edge ahead is the end of the world.
    const flatBot = new PlaceholderVehicle(game, { ...terrain, size: 400 }, new Vector3(190, 0.5, 0), -Math.PI / 2)
    const flatBrain = new BotBrain(game, { ...terrain, size: 400 }, flatBot, near)
    flatBrain.setTargets([near, far]); flatBrain.fixedUpdate(0.02)
    expect(flatBrain.target).toBe(far)
  })
})
