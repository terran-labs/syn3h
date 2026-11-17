/**
 * How long a removed bot or a departed player lingers, per gameplay list, as each page sees it.
 *   node tools/departure-timing.mjs <base URL> [throttle ...]     e.g. 1 4 6
 * Two pages share a room: Host (simulates the bots) and Guest. Bots go from 4 to 0 on the host,
 * then the host leaves. For each list, the seconds from the change (or from the guest processing
 * the leave) until nothing removed is left in it.
 */
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5419'
const throttles = args.filter((a) => /^\d+$/.test(a)).map(Number)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] })

// Installed in each page: records every vehicle a departure is played for, and samples lists.
const install = () => {
  const s = window.syn3h, n = window.syn3hNet, m = s.materialize
  window.__gone = []
  if (m?.depart) { const depart = m.depart.bind(m); m.depart = (vehicle, ...rest) => { window.__gone.push(vehicle); return depart(vehicle, ...rest) } }
  window.__sample = (bots) => {
    const inWorld = (v) => s.game.world.getRigidBody(v.body.handle) === v.body
    const players = [...n.players.values()].filter((p) => (bots ? p.bot : !p.bot && p.id !== n.id)).length
    const remotes = [...n.remotes.keys()].filter((id) => (bots ? id >= 0xff00 : id < 0xff00)).length
    const markers = n.mapMarkers().filter((mk) => (bots ? mk.kind === 'bot' : mk.kind === 'person')).length - (bots ? 0 : 1)
    const departing = window.__gone.filter((v) => (bots ? v.kind !== undefined : true))
    return { players, remotes, markers, scene: departing.filter((v) => !!v.object.parent).length, physics: departing.filter(inWorld).length }
  }
}

async function run(throttle) {
  const room = `dt${Date.now() % 100000}`
  const open = async (name) => {
    const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage()
    await page.goto(`${base}/?room=${room}&name=${name}&autoplay=1&vehicle=buggy`)
    await page.waitForFunction(() => window.syn3hNet?.connected && window.syn3h?.game.tick > 60, null, { timeout: 120000 })
    await page.evaluate(() => { window.syn3h.shell.play?.(); window.syn3h.bots.daydream?.setBlocker?.(() => true) })
    if (throttle > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle })
    await page.evaluate(install)
    return page
  }
  const host = await open('Host'), guest = await open('Guest')
  await host.evaluate(() => window.syn3h.params.set('bots.count', 4))
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => [...window.syn3hNet.players.values()].filter((x) => x.bot).length >= 4 && (window.syn3hNet.isHost || window.syn3hNet.remotes.size >= 5), null, { timeout: 120000 })))
  await wait(3000)
  const lists = ['players', 'remotes', 'markers', 'scene', 'physics']
  const timeLists = async (page, bots, since) => {
    const done = {}
    for (let i = 0; i < 300 && lists.some((l) => done[l] === undefined); i++) {
      const s = await page.evaluate((b) => window.__sample(b), bots)
      const t = (Date.now() - since) / 1000
      for (const l of lists) if (done[l] === undefined && s[l] <= 0) done[l] = +t.toFixed(2)
      await wait(50)
    }
    return done
  }
  const t0 = Date.now()
  await host.evaluate(() => window.syn3h.params.set('bots.count', 0))
  const [h, g] = await Promise.all([timeLists(host, true, t0), timeLists(guest, true, t0)])
  console.log(`throttle ${throttle}x, 4 bots removed: host ${JSON.stringify(h)}; guest ${JSON.stringify(g)}`)
  // The host leaves: time on the guest from processing the leave.
  await guest.evaluate(() => { const n = window.syn3hNet, remove = n.removeRemote.bind(n); n.removeRemote = (...a) => { if (a[0] < 0xff00) window.__leftAt = Date.now(); return remove(...a) } })
  await host.evaluate(() => window.syn3hNet.leave?.() ?? window.syn3hNet.close?.())
  await host.context().close()
  await guest.waitForFunction(() => window.__leftAt, null, { timeout: 90000 })
  const leftAt = await guest.evaluate(() => window.__leftAt)
  const p = await timeLists(guest, false, leftAt)
  console.log(`throttle ${throttle}x, player left: guest ${JSON.stringify(p)}`)
  await guest.context().close()
}

try {
  for (const t of throttles.length ? throttles : [1, 4, 6]) await run(t)
} finally {
  await browser.close()
}
