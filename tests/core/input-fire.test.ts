import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Input, primaryPointerEnded } from '../../src/core/Input'

// A fresh event target keeps each Input's native listeners isolated.
function harness() {
  const target = new EventTarget()
  const input = new Input(target as unknown as Window)
  const key = (type: string, code: string) => {
    const e = new Event(type)
    Object.defineProperties(e, { code: { value: code }, repeat: { value: false } })
    target.dispatchEvent(e)
  }
  const pointer = (type: string, pointerId = 1, buttons = type === 'pointerdown' ? 1 : 0, button = 0, pointerType = 'mouse') => {
    const e = new Event(type)
    Object.defineProperties(e, {
      pointerId: { value: pointerId }, button: { value: button }, buttons: { value: buttons }, pointerType: { value: pointerType },
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
  it('keeps mouse blocked across suppression and blur until real release', () => {
    const { input, pointer, target } = harness()
    pointer('pointerdown'); input.beginCanvasFire(1)
    input.cancelFireUntilNeutral()
    input.suppressCanvasFire(1); input.beginCanvasFire(1)
    target.dispatchEvent(new Event('blur'))
    expect(input.poll().fire).toBe(false)
    pointer('pointerup'); input.suppressCanvasFire(1)
    pointer('pointerdown'); input.beginCanvasFire(1)
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
    key('keydown', 'KeyL'); pointer('pointerdown'); input.beginCanvasFire(1)
    input.beginExternalFire(owner)
    expect(input.state.fire).toBe(false)
    input.suspended = false
    expect(input.poll().fire).toBe(false)
    key('keyup', 'KeyL'); pointer('pointercancel'); input.suppressCanvasFire(1)
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


describe('physical primary-neutral observations', () => {
  it.each(['mouse', 'pen'])('clears %s canvas hold on primary-first release before secondary-last up', pointerType => {
    const { input, pointer } = harness()
    pointer('pointerdown', 1, 1, 0, pointerType); input.beginCanvasFire(1); input.poll()
    pointer('pointermove', 1, 3, 2, pointerType)
    expect(input.state.fire).toBe(true)
    pointer('pointermove', 1, 2, 0, pointerType)
    expect(input.state.fire).toBe(false)
    pointer('pointerup', 1, 0, 2, pointerType)
    expect(input.poll().fire).toBe(false)
  })
  it('retains a canceled primary through chord movement until observed bit-zero', () => {
    const { input, pointer } = harness(), other = {}
    pointer('pointerdown'); input.beginCanvasFire(1); input.cancelFireUntilNeutral()
    input.beginExternalFire(other)
    pointer('pointermove', 1, 3, 2); pointer('pointermove', 1, 1, 2)
    input.endExternalFire(other)
    expect(input.state.fire).toBe(false)
    pointer('pointermove', 1, 0, 0)
    pointer('pointerdown'); input.beginCanvasFire(1)
    expect(input.poll().fire).toBe(true)
  })
  it('does not clear eligible external, keyboard or gamepad fire with native neutral', () => {
    const { input, pointer, key } = harness(), owner = {}
    pointer('pointerdown'); input.beginCanvasFire(1)
    input.beginExternalFire(owner); key('keydown', 'KeyL'); pads = [pad(0, true)]
    pointer('pointermove', 1, 2, 0)
    expect(input.state.fire).toBe(true)
    input.endExternalFire(owner); key('keyup', 'KeyL')
    expect(input.poll().fire).toBe(true)
    pads = [pad(0, false)]
    expect(input.poll().fire).toBe(false)
  })
  it('ignores untracked movement, touch movement and cleanup-shaped events', () => {
    const { input, pointer } = harness()
    pointer('pointerdown'); input.beginCanvasFire(1); input.poll()
    pointer('pointermove', 9, 0); pointer('pointermove', 1, 0, 0, 'touch')
    expect(input.state.fire).toBe(true)
    for (const type of ['blur', 'lostpointercapture', 'pointerleave'])
      expect(primaryPointerEnded({ type, pointerType: 'mouse', buttons: 0 })).toBe(false)
    pointer('pointercancel', 1, 0, -1)
    expect(input.state.fire).toBe(false)
  })
})

describe('scoped canvas fire ownership', () => {
  it('admits only tracked primary mouse/pen downs and never starts on movement', () => {
    const { input, pointer } = harness()
    input.beginCanvasFire(9)
    pointer('pointerdown', 2, 1, 0, 'touch'); input.beginCanvasFire(2)
    pointer('pointerdown', 3, 2, 2); input.beginCanvasFire(3)
    pointer('pointermove', 4, 1); input.beginCanvasFire(4)
    expect(input.state.fire).toBe(false)
    pointer('pointerdown', 5, 1, 0, 'pen')
    expect(input.poll().fire).toBe(false)
    input.beginCanvasFire(5)
    expect(input.state.fire).toBe(true)
  })
  it('does not let a UI pen release or cancel affect a canvas mouse hold', () => {
    const { input, pointer } = harness(), notify = vi.fn()
    input.onCanvasFireSuppressed(notify)
    pointer('pointerdown', 1); input.beginCanvasFire(1)
    pointer('pointerdown', 2, 1, 0, 'pen')
    pointer('pointerup', 2, 0, 0, 'pen')
    expect(input.state.fire).toBe(true)
    pointer('pointerdown', 2, 1, 0, 'pen')
    pointer('pointercancel', 2, 0, -1, 'pen')
    input.suppressCanvasFire(2); input.suppressCanvasFire(99)
    expect(input.state.fire).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })
  it('notifies after recomputation but before canceled identity retires, without dispatch', () => {
    const { input, pointer, target } = harness(), observations: boolean[] = [], release = vi.fn()
    target.addEventListener('pointerup', release)
    const unsubscribe = input.onCanvasFireSuppressed(() => {
      observations.push(input.state.fire)
      input.beginCanvasFire(1) // Same physical identity remains blocked inside callback.
      observations.push(input.state.fire)
    })
    pointer('pointerdown'); input.beginCanvasFire(1)
    pointer('pointercancel')
    expect(observations).toEqual([false, false])
    expect(release).not.toHaveBeenCalled()
    input.beginCanvasFire(1) // Retired identity cannot be admitted without a new down.
    expect(input.state.fire).toBe(false)
    pointer('pointerdown'); input.beginCanvasFire(1)
    expect(input.state.fire).toBe(true)
    unsubscribe(); input.suppressCanvasFire(1)
    expect(observations).toHaveLength(2)
  })
  it('retains canvas blocks across duplicate starts and preserves every other source', () => {
    const { input, pointer, key } = harness(), owner = {}, observed: boolean[] = []
    input.onCanvasFireSuppressed(() => observed.push(input.state.fire))
    pointer('pointerdown', 1); input.beginCanvasFire(1)
    pointer('pointerdown', 2, 1, 0, 'pen'); input.beginCanvasFire(2)
    input.beginExternalFire(owner); key('keydown', 'KeyL'); pads = [pad(0, true)]
    input.suppressCanvasFire(1)
    input.beginCanvasFire(1); input.suppressCanvasFire(1)
    pointer('pointercancel', 1)
    expect(observed).toEqual([true]) // Stale blocked cancellation does not notify.
    input.suppressAllCanvasFire()
    expect(observed).toEqual([true, true])
    input.endExternalFire(owner); key('keyup', 'KeyL'); pads = [pad(0, false)]
    expect(input.poll().fire).toBe(false)
    input.beginCanvasFire(2)
    expect(input.state.fire).toBe(false)
    pointer('pointerup', 2, 0, 0, 'pen')
    pointer('pointerdown', 2, 1, 0, 'pen'); input.beginCanvasFire(2)
    expect(input.state.fire).toBe(true)
  })
  it('suppresses all canvas holders once and does not notify for intentional releases', () => {
    const { input, pointer } = harness(), notify = vi.fn()
    input.onCanvasFireSuppressed(notify)
    pointer('pointerdown', 1); input.beginCanvasFire(1)
    pointer('pointerdown', 2, 1, 0, 'pen'); input.beginCanvasFire(2)
    input.suppressAllCanvasFire(); input.suppressAllCanvasFire()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(input.state.fire).toBe(false)
    pointer('pointerup', 1); pointer('pointerup', 2, 0, 0, 'pen')
    pointer('pointerdown', 1); input.beginCanvasFire(1)
    pointer('pointermove', 1, 2, 0)
    expect(input.state.fire).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
