// Every arrival in the lobby settles on the one arrival view for the screen (Galaxy.arrivalPose,
// read through galaxy.freshPose()), frames the name inside the screen, and stays there. Bug
// caught (the owner's iPad mini, 21 November 2026: "sometimes when I drop in, the camera is too
// high"): tall screens arrived at a steeper tilt, with the name cut off at the top and sides,
// then sank to the resting tilt over half a minute, so the height depended on when you looked.
// Arrivals checked at an iPad mini upright and on its side, a phone and a desktop: a fresh load,
// a return from a world after an orbit drag, and a return after turning the screen in a world.
//   SYN3H_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-arrival.mjs
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/'
const sizes = [
  ['ipad-portrait', webkit, { viewport: { width: 744, height: 1133 }, hasTouch: true, isMobile: true }],
  ['ipad-landscape', webkit, { viewport: { width: 1133, height: 744 }, hasTouch: true, isMobile: true }],
  ['phone', webkit, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['desktop', chromium, { viewport: { width: 1440, height: 900 } }],
]
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
const arrived = page => page.waitForFunction(() => {
  const g = window.syn3h?.shell?.galaxy
  return document.documentElement.dataset.boot === 'done' && g && !g.opening && !g.returningHome && !document.documentElement.dataset.opening && !document.querySelector('.syn3h-shell').classList.contains('is-playing')
}, null, { timeout: 180000 })
const view = page => page.evaluate(() => {
  const g = window.syn3h.shell.galaxy, box = g.wordmarkScreenBox()
  return { yaw: g.yaw, pitch: g.pitch, distance: g.distance, target: g.target, want: g.freshPose(), box, w: innerWidth, h: innerHeight }
})
/** The view is the arrival view for this screen, and the name is whole on it. */
function check(v, what) {
  const tag = `${what} ${JSON.stringify(v)}`
  // The heading drifts slowly round once arrived (about 0.02 rad a second): a little latitude.
  assert.ok(Math.abs(wrap(v.yaw - v.want.yaw)) < 0.12, `${what}: heading`)
  assert.ok(Math.abs(v.pitch - v.want.pitch) < 1e-3, `${what}: tilt is the arrival tilt ${tag}`)
  assert.ok(Math.abs(v.distance / v.want.distance - 1) < 1e-3, `${what}: distance is the arrival distance ${tag}`)
  assert.ok(Math.hypot(...v.target) < 1e-3, `${what}: centred on the sun ${tag}`)
  assert.ok(v.box && v.box.x >= 0 && v.box.y >= 0 && v.box.x + v.box.width <= v.w && v.box.y + v.box.height <= v.h, `${what}: the name is whole on screen ${tag}`)
}
const browsers = new Map()
try {
  for (const [name, engine, options] of sizes) {
    if (!browsers.has(engine)) browsers.set(engine, await (engine === chromium ? engine.launch({ channel: 'chrome', headless: true }) : engine.launch()))
    const page = await browsers.get(engine).newPage(options)
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?room=lobby-arrival-${name}-${Date.now()}`)
    await arrived(page); await page.waitForTimeout(1200)
    check(await view(page), `${name}, fresh load`)
    // The idle rest at once and quickly: an arrival view must have nothing left for it to move.
    await page.evaluate(() => { window.syn3h.params.set('lobby.returnDelay', 0); window.syn3h.params.set('lobby.returnTime', 1) })
    await page.waitForTimeout(2500)
    check(await view(page), `${name}, after the idle rest`)
    await page.evaluate(() => { window.syn3h.params.set('lobby.returnDelay', 4); window.syn3h.params.set('lobby.returnTime', 25) })
    const enter = async () => {
      await page.evaluate(() => { const worlds = window.syn3h.shell.galaxyWorlds; window.syn3h.shell.galaxy.choose((worlds[1] ?? worlds[0]).id) })
      await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-playing'), null, { timeout: 120000 })
      await page.waitForTimeout(1500)
    }
    // A player's own orbit drag, then a world, then back: the drag does not survive the return.
    const canvas = await page.locator('.galaxy-canvas').boundingBox()
    await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.6); await page.mouse.down()
    await page.mouse.move(canvas.x + canvas.width * 0.65, canvas.y + canvas.height * 0.15, { steps: 8 }); await page.mouse.up()
    await page.waitForTimeout(500)
    await enter(); await page.evaluate(() => window.syn3h.shell['ascent']())
    await arrived(page); await page.waitForTimeout(1200)
    check(await view(page), `${name}, return after an orbit drag`)
    // The screen turned while in a world: the return frames the screen as it is now.
    const { width, height } = options.viewport
    await enter(); await page.setViewportSize({ width: height, height: width }); await page.waitForTimeout(1200)
    await page.evaluate(() => window.syn3h.shell['ascent']())
    await arrived(page); await page.waitForTimeout(1200)
    check(await view(page), `${name}, return after turning the screen in a world`)
    assert.deepEqual(errors, [], `${name}: no page errors`)
    console.log(`${name}: ok`)
    await page.close()
  }
} finally { for (const browser of browsers.values()) await browser.close() }
