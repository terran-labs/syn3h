import { describe, expect, it } from 'vitest'
import { buildTree, exportSection, exportWorld, fraction, limits, parseWorld, pasteSummary, show, type PropertyDef } from '../../src/ui/inspector/model'

const def = (id: string, group: string, scope: 'world' | 'client', value: number | boolean, min?: number, max?: number, step?: number): PropertyDef => ({ id, label: id, group, scope, default: value, min, max, step })
const DEFS = [
  def('world.seed', 'World', 'world', 1, 1, 999999, 1), def('sun.timeOfDay', 'Sun', 'world', 16.5, 0, 24, 0.01), def('sky.sunDisc', 'Sky', 'world', true),
  def('bots.count', 'Bots', 'world', 0, 0, 8, 1), def('buggy.grip', 'Buggy', 'world', 1, 0, 2, 0.01), def('camera.sensitivity', 'Camera', 'client', 1, 0.1, 4, 0.1),
  def('novel.thing', 'Brand new group', 'world', 3, 0, 9, 1), def('novel.mine', 'Another new group', 'client', false),
]
const values = new Map<string, number | boolean>(DEFS.map(d => [d.id, d.default]))

describe('the inspector tree', () => {
  const tree = buildTree(DEFS)
  it('puts every property in exactly one logical section', () => {
    expect(tree.map(s => s.id)).toEqual(['you', 'game', 'vehicles', 'world'])
    expect(tree[0].title).toBe('Me')
    expect(tree.reduce((n, s) => n + s.count, 0)).toBe(DEFS.length)
    expect(tree.find(s => s.id === 'world')!.tree.map(g => g.name)).toContain('Sky')
  })
  it('finds a home for groups nobody listed, by who they affect', () => {
    expect(tree.find(s => s.id === 'world')!.tree.map(g => g.name)).toEqual(['World', 'Sun', 'Sky', 'Brand new group'])
    expect(tree.find(s => s.id === 'you')!.tree.map(g => g.name)).toEqual(['Camera', 'Another new group'])
  })
  it('nests game and sky groups without duplicating or changing their scopes', () => {
    const groups = ['Game', 'Tag', 'Tag beams', 'Zorb', 'Sun', 'Sky', 'Weather']
    const tree = buildTree(groups.map((group, i) => def(`nested.${i}`, group, 'world', 1)))
    expect(tree.find(s => s.id === 'game')!.tree.map(g => g.name)).toEqual(groups.slice(0, 4))
    expect(tree.find(s => s.id === 'world')!.tree.map(g => g.name)).toEqual(groups.slice(4))
    expect(tree.flatMap(s => s.tree.flatMap(g => g.properties)).every(p => p.scope === 'world')).toBe(true)
    expect(tree.reduce((n, s) => n + s.count, 0)).toBe(groups.length)
  })
  it('states the limits of each in plain words', () => {
    expect(limits(DEFS[1])).toBe('0 to 24 · default 16.5 · shared with everyone in the room')
    expect(limits(DEFS[2])).toBe('on or off · default on · shared with everyone in the room')
    expect(limits(DEFS[5])).toBe('0.1 to 4 · default 1 · yours only')
    expect(fraction(DEFS[1], 12)).toBe(0.5); expect(fraction(DEFS[2], true)).toBeNull()
    expect(show(16.5, DEFS[1])).toBe('16.5'); expect(show(3, DEFS[3])).toBe('3'); expect(show(false)).toBe('off')
  })
})

describe('a world as JSON', () => {
  it('writes out every shared property and no personal one, and reads itself back', () => {
    const json = exportWorld(DEFS, id => values.get(id))
    expect(json.mira).toBe('world'); expect(Object.keys(json.values)).not.toContain('camera.sensitivity'); expect(json.values['sun.timeOfDay']).toBe(16.5)
    const back = parseWorld(JSON.stringify(json), DEFS)
    expect(back.ok && back.entries.length).toBe(6); expect(back.ok && back.skipped).toEqual([])
  })
  it('pulls numbers inside their limits and says so', () => {
    const result = parseWorld('{"mira":"world","version":1,"values":{"sun.timeOfDay":99,"bots.count":-4,"world.seed":7}}', DEFS)
    expect(result.ok && result.entries).toEqual([{ id: 'sun.timeOfDay', value: 24, adjusted: true }, { id: 'bots.count', value: 0, adjusted: true }, { id: 'world.seed', value: 7, adjusted: false }])
    expect(result.ok && pasteSummary(result)).toBe('3 properties pasted, 2 pulled inside limits.')
  })
  it('leaves out what it does not know, wrong kinds, and personal settings in a world', () => {
    const result = parseWorld('{"values":{"made.up":1,"sky.sunDisc":"yes","sun.timeOfDay":"noon","camera.sensitivity":3,"bots.count":2}}', DEFS)
    expect(result.ok && result.entries).toEqual([{ id: 'bots.count', value: 2, adjusted: false }])
    expect(result.ok && result.skipped.map(s => s.id)).toEqual(['made.up', 'sky.sunDisc', 'sun.timeOfDay', 'camera.sensitivity'])
  })
  it('accepts a bare object of values, and a personal section only when allowed', () => {
    expect(parseWorld('{"bots.count":3}', DEFS).ok).toBe(true)
    const you = buildTree(DEFS).find(s => s.id === 'you')!, json = JSON.stringify(exportSection(you, id => values.get(id)))
    const refused = parseWorld(json, DEFS); expect(refused.ok).toBe(false)
    const allowed = parseWorld(json, DEFS, { personal: true }); expect(allowed.ok && allowed.entries.map(e => e.id)).toEqual(['camera.sensitivity', 'novel.mine'])
  })
  it('refuses what is not a world, without throwing', () => {
    for (const text of ['', 'hello', '[]', '42', 'null', '{"mira":"world"}', '{"values":{}}']) expect(parseWorld(text, DEFS).ok).toBe(false)
    expect(parseWorld('{"values":{"__proto__":{"x":1},"constructor":2}}', DEFS).ok).toBe(false)
  })
})
