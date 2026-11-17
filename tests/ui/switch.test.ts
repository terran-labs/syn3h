/**
 * The standard switch. Bugs these catch: a switch whose aria-checked disagrees with what it
 * shows (screen readers announce the wrong state), and Enter doing nothing on a focused switch.
 * The real browser path is exercised by sidebar.mjs and lobby-settings.mjs.
 */
import { expect, it } from 'vitest'
import { bindSwitch, isSwitchKey, type SwitchInput } from '../../src/ui/inspector/switch'
import { statusLines } from '../../src/ui/PerformancePanel'

/** Just enough of a checkbox: click flips checked and fires change, as a browser does. */
function fakeCheckbox() {
  const attributes = new Map<string, string>(), listeners: Record<string, ((event: any) => void)[]> = {}
  const box = {
    type: '', checked: false, disabled: false, className: '',
    setAttribute(name: string, value: string) { attributes.set(name, value) },
    addEventListener(type: string, listener: (event: any) => void) { (listeners[type] ??= []).push(listener) },
    click() { if (box.disabled) return; box.checked = !box.checked; for (const l of listeners.change ?? []) l({}) },
    key(key: string) { let prevented = false; for (const l of listeners.keydown ?? []) l({ key, repeat: false, preventDefault() { prevented = true } }); return prevented },
    attributes,
  }
  return box
}

it('exposes role switch with aria-checked matching its state, however the state changes', () => {
  const box = fakeCheckbox()
  const set = bindSwitch(box as SwitchInput)
  expect(box.type).toBe('checkbox')
  expect(box.attributes.get('role')).toBe('switch')
  expect(box.attributes.get('aria-checked')).toBe('false')
  box.click()
  expect(box.checked).toBe(true); expect(box.attributes.get('aria-checked')).toBe('true')
  set(false)
  expect(box.checked).toBe(false); expect(box.attributes.get('aria-checked')).toBe('false')
  set(true)
  expect(box.attributes.get('aria-checked')).toBe('true')
})

it('toggles from the keyboard with Enter, and Space stays the checkbox\'s own', () => {
  const box = fakeCheckbox(); bindSwitch(box as SwitchInput)
  expect(isSwitchKey(' ')).toBe(true); expect(isSwitchKey('Enter')).toBe(true)
  expect(box.key('Enter')).toBe(true)
  expect(box.checked).toBe(true); expect(box.attributes.get('aria-checked')).toBe('true')
  // Space is not intercepted: the browser's own checkbox behaviour toggles it.
  expect(box.key(' ')).toBe(false)
  box.disabled = true
  box.key('Enter')
  expect(box.checked).toBe(true)
})

it('keeps every Performance fact when splitting the status into a plain and a technical line', () => {
  const [main, detail] = statusLines({ name: 'High', auto: true, pinned: false, easing: null, pixelRatio: 1.25, post: 1, targetFps: 60 })
  expect(main).toMatch(/^High · Auto quality on · aiming for 60 fps$/)
  for (const fact of ['Pixel ratio 1.25', 'Post budget 100%', 'not pinned', 'Full resolution']) expect(detail).toContain(fact)
  expect(statusLines({ name: 'Ultra', auto: false, pinned: true, easing: 'resolution' })[0]).toBe('Ultra · Auto quality off · Resolution reduced automatically')
})
