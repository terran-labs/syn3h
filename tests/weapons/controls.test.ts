import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import type { Game } from '../../src/core/Game'
import { Input } from '../../src/core/Input'
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
function setup(realInput = false) {
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
  // Contract double for the separately owned Input API. These tests exercise Gear;
  // native source sampling and UI identity retention require composition coverage.
  const owners = new Map<object | symbol, boolean>()
  const contractInput = {
    suspended: false, state: { fire: false }, external: {} as { fire?: boolean },
    beginExternalFire(owner: object | symbol) {
      if (!owners.has(owner)) owners.set(owner, this.suspended)
      refresh()
    },
    endExternalFire(owner: object | symbol) { owners.delete(owner); refresh() },
    suppressExternalFire(owner: object | symbol) {
      if (!owners.has(owner)) return
      owners.set(owner, true); refresh()
    },
  }
  if (realInput) vi.stubGlobal('navigator', { getGamepads: () => [] })
  const input = realInput ? new Input(noTarget) : contractInput
  const refresh = () => {
    input.external.fire = [...owners.values()].some(blocked => !blocked)
    input.state.fire = !input.suspended && input.external.fire
  }
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
      rack.postPhysics()
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
      expect(c.status).toMatch(/^Cord \d+ m$/)
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
      expect(ids(held)).toEqual(['grab', 'fling'])
      expect(held.actions[0].hold).toBe(true)
      expect(held.actions[1].hold).toBe(false)
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
      expect(ids(ready)).toEqual(['charge'])
      ready.actions[0].stop!() // This presentation closure did not acquire the gesture.
      expect(s.input.external.fire).toBe(true)
      idle.actions[0].stop!() // End the exact action captured on press.
      expect(s.input.external.fire).toBe(false)
      expect(s.input.state.fire).toBe(false)
      s.step()
      expect(s.bigRed.stats).toEqual({ sent: 1, fizzled: 0 })
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


describe('modal gear cancellation', () => {
  it('discards a full Thunder charge without release, fizzle or cooldown reset', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('red')
      s.rack.controls().actions[0].start()
      s.input.state.fire = true; s.step(501)
      expect(s.bigRed.ready).toBe(true)
      const reset = vi.spyOn(s.bigRed, 'reset')
      const release = vi.spyOn(s.bigRed, 'letGo')
      const inhibitor = vi.fn(() => {
        expect(s.bigRed.charge).toBe(-1)
        expect(s.input.external.fire).toBe(true)
        expect(s.input.state.fire).toBe(true)
      })
      s.rack.cancelActions(inhibitor)
      s.step()
      expect(inhibitor).toHaveBeenCalledOnce()
      expect(reset).not.toHaveBeenCalled()
      expect(release).not.toHaveBeenCalled()
      expect(s.bigRed.stats).toEqual({ sent: 0, fizzled: 0 })
      // A deliberate fizzle creates a cooldown. Cancellation must not erase it.
      s.input.state.fire = true; s.step()
      expect(s.bigRed.charge).toBeGreaterThanOrEqual(0)
      s.input.state.fire = false; s.step()
      s.rack.cancelActions(() => {})
      s.input.state.fire = true; s.step()
      expect(s.bigRed.charge).toBe(-1)
    } finally { s.close() }
  })

  it('drops a carried vehicle gently instead of flinging on cleanup', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('yoink')
      const grab = s.rack.controls().actions[0]
      grab.start(); s.input.state.fire = true; s.step()
      expect(s.yoink.holding).toBe(3)
      const fling = s.rack.controls().actions.find(a => a.id === 'fling')!
      s.rack.cancelActions(() => {})
      grab.stop!(); fling.start(); s.step()
      expect(s.yoink.holding).toBeNull()
      expect(s.yoink.stats.flings).toBe(0)
      expect(s.yoink.stats.drops).toBe(1)
      s.rack.cancelActions(() => {})
      expect(s.yoink.stats.drops).toBe(1)
    } finally { s.close() }
  })

  it('cancels only the local hook and reel, leaving remote cords intact', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('bungee')
      const launch = s.rack.controls().actions[0]
      s.bungee.applyRemote(3, { s: 'on', at: [0, 0, -14], n: [0, 1, 0], r: 6 })
      const remoteOnlyCount = s.bungee.count
      const cords = (s.bungee as unknown as { cords: Map<number, { at: THREE.Vector3 | null }> }).cords
      const remote = cords.get(3)!
      const anchor = remote.at!.clone()
      expect(remoteOnlyCount).toBe(2) // Remote cord plus ground anchor.
      launch.start()
      expect(s.bungee.mine?.hook).toBeTruthy()
      expect(s.bungee.count).toBe(remoteOnlyCount + 2) // Local cord plus flying hook.
      s.bungee.setReel(-1)
      const reset = vi.spyOn(s.bungee, 'reset')
      s.rack.cancelActions(() => {})
      launch.start()
      expect(s.bungee.mine).toBeUndefined()
      expect(s.bungee.reel).toBe(0)
      expect(s.bungee.count).toBe(remoteOnlyCount)
      expect(cords.get(3)).toBe(remote)
      expect(remote.at!.equals(anchor)).toBe(true)
      expect(reset).not.toHaveBeenCalled()
      s.rack.cancelActions(() => {})
      expect(s.bungee.count).toBe(remoteOnlyCount)
      expect(cords.get(3)).toBe(remote)
      expect(remote.at!.equals(anchor)).toBe(true)
      s.bungee.applyRemote(3, { s: 'off' })
      expect(cords.has(3)).toBe(false)
      expect(s.bungee.count).toBe(0)
    } finally { s.close() }
  })

  it('clears a pending pulse without letting stale starts or stops affect fresh controls', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('beam')
      const staleHold = s.rack.controls().actions[0]
      staleHold.start()
      s.rack.select('pester')
      const stalePulse = s.rack.controls().actions[0]
      stalePulse.start()
      s.rack.cancelActions(() => {})
      stalePulse.start(); staleHold.start()
      expect(s.input.external.fire).toBe(false)
      s.rack.select('beam')
      const fresh = s.rack.controls().actions[0]
      s.input.suspended = true; fresh.start()
      expect(s.input.external.fire).toBe(false)
      s.input.suspended = false; fresh.start()
      s.input.state.fire = true
      staleHold.stop!(); s.rack.fixedUpdate()
      expect(s.input.external.fire).toBe(true)
      fresh.stop!()
      expect(s.input.external.fire).toBe(false)
    } finally { s.close() }
  })

  it('cancels before binding and clears outputs if the required inhibitor fails', () => {
    const s = setup()
    try {
      s.rack.cancelActions(() => {}) // Safe before live systems are bound.
      s.bind(); s.rack.select('beam'); s.rack.controls().actions[0].start()
      expect(() => s.rack.cancelActions(() => { throw new Error('inhibitor failed') })).toThrow('inhibitor failed')
      expect(s.input.external.fire).toBe(false)
      expect(s.input.state.fire).toBe(false)
      s.rack.cancelActions(() => {})
      s.bind(); s.rack.select('beam')
      s.rack.controls().actions[0].start()
      expect(s.input.external.fire).toBe(true)
    } finally { s.close() }
  })

  it('cleanup retains a blocked hold until its real end and never dispatches a release', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('red')
      const action = s.rack.controls().actions[0]
      action.start(); s.step(501)
      expect(s.bigRed.ready).toBe(true)
      const release = vi.spyOn(s.bigRed, 'letGo')
      action.stop!('cleanup')
      expect(s.input.state.fire).toBe(false)
      expect(s.bigRed.charge).toBe(-1)
      expect(release).not.toHaveBeenCalled()
      action.start(); s.step()
      expect(s.input.state.fire).toBe(false)
      expect(release).not.toHaveBeenCalled()
      action.stop!('end'); action.start(); s.step()
      expect(s.input.state.fire).toBe(true)
      expect(s.bigRed.charge).toBeGreaterThanOrEqual(0)
    } finally { s.close() }
  })

  it('cleanup preserves another eligible holder and stale cleanup/end cannot clear fresh fire', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('red')
      const old = s.rack.controls().actions[0]
      old.start(); s.step(501)
      const other = Symbol('independent touch')
      s.input.beginExternalFire(other)
      const cancel = vi.spyOn(s.bigRed, 'cancel')
      old.stop!('cleanup')
      expect(s.input.state.fire).toBe(true)
      expect(s.bigRed.ready).toBe(true)
      expect(cancel).not.toHaveBeenCalled()
      // Modal all-owner inhibitor is supplied by Input/composition.
      s.rack.cancelActions(() => s.input.suppressExternalFire(other))
      const fresh = s.rack.controls().actions[0]
      fresh.start()
      const calls = cancel.mock.calls.length
      old.stop!('cleanup'); old.stop!('end'); old.stop!('end')
      expect(s.input.state.fire).toBe(true)
      expect(cancel.mock.calls).toHaveLength(calls)
      fresh.stop!('end')
      expect(s.input.state.fire).toBe(false)
    } finally { s.close() }
  })


  it('keeps the pulse visible to fixed consumers, then retires only its ephemeral owner', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('pester')
      const pulse = s.rack.controls().actions[0]
      pulse.start()
      s.rack.fixedUpdate()
      expect(s.input.state.fire).toBe(true)
      s.rack.postPhysics()
      expect(s.input.state.fire).toBe(false)
      const other = Symbol('held TAG')
      s.input.beginExternalFire(other)
      pulse.start(); s.rack.fixedUpdate(); s.rack.postPhysics()
      expect(s.input.state.fire).toBe(true)
      s.input.endExternalFire(other)
      expect(s.input.state.fire).toBe(false)
    } finally { s.close() }
  })


  it('old same-direction reel cleanup and end cannot stop a replacement reel', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('bungee')
      s.bungee.launch(AT_OTHER)
      for (let i = 0; i < 100 && s.bungee.mine?.hook; i++) s.step()
      expect(s.rack.controls().state).toBe('vehicle')
      const old = s.rack.controls().actions.find(a => a.id === 'reelIn')!
      old.start()
      // Model ordinary attachment-state replacement without a modal generation change.
      s.bungee.mine!.to = null
      const fresh = s.rack.controls().actions.find(a => a.id === 'reelIn')!
      expect(fresh).not.toBe(old)
      fresh.start()
      old.stop!('cleanup'); old.stop!('end')
      expect(s.bungee.reel).toBe(-1)
      fresh.stop!('end')
      expect(s.bungee.reel).toBe(0)
    } finally { s.close() }
  })

  it('rebinding invalidates old starts but permits old ends to retire only their token', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('beam')
      const old = s.rack.controls().actions[0]
      old.start(); s.bind()
      const fresh = s.rack.controls().actions[0]
      fresh.start(); old.stop!('cleanup'); old.stop!('end')
      expect(s.input.state.fire).toBe(true)
      fresh.stop!('end'); old.start()
      expect(s.input.state.fire).toBe(false)
    } finally { s.close() }
  })

  it('already suppressed old cleanup cannot cancel a pending intentional release', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('red')
      const old = s.rack.controls().actions[0]
      old.start(); s.step(501)
      const fresh = s.rack.controls().actions[0]
      expect(fresh).not.toBe(old)
      fresh.start()
      // Retire old gameplay while the newer hold still owns the charge.
      // Its duplicate cleanup must not cancel the newer intentional release.
      old.stop!('cleanup')
      fresh.stop!('end')
      const cancel = vi.spyOn(s.bigRed, 'cancel')
      old.stop!('cleanup')
      expect(cancel).not.toHaveBeenCalled()
      s.step()
      expect(s.bigRed.stats.sent).toBe(1)
    } finally { s.close() }
  })


  it('cleanup after a gear switch cancels the old charge without firing it', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('red')
      const old = s.rack.controls().actions[0]
      old.start(); s.step(501)
      s.rack.select('beam'); s.rack.controls().actions[0].start()
      old.stop!('cleanup'); s.step()
      expect(s.input.state.fire).toBe(true)
      expect(s.bigRed.charge).toBe(-1)
      expect(s.bigRed.stats.sent).toBe(0)
    } finally { s.close() }
  })


  it('touch suppression helper preserves overlap and cancels only charge/carry at zero holders', () => {
    const s = setup()
    try {
      s.bind()
      const red = vi.spyOn(s.bigRed, 'cancel')
      const yoink = vi.spyOn(s.yoink, 'cancel')
      const bungee = vi.spyOn(s.bungee, 'cancel')
      const reel = vi.spyOn(s.bungee, 'setReel')
      const first = Symbol('first touch'), second = Symbol('second touch')
      s.input.beginExternalFire(first); s.input.beginExternalFire(second)
      s.input.suppressExternalFire(first); s.rack.cancelFireActionsIfIdle()
      expect(red).not.toHaveBeenCalled(); expect(yoink).not.toHaveBeenCalled()
      s.input.suppressExternalFire(second); s.rack.cancelFireActionsIfIdle()
      expect(red).toHaveBeenCalledOnce(); expect(yoink).toHaveBeenCalledOnce()
      expect(bungee).not.toHaveBeenCalled(); expect(reel).not.toHaveBeenCalled()
      s.input.beginExternalFire(first)
      expect(s.input.state.fire).toBe(false) // The helper did not retire blocked owners.
    } finally { s.close() }
  })


  it('a synchronous selection listener cancels charge before the next fixed step', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('red')
      const old = s.rack.controls().actions[0]
      old.start(); s.step(501)
      const inhibit = vi.fn()
      const unsubscribe = s.rack.onChange(() => s.rack.cancelSelectionActions(inhibit))
      s.rack.select('beam')
      expect(inhibit).toHaveBeenCalledOnce()
      expect(s.bigRed.charge).toBe(-1)
      expect(s.input.state.fire).toBe(false)
      old.start(); old.stop!('end'); s.step()
      expect(s.bigRed.stats.sent).toBe(0)
      s.rack.select('beam')
      expect(inhibit).toHaveBeenCalledOnce()
      unsubscribe()
    } finally { s.close() }
  })

  it('selection gently drops a carry and clears a pending pulse without UI refresh', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('yoink')
      s.rack.controls().actions[0].start(); s.step()
      expect(s.yoink.holding).toBe(3)
      const unsubscribe = s.rack.onChange(() => s.rack.cancelSelectionActions(() => {}))
      s.rack.select('pester')
      expect(s.yoink.holding).toBeNull()
      expect(s.yoink.stats.flings).toBe(0)
      s.rack.controls().actions[0].start()
      s.rack.select('beam'); s.step()
      expect(s.input.external.fire).toBe(false)
      expect(s.yoink.stats.flings).toBe(0)
      unsubscribe()
    } finally { s.close() }
  })

  it('selection preserves flying and attached cords while stopping reel intent', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('bungee')
      s.bungee.launch(AT_OTHER)
      const cord = s.bungee.mine!
      expect(cord.hook).toBeTruthy()
      const cancel = vi.spyOn(s.bungee, 'cancel')
      const reset = vi.spyOn(s.bungee, 'reset')
      const unsubscribe = s.rack.onChange(() => s.rack.cancelSelectionActions(() => {}))
      s.rack.select('beam')
      expect(s.bungee.mine).toBe(cord)
      for (let i = 0; i < 100 && s.bungee.mine?.hook; i++) s.step()
      expect(s.bungee.attached).toBe(true)
      s.rack.select('bungee'); s.bungee.setReel(-1)
      s.rack.select('beam')
      expect(s.bungee.mine).toBe(cord)
      expect(s.bungee.reel).toBe(0)
      expect(cancel).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled()
      unsubscribe()
    } finally { s.close() }
  })

  it('clears queued wheel and double-tap history without changing a live cord or cooldown', () => {
    const s = setup()
    try {
      s.bind(); s.rack.select('bungee'); s.bungee.launch(AT_OTHER)
      for (let i = 0; i < 100 && s.bungee.mine?.hook; i++) s.step()
      expect(s.bungee.attached).toBe(true)
      const cord = s.bungee.mine!, rest = cord.rest
      // Seed pending event state directly; the production method may change only these
      // four fields, and the next real control step must preserve the cord.
      const pending = s.bungee as unknown as { fireWas: boolean; lastPress: number; wheel: number; readyAt: number }
      pending.fireWas = true; pending.lastPress = s.game.time; pending.wheel = 1
      const readyAt = pending.readyAt
      s.bungee.setReel(-1); s.bungee.clearControlIntent()
      expect(s.bungee.mine).toBe(cord)
      expect(s.bungee.reel).toBe(0)
      expect(pending.readyAt).toBe(readyAt)
      s.input.state.fire = true
      s.bungee.fixedUpdate(0)
      expect(s.bungee.mine).toBe(cord) // Fresh press must not count as the old double tap.
      expect(cord.rest).toBe(rest) // No wheel payout survives the selection boundary.
    } finally { s.close() }
  })

})


// These are real Input and gear systems, exercised through their action API.
// They do not mount GearSelector, prove DOM safety, or model primary TAG event wiring.
describe('stable primary hold presentation with real Input', () => {
  it.each(['end', 'cleanup'] as const)('Thunder retains charge through presentation refresh until %s', reason => {
    const s = setup(true)
    try {
      s.bind(); s.rack.select('red')
      const captured = s.rack.controls().actions[0]
      captured.start(); s.step()
      expect(ids(s.rack.controls())).toEqual(['charge'])
      s.step(500)
      const ready = s.rack.controls()
      expect(ids(ready)).toEqual(['charge'])
      expect(s.bigRed.ready).toBe(true)
      ready.actions[0].stop!('end') // Never acquired ownership.
      expect(s.input.state.fire).toBe(true)
      captured.stop!(reason)
      if (reason === 'cleanup') captured.stop!('end')
      s.step()
      expect(s.input.state.fire).toBe(false)
      expect(s.bigRed.stats).toEqual({ sent: reason === 'end' ? 1 : 0, fizzled: 0 })
    } finally { s.close() }
  })

  it.each(['end', 'cleanup'] as const)('Yoink retains carry through presentation refresh until %s', reason => {
    const s = setup(true)
    try {
      s.bind(); s.rack.select('yoink')
      const captured = s.rack.controls().actions[0]
      captured.start(); s.step()
      const held = s.rack.controls()
      expect(ids(held)).toEqual(['grab', 'fling'])
      expect(held.actions.map(a => a.hold)).toEqual([true, false])
      expect(s.yoink.holding).toBe(3)
      held.actions[0].stop!('end') // The displayed closure is not the captured owner.
      expect(s.input.state.fire).toBe(true)
      expect(s.yoink.holding).toBe(3)
      captured.stop!(reason)
      if (reason === 'cleanup') captured.stop!('end')
      s.step()
      expect(s.yoink.holding).toBeNull()
      expect(s.yoink.stats.flings).toBe(reason === 'end' ? 1 : 0)
      expect(s.yoink.stats.drops).toBe(reason === 'cleanup' ? 1 : 0)
    } finally { s.close() }
  })

  it('keeps explicit Fling separate from the retained grab gesture', () => {
    const s = setup(true)
    try {
      s.bind(); s.rack.select('yoink')
      const captured = s.rack.controls().actions[0]
      captured.start(); s.step()
      s.rack.controls().actions.find(a => a.id === 'fling')!.start()
      expect(s.yoink.holding).toBeNull()
      expect(s.yoink.stats.flings).toBe(1)
      captured.stop!('end'); s.step()
      expect(s.yoink.stats.flings).toBe(1)
    } finally { s.close() }
  })
})
