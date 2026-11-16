/**
 * The release feed: /releases.json, the most recent production releases with their notes,
 * newest first, for the Updates view in About (src/ui/updates/).
 *
 * vite.config.ts: plugins: [..., releaseFeed()]
 *
 * Built from release-notes/releases/v*.md and the dates in release-notes/history.tsv. It is
 * emitted into the build and served by the dev server; nothing loads it until a player opens
 * Updates (or an update is found and the banner wants its summary). Only production releases
 * that have a notes file are listed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FEED_FILE = 'releases.json'
const LIMIT = 12
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

const compare = (a, b) => {
  const x = VERSION.exec(a).slice(1).map(Number), y = VERSION.exec(b).slice(1).map(Number)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/**
 * One notes file to { summary, notes }. The file starts with an "(AI Generated)" line, a
 * "## Syn3h v…" title, a one-line summary and a "Public release at …" line; the notes are
 * everything from the first section heading on.
 */
export function parseNotes(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const title = lines.findIndex(line => /^#{1,3}\s+Syn3h\s+v?\d/.test(line))
  const first = lines.findIndex((line, i) => i > title && /^#{2,6}\s/.test(line))
  const head = lines.slice(title + 1, first < 0 ? lines.length : first).map(line => line.trim()).filter(Boolean)
  const summary = head.find(line => !/^Public release at\b/i.test(line)) ?? ''
  const notes = first < 0 ? '' : lines.slice(first).join('\n').trim()
  return { summary, notes }
}

/** Production releases from history.tsv: version to its Pacific time. */
export function productionDates(tsv) {
  const dates = new Map()
  for (const line of tsv.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const [version, , , when, channel] = line.split('\t')
    if (channel?.trim() === 'production' && VERSION.test(version)) dates.set(version.replace(/^v/, ''), when.trim())
  }
  return dates
}

export function buildFeed(repo = REPO, limit = LIMIT) {
  const dir = join(repo, 'release-notes', 'releases'), history = join(repo, 'release-notes', 'history.tsv')
  const dates = existsSync(history) ? productionDates(readFileSync(history, 'utf8')) : new Map()
  const files = existsSync(dir) ? readdirSync(dir).filter(name => /^v\d+\.\d+\.\d+\.md$/.test(name)) : []
  const releases = files
    .map(name => name.slice(1, -3))
    .filter(version => dates.has(version))
    .sort((a, b) => compare(b, a))
    .slice(0, limit)
    .map(version => ({ version, date: dates.get(version), ...parseNotes(readFileSync(join(dir, `v${version}.md`), 'utf8')) }))
  return { releases }
}

export function releaseFeed() {
  return {
    name: 'syn3h-release-feed',
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
