/**
 * The creator key on this device (server/creator.ts). The owner opens a private link once,
 * https://<host>/#creator=<key>; this module is main.ts's first import, so on that load it runs
 * before any other module reads the address. It stores the key and takes it out of the address
 * bar at once with history.replaceState, so no invite, Copy link, share card, bug report or
 * screenshot of the bar can carry it. A fragment never reaches a server, a referrer or a
 * request log. The key goes only into hello (src/net/index.ts), over the room's wss connection.
 *
 * Storage: localStorage `mira.creatorKey`, which nothing else reads. Never print or log it.
 */
import { localStore } from './safeStorage'

export const CREATOR_KEY_STORAGE = 'mira.creatorKey'
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/

/**
 * Take `creator=<key>` out of an address's fragment. Returns the key, if well formed, and the
 * address without it (the rest of any fragment kept). Pure, for tests.
 */
export function takeCreatorKey(href: string): { key: string | null; href: string } | null {
  const hashAt = href.indexOf('#')
  if (hashAt < 0) return null
  const parts = href.slice(hashAt + 1).split('&')
  const keep: string[] = []
  let key: string | null = null
  let found = false
  for (const part of parts) {
    if (part.startsWith('creator=')) {
      found = true
      const value = decodeURIComponent(part.slice('creator='.length))
      if (KEY_PATTERN.test(value)) key = value
    } else if (part) keep.push(part)
  }
  if (!found) return null
  return { key, href: href.slice(0, hashAt) + (keep.length ? `#${keep.join('&')}` : '') }
}

/** Boot: store a key from the address and remove it from the bar. Safe without storage. */
export function adoptCreatorKeyFromAddress(loc: Pick<Location, 'href'> = location, hist: Pick<History, 'replaceState' | 'state'> = history): void {
  const taken = takeCreatorKey(loc.href)
  if (!taken) return
  // The address is cleaned first, whatever happens to the key.
  try { hist.replaceState(hist.state, '', taken.href) } catch { /* a sandboxed frame: nothing to clean */ }
  if (taken.key) try { localStore()?.setItem(CREATOR_KEY_STORAGE, taken.key) } catch { /* storage full or blocked */ }
}

/** The key this device holds, or null. */
export function creatorKey(): string | null {
  try {
    const v = localStore()?.getItem(CREATOR_KEY_STORAGE) ?? null
    return v && KEY_PATTERN.test(v) ? v : null
  } catch {
    return null
  }
}

/** Settings' "Sign out of creator on this device". The badge goes at the next join. */
export function forgetCreatorKey(): void {
  try { localStore()?.removeItem(CREATOR_KEY_STORAGE) } catch { /* nothing stored */ }
}

if (typeof location !== 'undefined' && typeof history !== 'undefined') adoptCreatorKeyFromAddress()
