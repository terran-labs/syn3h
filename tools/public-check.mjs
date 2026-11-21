/**
 * The short public check: only what a deploy can break, run against a public address after a
 * production deploy. The full gameplay smoke (tools/net-smoke.mjs) runs on the staging Worker
 * and in the dry run, against the same frozen build, before production is touched.
 *
 *   node tools/public-check.mjs https://www.syn3h.com/
 *
 * Steps, two clients in one fresh room:
 *  1. both join and see each other;
 *  2. state crosses the room: A moves and B sees A there;
 *  3. a shared setting set by A reaches B;
 *  4. King of the Hill: A alone in the zone gets 2 points within 10 s from the room's own clock;
 *  5. A's socket is closed under it and A rejoins as the same player, still seen by B;
 *  6. A leaves and the room tells B (after the rejoin grace).
 * SYN3H_CHECK_OLD_VERSION=<version> loads the first page from that frozen build, for a mixed room.
 * SYN3H_CHECK_TOLERATE_DEVICE_LOSS=1 (the hosted run on GitHub's GPU-less runners, where WebGPU
 * loses its device) lets "no page errors" pass over exactly the WebGPU device-loss messages,
 * printing each one it passed over; any other page error still fails.
 * Prints PUBLIC CHECK OK and exits 0, or PUBLIC CHECK FAILED and exits 1. A crashed browser
 * page is the machine, not the deploy: PUBLIC CHECK BROWSER CRASHED, exit 3.
 */
import { chromium } from 'playwright-core'
import { browserEnv } from './lib/safe-env.mjs'
import { isBrowserCrash, isTransportConsoleError } from './lib/smoke-retry.mjs'

const base = process.argv[2]
const tolerateDeviceLoss = process.env.SYN3H_CHECK_TOLERATE_DEVICE_LOSS === '1'
// The WebGPU device-loss family, as three and Chrome word it on a machine without a GPU.
const DEVICE_LOSS = /WebGPU Device Lost|Instance dropped|A valid external Instance reference no longer exists/
// Most device-loss lines a hosted run may tolerate. v26.11.2009's hosted run had 2 (one per page);
// runs from 1707 to 1906 had 6. 8 leaves that margin; 2001 to 2008 had 204 to 406 before the fixes.
const MAX_DEVICE_LOSS = 8
if (!base) { console.error('usage: node tools/public-check.mjs <public url>'); process.exit(2) }
const room = `check${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
const results = [], errors = [], crashed = [], browsers = [], consoleLines = []
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`) }
const until = async (page, fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false)

// Same page setup as the smoke: one browser each, Low pinned, 960x540.
const entryReady = new Map()
async function open(name) {
  // No credentials in a browser's environment: a crash dump would record them (lib/safe-env.mjs).
  const browser = await chromium.launch({ channel: 'chrome', headless: true, env: browserEnv(), args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
  browsers.push(browser)
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } })
  await ctx.addInitScript(() => localStorage.setItem('syn3h.quality.v2', JSON.stringify({ level: 1, auto: false, pinned: true, overrides: {} })))
  const page = await ctx.newPage()
  page.on('crash', () => crashed.push(name))
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', (m) => {
    consoleLines.push({ name, at: Date.now(), type: m.type(), text: m.text().slice(0, 300) })
    if (m.type() === 'error' && !isTransportConsoleError(m.text(), base)) errors.push(`${name} console: ${m.text()}`)
  })
  page.on('websocket', (ws) => {
    consoleLines.push({ name, at: Date.now(), type: 'websocket-open', text: ws.url().replace(/room=[^&]+/, 'room=<check>') })
    ws.on('close', () => consoleLines.push({ name, at: Date.now(), type: 'websocket-close', text: '' }))
    ws.on('socketerror', (e) => consoleLines.push({ name, at: Date.now(), type: 'websocket-error', text: String(e) }))
  })
  // SYN3H_CHECK_OLD_VERSION=<version> loads Alice from that frozen build (?v=), so an older
  // client is checked against the newly deployed room: a protocol change must not strand it.
  const old = name === 'Alice' && process.env.SYN3H_CHECK_OLD_VERSION ? `&v=${process.env.SYN3H_CHECK_OLD_VERSION}` : ''
  await page.goto(`${base}?room=${room}&name=${name}&autoplay=1${old}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3hNet?.id > 0 && window.syn3h?.player, null, { timeout: 60000 }).catch(async (error) => {
    // Say what the page had got to, not only that it timed out. `fatal` is the start-failure
    // notice's text, which carries a PhysicsLoadError's detail (timeout or HTTP status).
    const state = await page.evaluate(() => ({ boot: document.documentElement.dataset.boot ?? null, backend: window.syn3h?.game?.backend ?? null, net: window.syn3hNet?.id ?? null, player: !!window.syn3h?.player, fatal: document.getElementById('fatal')?.textContent?.trim().slice(0, 600) || null })).catch(() => null)
    const recent = consoleLines.filter((l) => l.name === name).slice(-8).map((l) => `${l.type}: ${l.text}`)
    throw new Error(`${name} never became ready: ${error.message}; page ${JSON.stringify(state)}; console ${JSON.stringify(recent)}`)
  })
  const start = Date.now()
  await page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.() })
  // Wait for this player to be playable before the next browser is launched, so one player's
  // figure never includes another browser's launch and boot on the same machine. ?autoplay=1
  // already requested play at boot, so the figure that counts is the page's own: from its play
  // request to its first reveal (window.syn3hStartup, src/core/diagnostics.ts). It is printed,
  // never a threshold; entry fails only if the loading overlay never clears.
  const ok = await until(page, () => {
    const { shell, game } = window.syn3h
    return shell.playing && !shell.transitioning && !game.holdDraws
  }, null, 45000)
  const own = await page.evaluate(() => {
    const t = window.syn3hStartup
    return t?.playRequestMs !== undefined && t?.firstRevealMs !== undefined ? Math.round(t.firstRevealMs - t.playRequestMs) : null
  }).catch(() => null)
  entryReady.set(page, Promise.resolve({ name, ok, playToPlayableMs: own, observedMs: Date.now() - start }))
  return page
}

let exitCode = 0
try {
  const a = await open('Alice'), b = await open('Bob')
  const idA = await a.evaluate(() => window.syn3hNet.id), idB = await b.evaluate(() => window.syn3hNet.id)
  const sees = (page, ids) => until(page, (ids) => ids.every((id) => window.syn3hNet.players.has(id)), ids, 15000)
  const backends = await Promise.all([a, b].map((p) => p.evaluate(() => window.syn3h?.game?.backend ?? null).catch(() => null)))
  check('both join and see each other', idA !== idB && await sees(a, [idA, idB]) && await sees(b, [idA, idB]), { idA, idB, renderer: backends })

  // No bots: a moving bot in the zone would contest the hill in step 4 (as in the full smoke).
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))

  // 2. A moves 30 m along the ground; B's copy of A follows.
  const entry = await Promise.all([entryReady.get(a), entryReady.get(b)])
  console.log('Playable entry (playToPlayableMs: the page\'s own play request to first reveal; observedMs: since the check pressed Play)', JSON.stringify(entry))
  if (!entry.every(client => client.ok)) throw new Error('Playable entry failed before movement check')
  const target = await a.evaluate(() => {
    const s = window.syn3h.terrain.spawnPoint(0), x = s.position.x + 30, z = s.position.z
    s.position.set(x, window.syn3h.terrain.heightAt(x, z) + 1.5, z); window.syn3h.player.teleport(s.position, 0)
    return [x, z]
  })
  const followed = await until(b, ({ id, target }) => { const p = window.syn3hNet.remotes.get(id)?.vehicle?.body?.translation(); return !!p && Math.hypot(p.x - target[0], p.z - target[1]) < 4 }, { id: idA, target }, 15000)
  check('state crosses the room: B sees A where A moved', followed, { target })

  // 3. A shared setting.
  await a.evaluate(() => window.syn3h.params.set('laser.speed', 250))
  check('a shared setting reaches B', await until(b, () => window.syn3h.params.get('laser.speed').value === 250, null, 15000))

  // 4. The room's own clock, on this Worker: King of the Hill, A alone in the zone, B out, and
  // the room must credit A at least 2 points within 10 s (scoring runs on the room's alarm, not
  // on players' messages). Production failed this twice when staging did not, so it runs here.
  await a.evaluate(() => window.syn3h.params.set('game.mode', 1))
  const zoned = await until(a, () => window.syn3hNet.game.mode === 1 && !!window.syn3hNet.game.koth.zone, null, 15000)
  let hill = { zoned }
  if (zoned) {
    await a.evaluate(() => {
      const zone = window.syn3hNet.game.koth.zone, r = (zone.inner + zone.outer) / 2
      const x = zone.x + Math.cos(0.3) * r, z = zone.z + Math.sin(0.3) * r
      const v = window.syn3h.player.object.position.clone(); v.set(x, window.syn3h.terrain.heightAt(x, z) + 1.2, z)
      window.syn3h.player.teleport(v, 0)
    })
    await b.evaluate(() => { const s = window.syn3h.terrain.spawnPoint(1); window.syn3h.player.teleport(s.position, 0) })
    const started = Date.now()
    const scored = await until(a, (id) => window.syn3hNet.game.koth.holder === id && (window.syn3hNet.game.scores[id] ?? 0) >= 2, idA, 10000)
    hill = { zoned, holder: await a.evaluate(() => window.syn3hNet.game.koth.holder), score: await a.evaluate((id) => window.syn3hNet.game.scores[id] ?? 0, idA), ms: Date.now() - started }
    check('the room scores the hill on its own clock: A alone gets 2 points within 10 s', scored, hill)
  } else check('the room scores the hill on its own clock: A alone gets 2 points within 10 s', false, hill)
  await a.evaluate(() => window.syn3h.params.set('game.mode', 2))
  await until(b, () => window.syn3hNet.game.mode === 2, null, 15000)

  // 5. Close A's socket under it, as a network drop would; A must come back as the same player.
  const before = await a.evaluate(() => window.syn3hNet.conn.reconnects)
  await a.evaluate(() => window.syn3hNet.conn.ws?.close(4000, 'public check'))
  // Sample A's connection each second while waiting, so a failure carries its own evidence.
  const closedAt = Date.now(), samples = []
  const sample = () => a.evaluate(() => { const c = window.syn3hNet.conn; return { state: c.state, reconnects: c.reconnects, backoff: c.backoff, retryPending: !!c.timer, readyState: c.ws?.readyState ?? null, id: window.syn3hNet.id } }).catch((e) => ({ error: String(e) }))
  let back = false
  for (let t = 0; t < 30 && !back; t++) {
    const s = await sample(); samples.push({ s: t, ...s })
    back = s.reconnects > before && s.state === 'open' && s.id > 0
    if (!back) await new Promise((r) => setTimeout(r, 1000))
  }
  const idAfter = await a.evaluate(() => window.syn3hNet.id)
  const rejoined = back && idAfter === idA && await sees(b, [idA])
  const evidence = rejoined ? { idA, idAfter } : {
    idA, idAfter, before,
    closes: await a.evaluate(() => window.syn3hNet.conn.closes).catch(() => null),
    samples,
    aSaw: consoleLines.filter((l) => l.name === 'Alice' && l.at >= closedAt - 1000).map((l) => ({ ms: l.at - closedAt, type: l.type, text: l.text })).slice(0, 60),
  }
  check('a forced reconnect rejoins as the same player', rejoined, evidence)

  // 6. A leaves; the room holds its place for the rejoin grace (30 s), then tells B.
  await a.context().close()
  check('a leaving player is gone for B after the rejoin grace', await until(b, (id) => !window.syn3hNet.players.has(id), idA, 60000), { idA })
} catch (e) {
  if (isBrowserCrash(String(e?.message ?? e))) crashed.push('a page')
  check('no exception', false, { message: String(e?.message ?? e) })
}
const tolerated = tolerateDeviceLoss ? errors.filter((e) => DEVICE_LOSS.test(e)) : []
const counted = errors.filter((e) => !tolerated.includes(e))
// Group the tolerated lines by message (numbers stripped, first 160 characters) so a new kind of
// device-loss line shows with its count instead of hiding past the first few samples.
const groups = new Map()
for (const e of tolerated) { const k = e.replace(/\d+/g, 'N').slice(0, 160); groups.set(k, (groups.get(k) ?? 0) + 1) }
if (tolerated.length) {
  console.log(`TOLERATED ${tolerated.length} WebGPU device-loss page errors (SYN3H_CHECK_TOLERATE_DEVICE_LOSS), by message:`)
  for (const [k, n] of [...groups].sort((x, y) => y[1] - x[1])) console.log(`  ${n} x ${JSON.stringify(k)}`)
}
// Past the cap, device loss is no longer the runner's ordinary loss but something we added.
const maxTolerated = Number(process.env.SYN3H_CHECK_MAX_DEVICE_LOSS ?? MAX_DEVICE_LOSS)
check('no page errors', counted.length === 0 && tolerated.length <= maxTolerated, { count: counted.length, tolerated: tolerated.length, maxTolerated, first: counted.slice(0, 5).map((e) => e.slice(0, 300)) })
await Promise.all(browsers.map((x) => x.close()))

const crashedRun = crashed.length > 0
if (crashedRun) { console.log(`PUBLIC CHECK BROWSER CRASHED (${crashed.join(', ') || 'a page'}): the browser running the check crashed; this is not a deploy failure`); exitCode = 3 }
else if (results.every((r) => r.ok)) console.log(`PUBLIC CHECK OK ${results.length} checks at ${base}`)
else { console.log(`PUBLIC CHECK FAILED at ${base}: ${results.filter((r) => !r.ok).map((r) => r.name).join('; ')}`); exitCode = 1 }
// Let stdout drain: process.exit() can cut off buffered output when stdout is a pipe (CI).
process.exitCode = exitCode
