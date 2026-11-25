import { cleanRecipeId, type RecipeId } from '../shared/recipes'
import type { PresenceSnapshot } from '../shared/presence'
/**
 * How many people are playing, across every room: the answer /status gives, so a release is
 * not deployed under anyone (a deploy resets occupied rooms; see docs/CUTOVER.md).
 *
 * Each room reports its number of connected players when it changes, and again every couple
 * of minutes while it has traffic. Only counts are kept: no player names, and room names
 * never leave the server. Reading the totals never wakes a room.
 *
 * How wrong it can be, and in which direction:
 *  - Too high, for up to STALE_MS: a room whose object was reset or evicted (a deploy, a
 *    crash) never said its players left. Its last count stays until the room speaks again or
 *    the entry goes stale. This is the safe direction: /status says "occupied" a little long.
 *  - Too low: only for a room that has had no traffic at all for STALE_MS (every tab frozen
 *    in the background) yet still holds sockets. Nobody in it is playing.
 *  - A report in flight when the totals are read: milliseconds.
 */

/** A room that has not reported for this long is forgotten, ms. */
export const STALE_MS = 10 * 60_000
/** A room with traffic repeats its count at least this often, ms. */
export const REFRESH_MS = 2 * 60_000

export const PRESENCE_REFRESH_MS = 30_000
/**
 * A report that changed only a room's active count is saved to storage at most once per this
 * long for the whole registry, ms: the counts in memory are current at once, and /status, the
 * reason the counts are stored, never reads `active`. With reports of active-only changes
 * bounded per room (server/presenceReporter.ts ACTIVE_REPORT_MS), pausing and resuming
 * anywhere costs the shared registry at most two storage writes a minute. Cost: after an
 * eviction, a planet's active count may be up to this old until its rooms report again.
 */
export const ACTIVE_SAVE_MS = 30_000
/** What a report means for the stored counts: write now, write within ACTIVE_SAVE_MS, nothing. */
export type Durability = 'save' | 'later' | 'none'
export const PRESENCE_TTL_MS = 90_000
export interface RegistryEntry {
  players: number
  at: number
  recipeId?: RecipeId | null
  /** Of `players`, those not paused; absent from rooms that do not report it (read as all). */
  active?: number
}

export interface Totals {
  /** Rooms with at least one connected player. */
  rooms: number
  /** Connected players in all of them. */
  players: number
}

export class RoomRegistry {
  /** Room name to its last reported count and when (ms). */
  private readonly entries = new Map<string, RegistryEntry>()

  constructor(saved?: Record<string, RegistryEntry>) {
    for (const [room, e] of Object.entries(saved ?? {})) {
      if (e && Number.isInteger(e.players) && e.players > 0 && Number.isFinite(e.at)) this.entries.set(room, { players: e.players, at: e.at, recipeId: cleanRecipeId(e.recipeId), ...activeOf(e.active, e.players) })
    }
  }

  /**
   * A room says how many players are connected, and how many of them are not paused (`active`,
   * optional: older rooms do not say, and then all count as active). Zero forgets the room.
   */
  report(room: string, players: number, now: number, recipeId?: unknown, active?: unknown): Durability {
    if (typeof room !== 'string' || !room || room.length > 128) return 'none'
    if (!Number.isInteger(players) || players <= 0) return this.entries.delete(room) ? 'save' : 'none'
    const n = Math.min(players, 1000)
    const before = this.entries.get(room)
    const next: RegistryEntry = { players: n, at: now, recipeId: cleanRecipeId(recipeId), ...activeOf(active, n) }
    this.entries.set(room, next)
    // Only the active count moved: nothing /status depends on. See ACTIVE_SAVE_MS.
    const activeOnly = before !== undefined && before.players === next.players && before.recipeId === next.recipeId &&
      before.active !== next.active && now - before.at < REFRESH_MS
    return activeOnly ? 'later' : 'save'
  }

  totals(now: number): Totals {
    let rooms = 0
    let players = 0
    for (const [room, e] of this.entries) {
      if (now - e.at > STALE_MS) {
        this.entries.delete(room)
        continue
      }
      rooms++
      players += e.players
    }
    return { rooms, players }
  }

  /** Presence expires independently; do not shorten the conservative release status TTL. */
  presence(now: number): PresenceSnapshot {
    this.totals(now) // Prune only after the longer status TTL.
    const groups = new Map<RecipeId | null, PresenceSnapshot['byRecipe'][number]>()
    for (const e of this.entries.values()) {
      if (now - e.at >= PRESENCE_TTL_MS || e.at > now) continue
      const id = cleanRecipeId(e.recipeId)
      const g = groups.get(id) ?? { recipeId: id, rooms: 0, players: 0, active: 0, oldestReportAt: e.at }
      g.rooms++; g.players += e.players; g.active = (g.active ?? 0) + (e.active ?? e.players); g.oldestReportAt = Math.min(g.oldestReportAt, e.at)
      groups.set(id, g)
    }
    return { version: 1, generatedAt: now, ttlMs: PRESENCE_TTL_MS,
      byRecipe: [...groups.values()].sort((a, b) => (a.recipeId ?? '').localeCompare(b.recipeId ?? '')) }
  }

  /** For storage, so the counts survive the registry object being evicted. */
  save(): Record<string, RegistryEntry> {
    return Object.fromEntries(this.entries)
  }
}

/** A reported active count, kept only when it is a whole number from 0 to `players`. */
function activeOf(raw: unknown, players: number): { active?: number } {
  return Number.isInteger(raw) && (raw as number) >= 0 ? { active: Math.min(raw as number, players) } : {}
}
