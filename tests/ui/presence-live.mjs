/** Combined acceptance with an ephemeral Vite proxy and real room server. Run through heavy.sh. */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { spawn } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { chromium, webkit } from 'playwright-core'
const origin = 'http://127.0.0.1:18104', sockets = []
const version = Number((await readFile('shared/protocol.ts', 'utf8')).match(/PROTOCOL_VERSION = (\d+)/)[1])
let logs = ''
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '18104', '--strictPort'], {
  env: { ...process.env, MIRA_NO_ROOM_SERVER: '', MIRA_ROOM_PORT: '18103' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
})
server.stdout.on('data', x => { logs += x }); server.stderr.on('data', x => { logs += x })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function connect(room) {
  const socket = new WebSocket(`ws://127.0.0.1:18103/ws?room=${room}`); sockets.push(socket)
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Welcome timeout')), 5000)
    socket.on('message', (data, binary) => {
      if (!binary && JSON.parse(String(data)).type === 'welcome') { clearTimeout(timer); resolve() }
    })
  })
  socket.send(JSON.stringify({ type: 'hello', v: version, name: 'Acceptance', params: { 'terrain.look': 2 } }))
  await ready
}
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs)
    try { const response = await fetch(`${origin}/presence`); if (response.ok && (await response.json()).version === 1) { ready = true; break } } catch {}
    await wait(200)
  }
  assert.ok(ready, logs)
  await connect('acceptance-a'); await connect('acceptance-b')
  const snapshot = await (await fetch(`${origin}/presence`)).json()
  assert.deepEqual(snapshot.byRecipe.map(({ recipeId, players, rooms }) => ({ recipeId, players, rooms })), [{ recipeId: 'alpine', players: 2, rooms: 2 }])
  await mkdir('tests/ui/artifacts/presence', { recursive: true })
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch(engine === chromium ? { channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] } : {})
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const errors = []; page.on('pageerror', e => errors.push(e.message))
      await page.goto(origin)
      await page.waitForFunction(() => document.querySelector('[data-world="alpine"] .galaxy-population')?.textContent === '2 online', null, { timeout: 120000 })
      await page.waitForFunction(() => window.mira?.shell?.galaxy?.live && document.documentElement.dataset.boot === 'done')
      await page.evaluate(() => { window.mira.shell.stopAttract(); window.mira.shell.galaxy.wake = 2 })
      await page.waitForTimeout(300)
      await page.screenshot({ path: `tests/ui/artifacts/presence/${engine.name()}.png` })
      assert.deepEqual(errors, [])
      assert.equal(await page.evaluate(() => window.mira.shell.galaxy.population.get('alpine').players), 2)
      console.log(`${engine.name()}: real same-origin population OK`)
    } finally { await browser.close() }
  }
} finally {
  for (const socket of sockets) socket.close()
  if (server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); process.kill(-server.pid, 'SIGTERM'); await stopped }
}
