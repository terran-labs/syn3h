/** Short notice text, sized for a one-line toast on a phone. */

import { isDefaultRoom } from '../core/roomAddress'
import { isParallelRoom } from '../net/parallel'
export { DEFAULT_ROOM } from '../core/roomAddress'

/** Shorten `text` to at most `max` characters by cutting from the middle, keeping both ends. */
export function middleTruncate(text: string, max = 20): string {
  if (text.length <= max) return text
  const keep = max - 1, head = Math.ceil(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`
}

/** "Joined as Name" in the public room, else "Joined room <room> as Name" with a long room name shortened. */
export function joinedText(room: string, name: string | undefined): string {
  const who = name ?? 'a player'
  // A parallel universe's name is a long random string, never something to read (net/parallel.ts).
  return isDefaultRoom(room) ? `Joined as ${who}` : isParallelRoom(room) ? `Joined your parallel universe as ${who}` : `Joined room ${middleTruncate(room)} as ${who}`
}
