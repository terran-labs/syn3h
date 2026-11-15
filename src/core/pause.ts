/**
 * One pause, two reasons. The game stops when the player pauses it ('user': Escape with the
 * cursor already free, or the touch menu) and when nobody can see the page ('hidden': a
 * background tab, a locked phone; see lifecycle.ts). Both go through this one state, so the
 * two can never disagree about whether the game is running:
 *
 *   - the game is paused while either reason holds, and runs only when neither does;
 *   - hiding the page never clears the player's own pause, and showing it again leaves that
 *     pause in place: a player who paused, switched tabs and came back is still paused;
 *   - the reported reason is 'user' whenever the player's pause holds, because that is the
 *     one with an overlay to show.
 *
 * Listeners hear every change of `paused` or `reason`. The composition root stops the frame
 * loop from here; the shell shows its overlay and fades audio from the same subscription.
 */
export type PauseReason = 'user' | 'hidden'
export type PauseListener = (paused: boolean, reason: PauseReason | null) => void

export interface PauseControl {
  readonly paused: boolean
  readonly reason: PauseReason | null
  /** Idempotent. */
  pause(reason: PauseReason): void
  /** Clears that reason only. */
  resume(reason: PauseReason): void
  subscribe(listener: PauseListener): () => void
}

export class PauseState implements PauseControl {
  private readonly reasons = new Set<PauseReason>()
  private readonly listeners: PauseListener[] = []

  get paused(): boolean { return this.reasons.size > 0 }
  get reason(): PauseReason | null { return this.reasons.has('user') ? 'user' : this.reasons.has('hidden') ? 'hidden' : null }

  pause(reason: PauseReason): void { this.change(() => this.reasons.add(reason)) }
  resume(reason: PauseReason): void { this.change(() => this.reasons.delete(reason)) }

  subscribe(listener: PauseListener): () => void {
    this.listeners.push(listener)
    return () => { const i = this.listeners.indexOf(listener); if (i >= 0) this.listeners.splice(i, 1) }
  }

  private change(apply: () => void): void {
    const paused = this.paused, reason = this.reason
    apply()
    if (paused === this.paused && reason === this.reason) return
    // Every listener hears it even if one throws: a system that fails to pause must not keep
    // the others running, and one that fails to resume must not leave the rest stopped.
    let failure: unknown
    for (const listener of [...this.listeners]) {
      try { listener(this.paused, this.reason) } catch (error) { failure ??= error }
    }
    if (failure !== undefined) console.error('A system failed to follow the game ' + (this.paused ? 'pausing' : 'resuming'), failure)
  }
}
