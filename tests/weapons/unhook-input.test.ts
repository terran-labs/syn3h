/**
 * The grabbed player's ways out of someone else's cord (Bungee.ts, the Foreman, 19 November
 * 2026). Bugs caught: no way to break free but out-driving the cord; a single tap of brake
 * cutting it by accident; their own Grapple press launching instead of cutting.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { Game } from '../../src/core/Game'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { Bungee } from '../../src/weapons/bungee/Bungee'

beforeAll(initPhysics)
afterEach(() => { params.set('bungee.allowed', false); vi.unstubAllGlobals() })

function setup(inHand = false) {
  vi.stubGlobal('window', { performance })
  const world = createWorld(0)
  const make = (z: number) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, z))
    world.createCollider(RAPIER.ColliderDesc.ball(1), body)
    return { body, object: new THREE.Group() } as unknown as Vehicle
  }
  const me = make(0), grappler = make(-10)
  const input = { fire: false, brakes: false }
  const game = { world, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), time: 0, input: { state: input, suspended: false } } as unknown as Game
  const asked: number[] = []
  const bungee = new Bungee(game, {
    self: () => 1, vehicleOf: id => id === 1 ? me : id === 1000 ? grappler : undefined,
    idOfBody: h => h === me.body.handle ? 1 : h === grappler.body.handle ? 1000 : null,
    owns: id => id === 1, lagOf: () => 0, wrapSize: () => 0, now: () => game.time, inHand: () => inHand,
    unhook: owner => asked.push(owner),
  }, new EventTarget() as unknown as Window)
  // Bot 1000's cord, tied to us, as the room relays it.
  bungee.applyRemote(1000, { s: 'on', to: 1, r: 12 })
  const step = (n = 1) => { for (let i = 0; i < n; i++) { game.time += 0.02; bungee.fixedUpdate(0.02); world.step() } }
  return { bungee, input, asked, step, close: () => { bungee.dispose(); world.free() } }
}

describe('breaking free of a cord on you', () => {
  it('a double tap of brake asks the cord\'s owner to let go; a single tap does not', () => {
    params.set('bungee.allowed', true)
    const s = setup()
    try {
      expect(s.bungee.hookedBy()).toEqual([1000])
      s.input.brakes = true; s.step(); s.input.brakes = false; s.step(30)
      expect(s.asked).toEqual([])
      s.input.brakes = true; s.step(); s.input.brakes = false; s.step(3); s.input.brakes = true; s.step()
      expect(s.asked).toEqual([1000])
    } finally { s.close() }
  })
  it('the first press of your own Grapple cuts their cord instead of launching yours', () => {
    params.set('bungee.allowed', true)
    const s = setup(true)
    try {
      s.input.fire = true; s.step()
      expect(s.asked).toEqual([1000])
      expect(s.bungee.mine).toBeUndefined()
    } finally { s.close() }
  })
})
