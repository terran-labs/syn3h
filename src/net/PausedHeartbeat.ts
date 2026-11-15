/**
 * Speaks for a player whose game has stopped. While the game is paused the frame loop does
 * not run, so no vehicle states and no pings leave this client; without a word from us the
 * others would watch our vehicle run on for a second, then read "not responding", and the
 * room would close the connection as silent. So a timer sends a state flagged paused about
 * once a second: the others hold the vehicle still where it is and show it as paused, and
 * the room keeps it out of the hill, tags and shoves until it moves again.
 *
 * The game pauses for two reasons (src/core/pause.ts): the player paused it, or the page is
 * hidden. Both arrive here through `setPaused`, called from the one pause subscription. The
 * page's visibility is only a fallback, for a host page that never calls `setPaused`: until
 * the first call a hidden page counts as paused, as it always did; after it, only the pause
 * state decides, so the two can never disagree.
 *
 * No browser or Three.js here, so it is unit tested directly.
 */
export interface HeartbeatHooks {
  /** Send one paused state now (the caller skips it while not connected). */
  send(): void
  /** The game runs again: whatever latency was measured before or during the pause is stale. */
  resumed(): void
  /** Milliseconds between heartbeats. */
  interval: number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

export class PausedHeartbeat {
  private timer: unknown = null
  /** `setPaused` has been called: the pause state decides, not the page's visibility. */
  private driven = false

  constructor(private readonly hooks: HeartbeatHooks) {}

  /** True while heartbeats stand in for the stopped game. */
  get paused(): boolean {
    return this.timer !== null
  }

  /** The game paused or resumed, for either reason. Idempotent. */
  setPaused(paused: boolean): void {
    this.driven = true
    this.apply(paused)
  }

  /** The page was hidden or shown. Ignored once `setPaused` has ever been called. */
  visibility(hidden: boolean): void {
    if (!this.driven) this.apply(hidden)
  }

  /** Stop for good (the client is being disposed). Does not count as resuming. */
  stop(): void {
    if (this.timer === null) return
    ;(this.hooks.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer)
    this.timer = null
  }

  private apply(paused: boolean): void {
    if (paused) {
      if (this.timer !== null) return
      this.timer = (this.hooks.setInterval ?? ((fn, ms) => setInterval(fn, ms)))(() => this.hooks.send(), this.hooks.interval)
      // At once as well, so the others stop extrapolating us within a frame, not a second.
      this.hooks.send()
    } else {
      if (this.timer === null) return
      this.stop()
      this.hooks.resumed()
    }
  }
}
