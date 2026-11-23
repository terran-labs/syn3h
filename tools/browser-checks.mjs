#!/usr/bin/env node
/**
 * Every browser check in tests/ui, one at a time, each against its own dev server and room
 * server on free ports, and one pass or fail line per file.
 *
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs            every file
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs galaxy jet-hint   some files
 *
 * Why: only about 13 of these run before a release, and about 20 failed on main for days unseen
 * (23 November 2026). This runs the whole folder when the machine allows.
 *
 * What each file gets, from what its header asks for:
 *  - MIRA_URL (and the older SYN3H_URL) set to its server; a file that takes its address as the
 *    first argument (`process.argv[2] ?? 'http...'`) gets it there too.
 *  - A room server beside the dev server, on its own free port (MIRA_ROOM_PORT, VITE_SERVER_URL).
 *  - A release build (MIRA_RELEASE_VERSION, the second newest production release in
 *    release-notes/history.tsv) when its header names MIRA_RELEASE_VERSION.
 *  - Files that start their own servers (they set MIRA_NO_ROOM_SERVER) are run with none.
 *  - A file whose header says `browser-checks: skip (reason)` is listed, not run: a review tool
 *    that compares two builds, say, rather than a check.
 * A failing file's log (and its server's) is also kept as <file>.failed-<time>.log, which no later
 * run overwrites. A file passes when it exits 0 within its time (10 minutes, --timeout=<s> to change). It runs in
 * the background of whatever else the machine does: run it through heavy.sh, which holds one slot.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const folder = join(root, 'tests/ui')
const args = process.argv.slice(2)
const timeout = Number(args.find(a => a.startsWith('--timeout='))?.split('=')[1] ?? 600) * 1000
const wanted = args.filter(a => !a.startsWith('--')).map(a => a.replace(/^tests\/ui\//, '').replace(/\.mjs$/, ''))
const logs = '/tmp/mira-browser-checks'
mkdirSync(logs, { recursive: true })

/** A browser check: an .mjs in tests/ui that drives Playwright. Helpers (stateWait, thumbGrid, lib/) are not. */
/** A file can opt out with `// browser-checks: skip (reason)` in its header: a review tool, not a check. */
const skipped = []
const files = readdirSync(folder).filter(f => f.endsWith('.mjs') && /from 'playwright(-core)?'/.test(readFileSync(join(folder, f), 'utf8')))
  .filter(f => { const why = readFileSync(join(folder, f), 'utf8').slice(0, 2000).match(/browser-checks: skip \(([^)]*)\)/); if (why) skipped.push(`${f.replace(/\.mjs$/, '')}: ${why[1]}`); return !why })
  .map(f => f.replace(/\.mjs$/, '')).filter(f => !wanted.length || wanted.includes(f)).sort()

const freePort = () => new Promise((done, fail) => { const s = createServer(); s.on('error', fail); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)) }) })
const releaseVersion = () => {
  const rows = readFileSync(join(root, 'release-notes/history.tsv'), 'utf8').split('\n').map(l => l.split('\t')).filter(r => /^v\d/.test(r[0] ?? '') && r[4]?.trim() === 'production')
  return rows.at(-2)?.[0].slice(1)
}
const ready = async (url, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 500))) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
  }
  return false
}
/**
 * The process groups this runner started and has not yet seen end: each file's check and its dev
 * server (with the room server it starts) run detached, in groups of their own, so a signal to the
 * runner does not reach them. On SIGTERM or SIGINT the runner signals exactly these groups, by the
 * PIDs it started, never by name or port, then exits (128 + the signal's number). On 23 November 2026
 * a stopped runner left a vite and its room server running, parented by launchd.
 */
const live = new Set()
const stopGroup = (pid, signal) => { try { process.kill(-pid, signal) } catch { /* gone */ } }
// Set by a signal: no further file starts, and the check it interrupted is not reported as a failure.
let stopping = 0
for (const [signal, number] of [['SIGTERM', 15], ['SIGINT', 2]]) {
  process.on(signal, () => {
    stopping = number
    for (const pid of live) stopGroup(pid, 'SIGTERM')
    // A group that ignores SIGTERM gets SIGKILL a moment later; the runner waits for that, then goes.
    setTimeout(() => { for (const pid of live) stopGroup(pid, 'SIGKILL'); process.exit(128 + number) }, 1500)
  })
}
/** Run a command in its own process group; resolves to its exit code (or 'timeout'). */
const run = (command, argv, env, logFile, ms) => new Promise(done => {
  const out = []
  const child = spawn(command, argv, { cwd: root, env: { ...process.env, ...env }, detached: true })
  live.add(child.pid)
  child.stdout.on('data', d => out.push(d)); child.stderr.on('data', d => out.push(d))
  const timer = ms ? setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } done({ code: 'timeout', out }) }, ms) : null
  child.on('exit', code => { live.delete(child.pid); if (timer) clearTimeout(timer); writeFileSync(logFile, Buffer.concat(out)); done({ code, out }) })
  return child
})
const startServer = (env, logFile) => {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', env.port, '--strictPort'], { cwd: root, env: { ...process.env, ...env.vars }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = []; child.stdout.on('data', d => out.push(d)); child.stderr.on('data', d => out.push(d))
  live.add(child.pid)
  child.on('exit', () => live.delete(child.pid))
  return { stop: () => { stopGroup(child.pid, 'SIGTERM'); live.delete(child.pid); writeFileSync(logFile, Buffer.concat(out)) } }
}
/** The last line that says why it failed: an assertion, an error, or the last line written. */
const reason = out => {
  const lines = Buffer.concat(out).toString().split('\n').map(l => l.trim()).filter(Boolean)
  return (lines.find(l => /AssertionError|Error:|FAIL|Timeout/.test(l) && !/^at /.test(l)) ?? lines.at(-1) ?? '').slice(0, 220)
}

for (const line of skipped) if (!wanted.length || wanted.includes(line.split(':')[0])) console.log(`SKIP  ${line}`)
const started = Date.now(), results = []
for (const name of files) {
  if (stopping) break
  const source = readFileSync(join(folder, `${name}.mjs`), 'utf8'), head = source.slice(0, 2000)
  const ownServers = /MIRA_NO_ROOM_SERVER/.test(source)
  const urlArgument = /process\.argv\[2\]\s*\?\?\s*'http/.test(source)
  const [devPort, roomPort] = [String(await freePort()), String(await freePort())]
  const url = `http://127.0.0.1:${devPort}/`
  const vars = { MIRA_ROOM_PORT: roomPort, VITE_SERVER_URL: `ws://127.0.0.1:${roomPort}` }
  if (/MIRA_RELEASE_VERSION|SYN3H_RELEASE_VERSION/.test(head)) vars.MIRA_RELEASE_VERSION = releaseVersion()
  const t0 = Date.now()
  let server = null, result
  if (!ownServers) {
    server = startServer({ port: devPort, vars }, join(logs, `${name}.server.log`))
    if (!(await ready(url, 60000))) result = { code: 'no server', out: [Buffer.from('the dev server did not answer within a minute')] }
  }
  result ??= await run(process.execPath, [`tests/ui/${name}.mjs`, ...(urlArgument ? [url] : [])], { MIRA_URL: url, SYN3H_URL: url, ...vars }, join(logs, `${name}.log`), timeout)
  server?.stop()
  if (stopping) { console.log(`STOPPED  ${name} (signal; not counted)`); break }
  const seconds = Math.round((Date.now() - t0) / 1000), ok = result.code === 0
  results.push({ name, ok, seconds })
  // A failure's logs are kept under the time it failed: the fixed paths are overwritten by the next
  // run, which lost the evidence of two failures on 23 November 2026. Passing runs keep the fixed paths.
  let kept = ''
  if (!ok) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    kept = join(logs, `${name}.failed-${stamp}.log`)
    writeFileSync(kept, Buffer.concat(result.out))
    const serverLog = join(logs, `${name}.server.log`)
    if (server && existsSync(serverLog)) copyFileSync(serverLog, join(logs, `${name}.failed-${stamp}.server.log`))
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${String(seconds).padStart(4)} s${ok ? '' : `  (${result.code === 'timeout' ? 'timed out' : result.code === 'no server' ? 'no server' : `exit ${result.code}`}) ${reason(result.out)}\n      log kept: ${kept}`}`)
}
// Stopped by a signal: leave the exit to the handler, after its groups are gone.
if (stopping) await new Promise(() => {})
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} passed in ${Math.round((Date.now() - started) / 60000)} min. Logs: ${logs}/<file>.log`)
process.exit(failed.length ? 1 : 0)
