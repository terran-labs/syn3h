import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { Game } from '../../src/core/Game'
import { RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { BigRed } from '../../src/weapons/BigRed'
import { GEAR_DESCRIPTIONS, GEAR_LABELS, GearRack, type GearControls, type GearId } from '../../src/weapons/Gear'
import { Bungee } from '../../src/weapons/bungee/Bungee'
import type { Pesters } from '../../src/weapons/pester/Pesters'
import { Yoink } from '../../src/weapons/yoink/Yoink'

const GEAR = ['bungee.allowed', 'yoink.allowed', 'bigRed.allowed', 'pester.allowed', 'laser.allowed']

beforeAll(initPhysics)
beforeEach(() => { for (const id of GEAR) params.set(id, true) })
afterEach(() => {
  for (const id of GEAR) params.set(id, true)
  vi.unstubAllGlobals()
})

const noTarget = { addEventListener() {} } as unknown as Window

/** The player at the origin facing -z, and another vehicle (id 3) ten metres ahead. */
function setup() {
  const world = createWorld(0)
  const make = (z: number) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, z))
    world.createCollider(RAPIER.ColliderDesc.ball(1), body)
    const object = new THREE.Group()
    object.position.set(0, 5, z)
    return { body, object }
  }
  const me = make(0), other = make(-10)
  vi.stubGlobal('window', { performance })
  vi.stubGlobal('document', { pointerLockElement: null })
  const input = { state: { fire: false }, external: {} as { fire?: boolean } }
  const game = { world, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), canvas: {}, time: 0, input } as unknown as Game
  const rack = new GearRack(game, noTarget)
  const vehicleOf = (id: number) => (id === 1 ? me : id === 3 ? other : undefined)
  const bungee = new Bungee(game, {
    self: () => 1, vehicleOf, idOfBody: h => (h === other.body.handle ? 3 : h === me.body.handle ? 1 : null),
    owns: () => true, lagOf: () => 0, wrapSize: () => 0, now: () => game.time, inHand: () => rack.current === 'bungee',
  }, noTarget)
  const yoink = new Yoink(game, {
    self: () => 1, vehicleOf, vehicleIds: () => [1, 3], owns: () => true, lagOf: () => 0, wrapSize: () => 0,
    inHand: () => rack.current === 'yoink',
  })
  const bigRed = new BigRed(game, { body: () => me.body, object: () => me.object, inHand: () => rack.current === 'red', fire: () => {} })
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      game.time += 0.02
      for (const s of [rack, bungee, yoink, bigRed]) s.fixedUpdate(0.02)
      world.step()
    }
  }
  const bind = () => rack.bind({ bungee, yoink, bigRed, pesters: {} as Pesters, nameOf: id => `Bot ${id}` })
  return { game, input, rack, bungee, yoink, bigRed, step, bind, close: () => { bungee.dispose(); yoink.dispose(); bigRed.dispose(); world.free() } }
}

/** From the roof muzzle (1.1 up, 1.2 ahead) to the other vehicle's centre. */
const AT_OTHER: [number, number, number] = [0, -1.1, -8.8]
const ids = (c: GearControls) => c.actions.map(a => a.id)

describe('gear controls', () => {
  it('names and describes all five', () => {
    const all: GearId[] = ['beam', 'red', 'pester', 'bungee', 'yoink']
    expect(all.map(g => GEAR_LABELS[g])).toEqual(['Plasma Tag', 'Plasma Thunder', 'Chaser', 'Grapple', 'Yoink'])
    for (const g of all) {
      expect(GEAR_DESCRIPTIONS[g].length).toBeGreaterThan(10)
      expect(GEAR_DESCRIPTIONS[g]).not.toMatch(/\n|weapon|shoot|kill|damage|attack/i)
    }
    const s = setup()
    try {
      s.bind()
      for (const g of all) {
        s.rack.select(g)
        const c = s.rack.controls()
        expect(c.name).toBe(GEAR_LABELS[g])
        expect(c.description).toBe(GEAR_DESCRIPTIONS[g])
        expect(c.state).toBe('idle')
        expect(c.actions.length).toBe(1)
      }
    } finally { s.close() }
  })

  it('is safe before bind, with no actions', () => {
    const s = setup()
    try {
      s.rack.select('bungee')
      const c = s.rack.controls()
      expect(c).toMatchObject({ gear: 'bungee', name: 'Grapple', state: 'idle', actions: [] })
      expect(c.level).toBeUndefined()
      expect(s.rack.controls()).toBe(c)
      s.bind()
      expect(s.rack.controls()).not.toBe(c)
      expect(ids(s.rack.controls())).toEqual(['launch'])
    } finally { s.close() }
  })

  it('returns the same object while nothing changes, and a new one when gear changes', () => {
    const s = setup()
    try {
      s.bind()
      s.rack.select('beam')
      const a = s.rack.controls()
      s.step(3)
      expect(s.rack.controls()).toBe(a)
      expect(s.rack.controls()).toBe(a)
      s.rack.select('bungee')
      const b = s.rack.controls()
      expect(b).not.toBe(a)
      expect(s.rack.controls()).toBe(b)
      expect(b.actions[0]).toBe(s.rack.controls().actions[0])
    } finally { s.close() }
  })

  it('lists exactly the right Grapple actions in each state, and release drops the cord', () => {
    const s = setup()
    try {
      s.bind()
      s.rack.select('bungee')
      let c = s.rack.controls()
      expect(c.state).toBe('idle')
      expect(ids(c)).toEqual(['launch'])
      expect(c.level).toBe(0)

      expect(s.bungee.launch(AT_OTHER)).toBe(true)
      c = s.rack.controls()
      expect(c.state).toBe('flying')
      expect(ids(c)).toEqual(['release'])
      expect(c.status).toBeUndefined()

      for (let i = 0; i < 100 && s.bungee.mine?.hook; i++) s.step()
      c = s.rack.controls()
      expect(c.state).toBe('vehicle')
      expect(ids(c)).toEqual(['reelIn', 'payOut', 'release'])
      expect(c.actions.map(a => a.hold)).toEqual([true, true, false])
      expect(c.status).toMatch(/^Cord \d+ (m|ft)$/)
      expect(c.level).toBeGreaterThanOrEqual(0)
      expect(c.level).toBeLessThanOrEqual(1)
      // Same rounded length, same object.
      expect(s.rack.controls()).toBe(c)

      c.actions.find(a => a.id === 'release')!.start()
      expect(s.bungee.mine).toBeUndefined()
      expect(s.rack.controls().state).toBe('idle')
    } finally { s.close() }
  })

  it('reel in, let out and let go never raise the tag control', () => {
    const s = setup()
    try {
      s.bind()
      s.rack.select('bungee')
      s.bungee.launch(AT_OTHER)
      for (let i = 0; i < 100 && s.bungee.mine?.hook; i++) s.step()
      const c = s.rack.controls()
      const [reelIn, payOut, release] = c.actions
      const before = s.bungee.mine!.rest

      payOut.start(); s.step(10)
      expect(s.input.external.fire).toBeFalsy()
      expect(s.input.state.fire).toBe(false)
      expect(s.bungee.mine!.rest).toBeGreaterThan(before)
      payOut.stop!()
      expect(s.bungee.reel).toBe(0)

      const out = s.bungee.mine!.rest
      reelIn.start(); s.step(10)
      expect(s.input.external.fire).toBeFalsy()
      expect(s.bungee.mine!.rest).toBeLessThan(out)
      // Stopping the other direction leaves this one held.
      payOut.stop!()
      expect(s.bungee.reel).toBe(-1)
      reelIn.stop!()
      expect(s.bungee.reel).toBe(0)

      const launched = s.bungee.stats.launched
      release.start(); s.step(5)
      expect(s.input.external.fire).toBeFalsy()
      expect(s.bungee.mine).toBeUndefined()
      expect(s.bungee.stats.launched).toBe(launched)
    } finally { s.close() }
  })

  it('Yoink grabs while held, says what it holds, and flings on letting go', () => {
    const s = setup()
    try {
      s.bind()
      s.rack.select('yoink')
      const idle = s.rack.controls()
      expect(ids(idle)).toEqual(['grab'])
      expect(idle.actions[0].hold).toBe(true)
      expect(idle.level).toBe(0)
      idle.actions[0].start()
      s.input.state.fire = Boolean(s.input.external.fire) // what Input.poll would do
      s.step()
      const held = s.rack.controls()
      expect(held.state).toBe('holding')
      expect(held.status).toBe('Holding Bot 3')
      expect(held.level).toBe(1)
      expect(ids(held)).toEqual(['fling'])
      idle.actions[0].stop!()
      s.input.state.fire = Boolean(s.input.external.fire)
      s.step()
      expect(s.yoink.holding).toBeNull()
      expect(s.yoink.stats.flings).toBe(1)
      expect(s.rack.controls().state).toBe('idle')
    } finally { s.close() }
  })

  it('Plasma Thunder has one hold action through idle, charging and ready', () => {
    const s = setup()
    try {
      s.bind()
      s.rack.select('red')
      const idle = s.rack.controls()
      expect(ids(idle)).toEqual(['charge'])
      idle.actions[0].start()
      s.input.state.fire = Boolean(s.input.external.fire)
      s.step()
      expect(s.rack.controls().state).toBe('charging')
      expect(s.rack.controls().actions.map(a => a.hold)).toEqual([true])
      s.step(500)
      const ready = s.rack.controls()
      expect(ready.state).toBe('ready')
      expect(ready.level).toBe(1)
      expect(ready.actions.map(a => a.hold)).toEqual([true])
      ready.actions[0].stop!()
      expect(s.input.external.fire).toBe(false)
    } finally { s.close() }
  })

  it('a one press Chaser action holds the tag control for one step only', () => {
    const s = setup()
    try {
      s.bind()
      s.rack.select('pester')
      const c = s.rack.controls()
      expect(c.actions[0]).toMatchObject({ id: 'launch', hold: false })
      c.actions[0].start()
      expect(s.input.external.fire).toBe(true)
      s.input.state.fire = true // the next poll
      s.step()
      expect(s.input.external.fire).toBe(false)
    } finally { s.close() }
  })
})
