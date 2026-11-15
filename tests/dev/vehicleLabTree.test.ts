import { describe, expect, it } from 'vitest'
import type { ParamDef } from '../../shared/params'
import { buildTree, collectExhibits, presentable, resolveSelection, selectionFromSearch, selectionToSearch, vehicleParams } from '../../src/dev/vehicleLab/tree'
import { carryOver, type BodyEntry } from '../../src/dev/vehicleLab/exhibits/buggy'
import type { LabDesignInfo, LabExhibit } from '../../src/dev/vehicleLab/types'

const exhibit = (id: string, o: Partial<LabExhibit> = {}): LabExhibit => ({
  id, title: id.toUpperCase(), designs: async () => [], build: async () => { throw new Error('not built in tests') }, ...o,
})
const design = (id: string, group?: string, alsoIn?: string[]): LabDesignInfo => ({ id, name: id, notes: [], group, alsoIn })

describe('collectExhibits', () => {
  it('finds named, default and array exports and ignores everything else', () => {
    const a = exhibit('a'), b = exhibit('b'), c = exhibit('c'), d = exhibit('d')
    const found = collectExhibits({
      './exhibits/one.ts': { a, helper: () => 1, NUMBER: 3 },
      './exhibits/two.ts': { default: b },
      './exhibits/three.ts': { list: [c, d, 'not an exhibit'] },
      './exhibits/empty.ts': {},
    })
    expect(found.map(e => e.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
  it('orders by order, then title', () => {
    const found = collectExhibits({ './x.ts': { z: exhibit('z', { title: 'Zed' }), y: exhibit('y', { title: 'Alpha' }), first: exhibit('w', { title: 'Wow', order: 1 }) } })
    expect(found.map(e => e.id)).toEqual(['w', 'y', 'z'])
  })
  it('keeps the first exhibit with an id', () => {
    const first = exhibit('dup', { title: 'First' })
    const found = collectExhibits({ './a.ts': { first }, './b.ts': { again: exhibit('dup', { title: 'Second' }) } })
    expect(found).toEqual([first])
  })
})

describe('tree and default selection', () => {
  const studies = exhibit('buggy', { section: 'Design studies', groupLabel: 'Round', defaultDesign: g => g === '2' ? 'w2' : undefined })
  const jet = exhibit('game-jet', { section: 'In the game', title: 'Jet', aliases: ['jet-old'] })
  const tree = buildTree([
    { exhibit: studies, designs: [design('v1', '1'), design('v4', '1', ['2']), design('w1', '2'), design('w2', '2')] },
    { exhibit: jet, designs: [design('game')] },
  ])
  const exhibits = [studies, jet]

  it('groups vehicles by section, with groups and the latest marked', () => {
    expect(tree.map(s => s.name)).toEqual(['Design studies', 'In the game'])
    const buggy = tree[0].vehicles[0]
    expect(buggy.groups.map(g => [g.label, g.latest, g.designs.map(d => d.id)])).toEqual([
      ['Round 1', false, ['v1', 'v4']],
      ['Round 2', true, ['v4', 'w1', 'w2']],
    ])
    expect(tree[1].vehicles[0].groups).toEqual([])
  })
  it('defaults to the first vehicle, its latest group and its default design', () => {
    expect(resolveSelection(tree, exhibits, {})).toEqual({ vehicle: 'buggy', group: '2', design: 'w2' })
  })
  it('falls back to the first design, keeps all, and takes positions', () => {
    expect(resolveSelection(tree, exhibits, { vehicle: 'buggy', group: '1' })).toEqual({ vehicle: 'buggy', group: '1', design: 'v1' })
    expect(resolveSelection(tree, exhibits, { vehicle: 'buggy', group: '1', design: 'all' })?.design).toBe('all')
    expect(resolveSelection(tree, exhibits, { vehicle: 'buggy', group: '2', design: '2' })?.design).toBe('w1')
  })
  it('resolves aliases and unknown ids', () => {
    expect(resolveSelection(tree, exhibits, { vehicle: 'jet-old' })).toEqual({ vehicle: 'game-jet', group: undefined, design: 'game' })
    expect(resolveSelection(tree, exhibits, { vehicle: 'nope', group: '9' })).toEqual({ vehicle: 'buggy', group: '2', design: 'w2' })
  })
  it('returns null with no vehicles', () => expect(resolveSelection([], [], {})).toBeNull())
})

describe('selection and the URL', () => {
  it('round trips, keeping other parameters', () => {
    const search = selectionToSearch({ vehicle: 'buggy', group: '3', design: 'r3-coilover' }, '?night=1&round=2&group=1')
    const q = new URLSearchParams(search)
    expect(q.get('night')).toBe('1')
    expect(q.has('round')).toBe(false)
    expect(selectionFromSearch(search)).toEqual({ vehicle: 'buggy', group: '3', design: 'r3-coilover' })
  })
  it('drops the group for vehicles without groups', () => {
    expect(selectionFromSearch(selectionToSearch({ vehicle: 'game-tank', design: 'game' }, '?group=3'))).toEqual({ vehicle: 'game-tank', group: undefined, design: 'game' })
  })
  it('reads round as a group and maps the retired game-skins exhibit', () => {
    expect(selectionFromSearch('?vehicle=buggy&round=1').group).toBe('1')
    expect(selectionFromSearch('?vehicle=game-skins')).toEqual({ vehicle: 'game-buggy' })
    expect(selectionFromSearch('?vehicle=game-skins&design=classic')).toEqual({ vehicle: 'game-buggy-classic' })
  })
})

describe('vehicleParams', () => {
  const def = (id: string, group: string, label = id): ParamDef => ({ id, label, group, scope: 'world', default: 1 })
  const defs = [
    def('buggy.power', 'Buggy'), def('buggy.lavaFloat', 'Buggy'), def('hover.thrust', 'Hovercraft'), def('jet.lift', 'Jet'),
    def('tank.grip', 'Tank'), def('lava.viscosity', 'Lava'), def('zorb.size', 'Zorb'), def('gfx.vehicleShading', 'Graphics'),
    def('laser.speed', 'Tag beams', 'Beam speed'), def('sky.turbidity', 'Sky'),
  ]
  const ids = (family: string, override?: string[]) => vehicleParams(defs, family, override).flatMap(g => g.defs.map(d => d.id))
  it('matches the family by id prefix, adding the vehicle wide shading', () => {
    expect(ids('buggy')).toEqual(['buggy.power', 'buggy.lavaFloat', 'gfx.vehicleShading'])
    expect(ids('buggy-classic')).toEqual(['buggy.power', 'buggy.lavaFloat', 'gfx.vehicleShading'])
    expect(ids('hovercraft')).toEqual(['hover.thrust', 'gfx.vehicleShading'])
    expect(ids('jet')).toEqual(['jet.lift', 'gfx.vehicleShading'])
    expect(ids('tank')).toEqual(['tank.grip', 'gfx.vehicleShading'])
  })
  it('groups in registration order', () => {
    expect(vehicleParams(defs, 'buggy').map(g => g.group)).toEqual(['Buggy', 'Graphics'])
  })
  it('lets an exhibit override with groups, prefixes or ids, or none', () => {
    expect(ids('anything', ['Lava', 'zorb', 'sky.turbidity'])).toEqual(['lava.viscosity', 'zorb.size', 'sky.turbidity'])
    expect(ids('buggy', [])).toEqual([])
  })
  it('never lists parameters with hidden words', () => {
    expect(ids('x', ['Tag beams', 'laser'])).toEqual([])
    expect(presentable(def('bots.canFire', 'Bots', 'Bots use tag beams'))).toBe(false)
    expect(presentable(def('buggy.power', 'Buggy', 'Power'))).toBe(true)
  })
})

describe('buggy carry-over', () => {
  const body = (id: string, round: number, o: Partial<BodyEntry> = {}): BodyEntry => ({ id, name: id.toUpperCase(), notes: [], file: '', triangles: 0, round, ...o })
  it('carries the legacy pick into later rounds when nothing is marked', () => {
    const plan = carryOver([body('v4-widebody', 1), body('w1', 2), body('r1', 3)])
    expect(plan.alsoIn.get('v4-widebody')).toEqual(['2', '3'])
    expect(plan.basis.get('3')).toBe('V4-WIDEBODY')
  })
  it('uses marked picks and basedOn, and stops the legacy pick before them', () => {
    const plan = carryOver([body('v4-widebody', 1), body('w1', 2), body('r3-coilover', 3, { alsoIn: ['4'] }), body('c1', 4, { basedOn: 'r3-coilover' })])
    expect(plan.alsoIn.get('r3-coilover')).toEqual(['4'])
    expect(plan.alsoIn.get('v4-widebody')).toEqual(['2', '3'])
    expect(plan.basis.get('4')).toBe('R3-COILOVER')
  })
})
