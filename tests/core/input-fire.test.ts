import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Input } from '../../src/core/Input'

// A fresh event target keeps each Input's native listeners isolated.
function harness() {
  const target = new EventTarget()
  const input = new Input(target as unknown as Window)
  const key = (type: string, code: string) => {
    const e = new Event(type)
    Object.defineProperties(e, { code: { value: code }, repeat: { value: false } })
    target.dispatchEvent(e)
  }
  const pointer = (type: string, pointerId = 1) => {
    const e = new Event(type)
    Object.defineProperties(e, {
      pointerId: { value: pointerId }, button: { value: 0 }, pointerType: { value: 'mouse' },
    })
    target.dispatchEvent(e)
  }
  return { input, target, key, pointer }
}
let pads: Gamepad[]
function pad(index: number, pressed: boolean) {
  return { index, connected: true, axes: [], buttons: [{ pressed }] } as unknown as Gamepad
}
beforeEach(() => {
  pads = []
  vi.stubGlobal('navigator', { getGamepads: () => pads })
  vi.stubGlobal('HTMLInputElement', class {})
  vi.stubGlobal('HTMLTextAreaElement', class {})
})
afterEach(() => vi.unstubAllGlobals())

describe('fire cancellation ownership', () => {
  it('suppresses only its owner and never revives it on duplicate begin', () => {
    const { input } = harness(), a = {}, b = {}
    input.beginExternalFire(a); input.beginExternalFire(b)
    input.suppressExternalFire(a)
    expect(input.state.fire).toBe(true)
    input.endExternalFire(b)
    expect(input.state.fire).toBe(false)
    input.beginExternalFire(a)
    expect(input.state.fire).toBe(false)
    input.endExternalFire(a); input.beginExternalFire({})
    expect(input.state.fire).toBe(true)
  })
  it('makes stale ends and cleanup harmless to a fresh owner', () => {
    const { input } = harness(), old = {}, fresh = {}
    input.beginExternalFire(old); input.cancelFireUntilNeutral()
    input.beginExternalFire(fresh)
    input.suppressExternalFire(old); input.endExternalFire(old); input.endExternalFire(old)
    input.suppressExternalFire({})
    expect(input.state.fire).toBe(true)
    input.endExternalFire(fresh)
    expect(input.state.fire).toBe(false)
  })
  it('does not call gameplay or dispatch a release during suppression', () => {
    const { input, target } = harness(), owner = {}, release = vi.fn()
    target.addEventListener('pointerup', release)
    input.beginExternalFire(owner)
    input.suppressExternalFire(owner)
    expect(input.state.fire).toBe(false)
    expect(release).not.toHaveBeenCalled()
  })
  it('does not use stale sampled state or legacy cleanup as eligible fire', () => {
    const { input } = harness(), owner = {}
    input.external.fire = true
    expect(input.poll().fire).toBe(true)
    input.cancelFireUntilNeutral()
    input.external.fire = false; input.external.fire = true
    input.beginExternalFire(owner)
    input.state.fire = true
    input.suppressExternalFire(owner)
    expect(input.state.fire).toBe(false)
    expect(input.poll().fire).toBe(false)
  })
  it('blocks both held keys independently until release and fresh press', () => {
    const { input, key } = harness()
    key('keydown', 'KeyL'); key('keydown', 'Enter'); input.poll()
    input.cancelFireUntilNeutral()
    key('keyup', 'KeyL')
    expect(input.poll().fire).toBe(false)
    key('keydown', 'KeyL')
    expect(input.poll().fire).toBe(true)
    key('keyup', 'KeyL')
    expect(input.poll().fire).toBe(false)
    key('keyup', 'Enter'); key('keydown', 'Enter')
    expect(input.poll().fire).toBe(true)
  })
  it('keeps mouse blocked across synthetic false and blur until real release', () => {
    const { input, pointer, target } = harness()
    pointer('pointerdown'); input.mouseFire = true
    input.cancelFireUntilNeutral()
    input.mouseFire = false; input.mouseFire = true
    target.dispatchEvent(new Event('blur'))
    expect(input.poll().fire).toBe(false)
    pointer('pointerup'); input.mouseFire = false
    pointer('pointerdown'); input.mouseFire = true
    expect(input.poll().fire).toBe(true)
  })
  it('leaves sampled fire intact on blur until the composition cancels gear first', () => {
    const { input, key, target } = harness()
    key('keydown', 'KeyL'); input.poll()
    target.dispatchEvent(new Event('blur'))
    expect(input.state.fire).toBe(true)
    // The composition calls the gear cancellation primitive before this inhibitor.
    input.cancelFireUntilNeutral()
    expect(input.state.fire).toBe(false)
    key('keydown', 'KeyL')
    expect(input.poll().fire).toBe(false)
    key('keyup', 'KeyL'); key('keydown', 'KeyL')
    expect(input.poll().fire).toBe(true)
  })
  it('samples gamepad neutral during suspension without accepting disconnect as neutral', () => {
    const { input } = harness()
    pads = [pad(0, true)]; input.cancelFireUntilNeutral()
    pads = []; input.poll()
    pads = [pad(0, true)]
    expect(input.poll().fire).toBe(false)
    input.suspended = true
    pads = [pad(0, false)]; input.poll()
    input.suspended = false
    pads = [pad(0, true)]
    expect(input.poll().fire).toBe(true)
  })
  it('blocks new suspended presses, including external owners, until real end', () => {
    const { input, key, pointer } = harness(), owner = {}
    input.suspended = true
    key('keydown', 'KeyL'); pointer('pointerdown'); input.mouseFire = true
    input.beginExternalFire(owner)
    expect(input.state.fire).toBe(false)
    input.suspended = false
    expect(input.poll().fire).toBe(false)
    key('keyup', 'KeyL'); pointer('pointercancel'); input.mouseFire = false
    input.endExternalFire(owner); input.beginExternalFire({})
    expect(input.state.fire).toBe(true)
  })
  it('preserves eligible native fire when an external holder is suppressed', () => {
    const { input, key } = harness(), owner = {}
    input.beginExternalFire(owner); key('keydown', 'KeyL')
    input.suppressExternalFire(owner)
    expect(input.state.fire).toBe(true)
    key('keyup', 'KeyL'); input.poll()
    expect(input.state.fire).toBe(false)
  })
})
