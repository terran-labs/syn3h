import { describe, expect, it } from 'vitest'
import { COMPARE_ALL, FUTURE, IN_GAME, compareOnly, futureTitle, present } from '../../src/dev/vehicleLab/presentation'
import { buildTree } from '../../src/dev/vehicleLab/tree'
import type { LabExhibit } from '../../src/dev/vehicleLab/types'

const exhibit = (id: string, title: string, extra: Partial<LabExhibit> = {}): LabExhibit =>
  ({ id, title, designs: async () => [], build: async () => { throw new Error('not built in this test') }, ...extra }) as LabExhibit

/** The exhibits as the lanes register them today, in collection order. */
const lanes = () => [
  exhibit('buggy', 'Next Syn3h buggy', { section: 'Design studies', order: 1 }),
  exhibit('lineup', 'Line-up: all vehicles to scale', { section: 'In the game', order: 1 }),
  exhibit('game-buggy', 'Syn3h buggy', { section: 'In the game', family: 'buggy' }),
  exhibit('game-buggy-classic', 'Mars Explorer buggy', { section: 'In the game', family: 'buggy-classic' }),
  exhibit('game-jet', 'Jet', { section: 'In the game', family: 'jet' }),
  exhibit('game-hovercraft', 'Hovercraft', { section: 'In the game', family: 'hovercraft' }),
  exhibit('game-tank', 'Tank', { section: 'In the game', family: 'tank' }),
  exhibit('hover', 'Syn3h hovercraft', { section: 'Design studies' }),
  exhibit('jet', 'Syn3h jet', { section: 'Design studies' }),
  exhibit('tank', 'Syn3h next-gen tank', { section: 'Design studies', family: 'tank' }),
  exhibit('tank-archive', 'Syn3h tank: earlier studies', { section: 'Design studies' }),
]

describe('how the vehicle lab names and orders its exhibits', () => {
  it('lists the comparison first, then the four game vehicles, then the future ones', () => {
    const tree = buildTree(present(lanes()).map(e => ({ exhibit: e, designs: [] })))
    expect(tree.map(s => [s.name, s.vehicles.map(v => v.title)])).toEqual([
      [IN_GAME, ['Compare all vehicles', 'Buggy', 'Jet', 'Hovercraft', 'Tank']],
      [FUTURE, ['Future buggies', 'Future hovercrafts', 'Future jets', 'Future tanks', 'Future tanks: earlier rounds']],
    ])
  })
  it('hides the Mars Explorer buggy and says neither Syn3h nor classic anywhere', () => {
    const shown = present(lanes())
    expect(shown.map(e => e.id)).not.toContain('game-buggy-classic')
    for (const e of shown) expect(e.title).not.toMatch(/syn3h|classic|mars explorer|next|line-up/i)
  })
  it('names a study by its vehicle whatever the lane called it, including one it has not seen', () => {
    expect(futureTitle('buggy')).toBe('Future buggies'); expect(futureTitle('hover')).toBe('Future hovercrafts')
    expect(futureTitle('tank-archive')).toBe('Future tanks'); expect(futureTitle('glider')).toBe('Future gliders')
    const [only] = present([exhibit('glider', 'Syn3h glider round 1')])
    expect([only.title, only.section]).toEqual(['Future gliders', FUTURE])
  })
  it('shows the comparison as a single line, and works when no lane provides one', () => {
    expect(compareOnly.has(COMPARE_ALL)).toBe(true)
    const without = present(lanes().filter(e => e.id !== 'lineup'))
    expect(without[0].title).toBe('Buggy')
  })
  it('renames the object itself, so the comparison lists the game buggy as Buggy', () => {
    const all = lanes(), buggy = all.find(e => e.id === 'game-buggy')!
    present(all)
    expect(buggy.title).toBe('Buggy')
  })
})
