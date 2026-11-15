/**
 * One answer to "is anyone looking at this page?", for every system to obey.
 *
 * The owner's rule: the game does not run in a background tab. Audio fades out and pauses,
 * and nothing spends CPU on physics, rendering, bots or effects. Browsers throttle a hidden
 * tab but do not stop it: timers, Web Audio, workers and socket handlers keep running unless
 * the page stops them itself. So the page decides, here, in one place.
 *
 * The state is `hidden` when any of these hold, and `active` only when none does:
 *   - the document is hidden (another tab, a minimised window, a locked phone);
 *   - the page was put in the back/forward cache (`pagehide`, until `pageshow`);
 *   - the browser froze the page (`freeze`, until `resume`).
 *
 * Listeners are told once per change, in the order they subscribed. Hiding is announced to
 * every listener even if one throws: a system that fails to pause must not keep the rest
 * running. The one stated exception to "nothing runs" is the room connection's keep-alive
 * (one small message a second, src/net), which stops a hidden player being dropped.
 */
export type PageState = 'active' | 'hidden'
export type PageListener = (state: PageState, previous: PageState) => void

/** The browser signals the controller reads. Tests supply their own. */
export interface PageSignals {
  hidden(): boolean
  /** Subscribes to an event on the document or the window; returns the unsubscribe. */
  on(target: 'document' | 'window', type: string, handler: () => void): () => void
}

function browserSignals(): PageSignals {
  return {
    hidden: () => typeof document !== 'undefined' && document.hidden,
    on(target, type, handler) {
      const node: EventTarget | undefined = target === 'document' ? (typeof document !== 'undefined' ? document : undefined) : (typeof window !== 'undefined' ? window : undefined)
      node?.addEventListener(type, handler)
      return () => node?.removeEventListener(type, handler)
    },
  }
}

export class PageLifecycle {
  private current: PageState
  private cached = false
  private frozen = false
  private readonly listeners: PageListener[] = []
  private readonly unsubscribe: (() => void)[]

  constructor(private readonly signals: PageSignals = browserSignals()) {
    this.current = signals.hidden() ? 'hidden' : 'active'
    const check = () => this.evaluate()
    this.unsubscribe = [
      signals.on('document', 'visibilitychange', check),
      signals.on('window', 'pagehide', () => { this.cached = true; check() }),
      signals.on('window', 'pageshow', () => { this.cached = false; check() }),
      signals.on('document', 'freeze', () => { this.frozen = true; check() }),
      signals.on('document', 'resume', () => { this.frozen = false; check() }),
    ]
  }

  get state(): PageState { return this.current }
  get hidden(): boolean { return this.current === 'hidden' }

  /** Subscribes to changes; returns the unsubscribe. Not called with the current state. */
  onChange(listener: PageListener): () => void {
    this.listeners.push(listener)
    return () => { const i = this.listeners.indexOf(listener); if (i >= 0) this.listeners.splice(i, 1) }
  }

  private evaluate(): void {
    const next: PageState = this.signals.hidden() || this.cached || this.frozen ? 'hidden' : 'active'
    if (next === this.current) return
    const previous = this.current
    this.current = next
    let failure: unknown
    for (const listener of [...this.listeners]) {
      try { listener(next, previous) } catch (error) { failure ??= error }
    }
    if (failure !== undefined) console.error('A system failed to follow the page becoming ' + next, failure)
  }

  dispose(): void {
    for (const off of this.unsubscribe) off()
    this.listeners.length = 0
  }
}
