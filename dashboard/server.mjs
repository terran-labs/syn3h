/**
 * Executive dashboard server. Read only: it shows the docs, the build plan in
 * dashboard/status.json, and live git state. It never changes the repository.
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
  ['PROPOSAL', 'docs/PROPOSAL.md', 'Proposal'],
  ['ROADMAP', 'docs/ROADMAP.md', 'Roadmap'],
  ['mars-explorer', 'docs/architecture/mars-explorer.md', 'Mars Explorer architecture'],
  ['syn3h', 'docs/architecture/syn3h.md', 'Syn3h (Unity) architecture'],
  ['reference-games', 'docs/research/reference-games.md', 'Reference games'],
  ['real-world-cities', 'docs/research/real-world-cities.md', 'Real world cities'],
]
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' }

function git(args, cwd = root) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 4000 }).trim() } catch { return '' }
}

function gitState() {
  const branches = git(['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)|%(committerdate:relative)|%(subject)', 'refs/heads'])
    .split('\n').filter(Boolean).map((l) => { const [name, when, ...s] = l.split('|'); return { name, when, subject: s.join('|') } })
  const base = 'build/weekend'
  for (const b of branches) b.ahead = Number(git(['rev-list', '--count', `${base}..${b.name}`]) || 0)
  const commits = git(['log', '--all', '-14', '--date=relative', '--format=%h|%cd|%D|%s'])
    .split('\n').filter(Boolean).map((l) => { const [hash, when, refs, ...s] = l.split('|'); return { hash, when, refs, subject: s.join('|') } })
  return { branches, commits }
}

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/api/status') {
    let status = {}
    try { status = JSON.parse(readFileSync(join(here, 'status.json'), 'utf8')) } catch (e) { status = { error: String(e) } }
    return send(res, 200, TYPES['.json'], JSON.stringify({ ...status, git: gitState(), docs: DOCS.map(([id, , title]) => ({ id, title })), now: new Date().toISOString() }))
  }
  if (url.pathname.startsWith('/api/doc/')) {
    const doc = DOCS.find(([id]) => id === url.pathname.slice(9))
    if (!doc || !existsSync(join(root, doc[1]))) return send(res, 404, 'text/plain', 'not found')
    return send(res, 200, TYPES['.html'], marked.parse(readFileSync(join(root, doc[1]), 'utf8')))
  }
  const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]/, '')
  const file = join(here, rel)
  if (!file.startsWith(here) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'text/plain', 'not found')
  send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file))
}).listen(port, '127.0.0.1', () => console.log(`dashboard on http://127.0.0.1:${port}`))
