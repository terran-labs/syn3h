import { cleanRecipeId, type RecipeId } from '../shared/recipes'
import type { PresenceSnapshot } from '../shared/presence'
import { REJOIN_GRACE } from '../src/modes/params'
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
export const PRESENCE_TTL_MS = 90_000
export interface RegistryEntry {
  players: number
  at: number
  recipeId?: RecipeId | null
  /** Places held for dropped players (game.rejoin): they occupy seats but are not playing. */
  held?: number
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
      if (e && Number.isInteger(e.players) && e.players >= 0 && Number.isFinite(e.at) && e.players + cleanHeld(e.held) > 0) {
        this.entries.set(room, { players: e.players, at: e.at, recipeId: cleanRecipeId(e.recipeId), ...(cleanHeld(e.held) ? { held: cleanHeld(e.held) } : {}) })
      }
    }
  }

  /**
   * A room says how many players are connected, and how many places it holds for dropped
   * players. Nobody either way forgets the room. A room held only for absent players is kept
   * for seat assignment (assign) but counts as nobody playing in totals and presence.
   */
  report(room: string, players: number, now: number, recipeId?: unknown, held?: unknown): void {
    if (typeof room !== 'string' || !room || room.length > 128) return
    const h = cleanHeld(held)
    if (!Number.isInteger(players) || players < 0 || players + h <= 0) {
      this.entries.delete(room)
      this.seats?.reported(room, Infinity, 0)
    } else {
      const before = this.entries.get(room)
      const next: RegistryEntry = { players: Math.min(players, 1000), at: now, recipeId: cleanRecipeId(recipeId), ...(h ? { held: h } : {}) }
      this.entries.set(room, next)
      this.seats?.reported(room, before ? before.players + (before.held ?? 0) : 0, next.players + h)
    }
  }

  /** Seat assignment for public rooms (see PublicSeats); created on first use. */
  private seats: PublicSeats | null = null

  /** Pick the public room a new arrival should join: see PublicSeats.assign. */
  assign(request: AssignRequest, now: number): string {
    this.seats ??= new PublicSeats()
    return this.seats.assign(request, now, (room) => this.fresh(room, now))
  }

  /** A room's entry if it reported recently enough to trust for seating, else null. */
  private fresh(room: string, now: number): RegistryEntry | null {
    const e = this.entries.get(room)
    return e && now - e.at < ASSIGN_TTL_MS && e.at <= now ? e : null
  }

  totals(now: number): Totals {
    let rooms = 0
    let players = 0
    for (const [room, e] of this.entries) {
      if (now - e.at > STALE_MS) {
        this.entries.delete(room)
        continue
      }
      if (e.players <= 0) continue // Only held places: nobody is playing there.
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
      if (now - e.at >= PRESENCE_TTL_MS || e.at > now || e.players <= 0) continue
      const id = cleanRecipeId(e.recipeId)
      const g = groups.get(id) ?? { recipeId: id, rooms: 0, players: 0, oldestReportAt: e.at }
      g.rooms++; g.players += e.players; g.oldestReportAt = Math.min(g.oldestReportAt, e.at)
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

function cleanHeld(raw: unknown): number {
  return Number.isInteger(raw) && (raw as number) > 0 ? Math.min(raw as number, 1000) : 0
}

/**
 * Public room overflow ("lobby", then "lobby#2", "lobby#3" ...). When the public room is full,
 * the next new arrival is sent to the lowest numbered public room with a free seat, so they
 * meet real people instead of being refused. Off unless the Worker asks (server/worker.ts,
 * PUBLIC_OVERFLOW and the runtime flag); with it off every public arrival goes to "lobby".
 *
 * Overflow rooms live in their own namespace: their names contain "#", which no /ws?room=
 * value can produce (roomName keeps only a-z, 0-9, _ and -). So a room someone named "lobby-2"
 * stays theirs, and an overflow room is reached only through assignment. The Worker tells the
 * room object its name in PUBLIC_ROOM_HEADER, which it strips from every incoming request.
 *
 * The registry is one object and handles one request at a time, so it can hand out seats
 * without two arrivals taking the last one: each assignment reserves a seat for RESERVE_MS,
 * until the room's own report shows the arrival (a rise in its count uses up reservations,
 * oldest first). A room's occupancy is its reported players, its held places while they can
 * still be held (HELD_TTL_MS after the report), and live reservations. Counts older than
 * ASSIGN_TTL_MS are not trusted and read as an empty room: a room reset by a deploy never
 * reports its players leaving.
 *
 * The room is the authority; the registry only guesses. The room enforces its cap
 * (MAX_ROOM_PLAYERS, server/room.ts) and recognises a returning player by their secret, so:
 *  - a returning player (prefer) is always sent back to their room, even when the registry
 *    thinks it full or has lost its memory in a restart. If the room has no place for them it
 *    refuses, and the client's single retry names it (full) and is seated elsewhere;
 *  - a wrong count here costs a refusal (4001), never a seventeenth player. A client told
 *    "full" retries once naming the room, which is skipped for FULL_HINT_MS or until the room
 *    reports, whichever is first. A hint is believed only for a room whose fresh report is
 *    within FULL_HINT_SLACK of the cap, so a hostile client can at most start overflow a few
 *    seats early in a busy room, for a few seconds at a time.
 *
 * Planet balancing is meant to build on this: a later caller may add a recipe to the request
 * and a per-planet cap, filtering candidates in `assign` (the base name and cap already come
 * from the request). Nothing here knows about planets today.
 */
export const PUBLIC_BASE = 'lobby'
/** Public rooms per base: lobby plus lobby#2 ... lobby#64, about 1,000 players. */
export const MAX_PUBLIC_ROOMS = 64
/** The request header in which the Worker names an assigned overflow room to its object. */
export const PUBLIC_ROOM_HEADER = 'x-mira-public-room'
/** A seat handed out is held for its arrival this long, ms. */
export const RESERVE_MS = 10_000
/** Counts older than this are not trusted for seating, ms (rooms with traffic refresh every 30 s). */
export const ASSIGN_TTL_MS = PRESENCE_TTL_MS
/**
 * Held places in a report count as taken only this long after it, ms: a hold lasts
 * REJOIN_GRACE, and a room whose holds run out while it hibernates may not report again.
 */
export const HELD_TTL_MS = (REJOIN_GRACE + 5) * 1000
/** A client's "that room refused me" is believed for at most this long, ms. */
export const FULL_HINT_MS = 5_000
/** ... and only for a room reported within this many seats of the cap. */
export const FULL_HINT_SLACK = 4
/**
 * How long a public arrival is willing to wait for the registry, ms. Best effort, not a
 * deadline: a timer and the registry's answer race, and under load a timer can fire late, so
 * a valid seat that arrives first is used even after this long (a seat beats a bounce; the
 * log says "late"). If the timer wins, an arrival with overflow known to be on is closed with
 * CLOSE_BUSY and retries once, never sent to "lobby" blind, which under a blast would be a
 * crowd at a full room. With overflow off or unknown, it fails open to today's "lobby".
 */
export const ASSIGN_PATIENCE_MS = 1000
/** An isolate trusts the last flag the registry told it (on: busy on failure) this long, ms. */
export const FLAG_TRUST_MS = 60_000
/** An assignment slower than this is logged (assign_slow), ms. */
export const ASSIGN_SLOW_MS = 250
/**
 * After the registry says overflow is off, a Worker isolate sends public arrivals to "lobby"
 * without asking again for this long, ms: with the runtime flag off, almost no join waits on
 * the registry. Turning the flag on therefore reaches every isolate within this time.
 */
export const OFF_CACHE_MS = 15_000

export interface AssignRequest {
  /** The room this tab was assigned before (a reconnect, a reload): it goes back there. */
  prefer?: string | null
  /** A room that just refused this tab as full: skipped for a few seconds (FULL_HINT_MS). */
  full?: string | null
  /** Seats per room (the room's own cap). */
  cap: number
  /** Family of public rooms, default PUBLIC_BASE. */
  base?: string
  /**
   * False while overflow is switched off: draining. No new arrival is assigned anywhere but
   * the base room, yet a returning player still goes back to an overflow room that exists,
   * so people already there keep their seats. Default true.
   */
  open?: boolean
}

/** The public room names of a base, in fill order. */
export function publicRooms(base = PUBLIC_BASE): string[] {
  return Array.from({ length: MAX_PUBLIC_ROOMS }, (_, i) => (i === 0 ? base : `${base}#${i + 1}`))
}

/** True for a name assign could have handed out for `base`. */
export function isPublicRoom(name: unknown, base = PUBLIC_BASE): name is string {
  if (typeof name !== 'string') return false
  if (name === base) return true
  const m = name.startsWith(`${base}#`) ? /^([2-9]|[1-9][0-9])$/.exec(name.slice(base.length + 1)) : null
  return !!m && Number(m[1]) <= MAX_PUBLIC_ROOMS
}

class PublicSeats {
  /** Room to the times (ms) of its live reservations, oldest first. */
  private readonly reserved = new Map<string, number[]>()
  /** Rooms a client reported full, to when that stops being believed (ms). */
  private readonly refused = new Map<string, number>()

  /** A room reported: it overrides any hint, and a rise in occupancy uses up reservations. */
  reported(room: string, before: number, after: number): void {
    this.refused.delete(room)
    const r = this.reserved.get(room)
    if (!r) return
    if (after === 0) { this.reserved.delete(room); return }
    if (after > before) r.splice(0, after - before)
    if (!r.length) this.reserved.delete(room)
  }

  assign(request: AssignRequest, now: number, entry: (room: string) => RegistryEntry | null): string {
    const base = request.base ?? PUBLIC_BASE
    const cap = request.cap
    const live = (room: string): number => {
      const r = this.reserved.get(room)
      if (!r) return 0
      while (r.length && now - r[0] >= RESERVE_MS) r.shift()
      if (!r.length) this.reserved.delete(room)
      return r.length
    }
    const reported = (room: string): number => {
      const e = entry(room)
      return e ? e.players + (now - e.at < HELD_TTL_MS ? e.held ?? 0 : 0) : 0
    }
    const occupied = (room: string): number => reported(room) + live(room)
    const refused = (room: string): boolean => {
      const until = this.refused.get(room)
      if (until === undefined) return false
      if (now < until) return true
      this.refused.delete(room)
      return false
    }
    const take = (room: string): string => {
      if (occupied(room) < cap) {
        const r = this.reserved.get(room) ?? []
        r.push(now)
        this.reserved.set(room, r)
      }
      return room
    }
    const full = isPublicRoom(request.full, base) ? request.full : null
    // Coming back to a room that is still live (a fresh report of players, or of holds that can
    // still be held; counts survive a restart in storage): the room decides (its cap, the
    // player's secret). A room that has emptied, or holds only expired places, is not
    // recreated for one player: a fresh assignment instead. Same presence test as occupancy.
    const prefer = isPublicRoom(request.prefer, base) && request.prefer !== full && (request.prefer === base || reported(request.prefer) > 0) ? request.prefer : null
    if (request.open === false) return prefer ?? base
    if (full && reported(full) >= cap - FULL_HINT_SLACK) this.refused.set(full, now + FULL_HINT_MS)
    if (prefer) return take(prefer)
    for (const room of publicRooms(base)) {
      if (room !== full && !refused(room) && occupied(room) < cap) return take(room)
    }
    // Every public room is full: today's behaviour, the room refuses and the client copes.
    return base
  }
}
