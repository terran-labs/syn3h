/**
 * End-to-end multiplayer check. Needs the dev server, which also starts the room server on
 * 8787 (or run them apart: `SYN3H_NO_ROOM_SERVER=1 npx vite ...` plus `npm run server`):
 *
 *   npx vite --port 5183 --strictPort
 *   node tools/net-smoke.mjs [http://localhost:5183/]
 *
 * Also works against a production build (`npx wrangler dev`), including real bot-manager checks.
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
 *  9. bots: A (host) owns a bot, B sees it, both list it for audio, and B's laser hit on it is
 *     judged by A
 * 10. world seed: A changes it, B regenerates and stays on the ground; a late joiner with a
 *     different ?seed= gets the room's seed
 * 11. King of the Hill: A switches the mode, the host's zone reaches everyone, A alone on the
 *     rim scores, B joins it and the hill is contested, B sinks into the lava lake and is
 *     stuck (still visible to A), then is lifted back to its pad
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()} at ${m.location().url}`) })
  page.on('response', (r) => { if (r.status() >= 400) console.log(`HTTP ${r.status()} ${r.url()}`) })
  page.on('requestfailed', (r) => console.log(`REQUEST FAILED ${r.url()} ${r.failure()?.errorText}`))
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
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet?.connected && [...window.syn3hNet.players.values()].filter(p => !p.bot).length === 2, null, { timeout: 30000 })))
  const [idA, idB] = await both(() => window.syn3hNet.id)
  const humanViews = await both(() => [...window.syn3hNet.players.values()].filter(p => !p.bot))
  check('both connected and see each other', idA && idB && idA !== idB && humanViews.every(ps => ps.length === 2 && ps.some(p => p.id === idA && p.name === 'Alice') && ps.some(p => p.id === idB && p.name === 'Bob')), { idA, idB, humanViews })
  await Promise.all([a, b].map(p => p.waitForFunction(() => [...window.syn3hNet.players.values()].some(p => p.bot), null, { timeout: 10000 })))
  const readBots = () => both(() => ({ requested: window.syn3h.params.get('bots.count').value, ids: [...window.syn3hNet.players.values()].filter(p => p.bot).map(p => p.id).sort(), effective: window.syn3h.bots.vehicles.length }))
  let defaultBots = await readBots()
  for (let i = 0; i < 50 && !(defaultBots[0].ids.length === defaultBots[0].effective && defaultBots[0].effective > 0 && JSON.stringify(defaultBots[0].ids) === JSON.stringify(defaultBots[1].ids)); i++) {
    await wait(200)
    defaultBots = await readBots()
  }
  check('default bots join and replicate', defaultBots.every(v => v.requested === 4 && v.ids.length > 0) && defaultBots[0].ids.length === defaultBots[0].effective && JSON.stringify(defaultBots[0].ids) === JSON.stringify(defaultBots[1].ids), defaultBots)
  // Preserve normal-default coverage above, then isolate the two-human scoring fixture.
  // Section 9 separately exercises the real manager and bot hit authority.
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))
  await Promise.all([a, b].map(p => p.waitForFunction(() => ![...window.syn3hNet.players.values()].some(p => p.bot), null, { timeout: 10000 })))


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
  // Both pages share one headless Chrome, and a page that is still loading starves the other
  // of frames: wait until B's game is running before asking A to drive, and drive until A
  // has covered ground (up to 10 s), not for a fixed time that a busy machine can eat.
  await b.waitForFunction(() => window.syn3h.game.time > 1.5, null, { timeout: 30000 }).catch(() => {})
  const before = await remoteOfA()
  const realBefore = await realA()
  const startA = realBefore
  await a.bringToFront()
  await a.keyboard.down('KeyW')
  await a.waitForFunction(([x, z]) => { const t = window.syn3h.player.body.translation(); return Math.hypot(t.x - x, t.z - z) > 12 }, [startA[0], startA[2]], { timeout: 10000 }).catch(() => {})
  await a.keyboard.up('KeyW')
  // The buggy coasts; compare once it has stopped and B's playback has caught up.
  await a.keyboard.down('ShiftLeft')
  await a.waitForFunction(() => { const v = window.syn3h.player.body.linvel(); return Math.hypot(v.x, v.z) < 0.3 }, null, { timeout: 8000 }).catch(() => {})
  await a.keyboard.up('ShiftLeft')
  // Two separate questions, so a slow buggy and a starved copy are told apart: did A itself
  // drive (read on A), and did B's copy of A follow (read on B). B's page is in the background
  // while A is driven, and under load its playback lags, so wait for the copy to move instead
  // of sleeping a fixed time: up to 10 s for the 3 m that 3 s of throttle exceeds tenfold.
  const truth = await realA()
  check('A itself drives', d2(realBefore, truth) > 10, { before: realBefore, after: truth, moved: +d2(realBefore, truth).toFixed(2) })
  let after = await remoteOfA()
  for (let i = 0; i < 50 && !(d2(before, after) > 3 && d2(after, truth) < 2); i++) { await wait(200); after = await remoteOfA() }
  check('A moves on B', d2(before, after) > 3, { before, after, moved: +d2(before, after).toFixed(2) })
  check('B tracks A within 2 m once settled', d2(after, truth) < 2, { remote: after, real: truth, error: +d2(after, truth).toFixed(2) })

  // Releases cut before the shared room clock existed have neither `seaTime` nor `onRoomClock`
  // on the network client: skip these two checks there instead of failing the release.
  const hasRoomClock = await a.evaluate(() => typeof window.syn3hNet?.onRoomClock === 'function' && window.syn3hNet.seaTime !== undefined)
  if (!hasRoomClock) console.log('SKIP shared room clock checks: this build predates them')
  else {
    // The sea runs on the room's clock, so both screens show the same wave at the same moment;
    // the wind is handed the same clock through the same hook. Read through the network client
    // (importing the modules by path can give a second copy of them on a dev server). The sea
    // takes the room clock a moment after it syncs, calming the swell across the change.
    await Promise.all([a, b].map((p) => p.waitForFunction(() => Math.abs(window.syn3hNet.seaTime - window.syn3hNet.clock.now()) < 0.05, null, { timeout: 8000 }).catch(() => {})))
    const clocks = (page) => page.evaluate(() => {
      const n = window.syn3hNet
      let handed = null
      n.onRoomClock((now) => { handed = now() })
      return { sea: n.seaTime, room: n.clock.now(), game: window.syn3h.game.time, handed, at: Date.now() }
    })
    const [seaA, seaB] = await Promise.all([clocks(a), clocks(b)])
    // Each was read at its own instant; compare after allowing for that.
    const apart = Math.abs((seaA.sea - seaA.at / 1000) - (seaB.sea - seaB.at / 1000))
    check('the sea runs on the shared room clock on both screens', Math.abs(seaA.sea - seaA.room) < 0.05 && Math.abs(seaB.sea - seaB.room) < 0.05 && apart < 0.15 && Math.abs(seaA.sea - seaA.game) > 1,
      { apartSeconds: +apart.toFixed(3), aSeaMinusRoom: +(seaA.sea - seaA.room).toFixed(3), bSeaMinusRoom: +(seaB.sea - seaB.room).toFixed(3) })
    check('onRoomClock hands a later asker the room clock at once', seaA.handed !== null && Math.abs(seaA.handed - seaA.room) < 0.05 && seaB.handed !== null && Math.abs(seaB.handed - seaB.room) < 0.05,
      { aHandedMinusRoom: seaA.handed === null ? null : +(seaA.handed - seaA.room).toFixed(3), bHandedMinusRoom: seaB.handed === null ? null : +(seaB.handed - seaB.room).toFixed(3) })
  }

  // 3. Shared slider, clamped by the server.
  await a.evaluate(() => window.syn3h.params.set('laser.speed', 250))
  await a.evaluate(() => window.syn3h.params.set('world.gravity', 500))
  // Wait for the values to arrive, up to 5 s: a fixed half second was sometimes too short on
  // a public address just after a deploy. The checks below still fail if they never do.
  await b.waitForFunction(() => window.syn3h.params.get('laser.speed').value === 250 && window.syn3h.params.get('world.gravity').value === 18.81, null, { timeout: 5000 }).catch(() => {})
  await a.waitForFunction(() => window.syn3h.params.get('world.gravity').value === 18.81, null, { timeout: 5000 }).catch(() => {})
  const [speedB, gravB, gravA] = await b.evaluate(() => [window.syn3h.params.get('laser.speed').value, window.syn3h.params.get('world.gravity').value]).then(async (r) => [...r, await a.evaluate(() => window.syn3h.params.get('world.gravity').value)])
  check('shared slider reaches B', speedB === 250, { speedB })
  check('server clamps a shared slider for everyone', gravB === 18.81 && gravA === 18.81, { gravA, gravB })
  await a.evaluate(() => window.syn3h.params.set('world.gravity', 9.81))

  // Reset scores after removing default bots, then verify Alice still holds it before the ram fixture.
  await a.evaluate(() => window.syn3h.params.set('game.mode', 1))
  await b.waitForFunction(() => window.syn3hNet.game.mode === 1)
  await a.evaluate(() => window.syn3h.params.set('game.mode', 0))
  await Promise.all([a, b].map(p => p.waitForFunction(id => window.syn3hNet.game.mode === 0 && window.syn3hNet.game.it === id, idA)))
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
  // Wait for the colour: the kind is already the default, so waiting on it alone returned at
  // once and read the old colours whenever the link had real latency.
  await b.waitForFunction((id) => window.syn3hNet.players.get(id)?.colors[0] === '#ff2200', idA, { timeout: 5000 }).catch(() => {})
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

  // 9. Exercise the actual manager in both Vite and production, without module imports.
  await a.evaluate(() => {
    const s = window.syn3h
    s.params.set('bots.canDrive', false); s.params.set('bots.canFire', false)
    s.params.set('bots.count', 1)
    window.__bots = s.bots
  })
  const botMade = await a.waitForFunction(() => window.syn3h.bots.vehicles.length === 1, null, { timeout: 8000 }).then(() => true, () => false)
  check('host manager spawns a bot', botMade, {})
  const ownership = await both(() => window.syn3h.bots.remote)
  check('only the host bot manager drives', ownership[0] === false && ownership[1] === true, { ownership })
  if (botMade === true) {
    const BOT = 0xff00
    await b.waitForFunction((id) => window.syn3hNet.remotes.has(id), BOT, { timeout: 8000 }).catch(() => {})
    await wait(1500)
    const botView = await b.evaluate((id) => { const r = window.syn3hNet.remotes.get(id); if (!r) return null; const t = r.vehicle.body.translation(); return [t.x, t.y, t.z] }, BOT)
    const botReal = await a.evaluate(() => { const t = window.__bots.vehicles[0].body.translation(); return [t.x, t.y, t.z] })
    check('B sees the host\'s bot where it is', botView && d2(botView, botReal) < 2, { botView, botReal })
    // Audio hears the other player and the bot on both sides (replica on B, own bot on A).
    const audible = await both(() => window.syn3hNet.audibleVehicles().length)
    check('audio gets the other player and the bot', audible[0] === 2 && audible[1] === 2, { audible })
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
  }
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))

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

  // 11. King of the Hill. Spy on the shell's match display and inject a seeded bot namer, as
  // main.ts would pass them.
  await b.evaluate(() => {
    window.__match = []
    window.syn3hNet.ctx.setMatchState = (m) => window.__match.push(m)
    window.syn3hNet.ctx.names = (seed, kind) => `${kind}-${seed}`
  })
  await a.evaluate(() => window.syn3h.params.set('game.mode', 1))
  await b.waitForFunction(() => window.syn3hNet.game.mode === 1 && window.syn3hNet.game.koth.zone, null, { timeout: 8000 }).catch(() => {})
  const zone = await b.evaluate(() => window.syn3hNet.game.koth.zone)
  const markerShown = await b.evaluate(() => window.syn3hNet.hill.visible)
  check('mode switch reaches B with the host\'s zone', zone && markerShown, { zone, markerShown })
  if (zone) {
    /** Park a page's vehicle on the zone's mid line at an angle, on the ground. */
    const park = (page, angle) => page.evaluate(({ zone, angle }) => {
      const r = (zone.inner + zone.outer) / 2
      const x = zone.x + Math.cos(angle) * r
      const z = zone.z + Math.sin(angle) * r
      const THREE_V = window.syn3h.player.object.position.clone()
      THREE_V.set(x, window.syn3h.terrain.heightAt(x, z) + 1.2, z)
      window.syn3h.player.teleport(THREE_V, 0)
      const p = window.syn3h.player.body.translation()
      return { p: [p.x, p.y, p.z], lava: window.syn3h.terrain.liquidHeightAt?.(x, z) }
    }, { zone, angle })
    const score = (id) => a.evaluate((id) => window.syn3hNet.game.scores[id] ?? 0, id)
    const parkedA = await park(a, 0.3)
    await b.evaluate(() => { const s = window.syn3h.terrain.spawnPoint(1); window.syn3h.player.teleport(s.position, 0) })
    // Wait for the server's result, rather than starting a four-second timer while a
    // loaded browser may still be delivering the teleport. Keep the scoring threshold.
    const scoringStart = Date.now()
    await a.waitForFunction((id) => window.syn3hNet.game.koth.holder === id && (window.syn3hNet.game.scores[id] ?? 0) >= 2, idA, { timeout: 15000 }).catch(() => {})
    const [holder, scoreA] = [await a.evaluate(() => window.syn3hNet.game.koth.holder), await score(idA)]
    check('A alone on the hill holds it and scores', holder === idA && scoreA >= 2, { holder, scoreA, parkedA, elapsedMs: Date.now() - scoringStart })
    await b.waitForFunction(() => window.__match.at(-1)?.scores.some((x) => x.name === 'Alice' && x.score >= 2), null, { timeout: 5000 }).catch(() => {})
    const held = await b.evaluate(() => window.__match.at(-1))
    check('match display: A holds, scores in seconds, target 60', held?.mode === 'koth' && held.holderName === 'Alice' && !held.holderIsYou && held.target === 60 && held.scores.find((x) => x.name === 'Alice')?.score >= 2 && held.scores.some((x) => x.you), held)
    await b.screenshot({ path: '/tmp/syn3h-koth-far.png' })

    await park(b, 0.3 + 0.15)
    await wait(1500)
    const s1 = await score(idA)
    await wait(2500)
    const s2 = await score(idA)
    const contested = await b.evaluate(() => window.syn3hNet.game.koth.contested)
    const hudB = await b.evaluate(() => document.getElementById('hud').textContent)
    check('B joins and the hill is contested, nobody scores', contested && s2 === s1 && hudB.includes('CONTESTED'), { contested, s1, s2 })
    const cont = await b.evaluate(() => ({ last: window.__match.at(-1), updates: window.__match.length, botName: window.syn3hNet.displayName(0xff00) }))
    check('match display: contested, few updates, seeded bot name', cont.last?.contested === true && cont.last.holderName === null && cont.updates < 40 && cont.botName.startsWith('bot-4242:65280'), cont)
    await b.screenshot({ path: '/tmp/syn3h-koth.png' })

    // Into the lava lake, if this terrain has one under the zone's centre.
    const lavaAt = await b.evaluate((zone) => window.syn3h.terrain.liquidHeightAt?.(zone.x, zone.z) ?? -Infinity, zone)
    if (Number.isFinite(lavaAt)) {
      await b.evaluate(({ zone, lavaAt }) => {
        const v = window.syn3h.player.object.position.clone()
        v.set(zone.x, lavaAt - 0.5, zone.z)
        window.syn3h.player.teleport(v, 0)
      }, { zone, lavaAt })
      await wait(800)
      const outB = await a.evaluate((id) => window.syn3hNet.game.koth.out[id] ?? 0, idB)
      const stuck = await b.evaluate(() => ({ count: window.syn3hNet.stats.stuck, visible: window.syn3h.player.object.visible, hud: document.getElementById('hud').textContent.match(/stuck in the lava[^\n]*/)?.[0] ?? null }))
      const visibleOnA = await a.evaluate((id) => window.syn3hNet.remotes.get(id)?.vehicle.object.visible === true, idB)
      check('lava sticks B: it sits out of the hill count but stays in the world', stuck.count === 1 && stuck.visible && stuck.hud && outB > 0 && visibleOnA, { stuck, outB, visibleOnA })
      await wait(3500)
      const back = await b.evaluate(() => {
        const p = window.syn3h.player.body.translation()
        return { visible: window.syn3h.player.object.visible, y: +p.y.toFixed(1), ground: +window.syn3h.terrain.heightAt(p.x, p.z).toFixed(1) }
      })
      check('B is lifted back to its pad after the delay', back.visible && back.y > back.ground - 1 && back.y < back.ground + 6, back)
    } else {
      console.log('SKIP lava: no lava under the zone centre on this terrain')
    }
  }

  const hud = await b.evaluate(() => document.getElementById('hud').textContent)
  console.log('B HUD:\n' + hud)
} catch (e) {
  check('no exception', false, { message: String(e?.message ?? e), stack: e?.stack })
} finally {
  await browser.close()
}

check('no page errors', errors.length === 0, errors)
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `NET SMOKE FAILED (${failed.length})` : `NET SMOKE OK, screenshot ${shot}`)
process.exit(failed.length ? 1 : 0)
