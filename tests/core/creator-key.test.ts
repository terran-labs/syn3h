/**
 * The creator key on a device (src/core/creatorKey.ts): taken from the private link's fragment,
 * stored, and gone from the address bar before anything can share the address.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adoptCreatorKeyFromAddress, creatorKey, CREATOR_KEY_STORAGE, forgetCreatorKey, takeCreatorKey } from '../../src/core/creatorKey'
import { inviteAddress } from '../../src/ui/LobbyAddress'
import { linkWithSwitches } from '../../src/core/fieldSwitches'
import { creatorMarkShape } from '../../src/ui/brand/creatorMarkPath'

const KEY = 'Zq3_x-7mKp9vR2tY8wB4nC6dF1gH5jL0'
const store = new Map<string, string>()
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

beforeEach(() => { store.clear(); (globalThis as { localStorage?: unknown }).localStorage = fakeStorage })
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

/** A page at `href`, whose bar replaceState rewrites. */
function page(href: string) {
  const loc = { href }
  const hist = { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { if (url) loc.href = String(url) } }
  return { loc, hist }
}

describe('creator key on a device', () => {
  // Bug: the key stays in the address bar, where Copy link, an invite or a screenshot shares it.
  it('stores the key and removes it from the address at boot', () => {
    const { loc, hist } = page(`https://beta.mira.cc/?room=lobby#creator=${KEY}`)
    adoptCreatorKeyFromAddress(loc, hist)
    expect(creatorKey()).toBe(KEY)
    expect(loc.href).toBe('https://beta.mira.cc/?room=lobby')
    // Every address the game builds for sharing, from the bar as it now is.
    const entry = new URL(loc.href)
    for (const shared of [loc.href, inviteAddress(entry, 'lobby', 'abc'), linkWithSwitches(loc.href)]) expect(shared).not.toContain(KEY)
  })

  // Bug: other fragment content is lost, or a malformed key is stored and sent.
  it('keeps the rest of a fragment, and stores nothing malformed', () => {
    expect(takeCreatorKey(`https://mira.cc/#a=1&creator=${KEY}&b`)).toEqual({ key: KEY, href: 'https://mira.cc/#a=1&b' })
    const { loc, hist } = page('https://mira.cc/#creator=<script>')
    adoptCreatorKeyFromAddress(loc, hist)
    expect(loc.href).toBe('https://mira.cc/')
    expect(creatorKey()).toBeNull()
    expect(takeCreatorKey('https://mira.cc/?creator=x')).toBeNull()
  })

  // Bug: signing out leaves the key behind, so the next join is still the creator.
  it('forgets the key on sign out', () => {
    store.set(CREATOR_KEY_STORAGE, KEY)
    forgetCreatorKey()
    expect(creatorKey()).toBeNull()
  })

  // Bug: blocked storage breaks the start of the game.
  it('starts without storage', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    const { loc, hist } = page(`https://mira.cc/#creator=${KEY}`)
    expect(() => adoptCreatorKeyFromAddress(loc, hist)).not.toThrow()
    expect(loc.href).toBe('https://mira.cc/')
    expect(creatorKey()).toBeNull()
  })

  // Bug: the generated mark draws nothing or a broken path.
  it('generates a finite mark for every reduction', () => {
    for (const kind of ['oneOrbit', 'twoOrbits', 'full'] as const) {
      const { orbits, solids } = creatorMarkShape(kind)
      expect(orbits.length).toBeGreaterThan(50)
      expect(`${orbits}${solids}`).not.toMatch(/NaN|Infinity/)
    }
  })
})
