/**
 * The live vehicle lab: one preview that shows every vehicle lane's latest committed work the
 * moment it is committed, with no merge queue in the way.
 *
 *   node tools/lab-live.mjs --port 5555
 *
 * It keeps a checkout (a sibling worktree, `lab-live`, on the local branch `lab/live`) that is
 * rebuilt whenever a branch tip moves: reset to trunk (`build/weekend`), then merge each
 * `veh/*` branch in turn. A branch that conflicts is skipped and named in
 * labs/live-status.json, which the lab's sidebar shows. Vite serves that checkout and reloads
 * the page when it changes. Nothing here is pushed, tested or shipped: the lab is a developer
 * tool and is not part of the production build.
 *
 * Owner's instruction, 14 November 2026: "I just want the vehicle preview system to update live
 * the moment a new vehicle is ready without waiting for anything from the Orchestrator."
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const port = args[args.indexOf('--port') + 1] ?? process.env.PASEO_PORT ?? '5555'
const TRUNK = process.env.LAB_TRUNK ?? 'build/weekend'
const BRANCHES = /^veh\//
/** Branches that are scratch space for one task, not a lane's line of work. */
const SKIP = new Set(['veh/vehicle-lab', 'veh/buggy-wheels'])
const live = resolve(here, '..', 'lab-live')
const POLL_MS = 15000
const OLD_EXHIBIT_LIST = 'src/dev/vehicleLab/exhibits/index.ts'

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tryGit = (cwd, ...a) => { try { return { ok: true, out: git(cwd, ...a) } } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } } }

function ensureCheckout() {
  if (!existsSync(join(live, '.git'))) {
    git(here, 'worktree', 'add', '-f', '-B', 'lab/live', live, TRUNK)
  }
  // Every worktree here shares one node_modules by symlink.
  const modules = join(live, 'node_modules')
  if (!existsSync(modules)) symlinkSync(resolve(here, 'node_modules'), modules)
}

function tips() {
  const lines = git(here, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads').split('\n')
  const map = new Map(lines.map(l => l.split(' ')))
  const branches = [...map.keys()].filter(n => BRANCHES.test(n) && !SKIP.has(n)).sort()
  return { trunk: map.get(TRUNK), branches: branches.map(name => ({ name, head: map.get(name) })) }
}

let signature = ''
function sync() {
  const t = tips()
  const next = t.trunk + '|' + t.branches.map(b => b.head).join(',')
  if (next === signature) return
  signature = next
  git(live, 'reset', '-q', '--hard', t.trunk)
  git(live, 'clean', '-q', '-fd', '--', 'src', 'labs', 'public', 'tools', 'tests')
  const status = []
  for (const b of t.branches) {
    const [subject, when] = git(here, 'log', '-1', '--format=%s%x09%cr', b.head).split('\t')
    const entry = { name: b.name, head: b.head.slice(0, 7), subject, when, merged: true }
    const merge = tryGit(live, '-c', 'user.name=Vehicle lab', '-c', 'user.email=lab@localhost', 'merge', '-q', '--no-edit', '--no-ff', b.head)
    let files = merge.ok ? [] : tryGit(live, 'diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean)
    // The lab once kept a hand-written list of exhibits, which every lane edited. It is gone
    // (exhibits register themselves), so a lane that still edits it conflicts only there:
    // drop the list and keep the lane's work.
    if (!merge.ok && files.length && files.every(f => f === OLD_EXHIBIT_LIST)) {
      tryGit(live, 'rm', '-q', '-f', OLD_EXHIBIT_LIST)
      const done = tryGit(live, '-c', 'user.name=Vehicle lab', '-c', 'user.email=lab@localhost', 'commit', '-q', '--no-edit')
      if (done.ok) { status.push(entry); continue }
      files = [OLD_EXHIBIT_LIST]
    }
    if (!merge.ok) {
      tryGit(live, 'merge', '--abort')
      entry.merged = false
      entry.error = files.length ? `conflicts with trunk or another lane in ${files.slice(0, 3).join(', ')}` : merge.out.split('\n')[0].slice(0, 160)
    }
    status.push(entry)
  }
  mkdirSync(join(live, 'labs'), { recursive: true })
  writeFileSync(join(live, 'labs', 'live-status.json'), JSON.stringify({ updated: new Date().toISOString(), trunk: t.trunk.slice(0, 7), branches: status }, null, 1))
  console.log(`[lab-live] rebuilt: ${status.map(s => `${s.name}${s.merged ? '' : ' (skipped)'}`).join(', ')}`)
}

ensureCheckout()
sync()
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: live, stdio: 'inherit', env: { ...process.env, SYN3H_NO_ROOM_SERVER: '1' },
})
const timer = setInterval(() => { try { sync() } catch (e) { console.error('[lab-live] sync failed:', e.message) } }, POLL_MS)
const stop = () => { clearInterval(timer); vite.kill('SIGTERM') }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
vite.on('exit', code => { clearInterval(timer); process.exit(code ?? 0) })
