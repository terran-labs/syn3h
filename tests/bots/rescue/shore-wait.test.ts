/**
 * A companion does not follow you into liquid. A wheeled bot chasing a target that sits in a
 * pond waits on the shore instead of driving in, and takes up the chase again once the target
 * is back on land; a hovercraft, which rides on liquid, still goes straight to it. The bug it
 * guards: on volcanic worlds buggies followed the player into lava some thirty times in ten
 * minutes, and most of the rescues there were those plunges.
 *
 * The pond is the rescue scenarios' (scenarios.ts terrainOf), water with a sloping shore.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { Vector3 } from 'three/webgpu'
import type { Game } from '../../../src/core/Game'
import { emptyInput } from '../../../src/core/Input'
import { createWorld, FIXED_DT, initPhysics, RAPIER } from '../../../src/core/physics'
import type { Vehicle } from '../../../src/vehicles/Vehicle'
import { MiraBuggy } from '../../../src/vehicles/MiraBuggy'
import { Hovercraft } from '../../../src/vehicles/Hovercraft'
import { BotBrain } from '../../../src/bots/BotBrain'
import { Mind } from '../../../src/bots/mind/Mind'
import { createPilot } from '../../../src/bots/pilot'
import { createNavigator } from '../../../src/bots/nav'
import { params } from '../../../shared/params'
import '../../../src/bots/params'
import { terrainOf } from './scenarios'

beforeAll(async () => {
  ;(globalThis as { window?: unknown }).window ??= { performance }
  await initPhysics()
})

// A pond 1.4 m deep west of x = -4, its shore rising to dry ground at x = 8.
const height = (x: number) => (x < -4 ? -1.4 : x > 8 ? 0.6 : -1.4 + (x + 4) * 2 / 12)
const liquid = () => 0

function pond(chaser: 'buggy' | 'hovercraft') {
  const world = createWorld(9.81)
  const terrain = terrainOf(world, (x) => height(x), liquid, 200)
  const game = { world, scene: new THREE.Scene(), tick: 0, time: 0, camera: new THREE.PerspectiveCamera(), canvas: {}, input: { state: emptyInput() } } as unknown as Game
  // The target sits out in the pond and stays there until moved.
  const target = new MiraBuggy(game, terrain, new Vector3(-12, 0.3, 0)); target.isLocal = false
  target.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
  const at = new Vector3(45, 1.4, 0)
  const bot: Vehicle = chaser === 'hovercraft' ? new Hovercraft(game, terrain, at, -Math.PI / 2) : new MiraBuggy(game, terrain, at, -Math.PI / 2)
  bot.isLocal = false
  params.set('bots.tagBeams', false); params.set('bots.freeSpirit', 0)
  const brain = new BotBrain(game, terrain, bot, target)
  brain.setTargets([target])
  brain.navigator = createNavigator(terrain)
  brain.mind = new Mind(bot, terrain, createPilot(bot, terrain)!, { seed: 'shore', navigator: brain.navigator })
  const step = () => {
    game.time += FIXED_DT
    brain.fixedUpdate(FIXED_DT)
    bot.fixedUpdate(FIXED_DT); target.fixedUpdate(FIXED_DT)
    world.step()
    bot.postPhysics(FIXED_DT); target.postPhysics(FIXED_DT)
  }
  const gap = () => { const p = bot.body.translation(), q = target.body.translation(); return Math.hypot(p.x - q.x, p.z - q.z) }
  return { bot, target, brain, step, gap }
}

describe('a companion and liquid', () => {
  it('a buggy waits on the shore for a target in the pond, then follows it back on land', () => {
    const { bot, target, brain, step, gap } = pond('buggy')
    let wet = 0, closest = Infinity
    for (let i = 0; i < 20 / FIXED_DT; i++) {
      step()
      const p = bot.body.translation()
      // More than 30 cm of liquid over the ground where it stands: it has gone in.
      if (liquid() - height(p.x) > 0.3) wet += FIXED_DT
      closest = Math.min(closest, p.x)
    }
    expect(wet).toBe(0)
    // It came down to the shore to wait (its waiting place is the dry ground nearest the target,
    // set back from the edge), rather than staying where it started.
    expect(closest).toBeLessThan(35)
    // The target drives out onto dry land: the chase resumes.
    target.body.setTranslation({ x: 30, y: 1.3, z: 40 }, true)
    let near = Infinity
    for (let i = 0; i < 20 / FIXED_DT && near > 12; i++) { step(); near = Math.min(near, gap()) }
    expect(near).toBeLessThan(12)
    expect(brain.rescues).toBe(0)
  })

  it('a hovercraft still goes out over the pond to its target', () => {
    const { step, gap } = pond('hovercraft')
    let near = Infinity
    for (let i = 0; i < 30 / FIXED_DT && near > 12; i++) { step(); near = Math.min(near, gap()) }
    expect(near).toBeLessThan(12)
  })
})
