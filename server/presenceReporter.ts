import { PRESENCE_REFRESH_MS } from './registry'
import type { RecipeId } from '../shared/recipes'

export interface RoomPresenceReport { room: string; players: number; recipeId: RecipeId | null }
interface Pending { report: RoomPresenceReport; signature: string }

/** One request at a time. Changes during delivery collapse to the newest room state.
 * Only successful delivery starts the refresh clock. Failures retry on subsequent traffic,
 * with a one-second backoff; no timer keeps an otherwise idle room awake.
 */
export class PresenceReporter {
  private latest: Pending | null = null
  private delivered = ''
  private deliveredAt = -Infinity
  private retryAt = -Infinity
  private running: Promise<void> | null = null

  constructor(private readonly send: (report: RoomPresenceReport) => Promise<void>,
    private readonly now: () => number = Date.now) {}

  report(report: RoomPresenceReport, seed: unknown): Promise<void> {
    this.latest = { report: { ...report }, signature: JSON.stringify([report.players, report.recipeId, seed]) }
    if (this.running) return this.running
    if (this.now() < this.retryAt || (this.latest.signature === this.delivered && this.now() - this.deliveredAt < PRESENCE_REFRESH_MS)) return Promise.resolve()
    this.running = this.flush().finally(() => { this.running = null })
    return this.running
  }

  private async flush(): Promise<void> {
    while (this.latest) {
      const pending = this.latest
      try { await this.send(pending.report) } catch {
        this.retryAt = this.now() + 1000
        return
      }
      this.delivered = pending.signature
      this.deliveredAt = this.now()
      this.retryAt = -Infinity
      if (this.latest.signature === pending.signature) return
    }
  }
}
