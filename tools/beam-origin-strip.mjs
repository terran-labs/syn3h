/**
 * Strips of consecutive frames of a tag beam leaving the firing vehicle, for the beam origin
 * check: at rest, at speed on the ground, in flight, and as another player sees it.
 *
 *   tools/heavy.sh node tools/beam-origin-strip.mjs http://127.0.0.1:5391/ /tmp/beam-origin [label]
 *
 * For each scenario it writes <out>/<label>-<scenario>-f<n>.png, one per drawn frame, and
 * prints per frame where the visible tail of each fresh beam is, measured along the vehicle's
 * nose from the vehicle's drawn centre (negative is behind the centre) and its distance from
 * that centre. The local scenarios hold the game loop and advance it one 60 Hz frame at a
 * time, so the strips are truly consecutive frames. The remote scenario lets both pages run
 * and samples every frame on the watching page, with screenshots as fast as they come.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://127.0.0.1:5391/'
const out = process.argv[3] ?? '/tmp/beam-origin'
const label = process.argv[4] ?? 'run'
mkdirSync(out, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const room = `beamorigin${Date.now() % 100000}`

/** In the page: a probe measuring every fresh beam against a vehicle's drawn centre. */
function installProbe() {
  const { game } = window.mira
  window.__beam = { rows: [], vehicle: null, shooter: null }
  game.add({
    update() {
      const v = window.__beam.vehicle
      if (!v) return
      const lasers = window.miraNet.lasers
      const c = v.object.position
      const q = v.object.quaternion
      // Nose is local -Z.
      const fx = -2 * (q.x * q.z + q.w * q.y), fy = -2 * (q.y * q.z - q.w * q.x), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
      for (const p of lasers.shots) {
        if (p.shooter !== window.__beam.shooter || p.age > 0.25 || !p.mesh.visible) continue
        // Where the beam is drawn: its tail and head in world space, from the mesh itself.
        p.mesh.updateMatrixWorld(true)
        const e = p.mesh.matrixWorld.elements
        const at = (z) => [e[8] * z + e[12], e[9] * z + e[13], e[10] * z + e[14]]
        const tail = at(-8), head = at(2)
        const dx = tail[0] - c.x, dy = tail[1] - c.y, dz = tail[2] - c.z
        window.__beam.rows.push({
          frame: game.frames, shot: p.id, age: +p.age.toFixed(3),
          tailAlong: +(dx * fx + dy * fy + dz * fz).toFixed(2),
          tailFromCentre: +Math.hypot(dx, dy, dz).toFixed(2),
          headAlong: +((head[0] - c.x) * fx + (head[1] - c.y) * fy + (head[2] - c.z) * fz).toFixed(2),
          speed: +Math.hypot(...Object.values(v.body.linvel())).toFixed(1),
        })
      }
    },
  })
}

/** In the page: hold the player at `speed` along its nose, `flight` metres up. */
function drive({ speed, flight }) {
  const { game } = window.mira
  const v = window.mira.player
  if (flight) {
    const t = v.body.translation()
    v.body.setTranslation({ x: t.x, y: t.y + flight, z: t.z }, true)
  }
  window.__drive?.()
  const sys = {
    fixedUpdate() {
      const p = window.mira.player
      const r = p.body.rotation()
      const fx = -2 * (r.x * r.z + r.w * r.y), fz = -(1 - 2 * (r.x * r.x + r.y * r.y))
      const len = Math.hypot(fx, fz) || 1
      const vy = flight ? 0 : p.body.linvel().y
      p.body.setLinvel({ x: (fx / len) * speed, y: vy, z: (fz / len) * speed }, true)
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    },
  }
  game.add(sys)
  window.__drive = () => game.remove(sys, false)
}

async function startPage(browser, name) {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message))
  await page.goto(`${base}?room=${room}&name=${name}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.shell && window.miraNet, null, { timeout: 90000 })
  await page.evaluate(() => window.mira.shell.play())
  await wait(500)
  // Only the game canvas in the pictures: the HUD and side panels hide the car.
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } #game, #game * { visibility: visible !important }' })
  await page.waitForFunction(() => window.miraNet.id !== undefined && window.mira.game.frames > 60, null, { timeout: 60000 })
  await page.evaluate(installProbe)
  return page
}

async function localStrip(page, scenario, opts) {
  await page.evaluate(drive, opts)
  await wait(opts.speed ? 900 : 1500)
  await page.evaluate(() => {
    window.__beam.vehicle = window.mira.player
    window.__beam.shooter = window.miraNet.id
    window.__beam.rows = []
    window.mira.game.pause()
  })
  const step = () => page.evaluate(() => {
    const g = window.mira.game
    g.last = performance.now() - 1000 / 60
    g.frame()
  })
  // Settle one frame, fire, then draw frames one at a time.
  await step()
  await page.evaluate(() => {
  const aside = () => {
    // A little up and to the right of the nose, so the chase camera sees the beam over the car.
    const q = window.mira.player.body.rotation()
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
    const len = Math.hypot(fx, fz) || 1
    window.miraNet.fire([fx / len - 0.3 * fz / len, 0.1, fz / len + 0.3 * fx / len])
  }
    aside()
  })
  for (let f = 0; f < 6; f++) {
    await step()
    await page.screenshot({ path: `${out}/${label}-${scenario}-f${f}.png` })
  }
  const rows = await page.evaluate(() => window.__beam.rows)
  await page.evaluate(() => { window.__drive?.(); window.__drive = null; window.mira.game.resume() })
  console.log(JSON.stringify({ scenario, rows }))
  return rows
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const a = await startPage(browser, 'Shooter')
  // Another player's view: B watches A's replica while A drives and fires.
  const b = await startPage(browser, 'Watcher')
  await b.waitForFunction(() => window.miraNet.remotes.size > 0, null, { timeout: 30000 })
  const shooterId = await a.evaluate(() => window.miraNet.id)
  await a.evaluate(drive, { speed: 60, flight: 0 })
  await b.evaluate((id) => {
    const r = window.miraNet.remotes.get(id)
    window.__beam.vehicle = r.vehicle
    window.__beam.shooter = id
    window.mira.camera.setVehicle(r.vehicle)
  }, shooterId)
  await wait(2500)
  await b.evaluate(() => { window.__beam.rows = [] })
  await a.evaluate(() => { for (let i = 0; i < 4; i++) setTimeout(() => {
    const aside = () => {
    // A little up and to the right of the nose, so the chase camera sees the beam over the car.
    const q = window.mira.player.body.rotation()
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
    const len = Math.hypot(fx, fz) || 1
    window.miraNet.fire([fx / len - 0.3 * fz / len, 0.1, fz / len + 0.3 * fx / len])
  }
    aside()
  }, i * 400) })
  for (let f = 0; f < 10; f++) {
    const glows = await b.evaluate(() => window.miraNet.lasers.glows.length)
    await b.screenshot({ path: `${out}/${label}-remote60-f${f}.png` })
    console.log(`remote60 f${f} glows ${glows}`)
    await wait(30)
  }
  await wait(800)
  console.log(JSON.stringify({ scenario: 'remote60', rows: await b.evaluate(() => window.__beam.rows) }))
  await b.close()
  await a.evaluate(() => { window.__drive?.(); window.__drive = null })
  await localStrip(a, 'rest', { speed: 0, flight: 0 })
  await localStrip(a, 'ground50', { speed: 50, flight: 0 })
  await localStrip(a, 'ground100', { speed: 100, flight: 0 })
  await localStrip(a, 'flight100', { speed: 100, flight: 40 })

} finally {
  await browser.close()
}
