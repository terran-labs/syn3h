/**
 * The in-play sidebar's five cards (the owner, 25 November 2026): Game, Players, World,
 * Settings, Chat. Each test names the bug it would catch. Placement within World or Settings is
 * tuning and is not pinned here; that every setting is somewhere, once, is.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { isVehicleAvailable } from '../../src/vehicles/available'
import { buildTree, CARD_ORDER, isLobbyOnly, migrateOpenCards, SECTIONS, SETTINGS_TITLE, SHOWN_ELSEWHERE, type PropertyDef } from '../../src/ui/inspector/model'

/** Every module that registers a setting, imported for its definitions. */
async function registerAll(): Promise<void> {
  const files: string[] = []
  const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else if (path.endsWith('.ts') && /defineParam[(<]/.test(readFileSync(path, 'utf8'))) files.push(path) } }
  walk('src'); walk('shared')
  for (const file of files) await import(/* @vite-ignore */ `../../${file}`)
}

describe('the in-play sidebar cards', () => {
  it('are Game, Players, World, Settings and Chat, in that order', () => {
    // Bug: a card missing, renamed back or out of order.
    expect(CARD_ORDER).toEqual(['game', 'players', 'world', 'performance', 'chat'])
    expect(SECTIONS.map(s => [s.id, s.title])).toEqual([['game', 'Game'], ['world', 'World'], ['performance', SETTINGS_TITLE]])
    expect(SETTINGS_TITLE).toBe('Settings')
    // Registry cards follow the same order as the full list.
    const ids = SECTIONS.map(s => s.id)
    expect(ids).toEqual(CARD_ORDER.filter(id => ids.includes(id as never)))
  })

  it('show every setting exactly once, and no lobby-only setting', async () => {
    // Bug: the move drops a setting (unreachable) or shows it twice, or a lobby control shows in a world.
    await registerAll()
    const defs = params.all().map(p => p.def as PropertyDef).filter(def => !def.hidden)
    expect(defs.length).toBeGreaterThan(300)
    const tree = buildTree(defs)
    const placed = tree.flatMap(s => s.parts.flatMap(p => p.groups.flatMap(g => g.properties.map(def => def.id))))
    expect(new Set(placed).size).toBe(placed.length)
    const expected = defs.filter(def => !isLobbyOnly(def) && !SHOWN_ELSEWHERE.includes(def.id) && (def.group !== 'Tank' || isVehicleAvailable('tank')))
    expect([...placed].sort()).toEqual(expected.map(def => def.id).sort())
    expect(placed.filter(id => isLobbyOnly({ id }))).toEqual([])
    // The flat tree (section copies, search) holds the same rows as the sections.
    expect(tree.reduce((n, s) => n + s.count, 0)).toBe(placed.length)
    expect(tree.flatMap(s => s.tree.flatMap(g => g.properties)).length).toBe(placed.length)
  })

  it('puts a lobby-only setting nowhere in play, tagged or not', () => {
    // Bug: a new lobby control tagged with lobbyGroup, or named lobby.*, appears in a world's card.
    const def = (id: string, extra: Partial<PropertyDef> = {}): PropertyDef => ({ id, label: id, group: 'Graphics', scope: 'client', default: 1, ...extra })
    const tree = buildTree([def('lobby.new'), def('galaxy.thing', { lobbyGroup: 'Sun' }), def('audio.score.lobbyNew', { group: 'Adaptive score' }), def('gfx.kept')])
    expect(tree.flatMap(s => s.tree.flatMap(g => g.properties.map(p => p.id)))).toEqual(['gfx.kept'])
  })

  it('opens the Me and Game sections for a new player', () => {
    // Bug: a first visit finds the merged Game card with its two working sections folded shut.
    const game = buildTree([])[0]
    expect(game.id).toBe('game')
    const parts = SECTIONS[0].parts
    expect(parts.slice(0, 2).map(p => [p.title, p.open])).toEqual([['Me', true], ['Game', true]])
    // Me is there even with no registry rows: it holds the vehicle, colours and name.
    expect(game.parts.map(p => p.title)).toContain('Me')
  })

  it('reads an old saved layout without error', () => {
    // Bug: a returning player's stored open cards name 'you' or 'vehicles' and the sidebar opens nothing, or throws.
    expect(migrateOpenCards(['you', 'vehicles', 'chat', 'you'])).toEqual(['world', 'chat', 'game'])
    expect(migrateOpenCards(['game', 'game'])).toEqual(['game'])
    for (const junk of [null, 'you', 7, {}, [1, null, ''], undefined]) expect(() => migrateOpenCards(junk)).not.toThrow()
    expect(migrateOpenCards([1, null, '', 'performance'])).toEqual(['performance'])
  })
})
