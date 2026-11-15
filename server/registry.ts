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

export interface Totals {
  /** Rooms with at least one connected player. */
  rooms: number
  /** Connected players in all of them. */
  players: number
}

export class RoomRegistry {
  /** Room name to its last reported count and when (ms). */
  private readonly entries = new Map<string, { players: number; at: number }>()

  constructor(saved?: Record<string, { players: number; at: number }>) {
    for (const [room, e] of Object.entries(saved ?? {})) {
      if (e && Number.isInteger(e.players) && e.players > 0 && Number.isFinite(e.at)) this.entries.set(room, { players: e.players, at: e.at })
    }
  }

  /** A room says how many players are connected. Zero forgets the room. */
  report(room: string, players: number, now: number): void {
    if (typeof room !== 'string' || !room || room.length > 128) return
    if (!Number.isInteger(players) || players <= 0) this.entries.delete(room)
    else this.entries.set(room, { players: Math.min(players, 1000), at: now })
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

  /** For storage, so the counts survive the registry object being evicted. */
  save(): Record<string, { players: number; at: number }> {
    return Object.fromEntries(this.entries)
  }
}
