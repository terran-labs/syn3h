/**
 * The release feed: /releases.json, the most recent production releases for the Updates view
 * in About (src/ui/updates/), newest first.
 *
 * vite.config.ts: plugins: [..., releaseFeed()]
 *
 * Players read the player digest of each release (release-notes/player/v<version>.md: a
 * one-line summary, then two to five bullets; see release-notes/README.md), not the published
 * notes, which are written for the record. A release without a digest shows only the summary
 * line of its notes. Each entry links its full notes on GitHub. Dates come from
 * release-notes/history.tsv; only production releases with a notes file are listed.
 *
 * Channels (ops/RELEASE.md, 25 November 2026). Every release is first a beta at beta.mira.cc and
 * is promoted to production byte for byte, so one feed serves both hosts. Each entry has a
 * channel; a production release carries `betas`, the betas built since the previous production
 * release that were never promoted, oldest first (release-notes/betas.tsv with each beta's own
 * player digest). The version this build is for is listed first with channel "beta" and the feed
 * names it as `build`: the page cannot know at build time whether its bytes will be served as a
 * beta or, once promoted, as production, so the view decides by its hostname (on a production
 * host its own build is production). `changes` lists one line per branch merged into an entry's
 * train (the merged tip's subject and short commit), read from git where the commits are known.
 *
 * The feed is emitted into the build and served by the dev server; nothing loads it until a
 * player opens Updates or an update is found. A build for a release (MIRA_RELEASE_VERSION
 * set, as tools/release.sh does) fails unless that version has a valid digest, so a release
 * never ships without words for its own players.
 */
import './lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FEED_FILE = 'releases.json'
// About 18 days at four releases a day: the view folds each day into one entry.
const LIMIT = 60
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/
const GITHUB = 'https://github.com/terran-labs/syn3h/releases/tag/'
// A beta has no GitHub release (only production is published): link its notes file instead.
const BETA_NOTES = 'https://github.com/terran-labs/syn3h/blob/main/release-notes/releases/'
export const SUMMARY_MAX = 70

const compare = (a, b) => {
  const x = VERSION.exec(a).slice(1).map(Number), y = VERSION.exec(b).slice(1).map(Number)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}
const bare = version => String(version).replace(/^v/, '')

/** The summary line of a published notes file: the first line after its "## Mira v…" title. */
export function notesSummary(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const title = lines.findIndex(line => /^#{1,3}\s+Mira\s+v?\d/.test(line))
  const head = lines.slice(title + 1).map(line => line.trim())
  return head.find(line => line && !/^#/.test(line) && !/^Public release at\b/i.test(line)) ?? ''
}

/** A digest file to { summary, digest }, or a list of what is wrong with it. */
export function parseDigest(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex(line => line.trim())
  const summary = first < 0 ? '' : lines[first].trim()
  const rest = lines.slice(first + 1).filter(line => line.trim())
  const bullets = rest.filter(line => /^- \S/.test(line))
  const problems = []
  if (!summary || summary.startsWith('-') || summary.startsWith('#')) problems.push('the first line must be a one-line summary')
  if (summary.length >= SUMMARY_MAX) problems.push(`the summary must be under ${SUMMARY_MAX} characters (it is ${summary.length})`)
  if (bullets.length < 2 || bullets.length > 5) problems.push(`it needs two to five "- " bullets (it has ${bullets.length})`)
  if (bullets.length !== rest.length) problems.push('after the summary, every line must be a "- " bullet')
  return { summary, digest: bullets.join('\n'), problems }
}

/** Production releases from history.tsv: version to its Pacific time. */
export function productionDates(tsv) {
  const dates = new Map()
  for (const line of tsv.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const [version, , , when, channel] = line.split('\t')
    if (channel?.trim() === 'production' && VERSION.test(version)) dates.set(bare(version), when.trim())
  }
  return dates
}

/** Production releases from history.tsv: version to its commit. */
function productionCommits(tsv) {
  const commits = new Map()
  for (const line of tsv.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const [version, , commit, , channel] = line.split('\t')
    if (channel?.trim() === 'production' && VERSION.test(version) && commit) commits.set(bare(version), commit.trim())
  }
  return commits
}

/** Betas from release-notes/betas.tsv (release.sh --beta): version, milestone, commit, time, frozen id. */
export function readBetas(tsv) {
  const betas = []
  for (const line of tsv.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const [version, , commit, when] = line.split('\t')
    if (VERSION.test(version)) betas.push({ version: bare(version), commit: commit?.trim() ?? '', date: when?.trim() ?? '' })
  }
  return betas
}

/**
 * The branches merged into a train, oldest first: the merged tip's subject and short commit for
 * each merge on the first-parent line between two commits, and each plain commit there (a tip
 * fast-forwarded onto the train). Empty when git or either commit is not available.
 */
const NOT_CHANGES = /^(Record v\d|v\d+\.\d+\.\d+ notes|Notes renamed to v\d|Merge )/
function trainChanges(repo, from, to) {
  if (!to) return []
  try {
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const range = from ? `${from}..${to}` : to
    // Each commit on the first-parent line: a merge stands for the tip it merged; a plain commit
    // (a tip fast-forwarded onto the train) for itself. Release records and notes are not changes.
    const lines = git('log', '--first-parent', '--format=%H %P', range).split('\n').filter(Boolean)
    const tips = lines.map(line => { const [self, , merged] = line.split(' '); return merged ?? self })
    return tips
      .map(tip => ({ title: git('log', '-1', '--format=%s', tip), commit: git('rev-parse', '--short=8', tip) }))
      .filter(c => !NOT_CHANGES.test(c.title))
      .reverse()
  } catch { return [] }
}

const digestPath = (repo, version) => join(repo, 'release-notes', 'player', `v${bare(version)}.md`)

function readDigest(repo, version) {
  const path = digestPath(repo, version)
  if (!existsSync(path)) return null
  const parsed = parseDigest(readFileSync(path, 'utf8'))
  if (parsed.problems.length) throw new Error(`Player digest ${path} is not ready:\n  ${parsed.problems.join('\n  ')}`)
  return parsed
}

/** Throw a clear error unless the version being released has a valid player digest. */
export function requireDigest(version, repo = REPO) {
  if (!VERSION.test(String(version))) throw new Error(`MIRA_RELEASE_VERSION "${version}" is not a version like v26.11.1604`)
  if (!readDigest(repo, version)) {
    throw new Error(`No player digest for v${bare(version)}. Write ${digestPath(repo, version)} before building this release: ` +
      `a summary under ${SUMMARY_MAX} characters, then two to five "- " bullets of what players will notice (release-notes/README.md).`)
  }
}

/** A time as history.tsv writes it: "2026-11-16 13:42 PST", in Pacific time. */
export function pacificStamp(when) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(when).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`
}

/**
 * The feed. `building` is the version this build is for (MIRA_RELEASE_VERSION): release.sh
 * writes its history row only after the deploy, so without this a release's own Updates would
 * leave it out. It is listed first, dated now, with its digest, unless history already has it.
 */
export function buildFeed(repo = REPO, limit = LIMIT, building = process.env.MIRA_RELEASE_VERSION, now = new Date()) {
  const dir = join(repo, 'release-notes', 'releases'), history = join(repo, 'release-notes', 'history.tsv')
  const historyText = existsSync(history) ? readFileSync(history, 'utf8') : ''
  const dates = productionDates(historyText)
  const commits = productionCommits(historyText)
  const betasFile = join(repo, 'release-notes', 'betas.tsv')
  const allBetas = existsSync(betasFile) ? readBetas(readFileSync(betasFile, 'utf8')) : []
  const built = building && VERSION.test(String(building)) ? bare(building) : null
  const files = existsSync(dir) ? readdirSync(dir).filter(name => /^v\d+\.\d+\.\d+\.md$/.test(name)) : []
  const versions = new Set(files.map(name => name.slice(1, -3)))
  const promoted = new Set(dates.keys())
  // This build's own version, until history has its production row: a beta now, perhaps
  // production later with the same bytes (the view decides by hostname).
  const own = built && !promoted.has(built) ? built : null
  if (own) {
    const beta = allBetas.find(b => b.version === own)
    dates.set(own, beta?.date || pacificStamp(now))
    versions.add(own)
  }
  const words = (version) => {
    const digest = readDigest(repo, version)
    const notes = join(dir, `v${version}.md`)
    return { summary: digest?.summary ?? (existsSync(notes) ? notesSummary(readFileSync(notes, 'utf8')) : ''), digest: digest?.digest ?? '' }
  }
  const ordered = [...versions].filter(version => dates.has(version)).sort((a, b) => compare(b, a))
  // Betas never promoted, each under the next release after it (or under this build).
  const unpromoted = allBetas.filter(b => !promoted.has(b.version) && b.version !== own).sort((a, b) => compare(a.version, b.version))
  const releases = ordered.slice(0, limit).map((version, i) => {
    const previous = ordered[i + 1] ?? null
    const commit = version === own ? (built === own ? gitHead(repo) : '') : commits.get(version)
    const previousCommit = previous ? commits.get(previous) : null
    const betas = unpromoted
      .filter(b => compare(b.version, version) < 0 && (!previous || compare(b.version, previous) > 0))
      .map((b, j, list) => ({
        version: b.version, date: b.date, ...words(b.version), url: `${BETA_NOTES}v${b.version}.md`,
        changes: trainChanges(repo, j ? list[j - 1].commit : previousCommit, b.commit),
      }))
    const entry = {
      version, date: dates.get(version), ...words(version),
      url: `${GITHUB}v${version}`,
      channel: version === own ? 'beta' : 'production',
      changes: trainChanges(repo, betas.length ? betas[betas.length - 1].commit || previousCommit : previousCommit, commit),
    }
    if (betas.length) entry.betas = betas
    return entry
  })
  return own ? { build: own, releases } : { releases }
}

function gitHead(repo) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}

export function releaseFeed() {
  let building = false
  return {
    name: 'mira-release-feed',
    configResolved(config) { building = config.command === 'build' },
    buildStart() {
      const version = process.env.MIRA_RELEASE_VERSION
      if (building && version) requireDigest(version)
    },
    configureServer(server) {
      server.middlewares.use(`/${FEED_FILE}`, (_req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-cache')
        res.end(JSON.stringify(buildFeed()))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FEED_FILE, source: JSON.stringify(buildFeed()) + '\n' })
    },
  }
}
