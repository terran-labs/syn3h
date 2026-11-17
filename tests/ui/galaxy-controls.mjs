import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(process.env.SYN3H_URL ?? 'http://127.0.0.1:5193/')
  await page.waitForFunction(() => window.syn3h?.shell?.galaxy?.live && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
  await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400); window.syn3h.shell.galaxy.options.still = () => true })
  // Keys and sticks move an aim and the view springs after it over the next drawn frames:
  // read the view once its swing has come to rest, never in the same instant as the key.
  const view = async () => {
    await page.waitForFunction(() => { const g = window.syn3h.shell.galaxy; return g.swingResting && Math.abs(g.reach - g.distance) < 0.01 * g.distance }, null, { timeout: 10000 })
    return page.evaluate(() => { const g = window.syn3h.shell.galaxy; return [g.yaw, g.pitch, g.distance] })
  }
  const before = await view()
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('+')
  const after = await view()
  assert.ok(after[0] > before[0] && after[1] > before[1] && after[2] < before[2], 'keyboard orbits and zooms')
  await page.evaluate(() => {
    window.__pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) }
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__pad] })
    window.__pad.axes = [0.8, -0.8, 0, -0.8]
  })
  // Held until the galaxy has polled the pad and moved (it reads it once a drawn frame), then let go.
  await page.waitForFunction(after => { const g = window.syn3h.shell.galaxy; return g.yaw > after[0] && g.pitch > after[1] && g.distance < after[2] }, after, { timeout: 10000 }).catch(() => {})
  await page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0] })
  const stick = await view()
  assert.ok(stick[0] > after[0] && stick[1] > after[1] && stick[2] < after[2], 'sticks orbit and zoom')
  await page.evaluate(() => { window.__pad.buttons[15].pressed = true })
  await page.waitForFunction(() => document.activeElement.classList.contains('galaxy-label'), null, { timeout: 10000 }).catch(() => {})
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('galaxy-label')), true, 'D-pad focuses a world')
  await page.evaluate(() => { window.__pad.buttons[15].pressed = false; window.syn3h.shell.showPanel('settings') })
  await page.waitForTimeout(600)
  const panel = await view()
  await page.keyboard.press('ArrowRight')
  await page.evaluate(() => { window.__pad.axes[0] = 1 })
  await page.waitForTimeout(200)
  assert.deepEqual(await view(), panel, 'an open panel blocks galaxy controls')
  await page.evaluate(() => { window.__pad.axes[0] = 0; window.syn3h.shell.showPanel('index') })
  await page.waitForTimeout(600)
  await page.evaluate(() => { window.__pad.buttons[0].pressed = true })
  await page.waitForFunction(() => window.syn3h.shell.dropping, null, { timeout: 3000 })
  assert.deepEqual(errors, [])
  console.log('GALAXY CONTROLS OK')
} finally { await browser.close() }
