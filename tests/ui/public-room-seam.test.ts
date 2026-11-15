import { describe, expect, it, vi } from 'vitest'
import { Shell } from '../../src/ui/Shell'

function fixture() {
  const state: any = Object.assign(Object.create(Shell.prototype), {
    roomInput: { value: 'lobby' }, updateRoomLabels: vi.fn(),
    toast: vi.fn(), inspector: { setStatus: vi.fn() },
    element: { querySelector: vi.fn(() => hint) },
    dropping: false, onPlanetRequest: vi.fn(() => true),
  })
  const hint = { textContent: '' }
  return { shell: state as Shell, state, hint }
}
describe('optional public-room Shell contract', () => {
  it('advertises room updates and planet interception as one versioned contract', () => {
    const { shell, state } = fixture()
    expect(shell.publicRoomRoutingVersion).toBe(1)
    shell.setRoom(' public-alpine-2 ')
    expect(shell.room).toBe('public-alpine-2')
    expect(state.updateRoomLabels).toHaveBeenCalledOnce()
    shell.setRoom(' ')
    expect(shell.room).toBe('public-alpine-2')
  })
  it('lets networking handle a planet before any world or camera work', () => {
    const { state } = fixture()
    expect(state.tapWorld('alpine~1')).toBe(true)
    expect(state.onPlanetRequest).toHaveBeenCalledWith('alpine')
  })
  it('does not route custom worlds or interrupt an active descent', () => {
    const { state } = fixture()
    expect(state.tapWorld('custom')).toBe(false)
    expect(state.onPlanetRequest).not.toHaveBeenCalled()
    state.dropping = true
    expect(state.tapWorld('alpine')).toBe(true)
    expect(state.onPlanetRequest).not.toHaveBeenCalled()
  })
  it('shows room notices in play, the inspector and the galaxy lobby', () => {
    const { shell, state, hint } = fixture()
    shell.showRoomStatus('This room is full. Trying another room...')
    expect(state.toast).toHaveBeenCalledWith(hint.textContent)
    expect(state.inspector.setStatus).toHaveBeenCalledWith(hint.textContent)
    shell.showRoomStatus('')
    expect(hint.textContent).toBe('Drag to look around. Tap a world to go there.')
  })
})
