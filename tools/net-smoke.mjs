/**
 * End-to-end multiplayer check. Needs the dev server, which also starts the room server on
 * 8787 (or run them apart: `SYN3H_NO_ROOM_SERVER=1 npx vite ...` plus `npm run server`):
 *
 *   npx vite --port 5183 --strictPort
 *   node tools/net-smoke.mjs [http://localhost:5183/]
 *
 * Also works against a production build (`npx wrangler dev`); checks that need Vite's
 * module server (bots) are skipped there.
 *
 * Opens two headless Chrome pages in one fresh room and checks, in order:
 *  1. both connect and see each other
 *  2. driving A moves A's remote vehicle on B, and B's copy tracks A's real position
 *  3. a shared slider moved on A arrives on B, clamped by the server
 *  4. ramming: A drives into B, a ram is detected, and "it" passes from A to B
 *  5. laser tag: B (now it) shoots A; A's client detects the hit and B scores
 *  6. sounds: spawns, shots, hits and rams reach the audio hooks
 *  7. identity: A's vehicle kind and colours reach B; B shows a name tag for A
 *  8. hidden tab: B hides, keeps a heartbeat, and A shows B as paused, not lost
 *  9. bots: A (host) owns a bot, B sees it and B's laser hit on it is judged by A
 * 10. world seed: A changes it, B regenerates and stays on the ground; a late joiner with a
 *     different ?seed= gets the room's seed
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
async function open(name, extra = '') {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`) })
  await page.goto(`${base}?room=${room}&name=${name}&autoplay=1${extra}`, { waitUntil: 'load' })
  // ?autoplay=1 joins the room but leaves the start screen's input suspension on, so press
  // Play as a person would (it is idempotent with autoplay's join).
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 30000 })
  await page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.() })
  return page
}

/** Record calls to the networking audio hooks (main.ts may not pass real audio yet). */
const spyAudio = (page) => page.evaluate(() => {
  const calls = []
  window.__audioCalls = calls
  window.syn3hNet.ctx.audio = {
    play: (sound) => calls.push(sound),
    impact: (strength) => calls.push(`impact:${strength.toFixed(1)}`),
  }
})
const audioCalls = (page) => page.evaluate(() => window.__audioCalls)

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const a = await open('Alice')
  await a.waitForFunction(() => window.syn3hNet?.connected, null, { timeout: 30000 })
  await spyAudio(a)
  const b = await open('Bob')
  const both = (fn, arg) => Promise.all([a.evaluate(fn, arg), b.evaluate(fn, arg)])
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet?.connected && window.syn3hNet.players.size === 2, null, { timeout: 30000 })))
  const [idA, idB] = await both(() => window.syn3hNet.id)
  check('both connected and see each other', idA && idB && idA !== idB, { idA, idB })

  // B needs a few snapshots of A before A's remote vehicle exists there.
  await b.waitForFunction((id) => window.syn3hNet.remotes.has(id), idA, { timeout: 10000 })
  await spyAudio(b)
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
  // The buggy coasts; compare once it has stopped and B's playback has caught up.
  await a.keyboard.down('ShiftLeft')
  await a.waitForFunction(() => { const v = window.syn3h.player.body.linvel(); return Math.hypot(v.x, v.z) < 0.3 }, null, { timeout: 8000 }).catch(() => {})
  await a.keyboard.up('ShiftLeft')
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

  // 5. Laser tag. Separate the two so no further contact passes "it" back, wait out the tag
  // cooldown, then B (it) shoots at where it sees A.
  await b.evaluate(() => {
    const a = window.syn3h.terrain.spawnPoint(0)
    const p = a.position.clone()
    p.z += 20
    p.y = window.syn3h.terrain.heightAt(p.x, p.z) + 1.5
    window.syn3h.player.teleport(p, 0)
  })
  await wait(3300)
  const scoreBefore = await a.evaluate((id) => window.syn3hNet.game.scores[id] ?? 0, idB)
  for (let i = 0; i < 6; i++) {
    await b.evaluate((id) => {
      const n = window.syn3hNet
      const target = n.remotes.get(id).vehicle.body.translation()
      n.fire(undefined, target)
    }, idA)
    const hit = await a.waitForFunction(() => window.syn3hNet.stats.hitsTaken > 0, null, { timeout: 1500 }).then(() => true, () => false)
    if (hit) break
    await wait(400)
  }
  await wait(600)
  const hitsA = await a.evaluate(() => window.syn3hNet.stats.hitsTaken)
  const scoreAfter = await a.evaluate((id) => window.syn3hNet.game.scores[id] ?? 0, idB)
  check('victim detects the laser hit', hitsA > 0, { hitsA })
  const itNow = await a.evaluate(() => window.syn3hNet.game.it)
  check('"it" scores for a laser tag', scoreAfter === scoreBefore + 1, { scoreBefore, scoreAfter, it: itNow })

  // 6. Sounds.
  const [soundsA, soundsB] = [await audioCalls(a), await audioCalls(b)]
  check('sounds: A heard B materialize and the ram', soundsA.includes('materialize') && soundsA.some((c) => c.startsWith('impact:')), { soundsA })
  check('sounds: B heard its shot and the hit', soundsB.includes('laserShot') && soundsB.includes('laserHit'), { soundsB })

  // 7. Identity and name tags.
  await a.evaluate(() => window.syn3hNet.setProfile({ kind: 'buggy-syn3h', colors: { body: '#FF2200', accent: '#00ffcc' } }))
  await b.waitForFunction((id) => window.syn3hNet.players.get(id)?.kind === 'buggy-syn3h', idA, { timeout: 5000 }).catch(() => {})
  const infoA = await b.evaluate((id) => window.syn3hNet.players.get(id), idA)
  check('vehicle kind and colours reach B', infoA?.kind === 'buggy-syn3h' && infoA.colors[0] === '#ff2200' && infoA.colors[1] === '#00ffcc', infoA)
  // Put B behind A, looking at it, so A's tag is on B's screen.
  await a.evaluate(() => { const s = window.syn3h.terrain.spawnPoint(0); window.syn3h.player.teleport(s.position, 0) })
  await b.evaluate(() => {
    const s = window.syn3h.terrain.spawnPoint(0)
    s.position.z += 14
    s.position.y = window.syn3h.terrain.heightAt(s.position.x, s.position.z) + 1.5
    window.syn3h.player.teleport(s.position, 0)
  })
  await wait(1500)
  const tag = await b.evaluate(() => [...document.querySelectorAll('.syn3h-nametags div')].map((d) => ({ text: d.textContent, display: d.style.display, opacity: d.style.opacity })))
  check('B shows a name tag for A', tag.some((t) => t.text.startsWith('Alice') && t.display === 'block' && Number(t.opacity) > 0.5), tag)
  await b.screenshot({ path: shot })

  // 8. Hidden tab heartbeat.
  await b.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await wait(3500)
  const hiddenView = await a.evaluate((id) => { const r = window.syn3hNet.remotes.get(id); return { paused: r.paused, responding: r.responding } }, idB)
  const beats = await b.evaluate(() => window.syn3hNet.stats.heartbeats)
  const hudPaused = await a.evaluate(() => document.getElementById('hud').textContent)
  check('hidden tab shows as paused, not lost', hiddenView.paused && hiddenView.responding && beats >= 2 && hudPaused.includes('(paused)'), { ...hiddenView, beats })
  await b.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await wait(1000)
  const back = await a.evaluate((id) => window.syn3hNet.remotes.get(id).paused, idB)
  check('returning tab resumes', back === false, { paused: back })

  // 9. Bots, owned by the host (A). Needs Vite's module server to build a vehicle in page.
  const botMade = await a.evaluate(async () => {
    try {
      const { createVehicle } = await import('/src/vehicles/index.ts')
      const THREE = await import('three/webgpu').catch(() => null)
      const s = window.syn3h.terrain.spawnPoint(5)
      const pos = THREE ? new THREE.Vector3(s.position.x, s.position.y, s.position.z) : s.position
      const v = createVehicle(window.syn3h.game, window.syn3h.terrain, 'buggy', pos, 0)
      v.isLocal = false
      window.syn3h.game.add(v)
      window.__bots = { vehicles: [v] }
      window.syn3hNet.attachBots(window.__bots)
      return true
    } catch (e) {
      return String(e)
    }
  })
  if (botMade === true) {
    const BOT = 0xff00
    await b.waitForFunction((id) => window.syn3hNet.remotes.has(id), BOT, { timeout: 8000 }).catch(() => {})
    await wait(1500)
    const botView = await b.evaluate((id) => { const r = window.syn3hNet.remotes.get(id); if (!r) return null; const t = r.vehicle.body.translation(); return [t.x, t.y, t.z] }, BOT)
    const botReal = await a.evaluate(() => { const t = window.__bots.vehicles[0].body.translation(); return [t.x, t.y, t.z] })
    check('B sees the host\'s bot where it is', botView && d2(botView, botReal) < 2, { botView, botReal })
    const judgedBefore = await a.evaluate(() => window.syn3hNet.stats.hitsJudged)
    for (let i = 0; i < 6; i++) {
      await b.evaluate((id) => {
        const n = window.syn3hNet
        const target = n.remotes.get(id).vehicle.body.translation()
        n.fire(undefined, target)
      }, BOT)
      const ok = await a.waitForFunction((j) => window.syn3hNet.stats.hitsJudged > j, judgedBefore, { timeout: 2000 }).then(() => true, () => false)
      if (ok) break
      await wait(400)
    }
    await wait(500)
    const judged = await a.evaluate(() => window.syn3hNet.stats.hitsJudged)
    const hitSeen = await b.evaluate(() => window.__audioCalls.filter((c) => c === 'laserHit').length)
    const diag = { a: await a.evaluate(() => ({ lasers: window.syn3hNet.lasers.count, host: window.syn3hNet.isHost })), bFired: await b.evaluate(() => window.syn3hNet.stats.shotsFired) }
    check('host judges a laser hit on its bot', judged > judgedBefore && hitSeen >= 2, { judgedBefore, judged, hitSoundsOnB: hitSeen, ...diag })
  } else {
    console.log(`SKIP bots: ${botMade}`)
  }

  // 10. World seed, and a late joiner who arrives with a different one.
  await a.evaluate(() => window.syn3h.params.set('world.seed', 4242))
  await wait(2500)
  const onGround = (page) => page.evaluate(() => {
    const p = window.syn3h.player.body.translation()
    return { seed: window.syn3h.params.get('world.seed').value, y: +p.y.toFixed(2), ground: +window.syn3h.terrain.heightAt(p.x, p.z).toFixed(2) }
  })
  const seedB = await onGround(b)
  check('seed reaches B and B stays on the new ground', seedB.seed === 4242 && seedB.y > seedB.ground - 1 && seedB.y < seedB.ground + 6, seedB)
  const c = await open('Carol', '&seed=777')
  await c.waitForFunction(() => window.syn3hNet?.connected, null, { timeout: 30000 })
  await wait(2500)
  const seedC = await onGround(c)
  check('late joiner gets the room seed and lands on that ground', seedC.seed === 4242 && seedC.y > seedC.ground - 1 && seedC.y < seedC.ground + 6, seedC)

  const hud = await b.evaluate(() => document.getElementById('hud').textContent)
  console.log('B HUD:\n' + hud)
} catch (e) {
  check('no exception', false, { message: String(e?.message ?? e) })
} finally {
  await browser.close()
}

check('no page errors', errors.length === 0, errors)
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `NET SMOKE FAILED (${failed.length})` : `NET SMOKE OK, screenshot ${shot}`)
process.exit(failed.length ? 1 : 0)
