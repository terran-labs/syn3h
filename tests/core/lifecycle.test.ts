import { describe, expect, it, vi } from 'vitest'
import { PageLifecycle, type PageSignals, type PageState } from '../../src/core/lifecycle'

/** Browser signals a test can drive by hand. */
function fakePage(hidden = false) {
  const handlers = new Map<string, Set<() => void>>()
  const page = {
    hidden,
    fire(target: 'document' | 'window', type: string) { for (const h of [...(handlers.get(`${target}:${type}`) ?? [])]) h() },
    hide() { page.hidden = true; page.fire('document', 'visibilitychange') },
    show() { page.hidden = false; page.fire('document', 'visibilitychange') },
    count: () => [...handlers.values()].reduce((n, set) => n + set.size, 0),
  }
  const signals: PageSignals = {
    hidden: () => page.hidden,
    on(target, type, handler) {
      const key = `${target}:${type}`
      if (!handlers.has(key)) handlers.set(key, new Set())
      handlers.get(key)!.add(handler)
      return () => handlers.get(key)!.delete(handler)
    },
  }
  return { page, signals }
}

describe('page lifecycle', () => {
  it('starts in the state the page is in', () => {
    expect(new PageLifecycle(fakePage(false).signals).state).toBe('active')
    expect(new PageLifecycle(fakePage(true).signals).hidden).toBe(true)
  })

  it('announces each change once, with the previous state', () => {
    const { page, signals } = fakePage()
    const life = new PageLifecycle(signals), seen: [PageState, PageState][] = []
    life.onChange((state, previous) => seen.push([state, previous]))
    page.hide(); page.fire('document', 'visibilitychange'); page.show()
    expect(seen).toEqual([['hidden', 'active'], ['active', 'hidden']])
  })

  it('stays hidden until every reason to be hidden has gone', () => {
    const { page, signals } = fakePage()
    const life = new PageLifecycle(signals), seen: PageState[] = []
    life.onChange((state) => seen.push(state))
    // A phone locks: hidden, then frozen. It resumes before it is shown again.
    page.hide(); page.fire('document', 'freeze'); page.fire('document', 'resume')
    expect(life.state).toBe('hidden')
    page.show()
    // Into the back/forward cache while visible, then restored.
    page.fire('window', 'pagehide')
    expect(life.state).toBe('hidden')
    page.fire('window', 'pageshow')
    expect(seen).toEqual(['hidden', 'active', 'hidden', 'active'])
  })

  it('a frozen page that is also visible counts as hidden', () => {
    const { page, signals } = fakePage()
    const life = new PageLifecycle(signals)
    page.fire('document', 'freeze')
    expect(life.hidden).toBe(true)
    page.fire('document', 'resume')
    expect(life.hidden).toBe(false)
  })

  it('tells every listener to pause even when one throws', () => {
    const { page, signals } = fakePage()
    const life = new PageLifecycle(signals), later = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    life.onChange(() => { throw new Error('audio refused') })
    life.onChange(later)
    page.hide()
    expect(later).toHaveBeenCalledWith('hidden', 'active')
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('unsubscribes one listener, and dispose removes every browser handler', () => {
    const { page, signals } = fakePage()
    const life = new PageLifecycle(signals), a = vi.fn(), b = vi.fn()
    const off = life.onChange(a); life.onChange(b)
    off(); page.hide()
    expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledOnce()
    life.dispose(); page.show()
    expect(b).toHaveBeenCalledOnce(); expect(page.count()).toBe(0)
  })
})
