/**
 * The one link between whatever shows chat (the right panel's Chat card) and the controls that
 * open it (the left column's Chat row, hud-column.css). Neither side reaches into the other's
 * markup: the chat surface registers how to open itself and publishes its unread count; a
 * control calls open() and subscribes to the count. No DOM here.
 *
 * Agreed between ux/hud-column and ux/chat-card on 17 November 2026; both branches carry this
 * file byte for byte, so change it in one place and tell the other.
 */
type UnreadListener = (count: number, fromPerson: boolean) => void

let opener: (() => void) | null = null
let unread = 0
let fromPerson = false
const listeners = new Set<UnreadListener>()

export const chatLink = {
  /** The chat surface registers how to open itself and focus its field; null to unregister. */
  setOpener(fn: (() => void) | null): void { opener = fn },

  /** Open chat and focus its field. False when nothing has registered to handle it. */
  open(): boolean {
    if (!opener) return false
    opener()
    return true
  },

  /** The chat surface is the one source of the unread count: 0 once read. */
  setUnread(count: number, person: boolean): void {
    if (count === unread && person === fromPerson) return
    unread = count; fromPerson = person
    for (const fn of listeners) fn(unread, fromPerson)
  },

  get unread(): number { return unread },
  get fromPerson(): boolean { return fromPerson },

  /** Hear every change to the unread count (not called on subscribe). Returns unsubscribe. */
  subscribe(fn: UnreadListener): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
}
