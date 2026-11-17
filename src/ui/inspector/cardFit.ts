/**
 * Which cards in the sidebar's stack to close so every open card keeps a comfortable height.
 * No DOM: the Inspector measures, this decides, and the tests drive it directly.
 *
 * A card is comfortable at COMFORT_PX (its header and about three rows) or its whole content
 * if that is shorter. When the open cards' comfortable heights, the closed headers and the
 * gaps do not fit the space, the card open longest closes first, then the next, until they
 * fit. Never closed: the card just opened, one the player is using, and fixed ones (the
 * Players & session card, which opens its own way).
 */

/** Header plus about three 44 px rows and the card's padding. */
export const COMFORT_PX = 200

export interface FitCard {
  id: string
  open: boolean
  /** Height when closed (its header), or the fixed height of a card this rule does not move. */
  closed: number
  /** Height when open with all its content showing. */
  natural: number
  /** False for a card the player is using, or one that opens its own way. */
  closable: boolean
}

/** The height an open card must keep: comfortable, or all of it when it is shorter. */
export const comfortable = (card: Pick<FitCard, 'natural' | 'closed'>, comfort = COMFORT_PX): number =>
  Math.max(card.closed, Math.min(card.natural, comfort))

/** Height the stack needs with each open card at its comfortable height. */
export function neededHeight(cards: readonly FitCard[], gap: number, closing: ReadonlySet<string> = new Set(), comfort = COMFORT_PX): number {
  let total = Math.max(0, cards.length - 1) * gap
  for (const card of cards) total += card.open && !closing.has(card.id) ? comfortable(card, comfort) : card.closed
  return total
}

/**
 * Ids to close, oldest first. `order` lists open card ids from opened longest ago to most
 * recent; `keep` is the card just opened. Returns fewer than needed (perhaps none) when
 * nothing else may close; the stack then scrolls, and still no card is squeezed.
 */
export function cardsToClose(cards: readonly FitCard[], order: readonly string[], available: number, gap: number, keep: string | null = null, comfort = COMFORT_PX): string[] {
  const closing = new Set<string>()
  const byId = new Map(cards.map(card => [card.id, card]))
  for (const id of order) {
    if (neededHeight(cards, gap, closing, comfort) <= available + 0.5) break
    const card = byId.get(id)
    if (!card || !card.open || !card.closable || id === keep) continue
    closing.add(id)
  }
  return [...closing]
}
