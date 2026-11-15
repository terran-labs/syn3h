import { describe, expect, it } from 'vitest'
import { readSavedWorlds, SavedWorldStore, savedWorldPlan, SAVED_WORLDS_KEY } from '../../src/ui/galaxy/savedWorlds'
import type { ParamDef } from '../../shared/params'
const defs: ParamDef[] = [
  { id: 'world.seed', label: 'Seed', group: 'World', scope: 'world', default: 1, min: 1, max: 999999 },
  { id: 'terrain.look', label: 'Look', group: 'World', scope: 'world', default: 0, min: 0, max: 8 },
  { id: 'terrain.height', label: 'Height', group: 'World', scope: 'world', default: 5, min: 0, max: 100 },
  { id: 'world.enabled', label: 'Enabled', group: 'World', scope: 'world', default: true },
  { id: 'audio.level', label: 'Audio', group: 'Audio', scope: 'client', default: 1 },
]
const values = { 'world.seed': 123, 'terrain.look': 2, 'terrain.height': 0, 'world.enabled': false, 'audio.level': 0.3 }
function fixture() {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  return { data, store: new SavedWorldStore(() => defs, () => storage) }
}
describe('local saved worlds', () => {
  it('keeps complete snapshots, false and zero, excludes personal settings and deduplicates', () => {
    const { store } = fixture(), first = store.save(values)
    expect(first.entry.world.values).toEqual({ 'world.seed': 123, 'terrain.look': 2, 'terrain.height': 0, 'world.enabled': false })
    values['terrain.height'] = 9
    expect(first.entry.world.values['terrain.height']).toBe(0)
    values['terrain.height'] = 0
    expect(store.save(values)).toEqual({ entry: first.entry, duplicate: true })
    expect(store.save({ ...values, 'terrain.height': 9 }).entry.id).not.toBe(first.entry.id)
    expect(store.read().entries).toHaveLength(2)
  })
  it('rejects malformed snapshots before the permissive clipboard parser can skip them', () => {
    const { store } = fixture(), entry = store.save(values).entry
    const read = (entry: unknown) => readSavedWorlds(JSON.stringify({ version: 1, entries: [entry] }), defs)
    for (const world of [entry.world.values, { ...entry.world, syn3h: 'section' }, { ...entry.world, version: 2 }, { ...entry.world, values: { ...entry.world.values, 'terrain.height': 'broken' } }]) expect(() => read({ ...entry, world })).toThrow()
    expect(() => read({ ...entry, seed: 456 })).toThrow()
    expect(() => read({ ...entry, recipeId: 'desert' })).toThrow()
  })
  it('defaults new settings without inheriting prior world state and reports removed settings', () => {
    const { store } = fixture(), entry = store.save(values).entry
    delete entry.world.values['terrain.height']; entry.world.values['removed.key'] = 4
    const read = readSavedWorlds(JSON.stringify({ version: 1, entries: [entry] }), defs)
    expect(read.notice).toMatch(/adjusted/)
    expect(savedWorldPlan(read.entries[0], defs)['terrain.height']).toBe(5)
    expect(savedWorldPlan(read.entries[0], defs)['world.enabled']).toBe(false)
  })
  it('caps saves without eviction and deletes only the selected bookmark', () => {
    const { store } = fixture()
    for (let seed = 1; seed <= 12; seed++) store.save({ ...values, 'world.seed': seed })
    const before = store.read().entries
    expect(() => store.save({ ...values, 'world.seed': 13 })).toThrow(/Twelve/)
    expect(store.read().entries).toEqual(before)
    store.remove(before[0].id)
    expect(store.read().entries).toEqual(before.slice(1))
  })
  it('preserves unreadable storage and propagates failed writes instead of claiming success', () => {
    const { store, data } = fixture(); data.set(SAVED_WORLDS_KEY, '{"version":99}')
    expect(() => store.save(values)).toThrow(); expect(data.get(SAVED_WORLDS_KEY)).toBe('{"version":99}')
    const failed = new SavedWorldStore(() => defs, () => ({ getItem: () => null, setItem: () => { throw new Error('Quota exceeded') } }))
    expect(() => failed.save(values)).toThrow(/Quota/)
    expect(() => readSavedWorlds(' '.repeat(512 * 1024 + 1), defs)).toThrow(/large/)
  })
})
