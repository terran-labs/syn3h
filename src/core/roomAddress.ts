/**
 * How a room appears in an address and in words.
 *
 * The public room was one room called "lobby" on the wire and in storage; older frozen clients
 * still join it. Current clients join a public room per planet, "public-<recipe>"
 * (core/publicWorlds.ts), and never "lobby". People never see that name: an address for the
 * public room carries no ?room= at all, and the interface calls it the public room. Any other
 * room keeps ?room=<name>, which is what makes it joinable.
 */

/** The public room's internal name. Protocol only; never shown or written into an address. */
export const DEFAULT_ROOM = 'lobby'

/** The server's room name rules (server/util.ts roomName): one room, however it is typed. */
export const canonicalRoom = (room: string): string =>
  room.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || DEFAULT_ROOM

/**
 * True for a public room: no room at all, old links that said ?room=lobby, and a planet's public
 * room by its internal name, "public-<recipe>" (core/publicWorlds.ts). None is ever written into
 * an address. DEFAULT_ROOM stays the sentinel for "the public room of whichever planet".
 */
export const isDefaultRoom = (room: string | null | undefined): boolean => !room?.trim() || canonicalRoom(room) === DEFAULT_ROOM || /^public-[a-z0-9]+$/.test(canonicalRoom(room))

/** The room an address asks for. No ?room= means the public room. */
export function roomFromQuery(query: URLSearchParams): string {
  return query.get('room')?.trim().slice(0, 64) || DEFAULT_ROOM
}

/** Write `room` into `url`: the public room is written as no parameter. Returns `url`. */
export function writeRoom(url: URL, room: string): URL {
  if (isDefaultRoom(room)) url.searchParams.delete('room'); else url.searchParams.set('room', room)
  return url
}

/** The room in words for people: "Public room" for the default, otherwise its name. */
/** A parallel universe (net/parallel.ts, "p-" and 22 random characters) is never named in words. */
export const roomLabel = (room: string): string => isDefaultRoom(room) ? 'Public room' : /^p-[a-z0-9]{22}$/.test(canonicalRoom(room)) ? 'Parallel universe' : room
