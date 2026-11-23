/**
 * Screenshots of a vehicle arrival (src/vehicles/effects/Materialize.ts and arrivalLook.ts).
 *   node tools/arrival-shots.mjs <base URL> <out dir> [day|night] [desktop|phone] [strip|far]
 * strip: six frames across one switch, the game paused for each shot.
 * far: a second player 70 m away watches the first one switch.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const [base = 'http://127.0.0.1:5419', out = '/tmp/arrival', light = 'day', device = 'desktop', mode = 'strip'] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const viewport = device === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 720 }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] })
const errors = []
try {
  const context = await browser.newContext({ viewport, deviceScaleFactor: device === 'phone' ? 2 : 1, isMobile: device === 'phone', hasTouch: device === 'phone' })
  const room = `arr${Date.now() % 100000}`
  // Each player in its own context, so neither page is a hidden (paused) background tab.
  const open = async (name) => {
    const own = name === 'Arrive' ? context : await browser.newContext({ viewport, deviceScaleFactor: device === 'phone' ? 2 : 1, isMobile: device === 'phone', hasTouch: device === 'phone' })
    const page = await own.newPage()
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
    await page.goto(`${base}/?room=${room}&name=${name}&autoplay=1&vehicle=buggy`)
    await page.waitForFunction(() => window.mira?.game?.tick > 200 && window.mira.materialize, null, { timeout: 90000 })
    await page.evaluate((night) => {
      const s = window.mira
      s.shell.play?.(); s.shell.closeMenu?.()
      // No autopilot: the player must stay where the script puts it.
      s.bots.daydream?.setBlocker?.(() => true)
      s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', night ? 22.5 : 11)
    }, light === 'night')
    return page
  }
  const a = await open('Arrive')
  await wait(4000)
  if (mode === 'far') {
    const b = await open('Watch')
    await b.waitForFunction(() => window.miraNet?.remotes?.size >= 1, null, { timeout: 30000 })
    await wait(2000)
    // Put the watcher 70 m away and to one side, facing the arriving player.
    const target = await a.evaluate(() => { const t = window.mira.player.body.translation(); return [t.x, t.y, t.z] })
    await b.evaluate(([x, , z]) => {
      const s = window.mira, px = x + 25, pz = z + 65
      s.player.teleport(new s.player.object.position.constructor(px, s.terrain.heightAt(px, pz) + 1.5, pz), Math.atan2(-(x - px), -(z - pz)) + .3)
    }, target)
    await wait(1500)
    // The arriving player must be on the watcher's screen, or the frames show nothing.
    const onScreen = await b.evaluate(() => {
      const s = window.mira, r = [...window.miraNet.remotes.values()].find((r) => r.info.name === 'Arrive')
      if (!r) return null
      const p = r.vehicle.object.position.clone().project(s.game.camera)
      return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(3), distance: +s.game.camera.position.distanceTo(r.vehicle.object.position).toFixed(1) }
    })
    console.log('arriving player on the watcher screen (x, y in -1..1):', JSON.stringify(onScreen))
    // Start when the watcher's copy begins its arrival, then a frame every 300 ms.
    await b.evaluate(() => { const s = window.mira, m = s.materialize, begin = m.begin.bind(m); window.__arrived = null; m.begin = (...args) => { window.__arrived = s.game.time; return begin(...args) } })
    await a.evaluate(() => window.mira.swapVehicle('jet'))
    await b.waitForFunction(() => window.__arrived !== null, null, { timeout: 20000 })
    for (const [i, at] of [0.3, 0.7, 1.1, 1.4].entries()) {
      await b.waitForFunction((at) => window.mira.game.time - window.__arrived >= at, at, { timeout: 30000 })
      await b.evaluate(() => window.mira.game.pause()); await wait(150)
      await b.screenshot({ path: `${out}/far-${light}-${device}-${i + 1}.png` })
      if (i === 1) console.log('watcher look:', JSON.stringify(await b.evaluate(() => {
        const s = window.mira, m = s.materialize, l = m.looks.find((l) => l.active)
        if (!l) return { active: false, holds: m.holds.length }
        const p = l.beam.position.clone(), top = p.clone().setY(p.y + l.beam.scale.y)
        return { far: l.u.far.value, progress: l.u.progress.value, strength: l.u.strength.value, beamScale: l.beam.scale.toArray().map((n) => +n.toFixed(2)), visible: l.object.visible && l.beam.visible, inScene: l.object.parent === s.game.scene, base: p.project(s.game.camera).toArray().map((n) => +n.toFixed(2)), top: top.project(s.game.camera).toArray().map((n) => +n.toFixed(2)) }
      })))
      await b.evaluate(() => window.mira.game.resume())
    }
  } else {
    const times = [0.1, 0.35, 0.6, 0.9, 1.15, 1.5]
    await a.evaluate(() => { window.__arrivalStart = window.mira.game.time; window.mira.swapVehicle('jet') })
    for (const [i, at] of times.entries()) {
      await a.waitForFunction((at) => window.mira.game.time - window.__arrivalStart >= at, at, { timeout: 30000 })
      await a.evaluate(() => window.mira.game.pause())
      await wait(150)
      await a.screenshot({ path: `${out}/${light}-${device}-${i + 1}.png` })
      await a.evaluate(() => window.mira.game.resume())
    }
  }
} finally {
  await browser.close()
}
if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1 }
