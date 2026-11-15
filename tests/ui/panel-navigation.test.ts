import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlidingPanels } from '../../src/ui/SlidingPanels'

function fixture() {
  const panels = ['multiplayer', 'settings', 'about'].map(id => ({
    dataset: { panel: id }, hidden: false, inert: false,
    querySelector: () => ({ focus: vi.fn() }),
    animate: vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() })),
  }))
  const host = { dataset: {} as Record<string, string>, hidden: false, querySelectorAll: () => panels }
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  return { host, panels, navigation: new SlidingPanels(host as unknown as HTMLElement) }
}
afterEach(() => vi.unstubAllGlobals())
describe('direct lobby navigation', () => {
  it('keeps the galaxy state free of a rendered index panel', async () => {
    const { host, panels, navigation } = fixture()
    await navigation.show('index', true)
    expect(host.hidden).toBe(true)
    expect(panels.every(p => p.hidden && p.inert)).toBe(true)
    await navigation.show('settings')
    expect(panels.map(p => p.hidden)).toEqual([true, false, true])
    expect(panels[1].animate).toHaveBeenCalledTimes(1)
    expect(panels[0].animate).not.toHaveBeenCalled()
  })
  it('switches directly and closes without an intermediate welcome surface', async () => {
    const { host, panels, navigation } = fixture()
    await navigation.show('multiplayer')
    await navigation.show('about')
    expect(panels[0].animate).toHaveBeenCalledTimes(1)
    expect(panels[0].hidden).toBe(true)
    expect(panels[2].inert).toBe(false)
    await navigation.show('index')
    expect(host.hidden).toBe(true)
    expect(navigation.active).toBe('index')
  })
  it('honours reduced motion and a newer selection during a transition', async () => {
    const { host, panels, navigation } = fixture()
    const first = navigation.show('settings'), next = navigation.show('about')
    await Promise.all([first, next])
    expect(host.dataset.activePanel).toBe('about')
    expect(panels[1].hidden).toBe(true)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    await navigation.show('settings')
    expect(panels[1].animate).toHaveBeenCalledTimes(1)
    expect(panels[1].inert).toBe(false)
  })
})
