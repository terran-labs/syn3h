import { isDefaultRoom, writeRoom } from '../core/roomAddress'
import { recipeOfWorld } from '../core/publicWorlds'

/**
 * The address bar. Keeps what the page was opened with (the entry URL, needed to resume or
 * reload into a world) separate from what the bar shows. No navigation occurs.
 *
 * - Galaxy lobby: the bar has no query at all.
 * - In a world in the public room: no ?room=, and no ?world=, ?planet= or ?seed= either. The
 *   room holds its world for everyone in it, and a reload resumes from the tab's saved session
 *   (src/core/resume.ts), so neither needs the address. The entry URL keeps them for reloads
 *   the game makes itself. Everything else the player typed (?v=, ?wordmark=, ?gfx= and other
 *   flags) stays as typed.
 * - In a world in another room: ?room=<name> plus the entry query, as it is what makes the
 *   room joinable.
 *
 * An old ?room=lobby link is read as the public room and the bar is cleaned at once.
 * A query-based frozen version is restored in play; reloading the cleaned root lobby
 * intentionally requests latest. Frozen pathnames stay intact.
 */
export class LobbyAddress {
  private retained: URL
  private lobby = false
  /** The last address this class wrote, to tell its own writes from a change made in play. */
  private written: string

  constructor(
    private readonly location: Pick<Location, 'href'>,
    private readonly history: Pick<History, 'state' | 'replaceState'>,
  ) {
    this.retained = withoutDefaultRoom(new URL(location.href))
    this.written = location.href
    this.replace(this.retained)
  }

  /** The address to reload or resume into a world with: the entry intent, never ?room=lobby. */
  playURL(): URL {
    if (!this.lobby) this.capture()
    return new URL(this.retained.href)
  }

  showLobby(): void {
    if (!this.lobby) this.capture()
    this.lobby = true
    const clean = new URL(this.retained.href)
    clean.search = ''; clean.hash = ''
    this.replace(clean)
  }

  showPlay(room?: string): void {
    const url = this.playURL()
    if (room !== undefined) writeRoom(url, room)
    this.retained = url
    this.lobby = false
    this.replace(visiblePlayURL(url))
  }

  /** Invite/QR generation must not derive a frozen version from the cleaned bar. */
  inviteURL(room: string, world: string): string {
    return inviteAddress(this.playURL(), room, world)
  }

  /** Someone changed the bar in play (not us): that is the new intent. */
  private capture(): void {
    if (this.location.href !== this.written) this.retained = withoutDefaultRoom(new URL(this.location.href))
  }

  private replace(url: URL): void {
    if (url.href !== this.location.href) this.history.replaceState(this.history.state, '', url.href)
    this.written = this.location.href
  }
}

/** World intent the public room already holds; shown only for other rooms. */
const ROOM_HELD = ['world', 'planet', 'seed']

function withoutDefaultRoom(url: URL): URL {
  if (url.searchParams.has('room') && isDefaultRoom(url.searchParams.get('room'))) url.searchParams.delete('room')
  return url
}

/** What the bar shows in a world. Exported for tests. */
export function visiblePlayURL(entry: URL): URL {
  const url = withoutDefaultRoom(new URL(entry.href))
  if (!url.searchParams.has('room')) for (const key of ROOM_HELD) url.searchParams.delete(key)
  return url
}

/**
 * A link into a room from `entry`'s page: its path, its pinned ?v=, the room (none for the
 * public room) and the world, so an empty room rebuilds the same one.
 */
export function inviteAddress(entry: URL, room: string, world?: string): string {
  // The path with repeated slashes collapsed: "//" alone would read as a link to another host,
  // and an address like https://mira.cc// threw here at startup.
  const url = new URL(entry.pathname.replace(/\/{2,}/g, '/'), entry.origin)
  const version = entry.searchParams.get('v')
  if (version !== null) url.searchParams.set('v', version)
  writeRoom(url, room)
  // A public room is its planet's canonical world (core/publicWorlds.ts): the link names the planet
  // only, so a seed in it would open a parallel universe of that seed instead.
  if (world && isDefaultRoom(room)) { const planet = recipeOfWorld(world); if (planet) url.searchParams.set('planet', planet) }
  else if (world) url.searchParams.set('world', world)
  return url.href
}
