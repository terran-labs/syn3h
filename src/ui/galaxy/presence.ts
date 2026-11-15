import type { PresenceSnapshot } from '../../../shared/presence'
export type { PresenceSnapshot } from '../../../shared/presence'

/** Public recipe totals only. Room identities and joining stay outside the lobby feed. */
export interface Population { rooms: number; players: number }
export type Populations = ReadonlyMap<string, Population | null>
export const PRESENCE_TTL = 90_000
export const PRESENCE_POLL = 30_000

export function readPresence(value: unknown): PresenceSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const v = value as PresenceSnapshot
  if (v.version !== 1 || v.ttlMs !== PRESENCE_TTL || !Number.isSafeInteger(v.generatedAt) || v.generatedAt < 0 || !Array.isArray(v.byRecipe)) return null
  const seen = new Set<string | null>()
  for (const row of v.byRecipe) {
    if (!row || (row.recipeId !== null && typeof row.recipeId !== 'string') || seen.has(row.recipeId)) return null
    if (![row.rooms, row.players, row.oldestReportAt].every(n => Number.isSafeInteger(n) && n >= 0) || row.oldestReportAt > v.generatedAt) return null
    seen.add(row.recipeId)
  }
  return v
}

/** Report age, never receipt age. Missing rows in a fresh response mean zero. */
export function populations(snapshot: PresenceSnapshot | null, recipes: readonly string[], now = Date.now()): Populations {
  const valid = snapshot !== null && snapshot.generatedAt <= now + 5000 && now - snapshot.generatedAt < PRESENCE_TTL
  return new Map(recipes.map(id => {
    if (!valid) return [id, null]
    const row = snapshot!.byRecipe.find(r => r.recipeId === id)
    if (!row) return [id, { rooms: 0, players: 0 }]
    return [id, now - row.oldestReportAt < PRESENCE_TTL ? { rooms: row.rooms, players: row.players } : null]
  }))
}

export function populationLabel(value: Population | null): string {
  return value ? `${value.players} connected across ${value.rooms} ${value.rooms === 1 ? 'room' : 'rooms'}` : 'Population unknown'
}

/** The caller supplies actual lobby/tab visibility. No background polling or overlapping fetches. */
export class PresenceFeed {
  private active = false
  private generation = 0
  private request: AbortController | null = null
  private pollTimer?: ReturnType<typeof setTimeout>
  private expiryTimer?: ReturnType<typeof setTimeout>
  private timeout?: ReturnType<typeof setTimeout>
  private snapshot: PresenceSnapshot | null = null
  constructor(private readonly recipes: readonly string[], private readonly changed: (values: Populations) => void, private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active; this.generation++
    clearTimeout(this.pollTimer); clearTimeout(this.expiryTimer); clearTimeout(this.timeout)
    this.request?.abort(); this.request = null
    this.snapshot = null
    if (active) { this.publish(); void this.poll() }
  }

  private publish(): void {
    if (!this.active) return
    clearTimeout(this.expiryTimer)
    const now = Date.now()
    this.changed(populations(this.snapshot, this.recipes, now))
    if (!this.snapshot || this.snapshot.generatedAt > now + 5000) return
    const deadlines = [this.snapshot.generatedAt, ...this.snapshot.byRecipe.map(row => row.oldestReportAt)]
      .map(at => at + PRESENCE_TTL).filter(at => at > now)
    if (deadlines.length) this.expiryTimer = setTimeout(() => this.publish(), deadlines.reduce((earliest, at) => Math.min(earliest, at), Infinity) - now)
  }

  private async poll(): Promise<void> {
    if (!this.active || this.request) return
    const generation = this.generation, request = this.request = new AbortController()
    this.timeout = setTimeout(() => request.abort(), 10_000)
    try {
      const response = await this.fetcher('/presence', { signal: request.signal, cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) throw new Error('Presence unavailable')
      const snapshot = readPresence(await response.json())
      if (generation !== this.generation) return
      this.snapshot = snapshot
    } catch {
      if (generation !== this.generation) return
      this.snapshot = null
    } finally {
      if (generation === this.generation) {
        clearTimeout(this.timeout); this.request = null
        this.publish()
        if (this.active) this.pollTimer = setTimeout(() => { void this.poll() }, PRESENCE_POLL)
      }
    }
  }
  dispose(): void { this.setActive(false) }
}
