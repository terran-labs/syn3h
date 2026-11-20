/**
 * A held fire button as intent (the owner, 19 November 2026): holding fire through a gear's
 * cooldown starts its charge or shot the moment it is ready. Bugs these catch: a press during
 * the cooldown still lost (click again); a charge starting under a button let go before the
 * cooldown ended; one starting under a button still held from before a gear switch.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { Game } from '../../src/core/Game'
import { RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { BigRed } from '../../src/weapons/BigRed'
import { bigRedCharge, bigRedCooldown } from '../../src/weapons/bigRedParams'
import { HeldFire } from '../../src/weapons/heldFire'

beforeAll(initPhysics)
afterEach(() => { params.set('bigRed.allowed', false); vi.unstubAllGlobals() })

const DT = 1 / 60

describe('HeldFire', () => {
  it('holds from a press made with the gear in hand until it is let go', () => {
    const t = new HeldFire()
    expect(t.step(true, true).pressed).toBe(true)
    expect(t.held).toBe(true)
    t.step(true, true); expect(t.held).toBe(true)
    expect(t.step(false, true).released).toBe(true)
    expect(t.held).toBe(false)
  })
  it('ends when the gear leaves the hand, and coming back while still held is not a press', () => {
    const t = new HeldFire()
    t.step(true, true)
    expect(t.step(true, false).released).toBe(true)
    expect(t.step(true, true).pressed).toBe(false)
    expect(t.held).toBe(false)
    t.step(false, true)
    expect(t.step(true, true).pressed).toBe(true)
  })
  it('a press made with another gear in hand does not count', () => {
    const t = new HeldFire()
    t.step(true, false)
    t.step(true, true)
    expect(t.held).toBe(false)
  })
  it('clear() ends it until a new press', () => {
    const t = new HeldFire()
    t.step(true, true); t.clear()
    t.step(true, true); expect(t.held).toBe(false)
    t.step(false, true); t.step(true, true); expect(t.held).toBe(true)
  })
})

describe('Plasma Thunder held through its cooldown', () => {
  function setup() {
    params.set('bigRed.allowed', true)
    const world = createWorld(0)
    world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0))
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0))
    world.createCollider(RAPIER.ColliderDesc.ball(1), body)
    vi.stubGlobal('window', { performance })
    vi.stubGlobal('document', { pointerLockElement: null })
    const game = { world, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), canvas: {}, time: 0, input: { state: { fire: false } } } as unknown as Game
    world.step()
    let inHand = true
    const fired: number[][] = []
    const red = new BigRed(game, { body: () => body, object: () => ({ position: new THREE.Vector3() }) as THREE.Object3D, inHand: () => inHand, fire: d => fired.push(d) })
    const tick = (n = 1) => { for (let i = 0; i < n; i++) { game.time += DT; red.fixedUpdate(DT) } }
    const hold = (on: boolean) => { (game.input.state as { fire: boolean }).fire = on }
    // Charge fully and send one, so the cooldown runs.
    const sendOne = () => {
      hold(true); tick(Math.ceil(bigRedCharge.value / DT) + 2)
      expect(red.ready).toBe(true)
      hold(false); tick()
      expect(red.stats.sent).toBeGreaterThan(0)
    }
    return { game, red, fired, tick, hold, sendOne, setHand: (v: boolean) => { inHand = v }, close: () => { red.dispose(); world.free() } }
  }

  it('starts the charge on the first tick the cooldown is over', () => {
    const s = setup()
    try {
      s.sendOne()
      const readyAt = s.game.time + bigRedCooldown.value
      // Pressed during the cooldown and held: nothing yet.
      s.hold(true)
      while (s.game.time + DT < readyAt - 1e-9) { s.tick(); expect(s.red.charge).toBe(-1) }
      // The first tick at or past the end of the cooldown starts it, as a press then would.
      s.tick(); if (s.game.time < readyAt) s.tick()
      expect(s.red.charge).toBeGreaterThanOrEqual(0)
      // Held on, it charges, and the release sends it: a second shot from one press.
      s.tick(Math.ceil(bigRedCharge.value / DT) + 2)
      s.hold(false); s.tick()
      expect(s.red.stats.sent).toBe(2)
    } finally { s.close() }
  })

  it('starts nothing if the button is let go before the cooldown ends', () => {
    const s = setup()
    try {
      s.sendOne()
      s.hold(true); s.tick(5)
      s.hold(false)
      s.tick(Math.ceil(bigRedCooldown.value / DT) + 10)
      expect(s.red.charge).toBe(-1)
      expect(s.red.stats).toEqual({ sent: 1, fizzled: 0 })
    } finally { s.close() }
  })

  it('a gear switch ends it: back in hand with the button still held starts nothing', () => {
    const s = setup()
    try {
      s.sendOne()
      s.hold(true); s.tick(5)
      s.setHand(false); s.tick()
      s.setHand(true)
      s.tick(Math.ceil(bigRedCooldown.value / DT) + 10)
      expect(s.red.charge).toBe(-1)
      // A new press does.
      s.hold(false); s.tick(); s.hold(true); s.tick()
      expect(s.red.charge).toBeGreaterThanOrEqual(0)
    } finally { s.close() }
  })

  it('a cancelled charge does not start again under a button still held', () => {
    const s = setup()
    try {
      s.hold(true); s.tick(3)
      expect(s.red.charge).toBeGreaterThan(0)
      s.red.cancel()
      s.tick(Math.ceil(bigRedCooldown.value / DT) + 10)
      expect(s.red.charge).toBe(-1)
    } finally { s.close() }
  })
})
