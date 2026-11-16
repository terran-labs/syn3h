import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Input } from '../../src/core/Input'
import { RetainedActionHolds, type GearAction } from '../../src/ui/gear/GearSelector'
import { TouchFireHolds } from '../../src/ui/TouchControls'

function events() {
  const target = new EventTarget()
  const pointer = (type: string, id: number, button = 0, pointerType = 'touch', buttons = type === 'pointerdown' ? 1 : 0) => {
    const event = new Event(type)
    Object.defineProperties(event, { pointerId: { value: id }, button: { value: button }, pointerType: { value: pointerType }, buttons: { value: buttons } })
    target.dispatchEvent(event)
  }
  const key = (type: string, code: string) => {
    const event = new Event(type)
    Object.defineProperty(event, 'code', { value: code })
    target.dispatchEvent(event)
  }
  return { target: target as unknown as Window, pointer, key }
}
function action(id: string): GearAction {
  return { id, label: id, keys: [], hold: true, start: vi.fn(), stop: vi.fn() }
}
beforeEach(() => {
  vi.stubGlobal('navigator', { getGamepads: () => [] })
  vi.stubGlobal('HTMLInputElement', class {})
  vi.stubGlobal('HTMLTextAreaElement', class {})
})
afterEach(() => vi.unstubAllGlobals())

describe('retained gear action membership', () => {
  it('aggregates separate keys and pointers and releases only after every real end', () => {
    const e = events(), holds = new RetainedActionHolds(e.target), a = action('reel')
    holds.pointer(a, 1); holds.pointer(a, 2); holds.key(a, 'Space'); holds.key(a, 'Enter')
    expect(a.start).toHaveBeenCalledTimes(1)
    e.pointer('pointerup', 1); e.key('keyup', 'Space'); e.pointer('pointercancel', 2)
    expect(a.stop).not.toHaveBeenCalled()
    e.key('keyup', 'Enter')
    expect(a.stop).toHaveBeenCalledExactlyOnceWith('end')
  })
  it('retains old membership through removal and does not reuse a held identity', () => {
    const e = events(), holds = new RetainedActionHolds(e.target), old = action('old'), fresh = action('new')
    holds.pointer(old, 1); holds.key(old, 'Enter'); holds.cleanup(old)
    expect(old.stop).toHaveBeenCalledExactlyOnceWith('cleanup')
    expect(holds.pointer(fresh, 1)).toBe(false)
    expect(holds.key(fresh, 'Enter')).toBe(false)
    holds.pointer(fresh, 2)
    e.pointer('pointerup', 1)
    expect(old.stop).toHaveBeenCalledTimes(1)
    e.key('keyup', 'Enter')
    expect(old.stop).toHaveBeenLastCalledWith('end')
    expect(fresh.stop).not.toHaveBeenCalled()
    expect(holds.active(fresh)).toBe(true)
    e.pointer('pointerup', 2)
    expect(fresh.stop).toHaveBeenCalledExactlyOnceWith('end')
  })
  it('does not mint another aggregate for the same retired action closure', () => {
    const e = events(), holds = new RetainedActionHolds(e.target), a = action('same')
    holds.pointer(a, 1); holds.cleanup(a); holds.pointer(a, 2)
    expect(a.start).toHaveBeenCalledTimes(1)
    e.pointer('pointerup', 2)
    expect(a.stop).toHaveBeenCalledTimes(1)
    e.pointer('pointerup', 1)
    expect(a.stop).toHaveBeenLastCalledWith('end')
    holds.pointer(a, 3)
    expect(a.start).toHaveBeenCalledTimes(2)
    e.pointer('pointerup', 3)
  })
  it('keeps only end listeners after cleanup and removes them after the final real end', () => {
    const e = events(), add = vi.spyOn(e.target, 'addEventListener'), remove = vi.spyOn(e.target, 'removeEventListener')
    const holds = new RetainedActionHolds(e.target), a = action('held')
    holds.pointer(a, 9); holds.dispose()
    expect(holds.pointer(action('disposed'), 10)).toBe(false)
    expect(add).toHaveBeenCalledTimes(4)
    expect(remove).not.toHaveBeenCalled()
    e.pointer('lostpointercapture', 9); e.pointer('pointerleave', 9)
    expect(a.stop).toHaveBeenCalledTimes(1)
    e.pointer('pointercancel', 9)
    expect(remove).toHaveBeenCalledTimes(4)
    e.pointer('pointerup', 9)
    expect(a.stop).toHaveBeenCalledTimes(2)
  })
})

describe('direct touch fire ownership with real Input', () => {
  it('keeps overlapping TAG pointers and keys active until final release', () => {
    const e = events(), input = new Input(e.target), canceled = vi.fn()
    const holds = new TouchFireHolds(input, e.target, canceled)
    holds.pointer(1); holds.pointer(2); holds.key('Space')
    e.pointer('pointerup', 1); e.key('keyup', 'Space')
    expect(input.state.fire).toBe(true)
    e.pointer('pointerup', 2)
    expect(input.state.fire).toBe(false)
    expect(canceled).not.toHaveBeenCalled()
  })
  it('suppresses cleanup without allowing a still-held pointer to rearm', () => {
    const e = events(), input = new Input(e.target), canceled = vi.fn()
    const holds = new TouchFireHolds(input, e.target, canceled)
    holds.pointer(1); holds.cleanup()
    expect(canceled).toHaveBeenCalledExactlyOnceWith()
    expect(input.state.fire).toBe(false)
    holds.pointer(1)
    expect(input.state.fire).toBe(false)
    holds.pointer(2)
    expect(input.state.fire).toBe(true)
    e.pointer('pointerup', 1)
    expect(input.state.fire).toBe(true)
    e.pointer('pointercancel', 2)
    expect(input.state.fire).toBe(false)
  })
  it('does not cancel another holder or call cleanup twice on an already blocked record', () => {
    const e = events(), input = new Input(e.target), canceled = vi.fn(), other = {}
    const holds = new TouchFireHolds(input, e.target, canceled)
    holds.pointer(1); input.beginExternalFire(other); holds.cleanup()
    expect(input.state.fire).toBe(true)
    expect(canceled).not.toHaveBeenCalled()
    input.endExternalFire(other); holds.cleanup()
    expect(canceled).not.toHaveBeenCalled()
    e.pointer('pointerup', 1)
  })
  it('retains tokens through modal inhibition and retires them on global real end', () => {
    const e = events(), input = new Input(e.target), canceled = vi.fn()
    const holds = new TouchFireHolds(input, e.target, canceled)
    holds.pointer(7); input.cancelFireUntilNeutral(); input.suspended = true; holds.cleanup()
    input.suspended = false; holds.pointer(7)
    expect(input.state.fire).toBe(false)
    e.pointer('pointerup', 7); holds.pointer(7)
    expect(input.state.fire).toBe(true)
    e.pointer('pointerup', 7)
  })
})


describe('primary pointer release ownership', () => {
  // Prepared event sequences model Pointer Events chord semantics. They do not prove
  // browser dispatch; the allocated native mouse fixture must confirm that separately.
  it.each(['mouse', 'pen'])('ends %s on primary-first move, not secondary button transitions', pointerType => {
    const e = events(), input = new Input(e.target), a = action('hold')
    const gear = new RetainedActionHolds(e.target), touch = new TouchFireHolds(input, e.target, () => {})
    gear.pointer(a, 1); touch.pointer(2)
    for (const id of [1, 2]) e.pointer('pointermove', id, 2, pointerType, 3)
    expect(a.stop).not.toHaveBeenCalled(); expect(input.state.fire).toBe(true)
    for (const id of [1, 2]) e.pointer('pointermove', id, 0, pointerType, 2)
    expect(a.stop).toHaveBeenCalledExactlyOnceWith('end'); expect(input.state.fire).toBe(false)
    for (const id of [1, 2]) e.pointer('pointerup', id, 2, pointerType, 0)
    expect(a.stop).toHaveBeenCalledTimes(1)
  })
  it.each([2, 4])('keeps primary through secondary-first release for secondary bit %s', sideBit => {
    const e = events(), input = new Input(e.target), a = action('hold')
    const gear = new RetainedActionHolds(e.target), touch = new TouchFireHolds(input, e.target, () => {})
    gear.pointer(a, 1); touch.pointer(2)
    for (const id of [1, 2]) {
      e.pointer('pointermove', id, sideBit === 2 ? 2 : 1, 'mouse', 1 | sideBit)
      e.pointer('pointermove', id, sideBit === 2 ? 2 : 1, 'mouse', 1)
    }
    expect(a.stop).not.toHaveBeenCalled(); expect(input.state.fire).toBe(true)
    for (const id of [1, 2]) e.pointer('pointerup', id, 0, 'mouse', 0)
    expect(a.stop).toHaveBeenCalledExactlyOnceWith('end'); expect(input.state.fire).toBe(false)
  })
  it('accepts secondary-last up as neutral when an intermediate release was not observed', () => {
    const e = events(), input = new Input(e.target), a = action('hold')
    const gear = new RetainedActionHolds(e.target), touch = new TouchFireHolds(input, e.target, () => {})
    gear.pointer(a, 1); touch.pointer(2)
    e.pointer('pointerup', 1, 2, 'mouse', 0); e.pointer('pointerup', 2, 1, 'mouse', 0)
    expect(a.stop).toHaveBeenCalledExactlyOnceWith('end'); expect(input.state.fire).toBe(false)
  })
  it('keeps retired identities during held movement and preserves a fresh overlapping owner', () => {
    const e = events(), input = new Input(e.target), old = action('old'), fresh = action('fresh')
    const gear = new RetainedActionHolds(e.target), touch = new TouchFireHolds(input, e.target, () => {})
    gear.pointer(old, 1); touch.pointer(2); gear.cleanup(old); touch.cleanup()
    gear.pointer(fresh, 3); touch.pointer(4)
    e.pointer('pointermove', 1, -1, 'mouse', 1); e.pointer('pointermove', 2, -1, 'pen', 1)
    expect(old.stop).toHaveBeenCalledExactlyOnceWith('cleanup')
    e.pointer('pointermove', 1, 0, 'mouse', 0); e.pointer('pointermove', 2, 0, 'pen', 2)
    expect(old.stop).toHaveBeenLastCalledWith('end')
    expect(fresh.stop).not.toHaveBeenCalled(); expect(input.state.fire).toBe(true)
    e.pointer('pointercancel', 3, -1); e.pointer('pointercancel', 4, -1)
  })
  it('keeps touch ownership on movement even with zero buttons and accepts explicit up', () => {
    const e = events(), input = new Input(e.target), a = action('hold')
    const gear = new RetainedActionHolds(e.target), touch = new TouchFireHolds(input, e.target, () => {})
    gear.pointer(a, 1); touch.pointer(2)
    e.pointer('pointermove', 1, -1, 'touch', 0); e.pointer('pointermove', 2, -1, 'touch', 0)
    expect(a.stop).not.toHaveBeenCalled(); expect(input.state.fire).toBe(true)
    e.pointer('pointerup', 1); e.pointer('pointerup', 2)
    expect(a.stop).toHaveBeenCalledExactlyOnceWith('end'); expect(input.state.fire).toBe(false)
  })
  it('accepts pointercancel regardless of its button sentinel', () => {
    const e = events(), input = new Input(e.target), a = action('hold')
    const gear = new RetainedActionHolds(e.target), touch = new TouchFireHolds(input, e.target, () => {})
    gear.pointer(a, 1); touch.pointer(2)
    e.pointer('pointercancel', 1, -1, 'pen', 0); e.pointer('pointercancel', 2, -1, 'touch', 0)
    expect(a.stop).toHaveBeenCalledExactlyOnceWith('end'); expect(input.state.fire).toBe(false)
  })
})
