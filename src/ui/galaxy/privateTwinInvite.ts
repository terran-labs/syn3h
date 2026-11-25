import { canonicalRoom } from '../../core/roomAddress'
import { isParallelRoom, parallelRoomName } from '../../net/parallel'

interface PrivateTwinInvite { room: string; world: string }

function readInvite(key: string): PrivateTwinInvite | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const invite = JSON.parse(raw) as Partial<PrivateTwinInvite> | null
    if (typeof invite?.room === 'string' && invite.room === canonicalRoom(invite.room) &&
        isParallelRoom(invite.room) && typeof invite.world === 'string' && invite.world.trim()) {
      return { room: invite.room, world: invite.world }
    }
  } catch { /* Storage may be unavailable or the record unreadable. */ }
  return null
}

/** Open the invite created by this browser's private tap for this recipe. */
export function privateTwinURL(recipeId: string, worldCode: string, roomURL: (room: string) => URL): URL {
  const key = `mira.privateTwinInvite.v1.${recipeId}`
  const saved = readInvite(key)
  const invite = saved ?? { room: parallelRoomName(), world: worldCode }
  const url = roomURL(invite.room)
  url.searchParams.set('world', invite.world)
  if (!saved) {
    // Store only the local invite, so each tap builds its URL from the current entry address.
    try { localStorage.setItem(key, JSON.stringify(invite)) } catch { /* The invite still opens. */ }
  }
  return url
}
