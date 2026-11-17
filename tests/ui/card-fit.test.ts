/**
 * The sidebar's card stack keeps every open card at a usable height. Bugs these catch: a new
 * card closing itself, a card the player is using snapping shut, and cards squeezed to slivers.
 */
import { expect, it } from 'vitest'
import { COMFORT_PX, cardsToClose, comfortable, neededHeight, type FitCard } from '../../src/ui/inspector/cardFit'

const HEAD = 46, GAP = 8
const card = (id: string, open: boolean, natural = 600, closable = true): FitCard => ({ id, open, closed: HEAD, natural: open ? natural : HEAD, closable })
/** Apply the rule, then check what must stay true of the result. */
function settle(cards: FitCard[], order: string[], available: number, keep: string | null) {
  const close = new Set(cardsToClose(cards, order, available, GAP, keep))
  const after = cards.map(c => close.has(c.id) ? { ...c, open: false, natural: HEAD } : c)
  return { close: [...close], after, order: order.filter(id => !close.has(id)) }
}
/** Every open card at its comfortable height, unless nothing more was allowed to close. */
function assertComfortable(r: ReturnType<typeof settle>, available: number, keep: string | null) {
  const fits = neededHeight(r.after, GAP) <= available + 0.5
  const stuck = r.after.every(c => !c.open || !c.closable || c.id === keep)
  expect(fits || stuck).toBe(true)
  if (keep) expect(r.after.find(c => c.id === keep)!.open).toBe(true)
}

it('closes the card open longest when a new one does not fit, and never the new one', () => {
  const cards = [card('you', true), card('game', true), card('vehicles', true), card('world', false), card('performance', false)]
  const opened = cards.map(c => c.id === 'world' ? card('world', true) : c)
  const r = settle(opened, ['game', 'you', 'vehicles', 'world'], 700, 'world')
  expect(r.close[0]).toBe('game')
  expect(r.close).not.toContain('world')
  assertComfortable(r, 700, 'world')
})

it('skips a card the player is using and closes the next oldest', () => {
  const cards = [card('you', true, 600, false), card('game', true), card('vehicles', true), card('world', true)]
  const r = settle(cards, ['you', 'game', 'vehicles', 'world'], 560, 'world')
  expect(r.close).not.toContain('you')
  expect(r.close[0]).toBe('game')
  assertComfortable(r, 560, 'world')
})

it('closes nothing when everything fits at a comfortable height', () => {
  const cards = [card('you', true, 150), card('game', true, 260), card('world', false)]
  expect(cardsToClose(cards, ['you', 'game'], 900, GAP, 'game')).toEqual([])
})

it('leaves no open card below the comfortable height after any open, resize or content change', () => {
  // A seeded walk: open cards in turn, shrink and grow the space, grow a card's content.
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const ids = ['you', 'game', 'players', 'vehicles', 'world', 'performance']
  let cards = ids.map(id => card(id, false)), order: string[] = [], available = 800
  for (let step = 0; step < 400; step++) {
    const roll = random()
    let keep: string | null = null
    if (roll < 0.5) {
      const id = ids[Math.floor(random() * ids.length)]
      cards = cards.map(c => c.id === id ? card(id, !c.open, 120 + Math.floor(random() * 900)) : c)
      order = order.filter(o => o !== id); if (cards.find(c => c.id === id)!.open) { order.push(id); keep = id }
    } else if (roll < 0.75) {
      available = 360 + Math.floor(random() * 900)
    } else {
      const open = cards.filter(c => c.open); if (!open.length) continue
      const grown = open[Math.floor(random() * open.length)]
      cards = cards.map(c => c.id === grown.id ? { ...c, natural: c.natural + 200 } : c); keep = grown.id
    }
    const r = settle(cards, order, available, keep)
    cards = r.after; order = r.order
    assertComfortable(r, available, keep)
    for (const c of cards) if (c.open) expect(comfortable(c)).toBeGreaterThanOrEqual(Math.min(c.natural, COMFORT_PX))
  }
})
