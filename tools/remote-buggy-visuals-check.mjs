/**
 * Regression check: another player's buggy beyond net.proxyRadius must still look alive.
 *
 * The defect it guards against: beyond that radius a remote buggy is a kinematic body moved
 * along its owner's snapshots, and the buggy's kinematic path returned before the wing state
 * and the steering, and read wheel velocities nothing refreshed. A distant player flew with
 * no wings and drove with wheels that neither turned nor rolled.
 *
 * Player A parks 150 m from player B. B reads A's copy while A opens its wings, closes them,
 * then drives off in a turn. Exit 1 if B's copy of A is not kinematic during a reading (the
 * check would prove nothing), or if its wings, steering or wheel speed do not follow A.
 *
 *   npx vite --port 5201 --strictPort          (starts its own room server)
 *   BASE_URL=http://127.0.0.1:5201/ node tools/remote-buggy-visuals-check.mjs
 *
 * Each player gets its own browser process: two pages in one headless Chrome starve each
 * other's frame loop.
 */
import { chromium } from 'playwright-core'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5201/'
const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist']
const browsers = []
const errors = []
const room = `remotevis${Date.now()}${Math.floor(Math.random() * 1e6)}`

async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  const url = new URL(base)
  url.searchParams.set('room', room); url.searchParams.set('name', name)
  url.searchParams.set('autoplay', '1'); url.searchParams.set('vehicle', 'buggy-syn3h')
  await page.goto(url.href)
  await page.waitForFunction(() => window.mira?.shell && window.miraNet?.connected, null, { timeout: 60000 })
  await page.evaluate(() => {
    window.mira.shell.play()
    window.mira.params.set('gfx.level', 0)
    // Daydream would take over an idle client after its timeout and drive it out of place.
    window.mira.params.set('daydream.seconds', 0)
    window.mira.params.set('bots.count', 0)
  })
  return page
}

const failures = []
try {
  const a = await open('A')
  const b = await open('B')
  const aId = await a.evaluate(() => window.miraNet.id)
  await b.waitForFunction(() => window.miraNet.remotes.size === 1, null, { timeout: 20000 })
  // The flattest dry spot for A within 300 m of the origin, and B 150 m from it.
  const spot = await a.evaluate(() => {
    const t = window.mira.terrain
    let best = null
    for (let x = -300; x <= 300; x += 30) for (let z = -300; z <= 300; z += 30) {
      let lo = Infinity, hi = -Infinity, wet = false
      for (let dx = -40; dx <= 40; dx += 8) for (let dz = -40; dz <= 40; dz += 8) {
        const y = t.heightAt(x + dx, z + dz)
        lo = Math.min(lo, y); hi = Math.max(hi, y)
        if ((t.liquidHeightAt?.(x + dx, z + dz) ?? -Infinity) > y) wet = true
      }
      if (!wet && (!best || hi - lo < best.range)) best = { x, z, range: hi - lo }
    }
    return best
  })
  const place = (page, x, z) => page.evaluate(({ x, z }) => {
    const { terrain, player } = window.mira
    player.teleport(player.object.position.clone().set(x, terrain.heightAt(x, z) + 1.2, z), 0)
  }, { x, z })
  await place(a, spot.x, spot.z)
  await place(b, spot.x + 150, spot.z)
  /** B's copy of A: is it kinematic, how far is it, and what does it show. */
  const seen = () => b.evaluate((id) => {
    const r = window.miraNet.remotes.get(id)
    if (!r) return null
    const v = r.vehicle, p = v.body.translation(), me = window.mira.player.body.translation()
    return {
      kinematic: v.body.isKinematic(), distance: Math.hypot(p.x - me.x, p.z - me.z),
      wingState: v.wingState, wingsOpen: v.wingsOpen, steer: v.steer[0], motorSpeed: v.motorSpeed,
      grounded: v.wheelsGrounded, drive: v.drive,
    }
  }, aId)
  const reading = async (label, ok) => {
    const s = await seen()
    const pass = !!s && s.kinematic && ok(s)
    console.log(JSON.stringify({ label, pass, ...s }))
    if (!pass) failures.push(label)
    return s
  }
  await wait(4000)
  await reading('parked: wings shut, wheels straight and still', (s) => s.wingState === 0 && Math.abs(s.steer) < 0.02 && Math.abs(s.motorSpeed) < 1)

  await a.evaluate(() => { window.mira.game.input.state.special = true })
  await wait(3000)
  await reading('wings open on the distant copy', (s) => s.wingState === 1 && s.wingsOpen)

  await a.evaluate(() => { window.mira.game.input.state.special = false })
  await wait(3000)
  await reading('wings shut again', (s) => s.wingState === 0 && !s.wingsOpen)

  // Drive away from B (B is at +X; turning keeps A well outside the radius either way).
  await a.evaluate(() => { const e = window.mira.game.input.external; e.y = 1; e.x = 0.6 })
  await wait(2500)
  const own = await a.evaluate(() => ({ steer: window.mira.player.steer[0], motorSpeed: window.mira.player.motorSpeed }))
  console.log(JSON.stringify({ label: "A's own buggy", ...own }))
  await reading('wheels turned and rolling while driving', (s) =>
    Math.abs(s.steer) > 0.03 && Math.sign(s.steer) === Math.sign(own.steer) && s.motorSpeed > 3 && s.drive === 'drive')

  await a.evaluate(() => { const e = window.mira.game.input.external; e.y = 0; e.x = 0 })
  console.log(`errors ${JSON.stringify(errors.slice(0, 5))}`)
} finally {
  await Promise.all(browsers.map((b) => b.close()))
}
const bad = failures.length > 0 || errors.length > 0
console.log(`${bad ? 'REMOTE VISUALS FAILED' : 'REMOTE VISUALS OK'}: ${failures.length} failed readings ${JSON.stringify(failures)}, ${errors.length} page errors`)
process.exit(bad ? 1 : 0)
