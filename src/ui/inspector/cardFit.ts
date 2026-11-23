/**
 * How many cards in the sidebar's stack stay open, and how the open ones share its height. No
 * DOM: the Inspector measures, this decides, and the tests drive it directly.
 *
 * Which stay open (cardsToClose; the owner, 22 November 2026: "I should really only be able to
 * see two cards at a normal laptop screen height ... You should be more aggressive about
 * collapsing older cards"). Every open card must be able to show OPEN_PX (or all of itself
 * when it is shorter) while every closed card's header stays in view, without the stack
 * overflowing by more than NEAR_PX. While that fails, the card open longest closes, then the
 * next. Never closed: the card just opened, one the player is typing in or dragging a slider
 * in. No count per screen size: the count follows from the measured heights (cardFit.test.ts
 * works it out for 720 to 1440 px tall screens).
 *
 * How they share (shareHeights; "singular panels which have enough internal contents to
 * warrant it expand as far as they can when that is the only panel open"). The height left
 * after the closed headers is shared out smallest want first: a card that needs less than an
 * equal share gets all it needs, and what is left is split between the rest. A card's want is
 * all its content, including the scrollback of a growing region (the chat log), so a lone chat
 * card fills the sidebar while a short card keeps its natural height and is never stretched.
 */

/**
 * What an open card must be able to show: its header and about three rows. With the stack's
 * measured headers (46 px) and gaps (7 px), this leaves one card open at 720 px tall, two at 800
 * and 900, three at 1080 and six at 1440 (cardFit.test.ts).
 */
export const OPEN_PX = 200
/** "Nearly fit": how far the stack may overflow before an older card closes. */
export const NEAR_PX = 24

export interface FitCard {
  id: string
  open: boolean
  /** Height when closed (its header), or the fixed height of a card this rule does not move. */
  closed: number
  /** Height when open with all its content showing, a growing region's scrollback included. */
  natural: number
  /** False for a card the player is using. */
  closable: boolean
}

/** The height an open card must be able to keep: OPEN_PX, or all of it when it is shorter. */
export const comfortable = (card: Pick<FitCard, 'natural' | 'closed'>, floor = OPEN_PX): number =>
  Math.max(card.closed, Math.min(card.natural, floor))

/** Height the stack needs with each open card at its floor. */
export function neededHeight(cards: readonly FitCard[], gap: number, closing: ReadonlySet<string> = new Set(), floor = OPEN_PX): number {
  let total = Math.max(0, cards.length - 1) * gap
  for (const card of cards) total += card.open && !closing.has(card.id) ? comfortable(card, floor) : card.closed
  return total
}

/**
 * Ids to close, oldest first. `order` lists open card ids from opened longest ago to most
 * recent; `keep` is the card just opened. Returns fewer than needed (perhaps none) when
 * nothing else may close; the stack then scrolls, and still no card is squeezed.
 */
export function cardsToClose(cards: readonly FitCard[], order: readonly string[], available: number, gap: number, keep: string | null = null, floor = OPEN_PX, near = NEAR_PX): string[] {
  const closing = new Set<string>()
  const byId = new Map(cards.map(card => [card.id, card]))
  for (const id of order) {
    if (neededHeight(cards, gap, closing, floor) <= available + near) break
    const card = byId.get(id)
    if (!card || !card.open || !card.closable || id === keep) continue
    closing.add(id)
  }
  return [...closing]
}

/**
 * Each open card's height, by id: the stack's height less the closed cards and the gaps,
 * shared smallest want first (see the file's comment). Never below a card's floor
 * (comfortable), so with more open than fit the stack scrolls rather than squeezing one.
 */
export function shareHeights(cards: readonly FitCard[], available: number, gap: number, floor = OPEN_PX): Map<string, number> {
  const open = cards.filter(card => card.open).sort((a, b) => a.natural - b.natural)
  let space = available - Math.max(0, cards.length - 1) * gap
  for (const card of cards) if (!card.open) space -= card.closed
  const heights = new Map<string, number>()
  open.forEach((card, i) => {
    const share = space / (open.length - i)
    const height = Math.max(comfortable(card, floor), Math.min(card.natural, Math.floor(share)))
    heights.set(card.id, height); space -= height
  })
  return heights
}
