import { describe, expect, it } from 'vitest'
import { cleanPlayerName, loadPlayerName, restorePlayerName, savedPlayerName, savePlayerName } from '../../src/ui/playerName'
import { MAX_NAME_LENGTH } from '../../shared/protocol'

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m } }

describe('the player name', () => {
  // A new visitor must have a name at once, and the same one next visit.
  it('a first visit gets a generated name, saved so the next visit keeps it', () => {
    const store = memory()
    const first = loadPlayerName(store)
    expect(first.source).toBe('generated'); expect(first.name.length).toBeGreaterThan(2)
    expect(loadPlayerName(store).name).toBe(first.name)
  })
  // The owner's rule: a typed name is never replaced by a generated one.
  it('a typed name persists and is never overwritten by a generated one', () => {
    const store = memory()
    expect(savePlayerName('Captain Ozzie', 'typed', store)).toBe(true)
    expect(savePlayerName('Zibwick', 'generated', store)).toBe(false)
    expect(loadPlayerName(store)).toEqual({ name: 'Captain Ozzie', source: 'typed' })
  })
  it('a name saved by an older version counts as typed', () => {
    const store = memory(); store.setItem('mira.playerName', 'Tamatek')
    expect(loadPlayerName(store)).toEqual({ name: 'Tamatek', source: 'typed' })
    expect(savePlayerName('Zibwick', 'generated', store)).toBe(false)
  })
  it('works with no storage at all', () => {
    expect(loadPlayerName(null).name.length).toBeGreaterThan(2)
  })
  // A name is shown on other players' screens: no markup, no invisible tricks, bounded length.
  it('is cleaned of control characters, markup and extra space, and capped', () => {
    expect(cleanPlayerName('  <b>Zed</b>\u0007‮  the   Great ')).toBe('bZed/b the Great')
    expect(cleanPlayerName('\n\t ')).toBe('')
    expect([...cleanPlayerName('x'.repeat(100))].length).toBe(MAX_NAME_LENGTH)
    expect(savePlayerName('   ', 'typed', memory())).toBe(false)
  })
  // Bug: a name typed and then cancelled with Escape was already saved keystroke by keystroke, so
  // the next visit opened with the abandoned text.
  it('a cancelled edit puts back exactly the name saved before it', () => {
    const store = memory()
    savePlayerName('Captain Ozzie', 'typed', store)
    const before = savedPlayerName(store)!
    savePlayerName('xyz', 'typed', store)
    restorePlayerName(before, store)
    expect(loadPlayerName(store)).toEqual({ name: 'Captain Ozzie', source: 'typed' })
  })
})
