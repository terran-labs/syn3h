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
 * The feed is emitted into the build and served by the dev server; nothing loads it until a
 * player opens Updates or an update is found. A build for a release (SYN3H_RELEASE_VERSION
 * set, as tools/release.sh does) fails unless that version has a valid digest, so a release
 * never ships without words for its own players.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FEED_FILE = 'releases.json'
const LIMIT = 12
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/
const GITHUB = 'https://github.com/terran-labs/syn3h/releases/tag/'
export const SUMMARY_MAX = 70

const compare = (a, b) => {
  const x = VERSION.exec(a).slice(1).map(Number), y = VERSION.exec(b).slice(1).map(Number)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}
const bare = version => String(version).replace(/^v/, '')

/** The summary line of a published notes file: the first line after its "## Syn3h v…" title. */
export function notesSummary(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const title = lines.findIndex(line => /^#{1,3}\s+Syn3h\s+v?\d/.test(line))
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
  if (!VERSION.test(String(version))) throw new Error(`SYN3H_RELEASE_VERSION "${version}" is not a version like v26.11.1604`)
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
 * The feed. `building` is the version this build is for (SYN3H_RELEASE_VERSION): release.sh
 * writes its history row only after the deploy, so without this a release's own Updates would
 * leave it out. It is listed first, dated now, with its digest, unless history already has it.
 */
export function buildFeed(repo = REPO, limit = LIMIT, building = process.env.SYN3H_RELEASE_VERSION, now = new Date()) {
  const dir = join(repo, 'release-notes', 'releases'), history = join(repo, 'release-notes', 'history.tsv')
  const dates = existsSync(history) ? productionDates(readFileSync(history, 'utf8')) : new Map()
  const files = existsSync(dir) ? readdirSync(dir).filter(name => /^v\d+\.\d+\.\d+\.md$/.test(name)) : []
  const versions = new Set(files.map(name => name.slice(1, -3)))
  if (building && VERSION.test(String(building)) && !dates.has(bare(building))) {
    dates.set(bare(building), pacificStamp(now))
    versions.add(bare(building))
  }
  const releases = [...versions]
    .filter(version => dates.has(version))
    .sort((a, b) => compare(b, a))
    .slice(0, limit)
    .map(version => {
      const digest = readDigest(repo, version)
      const notes = join(dir, `v${version}.md`)
      return {
        version, date: dates.get(version),
        summary: digest?.summary ?? (existsSync(notes) ? notesSummary(readFileSync(notes, 'utf8')) : ''),
        digest: digest?.digest ?? '',
        url: `${GITHUB}v${version}`,
      }
    })
  return { releases }
}

export function releaseFeed() {
  let building = false
  return {
    name: 'syn3h-release-feed',
    configResolved(config) { building = config.command === 'build' },
    buildStart() {
      const version = process.env.SYN3H_RELEASE_VERSION
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
