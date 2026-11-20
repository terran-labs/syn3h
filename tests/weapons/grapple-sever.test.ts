/**
 * The sever rule and the release effects on the client. Bugs these catch: a sever that waits
 * for a free cord slot to draw its effect (so a busy sky leaves a grappler unstoppable); a
 * relayed 'off' that leaves a cord drawn, or draws nothing, when the hit that explains it was
 * lost; a fading cord that never goes away.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { CordWire } from '../../shared/protocol'
import type { Game } from '../../src/core/Game'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { Bungee, type BungeeHooks } from '../../src/weapons/bungee/Bungee'
import { TETHER_CORDS } from '../../src/weapons/bungee/tether'

beforeAll(initPhysics)
afterEach(() => { params.set('bungee.allowed', false); vi.unstubAllGlobals() })

const DT = 0.02

/** Flat ground and three vehicles in a row along -z: 1 (us), 2 and 3. */
function setup(extra: Partial<BungeeHooks> = {}) {
  params.set('bungee.allowed', true)
  const world = createWorld(0)
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0))
  const make = (z: number) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, z))
    world.createCollider(RAPIER.ColliderDesc.ball(1), body)
    const object = new THREE.Group(); object.position.set(0, 3, z)
    return { body, object } as unknown as Vehicle
  }
  const vehicles = new Map<number, Vehicle>([[1, make(0)], [2, make(-10)], [3, make(-20)]])
  vi.stubGlobal('window', { performance })
  vi.stubGlobal('document', { pointerLockElement: null })
  const game = { world, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), canvas: {}, time: 0, input: { state: { fire: false } } } as unknown as Game
  world.step()
  const wires: CordWire[] = []
  const bungee = new Bungee(game, {
    self: () => 1, vehicleOf: (id: number) => vehicles.get(id),
    idOfBody: (h: number) => [...vehicles].find(([, v]) => v.body.handle === h)?.[0] ?? null,
    owns: (id: number) => id === 1, lagOf: () => 0, wrapSize: () => 0, now: () => game.time,
    control: () => ({ fire: false, direction: [0, -0.15, -1] }), inHand: () => true, send: c => wires.push(c), ...extra,
  })
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { game.time += DT; bungee.fixedUpdate(DT); bungee.update(DT) } }
  return { bungee, wires, tick, close: () => { bungee.dispose(); world.free() } }
}

describe('severing a cord', () => {
  it('lets go of our cord to the player who hit us, even with every cord slot taken', () => {
    const s = setup()
    try {
      expect(s.bungee.launch([0, -0.15, -1])).toBe(true)
      for (let i = 0; i < 50 && !s.bungee.attached; i++) s.tick()
      expect(s.bungee.stats.attachedVehicle).toBe(1)
      // Fill every drawing slot with other players' cords.
      for (let id = 100; id < 100 + TETHER_CORDS; id++) s.bungee.applyRemote(id, { s: 'on', at: [0, 0, -40], n: [0, 1, 0], r: 30 })
      expect(s.bungee.severIfTiedTo(3)).toBe(false)
      expect(s.bungee.mine).toBeDefined()
      expect(s.bungee.severIfTiedTo(2)).toBe(true)
      expect(s.bungee.mine).toBeUndefined()
      expect(s.bungee.stats.severed).toBe(1)
      expect(s.wires.at(-1)).toEqual({ s: 'off' })
      // No slot was free, so no effect: the cord is gone all the same.
      expect(s.bungee.fading).toEqual([])
    } finally { s.close() }
  })
})

describe("another player's cord let go by the room", () => {
  it('shows the plain release when no hit explains it, and the cord fades away', () => {
    const s = setup()
    try {
      s.bungee.applyRemote(2, { s: 'on', to: 3, r: 10 })
      s.tick()
      s.bungee.applyRemote(2, { s: 'off' })
      expect(s.bungee.count).toBe(0)
      expect(s.bungee.fading).toEqual(['released'])
      s.tick(Math.ceil(3 / DT))
      expect(s.bungee.fading).toEqual([])
    } finally { s.close() }
  })

  it('shows it severed when the far end hit its owner just before', () => {
    const s = setup({ severedBy: (owner, by) => owner === 2 && by === 3 })
    try {
      s.bungee.applyRemote(2, { s: 'on', to: 3, r: 10 })
      s.tick()
      s.bungee.applyRemote(2, { s: 'off' })
      expect(s.bungee.fading).toEqual(['severed'])
    } finally { s.close() }
  })

  it('sails a hook in flight away when it is let go', () => {
    const s = setup()
    try {
      s.bungee.applyRemote(2, { s: 'hook', o: [0, 4, -10], d: [0, 0, -150], t: 0 })
      s.tick()
      s.bungee.applyRemote(2, { s: 'off' })
      expect(s.bungee.fading).toEqual(['sail'])
    } finally { s.close() }
  })
})
