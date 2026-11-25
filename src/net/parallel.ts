/**
 * Parallel universes (the owner, 25 November 2026): "a full public room should take the user to
 * another duplicate planet with the same seed", and players who want their own planet get "Enter a
 * parallel universe with no other players". A parallel universe is an ordinary private room with
 * an unguessable name, entered with the current world's code, so an empty one rebuilds the same
 * planet (seed and world settings included) and anyone with its link joins it. Nothing on the
 * server knows it apart from any other named room: presence counts it under its planet, by number
 * only, and never names it.
 *
 * Moving between rooms is the existing exit and entry flow: a page navigation to the room's entry
 * address (the same address an invite carries) with autoplay. What the next page should say about
 * the move goes across in this tab's sessionStorage, never in the link.
 *
 * Its storage goes when its last player leaves (the room server's own reset), so a parallel
 * universe ends when everyone has left; its link then opens a fresh, empty universe of the planet.
 */
import { DEFAULT_ROOM, canonicalRoom } from '../core/roomAddress'

/** "p-" and 22 base-36 characters: about 113 random bits, within the server's 32-character names. */
const NAME_CHARS = 22
export function parallelRoomName(fill: (bytes: Uint8Array<ArrayBuffer>) => void = bytes => { crypto.getRandomValues(bytes) }): string {
  const bytes = new Uint8Array(NAME_CHARS)
  fill(bytes)
  let name = 'p-'
  for (const b of bytes) name += (b % 36).toString(36)
  return name
}
export const isParallelRoom = (room: string): boolean => /^p-[a-z0-9]{22}$/.test(canonicalRoom(room))

/** Why this page was opened in the room it is in, carried across the navigation. */
export interface RoomMove {
  /** full: refused by a full room and placed here. chosen: the player asked for a universe. still-full: came back here because the room tried was full. returning: trying `asked` from the universe at `back`. */
  reason: 'full' | 'chosen' | 'still-full' | 'returning'
  /** The room the player asked for, which Try again aims at. */
  asked: string
  /** The universe's own address, to come back to if `asked` is full. */
  back?: string
  /** Refusals in a row, to stop rather than chase full rooms (see onRefused). */
  hops: number
  at: number
}
export const MOVE_KEY = 'mira.roomMove'
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const session = (): Store | null => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null } }

/** The move that opened this page, read once and removed: a later reload is not a move. */
export function takeMove(store: Store | null = session(), now = Date.now()): RoomMove | null {
  if (!store) return null
  let raw: string | null = null
  try { raw = store.getItem(MOVE_KEY); store.removeItem(MOVE_KEY) } catch { return null }
  try {
    const m = JSON.parse(raw ?? 'null') as RoomMove | null
    // A stale note (a tab left for long between the two pages) says nothing about this page.
    return m && typeof m.asked === 'string' && typeof m.hops === 'number' && now - m.at < 120_000 ? m : null
  } catch { return null }
}
export function putMove(move: RoomMove, store: Store | null = session()): void {
  try { store?.setItem(MOVE_KEY, JSON.stringify(move)) } catch { /* storage is optional: the move just goes unexplained */ }
}

/** The refusal in a row that stays in local play with bots instead of moving again. */
export const MAX_HOPS = 3

/**
 * Whether this tab can carry a move across a navigation. Without it nothing bounds a chain of
 * moves and the arrival line is lost, and the address cannot carry them instead: it is the link
 * people copy. So without storage a full room means local play, said plainly (ParallelUniverses).
 */
export function storageWorks(store: Store | null = session()): boolean {
  if (!store) return false
  try { store.setItem(MOVE_KEY + '.probe', '1'); const ok = store.getItem(MOVE_KEY + '.probe') === '1'; store.removeItem(MOVE_KEY + '.probe'); return ok } catch { return false }
}

/** What to do when the room this page joined refused us as full. */
export type Refusal =
  | { go: 'universe'; room: string; move: RoomMove }
  | { go: 'back'; url: string; move: RoomMove }
  | { go: 'local' }
/**
 * `arrived`: the move that opened this page; `room`: the room this page asked for. A player who
 * left a universe to try a room that is still full goes back to that same universe, said once;
 * anyone else refused goes to a fresh universe of this world. A fresh room cannot be full, so a
 * chain of refusals means something else is wrong: the MAX_HOPS-th refusal in a row stays in
 * local play.
 */
export function onRefused(arrived: RoomMove | null, room: string, now = Date.now(), name = parallelRoomName): Refusal {
  const hops = (arrived?.hops ?? 0) + 1
  if (hops >= MAX_HOPS) return { go: 'local' }
  if (arrived?.reason === 'returning' && arrived.back) return { go: 'back', url: arrived.back, move: { reason: 'still-full', asked: arrived.asked, hops, at: now } }
  return { go: 'universe', room: name(), move: { reason: 'full', asked: canonicalRoom(room || DEFAULT_ROOM), hops, at: now } }
}

/** The line shown on arriving, or null. */
export function arrivalLine(arrived: RoomMove | null): string | null {
  switch (arrived?.reason) {
    case 'full': return "This world is full, so you're in a parallel universe of it. Invite friends with your link."
    case 'still-full': return arrived.asked === DEFAULT_ROOM ? "The main world is still full, so you're back in your parallel universe." : "That world is still full, so you're back in your parallel universe."
    case 'chosen': return "You're in a parallel universe of this planet. Only people with your link can join."
    default: return null
  }
}
