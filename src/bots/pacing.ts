/**
 * Bots arrive one at a time, and only as many as this device carries.
 *
 * Adding a whole fleet in one frame was one of the freezes on entering a world: each bot is a
 * vehicle to build, a body, a mind, effects and a dozen shaders. The pacer adds one, waits for
 * it to settle, measures the frames that follow against the current quality level's target,
 * and only then allows the next. If a bot pushed frames over the target, adding stops there and
 * that bot leaves again. What each level carried comfortably is kept for the session, so a
 * level the device returns to starts from what it learned.
 *
 * The quality governor uses the same budget (shed and climb): bots are one of its steps,
 * beside the post effects and the resolution (src/core/quality.ts).
 *
 * Pure logic, stepped with a clock and frame times, so it can be tested without a browser.
 * In the game both are wall time (performance.now and the frame's duration), which is what a
 * player feels; under a capture tool's virtual clock the measurement means nothing.
 */
import { defineParam } from '../../shared/params'

/** Seconds between one bot arriving or leaving and the next. Personal: each device paces itself. */
export const arrivalInterval = defineParam({ id: 'bots.arrivalInterval', label: 'Seconds between bot arrivals', group: 'Bots', scope: 'client', default: 1.5, min: 1, max: 10, step: 0.5 })

export const PACING = {
  /** After a bot arrives, frames are not judged for this long (its build and arrival effect). */
  settleMs: 1200,
  /** Then frames are measured for this long before deciding. */
  windowMs: 1500,
  /** A window is over the target when its 90th percentile frame is this far over (the governor's slow factor). */
  slowFactor: 1.25,
  /** A bot is only blamed for slow frames if it added at least this share of the frame budget... */
  costShare: 0.1,
  /** ...and at least this many milliseconds to the median frame... */
  minCostMs: 1.5,
  /**
   * ...and at least this share of the frames it is judged against. On a slow or busy device
   * (60 ms frames under load) the median of a short window moves by several milliseconds on
   * its own; an absolute margin there sent bots away for noise.
   */
  baselineShare: 0.12,
  /** Frames longer than this are a pause or a hidden tab, not evidence. */
  interruptedMs: 1000,
}

export interface PacingState {
  /** Bots alive now. */
  have: number
  /** The most the host asked for and the quality level allows. Never exceeded. */
  wanted: number
  /** The current quality level's frame target, in milliseconds. */
  targetMs: number
  /** The current quality level, for the session's record. */
  level: number
  /** False while bots may not arrive: entering a world, in the menus, paused. */
  open: boolean
}

export type PacingAction = 'add' | 'remove' | null

export class BotPacer {
  /** What this device carries now; Infinity until a measurement says otherwise. */
  allowed = Infinity
  /** Bots carried comfortably at each quality level this session, as measured. */
  readonly comfort = new Map<number, number>()
  /** Measured frame-time increase in ms each bot brought, by the count it made. */
  readonly marginal = new Map<number, number>()
  /** One line per arrival or departure decision, for the report and checks. */
  readonly log: { at: number; have: number; action: 'add' | 'remove' | 'kept'; p90?: number; meanMs?: number; targetMs: number }[] = []
  private last = -Infinity
  private wasOpen = false
  private level: number | null = null
  private recent: { at: number; ms: number }[] = []
  private measuring: { since: number; frames: number[]; before: number; count: number } | null = null

  constructor(private readonly interval: () => number = () => arrivalInterval.value) {}

  /**
   * Median frame time over the last window, or NaN with too little evidence. Medians, before
   * and after a bot, so the one-off frames of its arrival (its shaders compile on first sight)
   * are not mistaken for what it costs to keep.
   */
  private recentMedian(now: number): number {
    while (this.recent.length && this.recent[0].at < now - PACING.windowMs) this.recent.shift()
    if (this.recent.length < 5) return NaN
    const sorted = this.recent.map(f => f.ms).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  /** The number of bots to aim for now: what is wanted, within what the device carries. */
  goal(state: Pick<PacingState, 'wanted'>): number { return Math.max(0, Math.min(state.wanted, this.allowed, this.ceiling)) }
  /** At most this many for the rest of the session: set when the player accepts fewer bots. */
  private ceiling = Infinity

  /**
   * One frame. Returns whether to add a bot or remove one now. Never more than one change per
   * interval, never an addition while closed or while the last arrival is still being judged.
   */
  step(now: number, frameMs: number, state: PacingState): PacingAction {
    if (this.level !== state.level) {
      // A new level is a new device budget: start from what it carried before, if anything.
      this.level = state.level; this.allowed = this.comfort.get(state.level) ?? Infinity; this.measuring = null
    }
    // Opening (the player can drive) starts the clock: the first bot comes an interval later,
    // not in the frame the player lands.
    if (state.open && !this.wasOpen) this.last = Math.max(this.last, now)
    this.wasOpen = state.open
    const evidence = Number.isFinite(frameMs) && frameMs > 0 && frameMs < PACING.interruptedMs && state.open
    if (evidence) this.recent.push({ at: now, ms: frameMs })
    const intervalMs = Math.max(0, this.interval()) * 1000
    const due = now - this.last >= intervalMs
    const goal = this.goal(state)
    if (state.have > goal) {
      this.measuring = null
      if (!due) return null
      this.last = now; this.log.push({ at: now, have: state.have, action: 'remove', targetMs: state.targetMs })
      return 'remove'
    }
    const m = this.measuring
    if (m) {
      // Judged only on frames played with this many bots; the menus or a pause discard it.
      if (!state.open || state.have !== m.count) { this.measuring = null; return null }
      if (now - m.since < PACING.settleMs) return null
      if (evidence) m.frames.push(frameMs)
      const span = m.frames.reduce((s, f) => s + f, 0)
      if (span < PACING.windowMs) return null
      const sorted = [...m.frames].sort((a, b) => a - b), p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]
      const meanMs = span / sorted.length, medianMs = sorted[Math.floor(sorted.length / 2)]
      this.measuring = null
      // Over the target is not enough: the bot must have made frames measurably worse, from
      // frames that met the target before it. Frames already slow before it (a weak or busy
      // device, a headless browser) are the quality level's to fix, not the bots': there a
      // short window's median swings by a third on its own, so no comparison can single out a
      // bot. The governor's bot step (costly, shed) still offers relief with automatic quality.
      const keptUp = m.before <= state.targetMs * PACING.slowFactor
      // What a bot costs is recorded only from frames that kept up: on frames already slow the
      // difference is load noise, and the governor would shed bots for it (see costly).
      if (keptUp) this.marginal.set(m.count, medianMs - m.before)
      const worse = keptUp && medianMs - m.before > Math.max(PACING.minCostMs, state.targetMs * PACING.costShare, m.before * PACING.baselineShare)
      if (p90 > state.targetMs * PACING.slowFactor && worse) {
        // That one was too many: carry one fewer at this level, and send it off.
        this.allowed = Math.max(0, m.count - 1)
        this.comfort.set(state.level, this.allowed)
        this.last = now; this.log.push({ at: now, have: state.have, action: 'remove', p90, meanMs, targetMs: state.targetMs })
        return 'remove'
      }
      this.comfort.set(state.level, Math.max(this.comfort.get(state.level) ?? 0, m.count))
      this.log.push({ at: now, have: state.have, action: 'kept', p90, meanMs, targetMs: state.targetMs })
      return null
    }
    if (!state.open || state.have >= goal || !due) return null
    // Judged against the frames just before it: with no baseline yet (the first moments of
    // play) wait, rather than blame the bot for whatever the frames were already doing.
    const before = this.recentMedian(now)
    if (!Number.isFinite(before)) return null
    this.last = now
    this.measuring = { since: now, frames: [], before, count: state.have + 1 }
    this.log.push({ at: now, have: state.have, action: 'add', targetMs: state.targetMs })
    return 'add'
  }

  /**
   * The quality governor asks for relief: carry one bot fewer. True when that is a real
   * change (there was a bot to lose). Bots are offered before the picture is made coarser
   * only when they measurably cost frame time; see `costly`.
   */
  shed(have: number, byPlayer = false): boolean {
    if (have <= 0) return false
    this.allowed = have - 1; this.measuring = null
    // The player's own choice of fewer bots holds for the session: headroom does not undo it.
    if (byPlayer) this.ceiling = Math.min(this.ceiling, this.allowed)
    if (this.level !== null) this.comfort.set(this.level, this.allowed)
    return true
  }

  /** The governor sees headroom: allow one more, up to what was wanted. True when that changes anything. */
  climb(have: number, wanted: number): boolean {
    if (have >= Math.min(wanted, this.ceiling) || this.allowed > have) return false
    this.allowed = have + 1
    return true
  }

  /**
   * True when the bots now carried measurably cost frame time: together at least a tenth of
   * the frame budget, by what the pacer measured. An unmeasured bot is not counted: counting
   * it made the governor shed a bot within two seconds of its arrival on a device that was
   * slow before it, and the level then remembered carrying none for the session.
   */
  costly(have: number, targetMs: number): boolean {
    if (have <= 0) return false
    let total = 0
    for (let i = 1; i <= have; i++) total += this.marginal.get(i) ?? 0
    return total >= targetMs * 0.1
  }

  /** Forget the pace (a new world): the next bot may come at once, and is judged afresh. */
  restart(): void { this.last = -Infinity; this.measuring = null; this.recent = [] }
}
