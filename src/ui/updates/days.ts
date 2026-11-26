/**
 * The Updates view's model: the release feed (/releases.json, tools/release-feed.mjs) grouped
 * into one entry per day, the way Freed's changelog groups a day's builds under one card.
 *
 * A day comes from the version alone. v26.11.2503 is the fourth release of 25 November 2026
 * on the owner's Pacific calendar, wherever the player is and whenever it was promoted. The
 * viewer's clock and time zone are never read here.
 *
 * Beta and production (ops/RELEASE.md): a beta ships to beta.mira.cc with its own version and
 * is promoted to production unchanged, so a production release keeps its beta's version. The
 * feed may carry, per release, `channel`, `betas` (the betas built since the previous production
 * release that were not promoted) and `changes` (the branches merged into it, by commit). All
 * three are optional: today's feed has none of them and renders as days of releases. When they
 * arrive, each release gains a nested list of its betas and changes.
 *
 * One feed serves both hosts. The feed is baked into the build and a beta's bytes are promoted
 * unchanged, so the build's own version is listed with channel "beta" and named as `build`; the
 * page decides by its hostname. On a beta host it is the beta; on mira.cc the same entry is the
 * production release it was promoted to, with no beta label and its GitHub release link.
 *
 * Everything here is pure so the invariants can be tested without a browser
 * (tests/ui/updates.test.ts); about.ts renders exactly what it returns.
 */
import { bareVersion, compareVersions, isNewer } from './version'

/** A merged change inside a release: a commit, or a pull request if the repository adopts them. */
export interface Change { title: string; commit?: string; pr?: number }

/** One release: its player digest ("- " bullets, '' when it has none) and its full notes on GitHub. */
export interface Release {
  version: string; date: string; summary: string; digest: string; url: string
  channel?: 'production' | 'beta'
  betas?: Release[]
  changes?: Change[]
}

/**
 * The channel a page is served on, from its hostname alone. Copied from feat/beta-channel
 * (shared/channel.ts, channelOf), which is not on main yet: when it lands, import it from there.
 */
export type Channel = 'beta' | 'production'
export function channelOf(hostname: string): Channel {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  return host.startsWith('beta.') || host.endsWith('.workers.dev') ? 'beta' : 'production'
}

export const REPO_URL = 'https://github.com/terran-labs/syn3h'
export const RELEASES_URL = `${REPO_URL}/releases`
/** The GitHub release for one version. Built from the version, so a link never points at another release's tag. */
export const releaseHref = (version: string): string => `${RELEASES_URL}/tag/v${bareVersion(version) ?? version}`
/**
 * A beta has no GitHub release (only production is published): it links its notes file. The
 * feed's own link is used when it is a page of this repository that names this version, else the
 * notes file's usual address.
 */
export function betaHref(version: string, url?: string): string {
  const bare = bareVersion(version) ?? version
  if (url && url.startsWith(`${REPO_URL}/`) && url.includes(`v${bare}`) && !/[\s"'<>]/.test(url)) return url
  return `${REPO_URL}/blob/main/release-notes/releases/v${bare}.md`
}
const COMMIT = /^[0-9a-f]{7,40}$/i
/** A change's page on GitHub: its pull request when it has one, else its commit, else nothing. */
export function changeHref(change: Change): string | null {
  if (typeof change.pr === 'number' && Number.isInteger(change.pr) && change.pr > 0) return `${REPO_URL}/pull/${change.pr}`
  if (change.commit && COMMIT.test(change.commit)) return `${REPO_URL}/commit/${change.commit}`
  return null
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function parseChanges(value: unknown): Change[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((c): Change[] => {
    if (typeof c !== 'object' || c === null) return []
    const title = str((c as Change).title).trim()
    if (!title) return []
    const change: Change = { title }
    const commit = str((c as Change).commit).trim(); if (COMMIT.test(commit)) change.commit = commit
    const pr = (c as Change).pr; if (typeof pr === 'number' && Number.isInteger(pr) && pr > 0) change.pr = pr
    return [change]
  })
}

function parseRelease(value: unknown, nested: boolean, build: string | null, host: Channel): Release | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  const version = bareVersion(r.version)
  if (!version) return null
  const release: Release = {
    version, date: str(r.date).trim(), summary: str(r.summary).trim(), digest: str(r.digest),
    url: str(r.url).trim(),
  }
  if (nested) release.channel = 'beta'
  // This build's own entry is whatever the host serving it says; the rest are as the feed says.
  else if (version === build) release.channel = host
  else if (r.channel === 'beta' || r.channel === 'production') release.channel = r.channel
  const changes = parseChanges(r.changes); if (changes.length) release.changes = changes
  // Betas nest one level only: a beta does not contain betas.
  if (!nested && Array.isArray(r.betas)) {
    const betas = r.betas.map(b => parseRelease(b, true, build, host)).filter((b): b is Release => b !== null)
      .sort((a, b) => compareVersions(b.version, a.version))
    if (betas.length) release.betas = betas
  }
  return release
}

/**
 * The feed's body to releases, newest first, as seen from `hostname` (the page's own). Anything
 * malformed is dropped, never thrown.
 */
export function parseFeed(body: unknown, hostname = ''): Release[] {
  const feed = typeof body === 'object' && body !== null ? body as { releases?: unknown; build?: unknown } : {}
  const list = feed.releases
  if (!Array.isArray(list)) return []
  const build = bareVersion(feed.build), host = channelOf(hostname)
  const seen = new Set<string>()
  return list.map(r => parseRelease(r, false, build, host))
    .filter((r): r is Release => r !== null && !seen.has(r.version) && (seen.add(r.version), true))
    .sort((a, b) => compareVersions(b.version, a.version))
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The Pacific day a version was cut: v26.11.2503 to 2026-11-25. Null for anything else. */
export function versionDay(version: string): { year: number; month: number; day: number; key: string } | null {
  const bare = bareVersion(version)
  if (!bare) return null
  const [yy, month, build] = bare.split('.').map(Number)
  const day = Math.floor(build / 100), year = 2000 + yy
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day, key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
}

/** The feed's Pacific clock text, "2026-11-25 13:27 PST", to "1:27pm"; prefixed with the date when it is not `dayKey`. */
export function releaseTime(date: string, dayKey?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(date)
  if (!m) return date
  const time = m[4] === undefined ? '' : `${Number(m[4]) % 12 || 12}:${m[5]}${Number(m[4]) < 12 ? 'am' : 'pm'}`
  // A beta promoted on a later day keeps its version's day; say when it actually went out.
  if (dayKey && `${m[1]}-${m[2]}-${m[3]}` !== dayKey) {
    const on = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]?.slice(0, 3) ?? ''}`
    return time ? `${on}, ${time}` : on
  }
  return time
}

export interface ReleaseEntry {
  release: Release
  time: string
  href: string
  playing: boolean
  isNew: boolean
  /** A beta, labelled as one and linked to its notes file rather than a GitHub release. */
  beta: boolean
  /** Starts open: only the newest release of the newest day. */
  open: boolean
  betas: ReleaseEntry[]
  changes: { title: string; href: string | null }[]
}

export interface DayEntry {
  key: string
  /** "25 November", with the year when it is not the newest day's year. */
  label: string
  summary: string
  count: string
  /** The running version is this day's, or one of its releases' betas. */
  playing: boolean
  /** Something on this day is newer than the running version. */
  isNew: boolean
  expanded: boolean
  releases: ReleaseEntry[]
}

export interface UpdatesPlan { days: DayEntry[]; empty: string | null }

export const EMPTY_LINE = 'No release notes yet.'

/** A collapsed day's line: its two newest headlines, joined. */
export function daySummary(releases: readonly Release[]): string {
  return releases.map(r => r.summary).filter(Boolean).slice(0, 2).join(' · ')
}

function entry(release: Release, dayKey: string, running: string | null, open: boolean): ReleaseEntry {
  const beta = release.channel === 'beta'
  return {
    release, open, beta,
    time: releaseTime(release.date, dayKey),
    href: beta ? betaHref(release.version, release.url) : releaseHref(release.version),
    playing: running !== null && release.version === running,
    isNew: running !== null && isNewer(release.version, running),
    betas: (release.betas ?? []).map(b => entry(b, versionDay(b.version)?.key ?? dayKey, running, false)),
    changes: (release.changes ?? []).map(c => ({ title: c.title, href: changeHref(c) })),
  }
}

/**
 * The whole view: one entry per Pacific day, newest first, the newest day expanded with its
 * newest release open. `running` is this build's version (null on a dev build).
 */
export function planUpdates(releases: readonly Release[], running: string | null): UpdatesPlan {
  const byDay = new Map<string, { day: NonNullable<ReturnType<typeof versionDay>>; releases: Release[] }>()
  for (const release of releases) {
    const day = versionDay(release.version)
    if (!day) continue
    const group = byDay.get(day.key) ?? { day, releases: [] }
    group.releases.push(release); byDay.set(day.key, group)
  }
  const groups = [...byDay.values()].sort((a, b) => (a.day.key < b.day.key ? 1 : -1))
  if (!groups.length) return { days: [], empty: EMPTY_LINE }
  const newestYear = groups[0].day.year
  const days = groups.map((group, index): DayEntry => {
    const list = [...group.releases].sort((a, b) => compareVersions(b.version, a.version))
    const releaseEntries = list.map((r, i) => entry(r, group.day.key, running, index === 0 && i === 0))
    const all = releaseEntries.flatMap(r => [r, ...r.betas])
    const n = list.length, betas = list.reduce((sum, r) => sum + (r.betas?.length ?? 0), 0)
    return {
      key: group.day.key,
      label: `${group.day.day} ${MONTHS[group.day.month - 1]}${group.day.year === newestYear ? '' : ` ${group.day.year}`}`,
      summary: daySummary(list),
      count: `${n} ${n === 1 ? 'release' : 'releases'}${betas ? ` · ${betas} ${betas === 1 ? 'beta' : 'betas'}` : ''}`,
      playing: all.some(r => r.playing),
      isNew: all.some(r => r.isNew),
      expanded: index === 0,
      releases: releaseEntries,
    }
  })
  return { days, empty: null }
}

/**
 * Older history (the owner, 26 November 2026: "I should have the ability to" scroll back to the
 * first release). /releases.json carries the newest releases only; when there are more it names
 * a second file, `older`, with the rest. Nothing fetches that file until the player presses Show
 * more (about.ts), so the first load stays small. Only a root-relative .json path is accepted.
 */
export function olderUrl(body: unknown): string | null {
  const value = typeof body === 'object' && body !== null ? (body as { older?: unknown }).older : undefined
  return typeof value === 'string' && /^\/[a-z0-9][a-z0-9._/-]*\.json$/i.test(value) && !value.includes('..') ? value : null
}

/** How many more days each press of Show more reveals. */
export const DAY_STEP = 7

/**
 * The days that may be shown: all of them when the history is complete, else all but the oldest,
 * which may be cut in two by the end of the file and would show a day with releases missing.
 */
export function completeDays(days: readonly DayEntry[], more: boolean): DayEntry[] {
  return more && days.length > 1 ? days.slice(0, -1) : [...days]
}

/**
 * Show more, as a model: which days are shown, whether the older file must be fetched before the
 * next step, and when the history is exhausted. about.ts renders it; the tests drive it to the
 * first release.
 */
export class DayPager {
  private releases: Release[]
  /** The older history file still to fetch, or null once fetched (or when there is none). */
  older: string | null
  shown: number
  constructor(recent: readonly Release[], older: string | null, private readonly running: string | null) {
    this.releases = [...recent]; this.older = older
    this.shown = this.days().length
  }
  /** Every day that may be shown now, newest first (complete days only while more history waits). */
  days(): DayEntry[] { return completeDays(planUpdates(this.releases, this.running).days, this.older !== null) }
  /** The next press needs the older file first. */
  get needsOlder(): boolean { return this.shown >= this.days().length && this.older !== null }
  /** The older releases arrived: merge them; the file is not fetched again. */
  addOlder(past: readonly Release[]): void {
    this.releases = parseFeed({ releases: [...this.releases, ...past] }); this.older = null
  }
  /** The next DAY_STEP days, closed, and marks them shown. */
  next(): DayEntry[] {
    const step = this.days().slice(this.shown, this.shown + DAY_STEP).map(day => ({ ...day, expanded: false }))
    this.shown += step.length
    return step
  }
  /** Nothing older to show or fetch. */
  get done(): boolean { return this.shown >= this.days().length && this.older === null }
  /** The oldest release known. */
  get first(): Release | undefined { return this.releases.at(-1) }
}
