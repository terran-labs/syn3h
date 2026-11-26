/**
 * The Creator key row is hidden from everyone but the creator (src/ui/creatorReveal.ts): shown
 * with a key stored, or after five quick taps on the lobby's version label, whose own click must
 * still open Updates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREATOR_KEY_STORAGE } from '../../src/core/creatorKey'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } }
  vi.resetModules()
  vi.useFakeTimers()
})
afterEach(() => { vi.useRealTimers(); delete (globalThis as { localStorage?: unknown }).localStorage })

const load = () => import('../../src/ui/creatorReveal')
/** A version label with a clock the test drives. */
async function label() {
  const m = await load()
  const el = new EventTarget(), opened = { n: 0 }
  let t = 0
  m.bindVersionLabel(el, () => { opened.n++ }, new AbortController().signal, () => t)
  const pass = (ms: number) => { t += ms; vi.advanceTimersByTime(ms) }
  const click = (after: number) => { pass(after); el.dispatchEvent(new Event('click')) }
  return { m, opened, click, pass }
}

describe('creator key row reveal', () => {
  // Bug: every player sees a "Creator key" field and starts guessing.
  it('is hidden by default', async () => {
    const m = await load()
    expect(m.creatorKeyRowVisible()).toBe(false)
  })

  // Bug: the creator cannot reach the field on a device without a key (the iPhone Home Screen app).
  it('is revealed by five quick taps, and only by five', async () => {
    const { m, click } = await label()
    for (let i = 0; i < 4; i++) click(300)
    expect(m.creatorKeyRowVisible()).toBe(false)
    click(300)
    expect(m.creatorKeyRowVisible()).toBe(true)
  })

  // Bug: taps spread over a long time add up to a reveal by accident.
  it('does not count taps spread beyond three seconds', async () => {
    const { m, click } = await label()
    for (let i = 0; i < 8; i++) click(900)
    expect(m.creatorKeyRowVisible()).toBe(false)
  })

  // Bug: signed in, the creator cannot find Sign out without the gesture.
  it('shows Sign out without the gesture when a key is stored', async () => {
    store.set(CREATOR_KEY_STORAGE, 'Zq3_x-7mKp9vR2tY8wB4nC6dF1gH5jL0')
    const m = await load()
    expect(m.creatorKeyRowVisible()).toBe(true)
  })

  // Bug: the gesture breaks the version label's own job of opening Updates.
  it('still opens Updates on a slow single click, and not during the gesture', async () => {
    const { m, opened, click, pass } = await label()
    click(0)
    pass(m.SINGLE_CLICK_MS)
    expect(opened.n).toBe(1)
    pass(m.REVEAL_WINDOW_MS)
    for (let i = 0; i < 5; i++) click(200)
    pass(m.SINGLE_CLICK_MS * 2)
    expect(opened.n).toBe(1)
    expect(m.creatorKeyRowVisible()).toBe(true)
  })
})
