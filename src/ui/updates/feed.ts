/**
 * Releases and update detection for About and the update banner.
 *
 * The running version is the build's calendar version (vite.config.ts defines __SYN3H_BUILD__
 * from SYN3H_RELEASE_VERSION, which tools/release.sh sets; a dev build carries a git label and
 * has no version, so it never prompts). The latest version is the newest entry in
 * /v/versions.json, which every production deploy writes with the release it ships
 * (tools/frozen-versions.mjs carry). The notes come from /releases.json (tools/release-feed.mjs).
 *
 * Both files are fetched from the site root without a Referer: the Worker serves a pinned
 * (?v=) page's assets by its Referer, and these must describe the live site, not the pin.
 */
import { bareVersion, isNewer, latestVersion } from './version'

declare const __SYN3H_BUILD__: string | undefined

/** One release: its player digest ("- " bullets, '' when it has none) and its full notes on GitHub. */
export interface Release { version: string; date: string; summary: string; digest: string; url: string }

export const FEED_URL = '/releases.json'
export const VERSIONS_URL = '/v/versions.json'

/** This build's version, or null for a dev build. */
export function runningVersion(): string | null {
  return bareVersion(typeof __SYN3H_BUILD__ === 'string' ? __SYN3H_BUILD__ : null)
}

/** The address as the page was entered: the lobby cleans ?v= from the bar while it shows. */
const entrySearch = typeof location === 'undefined' ? '' : location.search
/** The version named by ?v= when this page is a pinned frozen release, else null. */
export function pinnedVersion(search = entrySearch): string | null {
  return bareVersion(new URLSearchParams(search).get('v'))
}

const rootFetch = (url: string) => fetch(url, { cache: 'no-cache', referrerPolicy: 'no-referrer', credentials: 'omit' })

let feed: Promise<Release[]> | undefined
/** The feed, fetched once per session. A failure is not cached, so Retry fetches again. */
export function loadFeed(): Promise<Release[]> {
  feed ??= rootFetch(FEED_URL)
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
    .then((body: { releases?: unknown }) => (Array.isArray(body.releases) ? body.releases : []).filter((r): r is Release =>
      typeof r === 'object' && r !== null && bareVersion((r as Release).version) !== null && typeof (r as Release).summary === 'string'))
  feed.catch(() => { feed = undefined })
  return feed
}

/** The newest version the live site serves, or null when it cannot be read. */
export async function liveVersion(): Promise<string | null> {
  try {
    const response = await rootFetch(VERSIONS_URL)
    if (!response.ok) return null
    const body = await response.json() as { versions?: unknown }
    return Array.isArray(body.versions) ? latestVersion(body.versions) : null
  } catch { return null }
}

const CHECK_EVERY = 10 * 60 * 1000

/**
 * Check for a newer live version shortly after start, every ten minutes while the page is
 * visible and whenever it becomes visible again. Calls `found` once per newer version. Never
 * reloads. Does nothing on a dev build or a pinned page.
 */
export function watchForUpdates(found: (version: string) => void, signal: AbortSignal, first = 4000): void {
  const running = runningVersion()
  if (!running || pinnedVersion()) return
  let reported = running, timer = 0
  const check = async () => {
    clearTimeout(timer)
    if (signal.aborted) return
    if (!document.hidden) {
      const live = await liveVersion()
      if (!signal.aborted && live && isNewer(live, reported)) { reported = live; found(live) }
    }
    if (!signal.aborted) timer = window.setTimeout(check, CHECK_EVERY)
  }
  timer = window.setTimeout(check, first)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check() }, { signal })
  signal.addEventListener('abort', () => clearTimeout(timer))
}
