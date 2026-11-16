/**
 * Executive dashboard server. Read only: it shows the docs, the hand kept status in
 * dashboard/status.json, the generated numbers in dashboard/stats.json (rerun
 * tools/dashboard-stats.mjs to refresh them), the releases recorded in
 * release-notes/history.tsv, the frozen builds the public site lists, and recent commits.
 * It never changes the repository.
 *
 *   node dashboard/server.mjs --port 4400
 */
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const portArg = process.argv.indexOf('--port')
const port = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.PASEO_PORT ?? 4400)

const DOCS = [
  ['FUTURE-IDEAS', 'ops/FUTURE-IDEAS.md', 'Future Ideas'],
  ['VEHICLE-STUDIO', 'ops/VEHICLE-STUDIO-RESEARCH.md', 'Vehicle studio research'],
  ['PROPOSAL', 'docs/PROPOSAL.md', 'Proposal'],
  ['ROADMAP', 'docs/ROADMAP.md', 'Roadmap'],
  ['reference-games', 'docs/research/reference-games.md', 'Reference games'],
  ['real-world-cities', 'docs/research/real-world-cities.md', 'Real world cities'],
]
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' }

function git(args, cwd = root) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 4000 }).trim() } catch { return '' }
}

function gitState() {
  const commits = git(['log', '--all', '-14', '--date=relative', '--format=%h|%cd|%D|%s'])
    .split('\n').filter(Boolean).map((l) => { const [hash, when, refs, ...s] = l.split('|'); return { hash, when, refs, subject: s.join('|') } })
  return { commits }
}

const SITE = 'https://www.syn3h.com/'
const REPO = 'https://github.com/terran-labs/syn3h'
/** Today's release train starts here: v26.11.1503 is the build frozen before the noon deadline. */
const FIRST_LISTED = 'v26.11.1503'

/** The one line summary under a release note's heading, or '' while the note is a draft. */
function releaseLine(version) {
  const file = join(root, 'release-notes', 'releases', `${version}.md`)
  if (!existsSync(file)) return ''
  const line = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('<!--')) ?? ''
  return line.startsWith('TODO') ? '' : line
}

/** Production and withdrawn releases from history.tsv, newest first, from FIRST_LISTED on. */
function releases(frozen) {
  let rows = []
  try {
    rows = readFileSync(join(root, 'release-notes', 'history.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
      .map((l) => { const [version, tag, commit, time, channel] = l.split('\t'); return { version, commit, time, channel } })
  } catch { return [] }
  return rows.filter((r) => (r.channel === 'production' || r.channel === 'withdrawn') && r.version >= FIRST_LISTED).reverse()
    .map((r) => ({ ...r, line: releaseLine(r.version), notes: `${REPO}/releases/tag/${r.version}`, frozen: frozen.includes(r.version.slice(1)) ? `${SITE}?v=${r.version.slice(1)}` : '' }))
}

// The frozen builds the public site serves, read from its own list at most once a minute.
let frozenCache = { at: 0, list: null }
async function frozenVersions() {
  if (Date.now() - frozenCache.at < 60000) return frozenCache.list
  let list = null
  try { list = (await (await fetch(`${SITE}v/versions.json`, { signal: AbortSignal.timeout(4000) })).json()).versions } catch {}
  frozenCache = { at: Date.now(), list: Array.isArray(list) ? list : null }
  return frozenCache.list
}

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

// Link liveness for the block at the top of the dashboard. Each link is probed at most once
// every 30 s; the page hides a link that does not answer rather than show a dead link.
const probes = new Map()
async function probe(url) {
  const hit = probes.get(url)
  if (hit && Date.now() - hit.at < 30000) return hit.up
  let up = false
  try { up = (await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(4000) })).status < 500 } catch { up = false }
  probes.set(url, { at: Date.now(), up })
  return up
}
async function withLiveness(links) {
  return Promise.all((links ?? []).map(async (g) => ({ ...g, items: await Promise.all(g.items.map(async (i) => ({ ...i, up: await probe(i.url) }))) })))
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/api/status') {
    let status = {}
    try {
      status = JSON.parse(readFileSync(join(here, 'status.json'), 'utf8'))
      // Never trust a hand written time: stamp from the file's own modification time, in Pacific.
      const stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(statSync(join(here, 'status.json')).mtime)
      status.updated = stamp
    } catch (e) { status = { error: String(e) } }
    let stats = null
    try { stats = JSON.parse(readFileSync(join(here, 'stats.json'), 'utf8')) } catch {}
    const frozen = await frozenVersions()
    const shipped = releases(frozen ?? [])
    // Frozen builds, newest first. If the site's list is unreachable, link the newest release
    // and the build frozen before the noon deadline.
    const versions = frozen ? [...frozen].reverse() : [...new Set([shipped.find((r) => r.channel === 'production')?.version.slice(1), FIRST_LISTED.slice(1)].filter(Boolean))]
    const links = [...(status.links ?? [])]
    if (versions.length) links.splice(1, 0, { group: 'Frozen builds', note: 'Every build stays playable at its own address.', items: versions.map((v) => ({ title: `v${v}`, url: `${SITE}?v=${v}` })) })
    status.links = await withLiveness(links)
    return send(res, 200, TYPES['.json'], JSON.stringify({ ...status, stats, releases: shipped, git: gitState(), docs: DOCS.map(([id, , title]) => ({ id, title })), now: new Date().toISOString() }))
  }
  if (url.pathname.startsWith('/api/doc/')) {
    const doc = DOCS.find(([id]) => id === url.pathname.slice(9))
    if (!doc || !existsSync(join(root, doc[1]))) return send(res, 404, 'text/plain', 'not found')
    let html = marked.parse(readFileSync(join(root, doc[1]), 'utf8'))
    // Keep links between known documents inside the dashboard's document viewer.
    for (const [id, path] of DOCS) {
      const relative = path.slice(path.lastIndexOf('/') + 1)
      html = html.replaceAll(`href="${relative}"`, `href="?doc=${id}"`)
    }
    return send(res, 200, TYPES['.html'], html)
  }
  const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]/, '')
  const file = join(here, rel)
  if (!file.startsWith(here) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'text/plain', 'not found')
  send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file))
}).listen(port, '127.0.0.1', () => console.log(`dashboard on http://127.0.0.1:${port}`))
