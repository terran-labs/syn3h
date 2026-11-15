/** Run via tools/heavy.sh. Tests the Worker or Node endpoint without browsers or deployment.
 * npm run build, then node tools/presence-runtime-check.mjs [worker|dev]
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const mode = process.argv[2] ?? 'worker'
assert.ok(['worker', 'dev'].includes(mode))
const port = mode === 'worker' ? 18097 : 18098
const origin = `http://127.0.0.1:${port}`
const persist = await mkdtemp(join(tmpdir(), 'syn3h-presence-'))
const version = Number((await readFile('shared/protocol.ts', 'utf8')).match(/PROTOCOL_VERSION = (\d+)/)[1])
const wait = ms => new Promise(r => setTimeout(r, ms))
let logs = '', child
const sockets = new Set()
async function start() {
  child = spawn(process.execPath, mode === 'worker'
    ? ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist]
    : ['node_modules/tsx/dist/cli.mjs', 'server/dev.ts'],
  { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', x => { logs += x }); child.stderr.on('data', x => { logs += x })
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`)
    try { if ((await fetch(`${origin}/presence`)).ok) return } catch {}
    await wait(200)
  }
  throw new Error(`Startup timed out: ${logs}`)
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const stopped = new Promise(r => child.once('exit', r))
  child.kill('SIGTERM'); await stopped
}
async function get(path = '/presence') {
  const response = await fetch(origin + path)
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /json/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return response.json()
}
async function until(check, label) {
  for (let i = 0; i < 50; i++) {
    const p = await get()
    if (check(p)) { console.log(`PASS ${mode}: ${label}`); return p }
    await wait(100)
  }
  throw new Error(`${label}: ${JSON.stringify(await get())}`)
}
async function connect(room, hello) {
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/ws?room=${room}`)
  sockets.add(ws); ws.on('error', () => {})
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  if (!hello) return { ws }
  const welcome = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('hello timeout')), 5000)
    ws.on('message', (data, binary) => {
      if (binary) return
      const m = JSON.parse(String(data))
      if (m.type === 'welcome') { clearTimeout(timeout); resolve(m) }
      if (m.type === 'error') { clearTimeout(timeout); reject(new Error(JSON.stringify(m))) }
    })
  })
  ws.send(JSON.stringify({ type: 'hello', v: version, name: 'Runtime', ...hello }))
  return { ws, welcome: await welcome }
}
const param = (p, id, value) => p.ws.send(JSON.stringify({ type: 'param', id, value }))
const close = async p => { const done = new Promise(r => p.ws.once('close', r)); p.ws.close(); await done }
try {
  await start()
  const fresh = await get(); assert.deepEqual(fresh.byRecipe, []); assert.equal(fresh.ttlMs, 90000); assert.equal(fresh.version, 1)
  assert.equal((await fetch(origin + '/presence', { method: 'POST' })).status, 405)
  const pending = await connect('pending')
  assert.deepEqual((await get()).byRecipe, [])
  const a = await connect('secret-a', { resume: 'presence-runtime-token-12345678', params: { 'terrain.look': 2, 'world.seed': 111 } })
  const b = await connect('secret-b', { params: { 'terrain.look': 2, 'world.seed': 222 } })
  const grouped = await until(p => p.byRecipe.length === 1 && p.byRecipe[0].players === 2 && p.byRecipe[0].rooms === 2, 'two rooms share recipe counts')
  assert.ok(!JSON.stringify(grouped).includes('secret')); assert.ok(!JSON.stringify(grouped).includes('Runtime'))
  assert.deepEqual(await get('/status'), { rooms: 2, players: 2 })
  param(a, 'terrain.look', 1)
  await until(p => p.byRecipe.length === 2 && p.byRecipe.find(r => r.recipeId === 'desert')?.players === 1, 'world change moves count without player change')
  const before = (await get()).byRecipe.find(r => r.recipeId === 'desert').oldestReportAt
  await wait(20); param(a, 'world.seed', 333)
  await until(p => p.byRecipe.find(r => r.recipeId === 'desert')?.oldestReportAt > before, 'seed-only change refreshes immediately')
  await close(a)
  await until(p => p.byRecipe.length === 1 && p.byRecipe[0].players === 1, 'held disconnect excluded')
  const again = await connect('secret-a', { resume: 'presence-runtime-token-12345678', params: {} })
  assert.equal(again.welcome.id, a.welcome.id)
  await until(p => p.byRecipe.reduce((n, r) => n + r.players, 0) === 2, 'reconnect counted once')
  if (mode === 'worker') {
    console.log('Waiting for independent presence expiry with sockets left silent')
    await wait(91_000)
    assert.deepEqual((await get()).byRecipe, [])
    assert.deepEqual(await get('/status'), { rooms: 2, players: 2 })
    console.log('PASS worker: ninety-second expiry preserves ten-minute status')
  }
  await close(again); await close(b); await close(pending)
  await until(p => p.byRecipe.length === 0, 'last disconnect removes population')
  assert.deepEqual(await get('/status'), { rooms: 0, players: 0 })
  if (mode === 'worker') { await stop(); await start(); assert.deepEqual((await get()).byRecipe, []); console.log('PASS worker: registry restore') }
  console.log(`PRESENCE ${mode.toUpperCase()} OK`)
} catch (error) { console.error(logs); throw error }
finally { for (const ws of sockets) ws.terminate(); await stop(); await rm(persist, { recursive: true, force: true }) }
