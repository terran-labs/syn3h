/**
 * The release feed: /releases.json, the most recent production releases for the Updates view
 * in About (src/ui/updates/), newest first.
 * /releases-older.json holds every older production release back to the first, fetched only
 * when a player presses Show more; /releases.json names it in `older` when it exists.
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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { bannedWords } from './lib/public-words.mjs'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FEED_FILE = 'releases.json'
/** Every older production release, back to the first: fetched only when a player presses Show more. */
export const OLDER_FILE = 'releases-older.json'
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
 * The commit graph the feed needs, read with one `git log` from every commit it names: each
 * commit's parents, short hash and subject. Commits missing from the repository are left out
 * (--ignore-missing). Empty when git is not available.
 */
function readGraph(repo, commits) {
  const graph = new Map()
  const starts = [...new Set(commits.filter(Boolean))]
  if (!starts.length) return graph
  try {
    const out = execFileSync('git', ['log', '--ignore-missing', '--abbrev=8', '--format=%H%x09%P%x09%h%x09%s', ...starts, '--'],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 })
    for (const line of out.split('\n')) {
      if (!line) continue
      const [hash, parents, short, ...subject] = line.split('\t')
      graph.set(hash, { parents: parents ? parents.split(' ') : [], short, subject: subject.join('\t') })
    }
  } catch { /* no git: no changes listed */ }
  return graph
}

/** A commit's full hash in the graph, from a full or abbreviated one; null when absent. */
function findCommit(graph, commit) {
  if (!commit) return null
  if (graph.has(commit)) return commit
  for (const hash of graph.keys()) if (hash.startsWith(commit)) return hash
  return null
}

/**
 * The branches merged into a train, oldest first: the merged tip's subject and short commit for
 * each merge on the first-parent line between two commits, and each plain commit there (a tip
 * fast-forwarded onto the train). Empty when either commit is not in the graph. The same answer
 * as `git log --first-parent from..to`, worked out from the graph read once (readGraph).
 */
const NOT_CHANGES = /^(Record v\d|v\d+\.\d+\.\d+ notes|Notes renamed to v\d|Merge )/
/**
 * Subjects that are not for players: tools, checks, tests, records and paths. The Changes list
 * shows players what changed in the game, and on 25 Nov about half of it was this. Errs toward
 * dropping: a player-facing change worded like one of these is left out, never a tool shown.
 */
const NOT_FOR_PLAYERS = [
  /^[\w?=.\/-]*[-.\/=?][\w.\/-]*\s*:/, // "release.sh:", "creator-key:", "about-updates:", "?frameProbe=1:"
  /\b(tools|tests|src|docs|ops|scripts)\//i, // a path
  /\.(mjs|cjs|js|ts|sh|py|md|tsv|json|toml|css|html)\b/i, // a file name
  /^(Runbook|STATE|Shorter summary|Water tools|Stop the old|Remove a stray|Type the|Shade the reference|Prototype|Pin graphics|Require the|Verify|Settle the|Keep the Apache|Record|Measure|Ask what|Wait for|Assert|Check|Document|Correct|Digest|Notes|Names|Hand fixes|Dev server|Release feed|Heavy|Mark today|Identify|Compare|Calibrate|Fit|Exercise|Leave World|Let the|Make the|Attribute|Include|Finish the|Add the|Add tools|Address switch)\b/i,
  /\b(tests?|checks?|checker|probe|harness|fixtures?|diagnostics?|trace|reports?|evidence|smoke|suite|typecheck|asserts?|measured|calibrat\w*|benchmark|ledger|notes|digest|README|documents?|rename\w*|Worker|R2|frozen|release\w*|betas?|deploy\w*|hosted|heavy|analytics|switch(es)?|pilot|trial|replay|sweep|rolls? back|rollback|keep-list|kept|CI|tested|auditing|measurements?|reference|alias(es)?|runbook|bytecode|prototype|summary line|attribution)\b/i,
  /\bwindow\.\w+/, // a page global, named for tools
  /^Updates feed\b/i, // the feed's own plumbing (one such subject also says a hidden word exists)
  /\b(built|dist|plugins?|tracked|bundle\w*|chunks?|hash(ed)?|vite|wasm|webassembly|shim)\b|<hash>/i, // how the build works
]
/** Whether a commit subject belongs in the players' Changes list. */
export function forPlayers(title) {
  return !NOT_CHANGES.test(title) && !NOT_FOR_PLAYERS.some(re => re.test(title)) && bannedWords(title).length === 0
}
function trainChanges(graph, from, to) {
  const head = findCommit(graph, to)
  if (!head) return []
  const base = from ? findCommit(graph, from) : null
  if (from && !base) return []
  // Everything reachable from `from`, which the range excludes.
  const excluded = new Set()
  for (const stack = base ? [base] : []; stack.length;) {
    const hash = stack.pop()
    if (excluded.has(hash)) continue
    excluded.add(hash)
    for (const parent of graph.get(hash)?.parents ?? []) if (graph.has(parent)) stack.push(parent)
  }
  // Each commit on the first-parent line: a merge stands for the tip it merged; a plain commit
  // (a tip fast-forwarded onto the train) for itself. Release records and notes are not changes.
  const tips = []
  for (let hash = head; hash && graph.has(hash) && !excluded.has(hash); hash = graph.get(hash).parents[0]) {
    tips.push(graph.get(hash).parents[1] ?? hash)
  }
  return tips
    .filter(tip => graph.has(tip))
    .map(tip => ({ title: graph.get(tip).subject, commit: graph.get(tip).short }))
    .filter(c => forPlayers(c.title))
    .reverse()
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
 * The feed: /releases.json, the newest `limit` releases, and /releases-older.json, every older
 * production release back to the first (the owner, 25 Nov 2026: "Show more"), or null when
 * there is none. The recent file names the older one in `older` only when it exists. Both get
 * the same fields, the same Changes filter and the same banned-word failure.
 * `building` is the version this build is for (MIRA_RELEASE_VERSION): release.sh writes its
 * history row only after the deploy, so without this a release's own Updates would leave it
 * out. It is listed first, dated now, with its digest, unless history already has it.
 */
export function buildFeeds(repo = REPO, limit = LIMIT, building = process.env.MIRA_RELEASE_VERSION, now = new Date()) {
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
  const ownHead = own ? gitHead(repo) : ''
  const graph = readGraph(repo, [...commits.values(), ...allBetas.map(b => b.commit), ownHead])
  // Betas never promoted, each under the next release after it (or under this build).
  const unpromoted = allBetas.filter(b => !promoted.has(b.version) && b.version !== own).sort((a, b) => compare(a.version, b.version))
  const entries = ordered.map((version, i) => {
    const previous = ordered[i + 1] ?? null
    const commit = version === own ? ownHead : commits.get(version)
    const previousCommit = previous ? commits.get(previous) : null
    const betas = unpromoted
      .filter(b => compare(b.version, version) < 0 && (!previous || compare(b.version, previous) > 0))
      .map((b, j, list) => ({
        version: b.version, date: b.date, ...words(b.version), url: `${BETA_NOTES}v${b.version}.md`,
        changes: trainChanges(graph, j ? list[j - 1].commit : previousCommit, b.commit),
      }))
    const entry = {
      version, date: dates.get(version), ...words(version),
      url: `${GITHUB}v${version}`,
      channel: version === own ? 'beta' : 'production',
      changes: trainChanges(graph, betas.length ? betas[betas.length - 1].commit || previousCommit : previousCommit, commit),
    }
    if (betas.length) entry.betas = betas
    return entry
  })
  const releases = entries.slice(0, limit), rest = entries.slice(limit)
  const recent = own ? { build: own, releases } : { releases }
  if (rest.length) recent.older = `/${OLDER_FILE}`
  const older = rest.length ? { releases: rest } : null
  // Nothing banned reaches players in any field of either file: the build fails instead
  // (public-words.mjs).
  for (const [name, feed] of [[FEED_FILE, recent], [OLDER_FILE, older]]) {
    const banned = feed ? bannedWords(JSON.stringify(feed)) : []
    if (banned.length) throw new Error(`The release feed (${name}) would show players banned words: ${banned.join(', ')}. Reword the notes or digest, or the filter in release-feed.mjs.`)
  }
  return { recent, older }
}

/** /releases.json alone (buildFeeds). */
export function buildFeed(repo = REPO, limit = LIMIT, building = process.env.MIRA_RELEASE_VERSION, now = new Date()) {
  return buildFeeds(repo, limit, building, now).recent
}

function gitHead(repo) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}

/**
 * What the feed is built from, as one string that changes when any of it does: history.tsv,
 * betas.tsv and every notes and player digest file, by name, size and modification time.
 * Commits are not part of it: the ones the feed names never change.
 */
export function feedInputs(repo = REPO) {
  const notes = join(repo, 'release-notes')
  const files = ['history.tsv', 'betas.tsv']
  for (const dir of ['releases', 'player']) {
    if (existsSync(join(notes, dir))) for (const name of readdirSync(join(notes, dir)).sort()) files.push(`${dir}/${name}`)
  }
  return files.map(file => {
    try { const s = statSync(join(notes, file)); return `${file} ${s.size} ${s.mtimeMs}` } catch { return `${file} -` }
  }).join('\n')
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
      // Built once per server start and again only when its inputs change: building it on every
      // request held Vite's event loop for seconds under load and stalled every other request.
      let cached = null, cachedKey = ''
      const feeds = () => {
        const key = feedInputs()
        if (cached === null || key !== cachedKey) {
          const { recent, older } = buildFeeds()
          cached = { [FEED_FILE]: JSON.stringify(recent), [OLDER_FILE]: older ? JSON.stringify(older) : null }
          cachedKey = key
        }
        return cached
      }
      for (const file of [FEED_FILE, OLDER_FILE]) {
        server.middlewares.use(`/${file}`, (req, res, next) => {
          if ((req.url ?? '/').split('?')[0] !== '/') return next() // only the file itself
          const body = feeds()[file]
          if (body === null) return next()
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-cache')
          res.end(body)
        })
      }
    },
    generateBundle() {
      const { recent, older } = buildFeeds()
      this.emitFile({ type: 'asset', fileName: FEED_FILE, source: JSON.stringify(recent) + '\n' })
      if (older) this.emitFile({ type: 'asset', fileName: OLDER_FILE, source: JSON.stringify(older) + '\n' })
    },
  }
}
