/**
 * The one link between whatever shows chat (the right panel's Chat card) and the controls that
 * open it (the left column's Chat row, hud-column.css). Neither side reaches into the other's
 * markup: the chat surface registers how to open itself and publishes its unread count; a
 * control calls open() and subscribes to the count. No DOM here.
 *
 * Agreed between ux/hud-column and ux/chat-card on 17 November 2026. The person menu was added
 * on 22 November 2026 when the Chat card's People list was removed: muting now starts from a
 * name in the log or a row in the Players & session card.
 */
type UnreadListener = (count: number, fromPerson: boolean) => void

let opener: (() => void) | null = null
let personMenu: ((id: number, anchor: HTMLElement, name: string) => void) | null = null
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

  /**
   * The chat surface registers its per-player menu (Mute or Unmute, on this screen only);
   * the Players & session card's rows open it. Null to unregister.
   */
  setPersonMenu(fn: ((id: number, anchor: HTMLElement, name: string) => void) | null): void { personMenu = fn },

  /** Open the menu for player `id` beside `anchor`. False when nothing has registered. */
  openPersonMenu(id: number, anchor: HTMLElement, name: string): boolean {
    if (!personMenu) return false
    personMenu(id, anchor, name)
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
