import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { CordWire, YoinkWire } from '../../shared/protocol'
import type { Game } from '../../src/core/Game'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { BotGear } from '../../src/weapons/BotGear'
import { bigRedCharge } from '../../src/weapons/bigRedParams'
import { bungeeCooldown } from '../../src/weapons/bungee/params'
import { yoinkCooldown } from '../../src/weapons/yoink/params'

beforeAll(initPhysics)
afterEach(() => {
  for (const id of ['bungee.allowed', 'yoink.allowed', 'bigRed.allowed', 'pester.allowed']) {
    if (params.get(id)) params.set(id, false)
  }
  vi.unstubAllGlobals()
})

function setup() {
  const world = createWorld(0)
  const make = (z: number) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, z))
    world.createCollider(RAPIER.ColliderDesc.ball(1), body)
    return { body, object: new THREE.Group() } as unknown as Vehicle
  }
  const bot = make(0), target = make(-10)
  const canvas = {}
  // The human is looking sideways while the bot's target is straight ahead.
  const camera = new THREE.PerspectiveCamera()
  camera.lookAt(100, 0, 0); camera.updateMatrixWorld()
  // Rapier reads window.performance when a browser global is present.
  vi.stubGlobal('window', { performance })
  vi.stubGlobal('document', { pointerLockElement: canvas })
  const game = { world, scene: new THREE.Scene(), camera, canvas, time: 0, input: { state: { fire: true } } } as unknown as Game
  const cords: CordWire[] = [], yoinks: YoinkWire[] = [], shots: number[][] = []
  const controller = new BotGear(game, 1000, bot, {
    vehicleOf: id => id === 1000 ? bot : id === 1 ? target : undefined,
    vehicleIds: () => [1000, 1], idOfBody: h => h === target.body.handle ? 1 : h === bot.body.handle ? 1000 : null,
    owns: () => true, lagOf: () => 0, wrapSize: () => 0, now: () => game.time,
    heldElsewhere: () => false, responding: () => true,
    sendCord: (_id, c) => cords.push(c), sendYoink: (_id, y) => yoinks.push(y),
    fireRed: (_id, d) => shots.push(d), launchPester: () => true,
  })
  const step = (n = 1) => { for (let i = 0; i < n; i++) { game.time += 0.02; controller.fixedUpdate(0.02); world.step() } }
  return { controller, target, world, game, cords, yoinks, shots, step, close: () => { controller.dispose(); world.free() } }
}

describe('bot gear execution', () => {
  it('does not read human fire input', () => {
    params.set('bungee.allowed', true); params.set('yoink.allowed', true)
    const s = setup()
    try { s.step(5); expect(s.cords).toEqual([]); expect(s.yoinks).toEqual([]); expect(s.shots).toEqual([]) }
    finally { s.close() }
  })

  it('charges and releases Big Red toward the bot target, ignoring human camera aim', () => {
    params.set('bigRed.allowed', true)
    const s = setup()
    try {
      s.controller.act({ gear: 'red', target: s.target, phase: 'press' })
      s.step(Math.ceil(bigRedCharge.value / 0.02) + 2)
      expect(s.shots).toHaveLength(0)
      s.controller.act({ gear: 'red', target: s.target, phase: 'release' }); s.step()
      expect(s.shots).toHaveLength(1)
      expect(s.shots[0][2]).toBeLessThan(-0.99)
      expect(Math.abs(s.shots[0][0])).toBeLessThan(0.01)
      s.step(5); expect(s.shots).toHaveLength(1)
    } finally { s.close() }
  })

  it('cancels a full charge without firing', () => {
    params.set('bigRed.allowed', true)
    const s = setup()
    try {
      s.controller.act({ gear: 'red', target: s.target, phase: 'press' })
      s.step(Math.ceil(bigRedCharge.value / 0.02) + 2)
      s.controller.act({ gear: 'red', target: s.target, phase: 'cancel' }); s.step()
      expect(s.shots).toEqual([])
    } finally { s.close() }
  })

  it('drops a carried vehicle on cancel without a fling', () => {
    params.set('yoink.allowed', true)
    const s = setup()
    try {
      s.controller.act({ gear: 'yoink', target: s.target, phase: 'press' }); s.step()
      expect(s.yoinks[0]).toEqual({ s: 'grab', to: 1 })
      s.controller.act({ gear: 'yoink', target: s.target, phase: 'cancel' }); s.step()
      expect(s.yoinks.map(y => y.s)).toEqual(['grab', 'drop'])
    } finally { s.close() }
  })

  it('drops a vanished target without accessing its removed body', () => {
    params.set('yoink.allowed', true)
    const s = setup()
    try {
      s.controller.act({ gear: 'yoink', target: s.target, phase: 'press' }); s.step()
      s.world.removeRigidBody(s.target.body)
      s.step()
      expect(s.controller.yoink.holding).toBeNull()
      expect(s.yoinks.map(y => y.s)).toEqual(['grab', 'drop'])
    } finally { s.close() }
  })

  it('honors a server forced release of the bot cord', () => {
    params.set('bungee.allowed', true)
    const s = setup()
    try {
      s.controller.act({ gear: 'bungee', target: s.target, phase: 'press' }); s.step()
      expect(s.cords[0].s).toBe('hook')
      const hook = s.cords[0] as Extract<CordWire, { s: 'hook' }>
      const ray = new THREE.Ray(new THREE.Vector3(...hook.o), new THREE.Vector3(...hook.d).normalize())
      expect(ray.distanceToPoint(new THREE.Vector3(0, 5, -10))).toBeLessThan(0.1)
      expect(s.controller.bungee.mine).toBeDefined()
      s.controller.bungee.applyRemote(1000, { s: 'off' })
      expect(s.controller.bungee.mine).toBeUndefined()
      expect(s.cords).toHaveLength(1)
    } finally { s.close() }
  })

  it.each(['press', 'hold', 'release'] as const)('rejects %s against a removed target before aiming', phase => {
    params.set('pester.allowed', true)
    const s = setup()
    try {
      s.world.removeRigidBody(s.target.body)
      expect(() => s.controller.act({ gear: 'pester', target: s.target, phase })).not.toThrow()
      expect(s.controller.active).toBe(false)
    } finally { s.close() }
  })

  it('preserves a new press after cancellation between physics steps', () => {
    params.set('bungee.allowed', true)
    const s = setup()
    try {
      s.controller.act({ gear: 'bungee', target: s.target, phase: 'press' }); s.step()
      s.controller.act({ gear: 'bungee', target: s.target, phase: 'cancel' })
      s.game.time += bungeeCooldown.value + 1
      s.controller.act({ gear: 'bungee', target: s.target, phase: 'press' }); s.step()
      expect(s.cords.filter(c => c.s === 'hook')).toHaveLength(2)
    } finally { s.close() }
  })

  it('disposes a live gust material once on teardown', () => {
    params.set('yoink.allowed', true)
    const s = setup()
    try {
      s.target.body.setTranslation({ x: 100, y: 5, z: 0 }, true)
      const before = new Set(s.game.scene.children)
      expect(s.controller.yoink.press()).toBe('gust')
      const wave = s.game.scene.children.find(o => !before.has(o)) as THREE.Mesh
      const dispose = vi.spyOn(wave.material as THREE.Material, 'dispose')
      s.controller.yoink.dispose()
      expect(dispose).toHaveBeenCalledTimes(1)
      s.controller.yoink.dispose()
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally { s.close() }
  })

  it('preserves a Yoink press after cancellation between physics steps', () => {
    params.set('yoink.allowed', true)
    const s = setup()
    try {
      s.controller.act({ gear: 'yoink', target: s.target, phase: 'press' }); s.step()
      s.controller.act({ gear: 'yoink', target: s.target, phase: 'cancel' })
      s.game.time += yoinkCooldown.value + 1
      s.controller.act({ gear: 'yoink', target: s.target, phase: 'press' }); s.step()
      expect(s.yoinks.filter(y => y.s === 'grab')).toHaveLength(2)
    } finally { s.close() }
  })
})
