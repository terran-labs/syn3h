/**
 * Tap to begin: where the browser will not start sound without a gesture (always on iPhone
 * Safari; on desktop Chrome for a visitor it does not know yet), the lobby's opening waits for
 * one. The owner's decision, 17 November 2026: "Wait for a tap only when sound is blocked, and
 * show a rotating carousel of fun messages, only one per load, letting users know when they're
 * ready to tap to enter."
 *
 * Once loading is done the veil stays up (html[data-boot="ready"]): black space and the
 * breathing point of light, the first frame of the Big Bang, drawn by the page as it is while
 * loading. Over it, one line from tapMessages.ts, which is a full-screen button. The first tap,
 * click or key press starts the sound inside that gesture (unlock.ts and GameAudio resume the
 * clock there, as Safari requires); when the clock runs, the score's swell is scheduled and
 * the veil lifts in the same moment, so the Big Bang and the music start together and the
 * score's drop lands on the pop (GameAudio.begin, POP_SECONDS).
 *
 * Where sound is allowed, nothing waits: the opening plays at once with sound, as before.
 *
 * Not held (the opening plays at once, silent until the first gesture, as before):
 *  - a link into a world or a room (?world=, ?room=, ?planet=, ?seed=) or ?autoplay: the tap
 *    that enters is the first tap, and it starts the sound;
 *  - automated browsers (navigator.webdriver), so checks never wait on a tap. ?tap=1 holds
 *    them too, for checking this; ?tap=0 never holds.
 */
import { audioContext, audioContextAge } from '../audio/unlock'
import { pickTapMessage } from './data/tapMessages'
import { introMode, openingCue, POP_SECONDS } from './galaxy/opening'
import type { VeilHold } from './LoadingScreen'

/** The parts of GameAudio the gate uses. */
export interface BeginAudio {
  begin(popSeconds: number): Promise<void>
  cancelBegin(): void
  /** Set by begin: when the sound will be heard, on the page's clock. */
  readonly bangAt?: { page: number }
}

/** Query keys that mean the visitor came to enter somewhere: no extra tap on the way. */
const ENTERING = ['world', 'room', 'planet', 'seed', 'autoplay'] as const
/**
 * The query the page was opened with. The lobby tidies the address bar before loading ends,
 * so read the navigation's own record of it, which that does not change.
 */
function entrySearch(): string {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (entry?.name) return new URL(entry.name).search
  } catch { /* fall back to the address bar */ }
  return location.search
}
/** How long a gesture has to start the clock before the opening goes ahead without sound. */
const GRACE_MS = 700
/** How long a new context may take to report that it is allowed to run. */
const SETTLE_MS = 300

/** Whether this load may wait for a tap at all (before asking the browser about sound). */
export function mayHold(search: string, automated: boolean): boolean {
  const query = new URLSearchParams(search)
  const asked = query.get('tap')
  if (asked === '0') return false
  if (asked === '1') return true
  return !automated && !ENTERING.some(key => query.has(key))
}

/**
 * Whether the browser is refusing to start sound without a gesture, now. A context it allows
 * may report running a moment after it is made, and one on a page the visitor has already used
 * (sticky activation) may start on request, so both are given a short while.
 */
export async function soundBlocked(context: AudioContext | undefined = audioContext()): Promise<boolean> {
  if (!context || context.state === 'closed') return false
  // A context made only now may still be changing its state: give it its first moments.
  const young = Math.max(0, SETTLE_MS - audioContextAge())
  if (young > 0) await new Promise(resolve => setTimeout(resolve, young))
  if (context.state === 'running') return false
  if ((navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation?.hasBeenActive) void context.resume().catch(() => {})
  await new Promise<void>(resolve => {
    const done = () => { context.removeEventListener('statechange', check); clearTimeout(timer); resolve() }
    const check = () => { if (context.state === 'running') done() }
    const timer = setTimeout(done, SETTLE_MS)
    context.addEventListener('statechange', check)
  })
  return (context.state as AudioContextState) !== 'running'
}

/** The hold for LoadingScreen.finish, or undefined where this load never waits. */
export function tapToBegin(audio: BeginAudio): VeilHold | undefined {
  if (!mayHold(entrySearch(), navigator.webdriver)) return undefined
  return lift => { void hold(audio, lift) }
}

async function hold(audio: BeginAudio, lift: () => void): Promise<void> {
  const root = document.documentElement
  if (!(await soundBlocked()) || root.dataset.boot !== 'loading') { lift(); return }
  root.dataset.boot = 'ready'
  const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* Storage is optional. */ }
  const gate = document.createElement('button')
  gate.type = 'button'
  gate.className = 'tap-gate'
  const line = document.createElement('span')
  line.className = 'tap-gate-line'
  line.textContent = pickTapMessage(storage, touch)
  gate.append(line)
  document.body.append(gate)
  requestAnimationFrame(() => { gate.classList.add('is-shown'); gate.focus({ preventScroll: true }) })

  const abort = new AbortController(), signal = abort.signal
  // A startup failure or the loading time limit lifts the veil without us: go with it.
  const watch = new MutationObserver(() => { if (root.dataset.boot !== 'ready') end() })
  let begun = false, grace: ReturnType<typeof setTimeout> | undefined
  const end = () => {
    if (signal.aborted) return
    abort.abort(); clearTimeout(grace); watch.disconnect()
    lift()
    gate.classList.add('is-leaving')
    setTimeout(() => gate.remove(), 400)
  }
  // The pop: where the opening plays, the score's drop lands on it; otherwise at once.
  const opening = introMode.value > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches
  // Armed now, before any gesture: the clock may start inside the gesture's first event
  // (pointerdown on desktop, touchend on a phone), before the button hears its click. Whenever
  // it runs, the score's swell is scheduled and the veil lifts with it.
  // The opening starts where the sound is heard (openingCue), whichever frame draws it first.
  audio.begin(opening ? POP_SECONDS : 0.05).then(() => { if (audio.bangAt) openingCue.at = audio.bangAt.page; end() }, end)
  // A gesture the browser did not accept as starting sound still begins, without it, so no
  // one has to tap twice. Sound then joins on the next gesture, fading in as usual.
  const tapped = () => {
    if (begun) return
    begun = true
    grace = setTimeout(() => { audio.cancelBegin(); end() }, GRACE_MS)
  }
  gate.addEventListener('click', tapped, { signal })
  window.addEventListener('keydown', event => {
    // Tab moves focus, a modifier alone is half a shortcut, Escape is not a gesture: none begin.
    if (event.key === 'Tab') gate.classList.add('is-keyed')
    if (event.key === 'Tab' || event.key === 'Escape' || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
    // The lobby's own keys wait for the lobby: this press only begins.
    event.preventDefault(); event.stopPropagation()
    tapped()
  }, { capture: true, signal })
  watch.observe(root, { attributes: true, attributeFilter: ['data-boot'] })
}
