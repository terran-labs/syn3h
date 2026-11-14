/**
 * End-to-end multiplayer check. Needs the room server and the dev server running:
 *
 *   npm run server                          (ws://localhost:8787)
 *   npx vite --port 5183 --strictPort
 *   node tools/net-smoke.mjs [http://localhost:5183/]
 *
 * Opens two headless Chrome pages in one fresh room and checks, in order:
 *  1. both connect and see each other
 *  2. driving A moves A's remote vehicle on B, and B's copy tracks A's real position
 *  3. a shared slider moved on A arrives on B, clamped by the server
 *  4. ramming: A drives into B, a ram is detected, and "it" passes from A to B
 *  5. laser tag: B (now it) shoots A; A's client detects the hit and B scores
 * Exits non zero on any failure or page error.
 */
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5183/'
const room = `smoke${Date.now() % 100000}`
const shot = '/tmp/syn3h-net-smoke.png'

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist',
    // Keep both pages running at full rate even though only one can be focused.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})
const errors = []
async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`) })
  await page.goto(`${base}?room=${room}&name=${name}`, { waitUntil: 'load' })
  return page
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const a = await open('Alice')
  await a.waitForFunction(() => window.syn3hNet?.connected, null, { timeout: 30000 })
  const b = await open('Bob')
  const both = (fn, arg) => Promise.all([a.evaluate(fn, arg), b.evaluate(fn, arg)])
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet?.connected && window.syn3hNet.players.size === 2, null, { timeout: 30000 })))
  const [idA, idB] = await both(() => window.syn3hNet.id)
  check('both connected and see each other', idA && idB && idA !== idB, { idA, idB })

  // B needs a few snapshots of A before A's remote vehicle exists there.
  await b.waitForFunction((id) => window.syn3hNet.remotes.has(id), idA, { timeout: 10000 })
  const remoteOfA = () => b.evaluate((id) => {
    const t = window.syn3hNet.remotes.get(id).vehicle.body.translation()
    return [t.x, t.y, t.z]
  }, idA)
  const realA = () => a.evaluate(() => { const t = window.syn3h.player.body.translation(); return [t.x, t.y, t.z] })
  const d2 = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2])

  // 2. Drive A forward and watch it on B.
  const before = await remoteOfA()
  await a.bringToFront()
  await a.keyboard.down('KeyW')
  await wait(3000)
  await a.keyboard.up('KeyW')
  await wait(600)
  const after = await remoteOfA()
  const truth = await realA()
  check('A moves on B', d2(before, after) > 3, { before, after, moved: +d2(before, after).toFixed(2) })
  check('B tracks A within 2 m once settled', d2(after, truth) < 2, { remote: after, real: truth, error: +d2(after, truth).toFixed(2) })

  // 3. Shared slider, clamped by the server.
  await a.evaluate(() => window.syn3h.params.set('laser.speed', 250))
  await a.evaluate(() => window.syn3h.params.set('world.gravity', 500))
  await wait(500)
  const [speedB, gravB, gravA] = await b.evaluate(() => [window.syn3h.params.get('laser.speed').value, window.syn3h.params.get('world.gravity').value]).then(async (r) => [...r, await a.evaluate(() => window.syn3h.params.get('world.gravity').value)])
  check('shared slider reaches B', speedB === 250, { speedB })
  check('server clamps a shared slider for everyone', gravB === 18.81 && gravA === 18.81, { gravA, gravB })
  await a.evaluate(() => window.syn3h.params.set('world.gravity', 9.81))

  // 4. Ram. A starts as "it". Park B just ahead of A, then drive A into it.
  const itBefore = await a.evaluate(() => window.syn3hNet.game.it)
  await a.evaluate(() => {
    const s = window.syn3h.terrain.spawnPoint(0)
    window.syn3h.player.teleport(s.position, 0)
  })
  await b.evaluate(() => {
    const s = window.syn3h.terrain.spawnPoint(0)
    s.position.z -= 7
    s.position.y = window.syn3h.terrain.heightAt(s.position.x, s.position.z) + 1.5
    window.syn3h.player.teleport(s.position, 0)
  })
  await wait(1500) // let both settle and the join cooldown expire
  await a.bringToFront()
  await a.keyboard.down('KeyW')
  await a.waitForFunction(() => window.syn3hNet.stats.rams > 0, null, { timeout: 8000 }).catch(() => {})
  await a.keyboard.up('KeyW')
  await wait(800)
  const [ramsA, ramsB] = await both(() => window.syn3hNet.stats.rams)
  const [itA, itB] = await both(() => window.syn3hNet.game.it)
  check('ram detected', ramsA + ramsB > 0, { ramsA, ramsB })
  check('ramming passes "it" from A to B', itBefore === idA && itA === idB && itB === idB, { itBefore, itA, itB })

  // 5. Laser tag. Wait out the tag cooldown, then B (it) shoots at where it sees A.
  await wait(3300)
  const scoreBefore = await a.evaluate((id) => window.syn3hNet.game.scores[id] ?? 0, idB)
  for (let i = 0; i < 6; i++) {
    await b.evaluate((id) => {
      const n = window.syn3hNet
      const target = n.remotes.get(id).vehicle.body.translation()
      const me = window.syn3h.player.body.translation()
      n.fire([target.x - me.x, target.y - me.y, target.z - me.z])
    }, idA)
    const hit = await a.waitForFunction(() => window.syn3hNet.stats.hitsTaken > 0, null, { timeout: 1500 }).then(() => true, () => false)
    if (hit) break
    await wait(400)
  }
  await wait(600)
  const hitsA = await a.evaluate(() => window.syn3hNet.stats.hitsTaken)
  const scoreAfter = await a.evaluate((id) => window.syn3hNet.game.scores[id] ?? 0, idB)
  check('victim detects the laser hit', hitsA > 0, { hitsA })
  check('"it" scores for a laser tag', scoreAfter === scoreBefore + 1, { scoreBefore, scoreAfter })

  const hud = await b.evaluate(() => document.getElementById('hud').textContent)
  console.log('B HUD:\n' + hud)
  await b.screenshot({ path: shot })
} catch (e) {
  check('no exception', false, { message: String(e?.message ?? e) })
} finally {
  await browser.close()
}

check('no page errors', errors.length === 0, errors)
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `NET SMOKE FAILED (${failed.length})` : `NET SMOKE OK, screenshot ${shot}`)
process.exit(failed.length ? 1 : 0)
