/**
 * Bots arrive for a host who is hemmed in. New bots are placed near the player on ground they
 * can use (BotManager.spot); a host sitting in the caldera's lava lake has none of that within
 * reach, so before the spawn-point fallback no bot ever arrived. With it, they arrive at once
 * on safe ground, never in the lava or on a slope they cannot hold, and drive over to the
 * host like any far bot.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { PerspectiveCamera, Scene, Vector3 } from 'three/webgpu'
import type { Game, System } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, initPhysics, RAPIER } from '../../src/core/physics'
import { PlaceholderVehicle } from '../../src/vehicles/Vehicle'
import { BotManager } from '../../src/bots/BotManager'
import { isSafeGround } from '../../src/bots/BotBrain'
import { params } from '../../shared/params'
import { island } from './island'

const DT = 0.02
beforeAll(initPhysics)

describe('bots for a host with no safe ground nearby', () => {
  it('arrive for a host in the caldera lava lake, on ground they can hold, and drive over', () => {
    const world = createWorld(9.81), terrain = island(world, 1)
    const summit = terrain.summit?.()
    expect(summit?.lake, 'this island has a lava lake').toBeTruthy()
    const systems: System[] = []
    const game = {
      world, scene: new Scene(), camera: new PerspectiveCamera(), tick: 0, input: { state: emptyInput(), external: {}, suspended: false },
      add<T extends System>(s: T) { systems.push(s); return s },
      remove(s: System) { const i = systems.indexOf(s); if (i >= 0) systems.splice(i, 1); s.dispose?.() },
    } as unknown as Game
    // The host sits still in the middle of the lake.
    const at = new Vector3(summit!.x, summit!.lake!.surface - 0.5, summit!.z)
    const player = new PlaceholderVehicle(game, terrain, at); player.isLocal = false
    player.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
    params.set('bots.fleet', 0); params.set('bots.count', 3); params.set('bots.tagBeams', false); params.set('bots.freeSpirit', 0); params.set('daydream.seconds', 0)
    const manager = game.add(new BotManager(game, terrain, player))
    try {
      manager.update()
      expect(manager.vehicles.length).toBe(3)
      const distance = (v: { body: { translation(): { x: number; z: number } } }) => { const p = v.body.translation(); return Math.hypot(p.x - at.x, p.z - at.z) }
      const start = manager.vehicles.map(distance)
      for (const bot of manager.vehicles) {
        const p = bot.body.translation()
        expect(isSafeGround(terrain, p.x, p.z), `${bot.id} arrives on safe ground`).toBe(true)
        expect(terrain.liquidKindAt?.(p.x, p.z) === 'lava' && terrain.heightAt(p.x, p.z) < (terrain.liquidHeightAt?.(p.x, p.z) ?? -Infinity), `${bot.id} not in lava`).toBe(false)
        expect(terrain.normalAt(p.x, p.z, new Vector3()).y, `${bot.id} on a slope it can hold`).toBeGreaterThanOrEqual(0.65)
      }
      // Like any far bot, they drive over: each is clearly closer half a minute later. How much
      // closer is driving speed, which is tuned and reported, not pinned.
      for (let i = 0; i < 30 / DT; i++) {
        player.body.setNextKinematicTranslation(at)
        for (const s of systems) s.fixedUpdate?.(DT); world.step(); for (const s of systems) s.postPhysics?.(DT); game.tick++
      }
      const end = manager.vehicles.map(distance)
      process.stdout.write(`spawn fallback: bots ${start.map((d) => d.toFixed(0)).join(', ')} m from the host at arrival, ${end.map((d) => d.toFixed(0)).join(', ')} m after 30 s\n`)
      end.forEach((d, i) => expect(d, `bot ${i} drives toward the host`).toBeLessThan(start[i] - 20))
    } finally { game.remove(manager) }
  }, 60_000)
})
