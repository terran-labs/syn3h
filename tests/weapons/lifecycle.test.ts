/**
 * Gear lifecycle: reset() leaves every gear system with nothing live, so a world change,
 * Exit world or a room leave carries no cord, carry, charge or projectile into the next
 * world. The owner's report: a Grapple anchored on one planet still hung in the sky of the
 * next. Also: a relayed ground cord that cannot belong to this world is not drawn.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { CordWire, ShotInfo, YoinkWire } from '../../shared/protocol'
import type { Game } from '../../src/core/Game'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import type { GearControl } from '../../src/weapons/aim'
import { BigRed } from '../../src/weapons/BigRed'
import { BotGear } from '../../src/weapons/BotGear'
import { Lasers } from '../../src/weapons/Lasers'
import { Bungee } from '../../src/weapons/bungee/Bungee'
import { bungeeLength, bungeeSnap } from '../../src/weapons/bungee/params'
import { Pesters } from '../../src/weapons/pester/Pesters'
import { Yoink } from '../../src/weapons/yoink/Yoink'

beforeAll(initPhysics)
afterEach(() => {
  for (const id of ['bungee.allowed', 'yoink.allowed', 'bigRed.allowed', 'pester.allowed']) {
    if (params.get(id)) params.set(id, false)
  }
  vi.unstubAllGlobals()
})

const DT = 0.02

/** Flat ground at y = 0 and three vehicles in a row along -z: 1 (us), 2 and 3. */
function setup() {
  const world = createWorld(0)
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0))
  const make = (z: number) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, z))
    world.createCollider(RAPIER.ColliderDesc.ball(1), body)
    return { body, object: new THREE.Group() } as unknown as Vehicle
  }
  const vehicles = new Map<number, Vehicle>([[1, make(0)], [2, make(-10)], [3, make(-20)]])
  const camera = new THREE.PerspectiveCamera()
  vi.stubGlobal('window', { performance })
  vi.stubGlobal('document', { pointerLockElement: null })
  const game = { world, scene: new THREE.Scene(), camera, canvas: {}, time: 0, input: { state: { fire: false } } } as unknown as Game
  world.step()
  const common = {
    self: () => 1,
    vehicleOf: (id: number) => vehicles.get(id),
    idOfBody: (h: number) => [...vehicles].find(([, v]) => v.body.handle === h)?.[0] ?? null,
    owns: (id: number) => id === 1, lagOf: () => 0, wrapSize: () => 0, now: () => game.time,
  }
  const close = () => world.free()
  return { world, game, vehicles, common, close }
}

describe('gear reset', () => {
  it('Bungee drops its own ground cord, others\' cords and hooks, reports off, and can fire again', () => {
    params.set('bungee.allowed', true)
    const s = setup()
    const control: GearControl = { fire: false, direction: [0, -1, -0.3] }
    const wires: CordWire[] = []
    const bungee = new Bungee(s.game, { ...s.common, control: () => control, inHand: () => true, send: c => wires.push(c) })
    try {
      expect(bungee.launch([0, -1, -0.3])).toBe(true)
      for (let i = 0; i < 50 && !bungee.attached; i++) { s.game.time += DT; bungee.fixedUpdate(DT) }
      expect(bungee.attached).toBe(true)
      expect(bungee.stats.attachedGround).toBe(1)
      // Another player's ground cord and a third player's hook in flight.
      bungee.applyRemote(2, { s: 'on', at: [0, 0, -14], n: [0, 1, 0], r: 6 })
      bungee.applyRemote(3, { s: 'hook', o: [0, 4, -21], d: [0, 0, -50], t: 0 })
      expect(bungee.count).toBeGreaterThanOrEqual(3)

      bungee.reset()
      expect(bungee.count).toBe(0)
      expect(bungee.attached).toBe(false)
      expect(bungee.mine).toBeUndefined()
      expect(bungee.cordLength).toBe(0)
      expect(wires.at(-1)).toEqual({ s: 'off' })
      // Nothing comes back on later steps, and no cooldown holds the next launch.
      const sent = wires.length
      s.game.time += DT; bungee.fixedUpdate(DT)
      expect(bungee.count).toBe(0)
      expect(wires).toHaveLength(sent)
      expect(bungee.launch([0, -1, -0.3])).toBe(true)
    } finally { bungee.dispose(); s.close() }
  })

  it('Bungee reset with nothing out sends nothing', () => {
    params.set('bungee.allowed', true)
    const s = setup()
    const wires: CordWire[] = []
    const bungee = new Bungee(s.game, { ...s.common, control: () => ({ fire: false, direction: [0, 0, -1] }), inHand: () => true, send: c => wires.push(c) })
    try {
      bungee.applyRemote(2, { s: 'on', at: [0, 0, -14], n: [0, 1, 0], r: 6 })
      bungee.reset()
      expect(bungee.count).toBe(0)
      expect(wires).toEqual([])
    } finally { bungee.dispose(); s.close() }
  })

  it('Yoink drops its own carry with the drop wire, ends others\' carries and clears gust rings', () => {
    params.set('yoink.allowed', true)
    const s = setup()
    const control: GearControl = { fire: false, direction: [0, 0, -1] }
    const wires: YoinkWire[] = []
    const yoink = new Yoink(s.game, { ...s.common, control: () => control, vehicleIds: () => [1, 2, 3], inHand: () => true, send: y => wires.push(y) })
    try {
      expect(yoink.press()).toBe('grab')
      const mine = yoink.holding
      expect(mine).not.toBeNull()
      yoink.applyRemote(3, { s: 'grab', to: mine === 2 ? 1 : 2 })
      // A gust ring needs a press at nothing; this player is holding, so a second Yoink on
      // the same game (sharing the look, as a bot's does) gusts into the empty sky.
      const other = new Yoink(s.game, { ...s.common, self: () => 3, control: () => ({ fire: false, direction: [0, 1, 0] }), vehicleIds: () => [], inHand: () => true })
      expect(other.press()).toBe('gust')
      expect(other.count).toBe(1)
      expect(yoink.count).toBe(2)

      yoink.reset(); other.reset()
      expect(yoink.count).toBe(0)
      expect(other.count).toBe(0)
      expect(yoink.holding).toBeNull()
      expect(yoink.holderOf(1)).toBeNull()
      expect(yoink.holderOf(2)).toBeNull()
      expect(wires.at(-1)).toEqual({ s: 'drop', to: mine })
      // Immediately usable again: reset is not a drop the player chose.
      expect(yoink.press()).toBe('grab')
      other.dispose()
    } finally { yoink.dispose(); s.close() }
  })

  it('Big Red cancels a charge without firing or fizzling', () => {
    params.set('bigRed.allowed', true)
    const s = setup()
    const control: GearControl = { fire: true, direction: [0, 0, -1] }
    const fired: number[][] = []
    const me = s.vehicles.get(1)!
    const red = new BigRed(s.game, { control: () => control, body: () => me.body, object: () => me.object, inHand: () => true, fire: d => fired.push(d) })
    try {
      for (let i = 0; i < 10; i++) { s.game.time += DT; red.fixedUpdate(DT) }
      expect(red.charge).toBeGreaterThan(0)
      red.reset()
      expect(red.charge).toBe(-1)
      // Releasing the held control afterwards neither fires nor fizzles.
      control.fire = false
      s.game.time += DT; red.fixedUpdate(DT)
      expect(fired).toEqual([])
      expect(red.stats).toEqual({ sent: 0, fizzled: 0 })
    } finally { red.dispose(); s.close() }
  })

  it('Pesters removes every one in flight', () => {
    params.set('pester.allowed', true)
    const s = setup()
    const pesters = new Pesters(s.game, {
      self: () => 1, bodyOf: id => s.vehicles.get(id)?.body, vehicleIds: () => [1, 2, 3], judges: id => id === 1,
      heightAt: () => 0, wrapSize: () => 0, inHand: () => false, launch: () => {}, onCatch: () => {},
    })
    try {
      const shot = (id: number): ShotInfo => ({ id, o: [0, 4, -2], d: [0, 0, -1], boost: 0, t: 0, k: 'pester', to: 2 } as ShotInfo)
      pesters.spawn(1, shot(1)); pesters.spawn(3, shot(2))
      expect(pesters.count).toBe(2)
      const before = s.game.scene.children.length
      pesters.reset()
      expect(pesters.count).toBe(0)
      expect(pesters.list()).toEqual([])
      expect(pesters.mine).toBe(0)
      // Every Pester is drawn by the same two instanced meshes, which stay in the scene.
      expect(s.game.scene.children.length).toBe(before)
    } finally { pesters.dispose(); s.close() }
  })

  it('Lasers removes every shot in flight', () => {
    const s = setup()
    const lasers = new Lasers(s.game, { bodyOf: id => s.vehicles.get(id)?.body, judgedId: () => null, isVehicleBody: () => false, onHit: () => {} })
    try {
      lasers.spawn(1, { id: 1, o: [0, 4, -2], d: [0, 0, -1], boost: 0, t: 0 } as ShotInfo)
      lasers.spawn(2, { id: 1, o: [0, 4, -12], d: [0, 0, 1], boost: 0, t: 0, k: 'red' } as ShotInfo)
      expect(lasers.count).toBe(2)
      lasers.reset()
      expect(lasers.count).toBe(0)
    } finally { lasers.dispose(); s.close() }
  })

  it('BotGear resets its cord, carry and charge and reports them as the bot', () => {
    params.set('bungee.allowed', true); params.set('bigRed.allowed', true)
    const s = setup()
    const cords: CordWire[] = [], yoinks: YoinkWire[] = []
    const bot = s.vehicles.get(1)!, target = s.vehicles.get(2)!
    const gear = new BotGear(s.game, 1, bot, {
      ...s.common, vehicleIds: () => [1, 2, 3], heldElsewhere: () => false, responding: () => true,
      sendCord: (_id, c) => cords.push(c), sendYoink: (_id, y) => yoinks.push(y),
      fireRed: () => {}, launchPester: () => true,
    })
    try {
      gear.act({ gear: 'bungee', target, phase: 'press' })
      for (let i = 0; i < 20 && !gear.bungee.attached; i++) { s.game.time += DT; gear.fixedUpdate(DT); s.world.step() }
      expect(gear.bungee.attached).toBe(true)
      expect(gear.active).toBe(true)
      gear.reset()
      expect(gear.bungee.count).toBe(0)
      expect(gear.yoink.count).toBe(0)
      expect(gear.red.charge).toBe(-1)
      expect(gear.active).toBe(false)
      expect(cords.at(-1)).toEqual({ s: 'off' })
      s.game.time += DT; gear.fixedUpdate(DT)
      expect(gear.bungee.count).toBe(0)
    } finally { gear.dispose(); s.close() }
  })
})

describe('relayed cords that cannot belong here', () => {
  function bungee() {
    params.set('bungee.allowed', true)
    const s = setup()
    const b = new Bungee(s.game, { ...s.common, control: () => ({ fire: false, direction: [0, 0, -1] }), inHand: () => false })
    return { b, close: () => { b.dispose(); s.close() } }
  }

  it('draws a cord anchored within reach of its owner', () => {
    const { b, close } = bungee()
    try {
      b.applyRemote(2, { s: 'on', at: [0, 0, -40], n: [0, 1, 0], r: 30 })
      // The shared renderer reserves the cord and its anchor immediately.
      expect(b.count).toBe(2)
    } finally { close() }
  })

  it('drops a ground anchor further from its owner than any cord could stretch', () => {
    const { b, close } = bungee()
    try {
      const far = (bungeeLength.def.max ?? 300) * bungeeSnap.value + 50
      b.applyRemote(2, { s: 'on', at: [0, 0, -10 - far], n: [0, 1, 0], r: 30 })
      expect(b.count).toBe(0)
      // And a good cord that later turns implausible is removed, not kept at its old anchor.
      b.applyRemote(2, { s: 'on', at: [0, 0, -40], n: [0, 1, 0], r: 30 })
      // The shared renderer reserves the cord and its anchor immediately.
      expect(b.count).toBe(2)
      b.applyRemote(2, { s: 'on', at: [0, 900, -10], n: [0, 1, 0], r: 30 })
      expect(b.count).toBe(0)
    } finally { close() }
  })

  it('drops non-finite and over-long cords', () => {
    const { b, close } = bungee()
    try {
      b.applyRemote(2, { s: 'on', at: [0, NaN, -14], n: [0, 1, 0], r: 6 })
      b.applyRemote(3, { s: 'on', at: [0, 0, -24], n: [0, 1, 0], r: Infinity })
      b.applyRemote(2, { s: 'on', at: [0, 0, -14], n: [0, 1, 0], r: (bungeeLength.def.max ?? 300) + 50 })
      b.applyRemote(3, { s: 'on', at: [0, 0, -24], n: [NaN, 1, 0], r: 6 })
      expect(b.count).toBe(0)
    } finally { close() }
  })
})
