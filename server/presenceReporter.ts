import { PRESENCE_REFRESH_MS } from './registry'
import type { RecipeId } from '../shared/recipes'

/** `active`: connected players not paused (server/room.ts presence); absent from older rooms. */
export interface RoomPresenceReport { room: string; players: number; active?: number; recipeId: RecipeId | null }
interface Pending { report: RoomPresenceReport; core: string; active: number | undefined }

/**
 * A change in only the active count (a player pausing or resuming) is reported at most once
 * per this long per room, ms, the latest value going with the first report call after the
 * window (a paused page sends a heartbeat every second, so there is traffic to carry it).
 * A pause bit flipped as fast as a client likes therefore causes at most six reports a minute
 * per room. A change in the connected count, the world or the seed still reports at once, so
 * /status and the lobby's player counts stay current. Cost: the lobby's "N active players"
 * can lag a pause or resume by up to this long, on top of its own 30 s poll.
 */
export const ACTIVE_REPORT_MS = 10_000

/** One request at a time. Changes during delivery collapse to the newest room state.
 * Only successful delivery starts the refresh clock. Failures retry on subsequent traffic,
 * with a one-second backoff; no timer keeps an otherwise idle room awake.
 */
export class PresenceReporter {
  private latest: Pending | null = null
  private deliveredCore = ''
  private deliveredActive: number | undefined = undefined
  private deliveredAt = -Infinity
  private retryAt = -Infinity
  private running: Promise<void> | null = null

  constructor(private readonly send: (report: RoomPresenceReport) => Promise<void>,
    private readonly now: () => number = Date.now,
    /** Told of each failed delivery (the transport rate limits its log line). */
    private readonly failed: (error: unknown) => void = () => {}) {}

  report(report: RoomPresenceReport, seed: unknown): Promise<void> {
    this.latest = { report: { ...report }, core: JSON.stringify([report.players, report.recipeId, seed]), active: report.active }
    if (this.running) return this.running
    if (this.now() < this.retryAt || !this.due(this.latest)) return Promise.resolve()
    this.running = this.flush().finally(() => { this.running = null })
    return this.running
  }

  /** Whether `p` should be sent now: see ACTIVE_REPORT_MS and PRESENCE_REFRESH_MS. */
  private due(p: Pending): boolean {
    const since = this.now() - this.deliveredAt
    if (p.core !== this.deliveredCore) return true
    if (p.active !== this.deliveredActive) return since >= ACTIVE_REPORT_MS
    return since >= PRESENCE_REFRESH_MS
  }

  private async flush(): Promise<void> {
    while (this.latest) {
      const pending = this.latest
      try { await this.send(pending.report) } catch (error) {
        this.failed(error)
        this.retryAt = this.now() + 1000
        return
      }
      this.deliveredCore = pending.core
      this.deliveredActive = pending.active
      this.deliveredAt = this.now()
      this.retryAt = -Infinity
      if (this.latest === pending || !this.due(this.latest)) return
    }
  }
}
