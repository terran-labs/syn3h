/**
 * Where the creator signs in is hidden from everyone else: the sign-in row (creatorKeyRow.ts)
 * shows only on a device that already holds a key, or after a deliberate gesture: five taps or
 * clicks on the lobby's version label within three seconds. It reveals the row for this page's
 * session, in the lobby's Settings and in the Me card, with no hint anywhere.
 *
 * The label keeps its own job with no delay (the Foreman, 26 Nov 2026: a 600 ms hold made every
 * Updates open late and cost the keyboard its focus ring). The first tap opens Updates at once.
 * Taps 2 to 5 land on the open sheet's backdrop, so a capture-phase listener on the document
 * counts those inside the label's rectangle for three seconds from the first, and swallows them
 * so the backdrop neither closes nor reopens the sheet under them. On the fifth, Updates closes
 * and the row is revealed. A tap anywhere else, or the window ending, stops counting and leaves
 * Updates as the player has it. Enter or Space (a click with detail 0) only ever opens Updates.
 */
import { CREATOR_KEY_EVENT, creatorKey } from '../core/creatorKey'

export const REVEAL_TAPS = 5
export const REVEAL_WINDOW_MS = 3000

let revealed = false

/** The gesture was made in this session. */
export const creatorKeyRevealed = (): boolean => revealed

/** Show the sign-in row on every surface for the rest of this session. */
export function revealCreatorKey(): void {
  if (revealed) return
  revealed = true
  try { globalThis.dispatchEvent?.(new Event(CREATOR_KEY_EVENT)) } catch { /* no window */ }
}

/** Whether a sign-in row is shown at all: a key is stored, or the gesture revealed it. */
export const creatorKeyRowVisible = (): boolean => creatorKey() !== null || revealed

/** The pointer events a tap is made of: all swallowed while a tap counts, so nothing under it reacts. */
const TAP_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click'] as const

export interface VersionLabelOptions {
  /** The version label, which opens Updates. */
  label: EventTarget
  /** Where taps 2 to 5 are caught, in the capture phase: the document. */
  root: EventTarget
  /** The label's rectangle on screen now. */
  rect(): { left: number; top: number; right: number; bottom: number }
  openUpdates(): void
  closeUpdates(): void
  signal: AbortSignal
  now?: () => number
}

/** A point of a mouse, pointer or touch event, or null. */
function pointOf(event: Event): { x: number; y: number } | null {
  const e = event as Partial<MouseEvent> & Partial<TouchEvent>
  const touch = e.changedTouches?.[0]
  if (touch) return { x: touch.clientX, y: touch.clientY }
  return typeof e.clientX === 'number' && typeof e.clientY === 'number' ? { x: e.clientX, y: e.clientY } : null
}

/** Bind the version label: Updates at once on every first tap, the hidden gesture on five. */
export function bindVersionLabel(o: VersionLabelOptions): void {
  const now = o.now ?? (() => performance.now())
  let since = -Infinity, count = 0
  /** The label's rectangle at the first tap: where taps 2 to 5 must land, whatever covers it then. */
  let area = { left: 0, top: 0, right: -1, bottom: -1 }
  const counting = () => count > 0 && now() - since < REVEAL_WINDOW_MS
  const stop = () => { count = 0 }
  o.label.addEventListener('click', (event) => {
    // Keyboard: Updates, never the gesture.
    if ((event as MouseEvent).detail === 0) { stop(); o.openUpdates(); return }
    if (counting()) return // a tap the document already counted (the label was reachable)
    since = now(); count = 1; area = o.rect()
    o.openUpdates()
  }, { signal: o.signal })
  const inside = (event: Event) => {
    const p = pointOf(event), r = area
    return !!p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
  }
  for (const type of TAP_EVENTS) {
    o.root.addEventListener(type, (event) => {
      if (!counting()) { stop(); return }
      // A keyboard click (detail 0) is never a tap, wherever it is: WebKit gives one the
      // label's own coordinates, which would otherwise count it and swallow Enter.
      if (type === 'click' && (event as MouseEvent).detail === 0) { stop(); return }
      // Outside the label's rectangle: not part of the gesture, and the tap does what it always
      // does (a dock link such as the GitHub icon, a link in the sheet, the backdrop). It ends
      // the count.
      if (!inside(event)) { if (type === 'click' || type === 'pointerdown') stop(); return }
      // Inside it the tap counts whatever lies under it now: the sheet's backdrop, its text, or
      // a release-note link that has scrolled under the label (traced 26 Nov 2026: tap 5 on such
      // an anchor cleared the count). Nothing under it reacts and no link opens. No
      // preventDefault on touch events: that would cancel the click the count is made from.
      event.stopPropagation()
      if (type === 'pointerdown' || type === 'mousedown' || type === 'click') event.preventDefault()
      if (type !== 'click') return
      if (++count < REVEAL_TAPS) return
      stop(); o.closeUpdates(); revealCreatorKey()
    }, { capture: true, signal: o.signal })
  }
}
