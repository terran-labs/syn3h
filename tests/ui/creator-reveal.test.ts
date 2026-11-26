/**
 * The hidden sign-in row (src/ui/creatorReveal.ts): shown with a key stored, or after five quick
 * taps on the lobby's version label, whose own job, opening Updates, must happen at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREATOR_KEY_STORAGE } from '../../src/core/creatorKey'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } }
  vi.resetModules()
})
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

const load = () => import('../../src/ui/creatorReveal')
const RECT = { left: 10, top: 700, right: 90, bottom: 720 }

/**
 * A version label and the document over it. The first tap lands on the label; once Updates is
 * open its backdrop covers the label, so later taps reach the document at the same point.
 */
async function lobby() {
  const m = await load()
  const label = new EventTarget(), root = new EventTarget()
  const seen = { opened: 0, closed: 0 }
  let t = 0
  m.bindVersionLabel({ label, root, rect: () => RECT, signal: new AbortController().signal, now: () => t,
    openUpdates: () => { seen.opened++ }, closeUpdates: () => { seen.closed++ } })
  const event = (type: string, x: number, y: number, detail = 1, link = false) => {
    const e = new Event(type, { cancelable: true })
    Object.defineProperties(e, { clientX: { value: x }, clientY: { value: y }, detail: { value: detail } })
    if (link) Object.defineProperty(e, 'target', { value: { closest: () => ({}) } })
    return e
  }
  /** A tap after `after` ms: on the label, or (sheet open) on the document at x, y. */
  const tap = (after: number, on: 'label' | 'root', x = 50, y = 710, link = false) => {
    t += after
    const target = on === 'label' ? label : root
    let last!: Event
    for (const type of on === 'label' ? ['click'] : ['pointerdown', 'pointerup', 'click']) target.dispatchEvent(last = event(type, x, y, 1, link))
    return last
  }
  const enter = () => label.dispatchEvent(event('click', 0, 0, 0))
  const pass = (ms: number) => { t += ms }
  // Raw access for a keyboard click reaching the document mid-gesture.
  const raw = { tap: (after: number) => tap(after, 'label'), event, dispatch: (e: Event) => root.dispatchEvent(e) }
  return { m, seen, tap, enter, pass, root: raw }
}

describe('hidden sign-in reveal', () => {
  // Bug: every player sees the sign-in field and starts guessing.
  it('is hidden by default', async () => {
    const m = await load()
    expect(m.creatorKeyRowVisible()).toBe(false)
  })

  // Bug: a tap on the version label opens Updates late (a held timer delayed every open).
  it('opens Updates on a single tap at once, with no timer in the path', async () => {
    const { seen, tap } = await lobby()
    tap(0, 'label')
    expect(seen.opened).toBe(1)
  })

  // Bug: the creator cannot reach the field on a device without a key.
  it('reveals on five quick taps, closing Updates, with the backdrop taps swallowed', async () => {
    const { m, seen, tap } = await lobby()
    tap(0, 'label')
    for (let i = 0; i < 3; i++) expect(tap(300, 'root').defaultPrevented).toBe(true)
    expect(m.creatorKeyRowVisible()).toBe(false)
    tap(300, 'root')
    expect(m.creatorKeyRowVisible()).toBe(true)
    expect(seen).toEqual({ opened: 1, closed: 1 })
  })

  // Bug: a player who taps a few times and stops has Updates closed or the field revealed.
  it('leaves Updates open and nothing revealed after four taps and a pause', async () => {
    const { m, seen, tap, pass } = await lobby()
    tap(0, 'label')
    for (let i = 0; i < 3; i++) tap(300, 'root')
    pass(m.REVEAL_WINDOW_MS)
    // After the window a tap on the backdrop is the player's own again: not swallowed.
    expect(tap(300, 'root').defaultPrevented).toBe(false)
    expect(m.creatorKeyRowVisible()).toBe(false)
    expect(seen).toEqual({ opened: 1, closed: 0 })
  })

  // Bug: a tap elsewhere counts toward the gesture.
  it('stops counting at a tap elsewhere', async () => {
    const a = await lobby()
    a.tap(0, 'label'); a.tap(200, 'root'); a.tap(200, 'root', 600, 300)
    a.tap(200, 'root'); a.tap(200, 'root')
    expect(a.m.creatorKeyRowVisible()).toBe(false)
  })

  // Bug (traced 26 Nov 2026, five taps within 265 ms): tap 5 landed on a release-note link in
  // the open sheet, under the label; links were rejected before the label's rectangle was
  // checked, so the count was cleared and nothing was revealed.
  it('counts a tap on a link in the sheet inside the label, and the link does not open', async () => {
    const { m, seen, tap } = await lobby()
    tap(0, 'label')
    for (let i = 0; i < 3; i++) tap(60, 'root')
    const onLink = tap(60, 'root', 50, 710, true)
    expect(onLink.defaultPrevented).toBe(true)
    expect(m.creatorKeyRowVisible()).toBe(true)
    expect(seen).toEqual({ opened: 1, closed: 1 })
  })

  // Bug: a link in the sheet outside the label is swallowed, or leaves the count running.
  it('lets a link outside the label open, and stops counting', async () => {
    const { m, tap } = await lobby()
    tap(0, 'label'); tap(200, 'root')
    expect(tap(200, 'root', 300, 400, true).defaultPrevented).toBe(false)
    tap(200, 'root'); tap(200, 'root'); tap(200, 'root')
    expect(m.creatorKeyRowVisible()).toBe(false)
  })

  // Bug: the GitHub icon in the dock beside the label counts toward the gesture.
  it('never counts taps on the GitHub dock icon beside the label', async () => {
    const { m, seen, tap } = await lobby()
    const GITHUB = [RECT.right + 20, 710] as const
    for (let i = 0; i < 5; i++) expect(tap(100, 'root', GITHUB[0], GITHUB[1], true).defaultPrevented).toBe(false)
    expect(m.creatorKeyRowVisible()).toBe(false)
    tap(100, 'label')
    for (let i = 0; i < 4; i++) tap(100, 'root', GITHUB[0], GITHUB[1], true)
    expect(m.creatorKeyRowVisible()).toBe(false)
    expect(seen.closed).toBe(0)
  })

  // Bug: WebKit gives a keyboard click the label's coordinates; counted at the document, it was
  // swallowed and Enter opened nothing.
  it('never swallows a keyboard click during a run of taps', async () => {
    const { seen, root } = await lobby()
    root.tap(0)
    const keyed = root.event('click', 50, 710, 0)
    root.dispatch(keyed)
    expect(keyed.defaultPrevented).toBe(false)
    expect(seen.opened).toBe(1)
  })

  // Bug: Enter on the label waits or counts; the keyboard must open Updates at once.
  it('opens Updates at once on Enter, which never counts', async () => {
    const { m, seen, enter } = await lobby()
    enter()
    expect(seen.opened).toBe(1)
    for (let i = 0; i < 5; i++) enter()
    expect(m.creatorKeyRowVisible()).toBe(false)
  })

  // Bug: signed in, the creator cannot find Close without the gesture.
  it('shows Close without the gesture when a key is stored', async () => {
    store.set(CREATOR_KEY_STORAGE, 'Zq3_x-7mKp9vR2tY8wB4nC6dF1gH5jL0')
    const m = await load()
    expect(m.creatorKeyRowVisible()).toBe(true)
  })
})
