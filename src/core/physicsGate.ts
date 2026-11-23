/**
 * The physics engine's download, retried in place. The lobby opens without it; only entering a
 * world needs it. A failed or stalled download is tried again by itself after a pause that grows
 * (RETRY_DELAYS_MS), and a player waiting to enter can try again at once. The page is never
 * left broken and never needs a reload for this.
 *
 * No DOM, no timers of its own beyond the injected clock: tests drive it with a fake one.
 */
export type PhysicsState = 'loading' | 'waiting' | 'ready'

/** Pauses before each automatic retry, in order; the last repeats. */
export const RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 10000, 20000]

export interface GateClock { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
const realClock: GateClock = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }

export class PhysicsGate {
  state: PhysicsState = 'loading'
  /** Attempts started so far. */
  attempts = 0
  /** The last failure, for diagnostics. */
  lastError: unknown = null
  /** Milliseconds until the next automatic attempt, while waiting. */
  nextDelayMs = 0
  /** Resolves once the engine is loaded. Never rejects. */
  readonly ready: Promise<void>
  private resolve!: () => void
  private timer: unknown = null
  private readonly listeners = new Set<(gate: PhysicsGate) => void>()

  constructor(private readonly load: () => Promise<void>, private readonly delays: readonly number[] = RETRY_DELAYS_MS, private readonly clock: GateClock = realClock) {
    this.ready = new Promise<void>(resolve => { this.resolve = resolve })
  }

  /** Start the first attempt. Safe to call more than once. */
  start(): Promise<void> {
    if (this.attempts === 0) this.attempt()
    return this.ready
  }

  /** While waiting to retry, retry now (a player pressed Try again). Otherwise does nothing. */
  retryNow(): void {
    if (this.state !== 'waiting') return
    this.clock.clear(this.timer); this.timer = null
    this.attempt()
  }

  /** Called on every change of state. Returns the function that stops it. */
  onChange(listener: (gate: PhysicsGate) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private attempt(): void {
    this.state = 'loading'; this.attempts++; this.emit()
    let settled = false
    this.load().then(() => {
      if (settled) return
      settled = true
      this.state = 'ready'; this.lastError = null; this.emit(); this.resolve()
    }, error => {
      if (settled) return
      settled = true
      this.lastError = error
      this.nextDelayMs = this.delays[Math.min(this.attempts - 1, this.delays.length - 1)] ?? 0
      this.state = 'waiting'; this.emit()
      this.timer = this.clock.set(() => { this.timer = null; if (this.state === 'waiting') this.attempt() }, this.nextDelayMs)
    })
  }

  private emit(): void { for (const listener of this.listeners) listener(this) }
}
