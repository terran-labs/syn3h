/**
 * The sidebar's card stack keeps every open card at a usable height. Bugs these catch: a new
 * card closing itself, a card the player is using snapping shut, and cards squeezed to slivers.
 */
import { expect, it } from 'vitest'
import { OPEN_PX, NEAR_PX, cardsToClose, comfortable, neededHeight, shareHeights, type FitCard } from '../../src/ui/inspector/cardFit'

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
  const fits = neededHeight(r.after, GAP) <= available + NEAR_PX + 0.5
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
    for (const c of cards) if (c.open) expect(comfortable(c)).toBeGreaterThanOrEqual(Math.min(c.natural, OPEN_PX))
  }
})

// Measured in play (22 November 2026): seven cards with 46 px headers, 7 px gaps, and the stack
// 130 px shorter than the window. Bug this catches: more than two cards staying open at a
// normal laptop height (the owner: "I should really only be able to see two cards at a normal
// laptop screen height"), or a lone card closing itself on a short screen.
it('keeps two cards open at laptop height, opening each card in turn', () => {
  const ids = ['you', 'game', 'players', 'vehicles', 'world', 'performance', 'chat']
  const openAt = (windowHeight: number) => {
    let cards = ids.map(id => ({ id, open: false, closed: 46, natural: 46, closable: true }))
    let order: string[] = []
    for (const id of ids) {
      cards = cards.map(c => c.id === id ? { ...c, open: true, natural: 600 } : c); order.push(id)
      const close = new Set(cardsToClose(cards, order, windowHeight - 130, 7, id))
      cards = cards.map(c => close.has(c.id) ? { ...c, open: false, natural: 46 } : c); order = order.filter(o => !close.has(o))
    }
    return cards.filter(c => c.open).length
  }
  expect(openAt(720)).toBe(1)
  expect(openAt(800)).toBe(2)
  expect(openAt(900)).toBe(2)
  expect(openAt(1080)).toBeGreaterThanOrEqual(2)
})

// Bugs: a lone chat card not filling the sidebar, a short card stretched to empty space, or
// two cards that do not fit together.
it('lets a lone card fill the stack, keeps a short card its own height, and shares between two', () => {
  const closed = (id: string) => ({ id, open: false, closed: 46, natural: 46, closable: true })
  const others = ['a', 'b', 'c', 'd', 'e', 'f'].map(closed), room = 770 - 6 * 7 - 6 * 46
  expect(shareHeights([...others, { id: 'chat', open: true, closed: 46, natural: 2000, closable: true }], 770, 7).get('chat')).toBe(room)
  expect(shareHeights([...others, { id: 'players', open: true, closed: 46, natural: 260, closable: true }], 770, 7).get('players')).toBe(260)
  const two = shareHeights([...others.slice(1), { id: 'players', open: true, closed: 46, natural: 210, closable: true }, { id: 'chat', open: true, closed: 46, natural: 2000, closable: true }], 770, 7)
  expect(two.get('players')).toBe(210)
  expect(two.get('players')! + two.get('chat')!).toBe(770 - 6 * 7 - 5 * 46)
})
