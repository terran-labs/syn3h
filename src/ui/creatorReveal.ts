/**
 * Where the creator signs in is hidden from everyone else: the Creator key row (creatorKeyRow.ts)
 * shows only on a device that already holds a key, or after a deliberate gesture: five taps or
 * clicks on the lobby's version label within three seconds. It reveals the row for this page's
 * session, in the lobby's Settings and in the Me card, with no hint anywhere. Taps and Enter on
 * the focused label both count, so it works in an iOS Home Screen app and from a keyboard.
 *
 * The label's own click still opens Updates: a click opens it once no further click follows
 * within SINGLE_CLICK_MS, so a slow single click opens Updates and a run of quick taps does not.
 */
import { CREATOR_KEY_EVENT, creatorKey } from '../core/creatorKey'

export const REVEAL_TAPS = 5
export const REVEAL_WINDOW_MS = 3000
/** How long a click waits for another before it counts as a single click (opens Updates). */
export const SINGLE_CLICK_MS = 600

let revealed = false

/** The gesture was made in this session. */
export const creatorKeyRevealed = (): boolean => revealed

/** Show the Creator key row on every surface for the rest of this session. */
export function revealCreatorKey(): void {
  if (revealed) return
  revealed = true
  try { globalThis.dispatchEvent?.(new Event(CREATOR_KEY_EVENT)) } catch { /* no window */ }
}

/** Whether a Creator key row is shown at all: a key is stored, or the gesture revealed it. */
export const creatorKeyRowVisible = (): boolean => creatorKey() !== null || revealed

/** Counts taps; true on the tap that completes REVEAL_TAPS within REVEAL_WINDOW_MS. */
export class RevealTaps {
  private times: number[] = []
  tap(now: number): boolean {
    this.times = this.times.filter((t) => now - t < REVEAL_WINDOW_MS)
    this.times.push(now)
    if (this.times.length < REVEAL_TAPS) return false
    this.times = []
    return true
  }
}

/**
 * Bind the version label: single clicks open Updates (after SINGLE_CLICK_MS without another),
 * five quick ones reveal the Creator key row instead.
 */
export function bindVersionLabel(label: EventTarget, openUpdates: () => void, signal: AbortSignal, now: () => number = () => performance.now()): void {
  const taps = new RevealTaps()
  let pending: ReturnType<typeof setTimeout> | undefined
  label.addEventListener('click', (event) => {
    clearTimeout(pending)
    // Enter or Space (a click with detail 0) opens Updates at once and is never part of the
    // gesture: a held timer cost the keyboard its focus ring on the sheet's X.
    if ((event as MouseEvent).detail === 0) { pending = undefined; openUpdates(); return }
    if (taps.tap(now())) { pending = undefined; revealCreatorKey(); return }
    pending = setTimeout(() => { pending = undefined; openUpdates() }, SINGLE_CLICK_MS)
  }, { signal })
  signal.addEventListener('abort', () => clearTimeout(pending))
}
