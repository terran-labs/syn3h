import { describe, expect, it } from 'vitest'
import { cleanPlayerName, loadPlayerName, savePlayerName } from '../../src/ui/playerName'
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
    const store = memory(); store.setItem('syn3h.playerName', 'Tamatek')
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
})
