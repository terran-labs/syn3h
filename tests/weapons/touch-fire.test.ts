import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { Input } from '../../src/core/Input'
import type { Game } from '../../src/core/Game'
import { RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { BigRed } from '../../src/weapons/BigRed'
import { GearRack } from '../../src/weapons/Gear'
import { Bungee } from '../../src/weapons/bungee/Bungee'
import { Pesters } from '../../src/weapons/pester/Pesters'
import { Yoink } from '../../src/weapons/yoink/Yoink'

const allowed = ['laser.allowed', 'bigRed.allowed', 'bungee.allowed', 'pester.allowed', 'yoink.allowed']
beforeAll(initPhysics)
beforeEach(() => { for (const id of allowed) params.set(id, true) })
afterEach(() => vi.unstubAllGlobals())

function setup() {
  const target = new EventTarget() as unknown as Window
  Object.assign(target, { performance })
  vi.stubGlobal('window', target)
  vi.stubGlobal('document', { pointerLockElement: null })
  for (const type of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) vi.stubGlobal(type, class {})
  const pad = { connected: true, axes: [], buttons: [{ pressed: false }] }
  vi.stubGlobal('navigator', { getGamepads: () => [pad] })
  const input = new Input(target)
  const world = createWorld(0)
  const make = (x: number, z: number) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 5, z))
    world.createCollider(RAPIER.ColliderDesc.ball(1), body)
    const object = new THREE.Group(); object.position.set(x, 5, z)
    return { body, object }
  }
  const vehicles = new Map([[1, make(0, 0)], [2, make(0, -10)], [3, make(20, -10)]])
  const me = vehicles.get(1)!
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 5.4, 5); camera.lookAt(0, 5, -20); camera.updateMatrixWorld()
  const game = { input, world, camera, canvas: {}, scene: new THREE.Scene(), time: 0 } as unknown as Game
  const rack = new GearRack(game, target)
  const common = {
    self: () => 1, vehicleOf: (id: number) => vehicles.get(id),
    vehicleIds: () => [...vehicles.keys()], owns: () => true, lagOf: () => 0,
    wrapSize: () => 0, now: () => game.time,
  }
  const bungee = new Bungee(game, { ...common, inHand: () => rack.current === 'bungee',
    idOfBody: h => [...vehicles].find(([, v]) => v.body.handle === h)?.[0] ?? null }, target)
  const yoink = new Yoink(game, { ...common, inHand: () => rack.current === 'yoink' })
  const shots: number[][] = [], chasers: (number | null)[] = []
  const bigRed = new BigRed(game, { body: () => me.body, object: () => me.object,
    inHand: () => rack.current === 'red', fire: d => shots.push(d) })
  const pesters = new Pesters(game, { ...common, bodyOf: id => vehicles.get(id)?.body,
    judges: () => false, heightAt: () => 0, inHand: () => rack.current === 'pester',
    launch: id => chasers.push(id), onCatch: () => {} })
  rack.bind({ bungee, yoink, bigRed, pesters })
  world.step()
  const physics = () => {
    rack.fixedUpdate(); bungee.fixedUpdate(0.02); yoink.fixedUpdate(0.02)
    bigRed.fixedUpdate(0.02); pesters.fixedUpdate(0.02)
    world.step(); game.time += 0.02
  }
  const step = (n = 1) => { for (let i = 0; i < n; i++) { input.poll(); physics() } }
  const key = (code: string, down: boolean) => {
    const e = new Event(down ? 'keydown' : 'keyup'); Object.assign(e, { code, repeat: false }); target.dispatchEvent(e)
  }
  return { game, input, world, camera, rack, bungee, yoink, bigRed, chasers, shots, step, physics, key, pad, target,
    close: () => { rack.fireCancel(); bungee.dispose(); yoink.dispose(); bigRed.dispose(); pesters.dispose(); world.free() } }
}

function run(body: (s: ReturnType<typeof setup>) => void) {
  const s = setup(); try { body(s) } finally { s.close() }
}

describe('shared fire ownership', () => {
  it('holds through either finger lifting and makes one Chaser edge for two TAG owners', () => run(s => {
    s.rack.select('pester')
    s.rack.fireBegin('a'); s.step(); s.rack.fireBegin('b'); s.step()
    s.rack.fireEnd('a'); s.step()
    expect(s.input.state.fire).toBe(true); expect(s.chasers).toHaveLength(1)
    s.rack.fireEnd('b'); s.step(); expect(s.input.state.fire).toBe(false)
    s.rack.fireBegin('c'); s.step(); expect(s.chasers).toHaveLength(2)
  }))

  it('preserves native mouse, keyboard and gamepad press timing while touch is held', () => run(s => {
    s.rack.select('pester')
    s.input.mouseFire = true; s.step(); expect(s.chasers).toHaveLength(1)
    s.key('KeyL', true); s.pad.buttons[0].pressed = true; s.rack.fireBegin('tag'); s.step()
    s.input.mouseFire = false; s.key('KeyL', false); s.rack.fireEnd('tag'); s.step()
    expect(s.input.state.fire).toBe(true); expect(s.chasers).toHaveLength(1)
    s.pad.buttons[0].pressed = false; s.step()
    s.key('Enter', true); s.step(); expect(s.chasers).toHaveLength(2)
    s.key('Enter', false); s.step(); s.pad.buttons[0].pressed = true; s.step()
    expect(s.chasers).toHaveLength(3)
  }))

  it('does not let a GearRack action release another holder', () => run(s => {
    s.rack.select('red')
    const action = s.rack.controls().actions[0]
    action.start(); s.rack.fireBegin('aim', 'aim'); s.step(45)
    action.stop!(); s.step(); expect(s.bigRed.ready).toBe(true); expect(s.shots).toHaveLength(0)
    s.rack.fireEnd('aim'); s.step(); expect(s.shots).toHaveLength(1)
  }))

  it('defers Chaser until the final aim lift and picks the final camera target', () => run(s => {
    s.rack.select('pester'); s.input.cameraAim = true
    s.rack.fireBegin('aim', 'aim'); s.rack.fireBegin('aim2', 'aim'); s.step(10)
    expect(s.chasers).toHaveLength(0)
    s.rack.fireEnd('aim'); s.step(); expect(s.chasers).toHaveLength(0)
    s.camera.lookAt(20, 5, -10); s.camera.updateMatrixWorld()
    s.rack.fireEnd('aim2'); s.step(); expect(s.chasers).toEqual([3])
    s.step(10); expect(s.chasers).toEqual([3])
  }))

  it.each(['tag', 'native'])('consumes deferred Chaser when %s fires during the gesture', source => run(s => {
    s.rack.select('pester'); s.rack.fireBegin('aim', 'aim'); s.step()
    if (source === 'tag') s.rack.fireBegin('tag'); else s.input.mouseFire = true
    s.step(); expect(s.chasers).toHaveLength(1)
    if (source === 'tag') s.rack.fireEnd('tag'); else s.input.mouseFire = false
    s.step(); s.rack.fireBegin('another-aim', 'aim'); s.step()
    s.rack.fireEnd('aim'); s.rack.fireEnd('another-aim'); s.step(3); expect(s.chasers).toHaveLength(1)
  }))

  it('keeps a deferred pulse through render polls without physics and separates rapid pulses', () => run(s => {
    s.rack.select('pester'); s.rack.fireBegin('a', 'aim'); s.rack.fireEnd('a')
    s.input.poll(); s.input.poll(); s.physics(); expect(s.chasers).toHaveLength(1)
    s.rack.fireBegin('b', 'aim'); s.rack.fireEnd('b')
    s.step(3); expect(s.chasers).toHaveLength(2)
  }))

  it('defers idle Grapple, reels an attached cord, and never turns rapid aim presses into detach', () => run(s => {
    s.rack.select('bungee'); s.input.cameraAim = true; s.rack.fireBegin('aim', 'aim'); s.step(5)
    expect(s.bungee.mine).toBeUndefined()
    s.rack.fireEnd('aim'); s.step(); expect(s.bungee.stats.launched).toBe(1)
    for (let i = 0; i < 100 && !s.bungee.attached; i++) s.step()
    expect(s.bungee.attached).toBe(true)
    const length = s.bungee.mine!.rest
    s.rack.fireBegin('reel', 'aim'); s.step(5); s.rack.fireEnd('reel'); s.step()
    expect(s.bungee.mine!.rest).toBeLessThan(length)
    s.rack.fireBegin('reel2', 'aim'); s.step(); s.rack.fireEnd('reel2'); s.step()
    expect(s.bungee.attached).toBe(true); expect(s.bungee.reel).toBe(0)
    s.rack.controls().actions.find(a => a.id === 'release')!.start()
    expect(s.bungee.mine).toBeUndefined()
  }))

  it('Thunder waits at full charge and fires with the final camera direction on lift', () => run(s => {
    s.rack.select('red'); s.input.cameraAim = true
    s.rack.fireBegin('aim', 'aim'); s.step(100)
    expect(s.bigRed.ready).toBe(true); expect(s.shots).toHaveLength(0)
    s.camera.lookAt(30, 5, -10); s.camera.updateMatrixWorld()
    s.rack.fireEnd('aim'); s.step(); expect(s.shots).toHaveLength(1)
    expect(s.shots[0][0]).toBeGreaterThan(0.8)
  }))

  it('Thunder early release fizzles rather than firing', () => run(s => {
    s.rack.select('red'); s.rack.fireBegin('aim', 'aim'); s.step()
    s.rack.fireEnd('aim'); s.step(); expect(s.bigRed.stats.fizzled).toBe(1); expect(s.shots).toHaveLength(0)
  }))

  it.each(['cancel', 'blur', 'suspend', 'switch'])('discards a full charge on %s', why => run(s => {
    s.rack.select('red'); s.rack.fireBegin('aim', 'aim'); s.step(45)
    if (why === 'cancel') s.rack.fireEnd('aim', false)
    if (why === 'blur') s.target.dispatchEvent(new Event('blur'))
    if (why === 'suspend') s.input.suspended = true
    if (why === 'switch') { s.rack.select('beam'); s.rack.select('red') }
    s.step(45); s.rack.fireEnd('aim'); s.step()
    expect(s.shots).toHaveLength(0); expect(s.bigRed.charge).toBe(-1); expect(s.bigRed.stats.fizzled).toBe(0)
  }))

  it('a cancelled owner suppresses other still-held owners until their gesture ends', () => run(s => {
    s.rack.select('red'); s.rack.fireBegin('a', 'aim'); s.rack.fireBegin('b'); s.step(45)
    s.rack.fireCancel('a'); s.step(45); expect(s.bigRed.charge).toBe(-1)
    s.rack.fireBegin('b'); s.step(); expect(s.bigRed.charge).toBe(-1)
    s.rack.fireEnd('b'); s.rack.fireBegin('new'); s.step(); expect(s.bigRed.charge).toBeGreaterThanOrEqual(0)
  }))

  it('cancelling deferred launch sends nothing and duplicate ends cannot cancel a new charge', () => run(s => {
    s.rack.select('pester'); s.rack.fireBegin('old', 'aim'); s.rack.fireCancel('old'); s.step()
    expect(s.chasers).toHaveLength(0)
    s.rack.select('red'); s.rack.fireBegin('new', 'aim'); s.step(45)
    s.rack.fireEnd('old', false); s.rack.fireEnd('old'); s.step()
    expect(s.bigRed.ready).toBe(true)
    s.rack.fireEnd('new'); s.step(); expect(s.shots).toHaveLength(1)
  }))

  it('Yoink grabs on press, flings on intentional release, and drops gently on cancel', () => run(s => {
    s.rack.select('yoink'); s.rack.fireBegin('aim', 'aim'); s.step()
    expect(s.yoink.holding).toBe(2)
    s.rack.fireEnd('aim'); s.step(); expect(s.yoink.stats.flings).toBe(1)
  }))

  it.each(['cancel', 'switch', 'timeout'])('Yoink drops without flinging on %s', why => run(s => {
    s.rack.select('yoink'); s.rack.fireBegin('aim', 'aim'); s.step()
    expect(s.yoink.holding).toBe(2)
    if (why === 'cancel') s.rack.fireEnd('aim', false)
    if (why === 'switch') s.rack.select('beam')
    s.step(220); s.rack.fireEnd('aim'); s.step()
    expect(s.yoink.holding).toBeNull(); expect(s.yoink.stats.flings).toBe(0); expect(s.yoink.stats.drops).toBe(1)
  }))
})
