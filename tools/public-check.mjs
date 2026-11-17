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
 * Prints PUBLIC CHECK OK and exits 0, or PUBLIC CHECK FAILED and exits 1. A crashed browser
 * page is the machine, not the deploy: PUBLIC CHECK BROWSER CRASHED, exit 3.
 */
import { chromium } from 'playwright-core'
import { isBrowserCrash, isTransportConsoleError } from './lib/smoke-retry.mjs'

const base = process.argv[2]
if (!base) { console.error('usage: node tools/public-check.mjs <public url>'); process.exit(2) }
const room = `check${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
const results = [], errors = [], crashed = [], browsers = [], consoleLines = []
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`) }
const until = async (page, fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false)

// Same page setup as the smoke: one browser each, Low pinned, 960x540.
async function open(name) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
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
  await page.goto(`${base}?room=${room}&name=${name}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3hNet?.id > 0 && window.syn3h?.player, null, { timeout: 60000 })
  await page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.() })
  return page
}

let exitCode = 0
try {
  const a = await open('Alice'), b = await open('Bob')
  const idA = await a.evaluate(() => window.syn3hNet.id), idB = await b.evaluate(() => window.syn3hNet.id)
  const sees = (page, ids) => until(page, (ids) => ids.every((id) => window.syn3hNet.players.has(id)), ids, 15000)
  check('both join and see each other', idA !== idB && await sees(a, [idA, idB]) && await sees(b, [idA, idB]), { idA, idB })

  // No bots: a moving bot in the zone would contest the hill in step 4 (as in the full smoke).
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))

  // 2. A moves 30 m along the ground; B's copy of A follows.
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
check('no page errors', errors.length === 0, errors)
await Promise.all(browsers.map((x) => x.close()))

const crashedRun = crashed.length > 0
if (crashedRun) { console.log(`PUBLIC CHECK BROWSER CRASHED (${crashed.join(', ') || 'a page'}): the browser running the check crashed; this is not a deploy failure`); exitCode = 3 }
else if (results.every((r) => r.ok)) console.log(`PUBLIC CHECK OK ${results.length} checks at ${base}`)
else { console.log(`PUBLIC CHECK FAILED at ${base}: ${results.filter((r) => !r.ok).map((r) => r.name).join('; ')}`); exitCode = 1 }
process.exit(exitCode)
