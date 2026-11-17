/**
 * Screenshots of departures as a guest sees them: a bot the host removes, then a player who
 * leaves. Each should play the arrival cloud in reverse and the vehicle vanish inside it.
 *   node tools/departure-shots.mjs <base URL> <out dir> [day|night]
 * Prints, after each departure, whether the vehicle was removed from the scene and the world.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const [base = 'http://127.0.0.1:5419', out = '/tmp/departure', light = 'night'] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] })
const errors = []
try {
  const room = `dep${Date.now() % 100000}`
  const open = async (name, bots) => {
    const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
    await page.goto(`${base}/?room=${room}&name=${name}&autoplay=1&vehicle=buggy`)
    await page.waitForFunction(() => window.syn3hNet?.connected && window.syn3h.materialize && window.syn3h.game.tick > 100, null, { timeout: 120000 })
    await page.evaluate(([bots, night]) => {
      const s = window.syn3h
      s.shell.play?.(); s.shell.closeMenu?.(); s.bots.daydream?.setBlocker?.(() => true)
      s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', night ? 21.5 : 11); s.params.set('bots.count', bots)
    }, [bots, light === 'night'])
    return page
  }
  const host = await open('Host', 1)
  const guest = await open('Guest', 1)
  await guest.waitForFunction(() => window.syn3hNet.remotes.size >= 2, null, { timeout: 60000 })
  await wait(3000)
  // The guest looks at a remote from 22 m, a little off to one side.
  const face = (id) => guest.evaluate((id) => {
    const s = window.syn3h, t = window.syn3hNet.remotes.get(id).vehicle.body.translation(), px = t.x + 8, pz = t.z + 20
    s.player.teleport(new s.player.object.position.constructor(px, s.terrain.heightAt(px, pz) + 1, pz), Math.atan2(-(t.x - px), -(t.z - pz)))
  }, id)
  await guest.evaluate(() => {
    const s = window.syn3h, m = s.materialize, depart = m.depart.bind(m)
    window.__departed = []
    m.depart = (vehicle, ...rest) => { window.__departed.push({ vehicle, at: s.game.time }); return depart(vehicle, ...rest) }
  })
  const capture = async (label) => {
    await guest.waitForFunction((n) => window.__departed.length >= n, label === 'bot' ? 1 : 2, { timeout: 90000 })
    for (const [i, at] of [0.05, 0.25, 0.5, 0.75, 0.95, 1.3].entries()) {
      await guest.waitForFunction((at) => window.syn3h.game.time - window.__departed.at(-1).at >= at, at, { timeout: 30000 })
      // The guest's own buggy would block the view: hide it for the shot only.
      await guest.evaluate(() => new Promise((done) => { window.syn3h.player.object.visible = false; requestAnimationFrame(() => requestAnimationFrame(() => { window.syn3h.game.pause(); done() })) })); await wait(150)
      await guest.screenshot({ path: `${out}/${label}-${light}-${i + 1}.png` })
      await guest.evaluate(() => { window.syn3h.player.object.visible = true; window.syn3h.game.resume() })
    }
    await wait(500)
    console.log(label, JSON.stringify(await guest.evaluate(() => {
      const s = window.syn3h, v = window.__departed.at(-1).vehicle
      return { inScene: !!v.object.parent, bodyInWorld: s.game.world.getRigidBody(v.body.handle) === v.body, remotes: window.syn3hNet.remotes.size, materializing: s.materialize.isMaterializing(v) }
    })))
  }
  const ids = await guest.evaluate(() => [...window.syn3hNet.remotes.keys()])
  const botId = ids.find((id) => id >= 0xff00) ?? ids[0], hostId = ids.find((id) => id !== botId)
  await face(botId); await wait(1500)
  await host.evaluate(() => window.syn3h.params.set('bots.count', 0))
  await capture('bot')
  await face(hostId); await wait(1500)
  await host.context().close()
  await capture('player')
} finally {
  await browser.close()
}
if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1 }
