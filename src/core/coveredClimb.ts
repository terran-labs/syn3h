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

/**
 * The highest level a covered climb is prepared for in slices (High). Climbs to Ultra and
 * Cinematic keep the v26.11.2204 path: applied on one covered frame and prepared in one draw.
 *
 * Why: four rounds of fixes to the sliced job left a bot jet's materials building in play after
 * a climb to Ultra or Cinematic (Volcanic, WebGPU, scripted jet pass), and each round moved the
 * cold set (showroom 2, then the plain set, tail lights and plume) rather than removing it. Every
 * cold pipeline differed from one the job had built only in the render context's sample count
 * (4 in play, 1 in the job's contexts), the job's covered marking, its off-screen hold target and
 * that target's sample count were each ruled out in turn, and there is no model that predicts the
 * next result. To lift this, find which pass draws those materials in play at those levels (the
 * render context with 4 samples) and why the sliced job's draws never reach it: likely in how the
 * post chain's graph at those levels (full tier: temporal, AO, GI) routes the scene pass when it is
 * drawn several times in one animation frame with the frame counter advanced (CoveredPipelines).
 */
export const SLICED_CLIMB_TOP = 3
/** Whether a covered climb to `level` runs as the sliced job (Game.takeCoveredClimb). */
export function slicedClimbTo(level: number | null): boolean { return level !== null && level <= SLICED_CLIMB_TOP }

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
