import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Quaternion, Scene, Vector3 } from 'three/webgpu'
import type { Game, System } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import { PlaceholderVehicle } from '../../src/vehicles/Vehicle'
import type { Terrain } from '../../src/world/Terrain'
import { BotBrain } from '../../src/bots/BotBrain'
import { BotManager } from '../../src/bots/BotManager'
import { params } from '../../shared/params'
import '../../src/bots/params'
const terrain: Terrain = {
  size: 200, heightAt: () => 0, normalAt: (_x, _z, out) => out.set(0, 1, 0),
  spawnPoint: (i) => ({ position: new Vector3(i * 4, 2, 0), heading: 0 }), dispose() {},
}
let world: RAPIER.World
beforeAll(initPhysics)
beforeEach(() => {
  for (const p of params.all().filter(p => p.def.group === 'Bots')) params.set(p.def.id, p.def.default)
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
  it('closes distance and makes real Rapier contact with a stationary target', () => {
    const { game, step } = harness(), target = stationaryTarget(game)
    const bot = new PlaceholderVehicle(game, terrain, new Vector3(0, 0.5, 25))
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
    params.set('bots.canDrive', false); params.set('bots.canFire', false)
    brain.fixedUpdate(2)
    expect(brain.target).toBe(remote); expect(bot.input.x).toBe(0); expect(bot.input.y).toBe(0); expect(bot.input.fire).toBe(false)
    params.set('bots.canFire', true); world.step(); brain.fixedUpdate(0.02)
    expect(bot.input.fire).toBe(true)
  })
  it('reverses when stuck and rescues only after the recovery interval', () => {
    const { game } = harness(), target = stationaryTarget(game)
    const bot = new PlaceholderVehicle(game, terrain, new Vector3(0, 0.5, 20))
    const brain = new BotBrain(game, terrain, bot, target)
    for (let i = 0; i < 76; i++) brain.fixedUpdate(0.02)
    expect(bot.input.y).toBeLessThan(0); expect(brain.rescues).toBe(0)
    for (let i = 0; i < 400; i++) brain.fixedUpdate(0.02)
    expect(brain.rescues).toBe(1)
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
