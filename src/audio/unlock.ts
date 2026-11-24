/**
 * Starting sound on the visitor's first gesture, anywhere on the page.
 *
 * Browsers will not run an AudioContext until the page has had a user activation: a key press
 * (not Escape), a mouse button going down, or a touch or pen lifting (`pointerup`, `touchend`;
 * a touch going down does not count, and Safari wants the context resumed inside the handler).
 * That rule is the platform's, not ours to remove. What is ours:
 *  - Listening from the moment this module is imported, during the loading view, before the
 *    game and its mix exist. The game's audio is built only after the world has loaded, and a
 *    tap before then used to be lost.
 *  - Listening on the window in the capture phase, so no panel, button or the galaxy's drag
 *    handling can stop the event before we hear it (several handlers stop propagation).
 *  - Creating the context inside the first gesture if there is none yet, and resuming it, so
 *    Safari counts it as started by the visitor.
 * The context is shared with GameAudio, which builds the mix on it.
 */
const GESTURES = ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown', 'click'] as const

/**
 * Fired on the window when sound starts, and whenever the context later stops or runs again,
 * so the "Tap to start sound" hint follows what is actually audible.
 */
export const SOUND_STARTED = 'mira:sound-started'
let started = false
const announce = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(SOUND_STARTED)) }
/**
 * True while the game's sound is not playing and a tap or key press would start it: before the
 * first one, and after the browser stopped the clock (iOS after a call or a trip to another app)
 * until the next one. The interface must never show sound as on while the clock is stopped.
 */
export const soundWaiting = () => !started || (shared !== undefined && shared.state !== 'running')
/** Called by GameAudio once its mix is running. */
export function markSoundStarted(): void {
  if (started) return
  started = true
  announce()
}

/**
 * iPhone and iPad put a page's Web Audio in the "ambient" audio session by default, which the
 * ring/silent switch silences (WebKit bug 237322; Audio Session API, Safari on iOS 17 and later).
 * Declaring "playback" makes the game heard on silent, as a video or music page is, and pauses
 * other apps' music while it plays. `playing` false returns to the browser's own choice, so a
 * muted game never takes over the phone's audio. A no-op where the API is missing.
 */
export { declareAudioSession } from './audioSession'

let shared: AudioContext | undefined
/** performance.now() when the shared context was made: its state may change in its first moments. */
let sharedAt = 0
/** How long ago the page's AudioContext was made, in milliseconds (Infinity if it has not been). */
export const audioContextAge = (): number => shared ? performance.now() - sharedAt : Infinity
let gestured = false
let claimed = false
const listeners = new Set<() => void>()

/** The page's AudioContext, made on first use. Undefined where Web Audio is unavailable. */
export function audioContext(): AudioContext | undefined {
  if (!shared && typeof AudioContext !== 'undefined') {
    try { shared = new AudioContext(); sharedAt = performance.now(); shared.addEventListener('statechange', () => { if (started) announce() }) } catch { /* no audio here */ }
  }
  return shared
}
/** Close a context the browser refused to start, so the next gesture makes a fresh one inside itself. */
export function discardAudioContext(context: AudioContext): void {
  if (shared === context) shared = undefined
  void context.close().catch(() => {})
}
/** Whether the page has had a gesture that could start audio. */
export function hadGesture(): boolean {
  return gestured || Boolean((navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation?.hasBeenActive)
}
/**
 * Hear every later gesture. Once something has subscribed, it owns resuming the context (a
 * paused game suspends it on purpose), so this module stops resuming it by itself.
 */
export function onGesture(listener: () => void): () => void {
  claimed = true
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function heard(event: Event): void {
  if (!event.isTrusted) return
  // Escape is not a user activation; nothing to gain from trying.
  if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') return
  gestured = true
  if (!claimed) {
    const context = audioContext()
    if (context && context.state !== 'running') void context.resume().catch(() => {})
  }
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') for (const type of GESTURES) window.addEventListener(type, heard, { capture: true, passive: true })
