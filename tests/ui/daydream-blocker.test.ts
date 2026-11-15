import { afterEach, describe, expect, it, vi } from 'vitest'
import { Shell } from '../../src/ui/Shell'

// Exercise the real getters without constructing the renderer, audio or full DOM shell.
class FocusedElement {
  constructor(readonly tag: string, readonly isContentEditable = false) {}
  matches(selector: string) { return selector.split(',').map(s => s.trim()).includes(this.tag) }
}
function setup(touch = true) {
  const canvas = { requestPointerLock() {} }
  const document = { activeElement: null as FocusedElement | null, pointerLockElement: null as object | null }
  vi.stubGlobal('HTMLElement', FocusedElement)
  vi.stubGlobal('document', document)
  const shell: any = Object.assign(Object.create(Shell.prototype), {
    started: true, menuVisible: false, userPaused: false, inviteOpen: false, exitAsking: false,
    touchPanels: false, touch: { available: touch }, game: { canvas },
  })
  return { shell: shell as Shell, state: shell, document, canvas }
}
afterEach(() => vi.unstubAllGlobals())

describe('Daydream UI blocker', () => {
  it('allows ordinary cursor-free touch driving but blocks the open touch inspector', () => {
    const { shell, state, document } = setup()
    expect(document.pointerLockElement).toBeNull()
    expect(shell.daydreamBlocked).toBe(false)
    state.touchPanels = true
    expect(shell.daydreamBlocked).toBe(true)
    state.touchPanels = false
    expect(shell.daydreamBlocked).toBe(false)
  })
  it('blocks the desktop inspector immediately on cursor release, before its next render', () => {
    const { shell, document, canvas } = setup(false)
    document.pointerLockElement = canvas
    expect(shell.daydreamBlocked).toBe(false)
    document.pointerLockElement = null
    expect(shell.daydreamBlocked).toBe(true)
  })
  it.each(['input', 'textarea', 'select'])('blocks focused %s even when the panels are closed', tag => {
    const { shell, document } = setup()
    document.activeElement = new FocusedElement(tag)
    expect(shell.daydreamBlocked).toBe(true)
    document.activeElement = null
    expect(shell.daydreamBlocked).toBe(false)
  })
  it('blocks contenteditable text but does not treat an ordinary focused button as text entry', () => {
    const { shell, document } = setup()
    document.activeElement = new FocusedElement('div', true)
    expect(shell.daydreamBlocked).toBe(true)
    document.activeElement = new FocusedElement('button')
    expect(shell.daydreamBlocked).toBe(false)
  })
  it.each(['menuVisible', 'userPaused', 'inviteOpen', 'exitAsking'])('blocks %s independently of touch panel visibility', flag => {
    const { shell, state } = setup()
    state[flag] = true
    expect(shell.daydreamBlocked).toBe(true)
    state[flag] = false
    expect(shell.daydreamBlocked).toBe(false)
  })
  it('blocks before the player starts', () => {
    const { shell, state } = setup()
    state.started = false
    expect(shell.daydreamBlocked).toBe(true)
  })
})
