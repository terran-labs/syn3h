/**
 * The control around one covered quality climb (Game.runCoveredClimb): its abort signal, the
 * ceiling on the Applying veil, and an abort when the world goes away.
 *
 * Behind an open menu nobody waits on the job, so it may take as long as it needs, one slice per
 * frame. The ceiling (veilMs) starts only when the Applying veil is shown, that is when someone
 * pressed Resume before the job was done: the veil must not hang. A world that is rebuilt or left
 * mid-job aborts it, so no slice runs against a disposed scene.
 */
export type ClimbOutcome = 'done' | 'veil' | 'aborted' | 'failed'

export class CoveredClimbRun {
  private readonly stop = new AbortController()
  private veilTimer: ReturnType<typeof setTimeout> | undefined
  private settle!: (outcome: ClimbOutcome) => void
  private outcome: ClimbOutcome | null = null
  private readonly settled = new Promise<ClimbOutcome>(resolve => { this.settle = resolve })
  /** When the veil went up, if it did. */
  veilAt: number | null = null

  constructor(private readonly veilMs: number) {}

  /** Aborted when the job must stop: done, out of time behind the veil, or the world went away. */
  get signal(): AbortSignal { return this.stop.signal }
  /** Throws once the job must stop; call it between every two steps of the job. */
  check(): void { this.stop.signal.throwIfAborted() }

  /** The Applying veil is up: from now the job has veilMs to finish. */
  veilShown(): void {
    if (this.veilTimer !== undefined || this.outcome) return
    this.veilAt = performance.now()
    this.veilTimer = setTimeout(() => this.end('veil'), this.veilMs)
  }

  /** The world is being rebuilt or left: the job stops at its next step. */
  abort(): void { this.end('aborted') }

  /** Run the job; resolves with why it ended, at once when it is stopped. */
  run(work: (run: CoveredClimbRun) => Promise<void>): Promise<ClimbOutcome> {
    work(this).then(() => this.end('done'), error => {
      if (!this.stop.signal.aborted) { console.warn('Covered climb failed', error); this.end('failed') }
    })
    return this.settled
  }

  private end(outcome: ClimbOutcome): void {
    if (this.outcome) return
    this.outcome = outcome
    if (this.veilTimer !== undefined) clearTimeout(this.veilTimer)
    this.stop.abort()
    this.settle(outcome)
  }
}
