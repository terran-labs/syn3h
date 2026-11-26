/**
 * Cursor capture on a desktop: the first click in play captures the cursor and sends no
 * beam; after that moving the mouse swings the camera and a click sends a beam; opening the
 * menu, or Escape, lets the cursor go. Right-click still switches cockpit and chase.
 *
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs cursor
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { serverUrl } from './lib/server.mjs'
const base = serverUrl('cursor')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?room=cursor-${Date.now()}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.game?.tick > 40, null, { timeout: 120000 })
  const locked = () => page.evaluate(() => document.pointerLockElement === window.mira.game.canvas)
  const eye = () => page.evaluate(() => { const s = window.mira, c = s.game.camera.position, p = s.player.body.translation(); return Math.atan2(c.x - p.x, c.z - p.z) })
  assert.equal(await locked(), false)
  // The first click captures and sends nothing.
  await page.mouse.move(640, 300); await page.mouse.down()
  await page.waitForFunction(() => document.pointerLockElement === window.mira.game.canvas, null, { timeout: 5000 })
  assert.equal(await page.evaluate(() => window.mira.game.input.mouseFire), false, 'the capturing click sends no beam')
  await page.mouse.up()
  // Moving the mouse swings the camera round the vehicle.
  await page.waitForTimeout(600); const before = await eye()
  const lastLook = await page.evaluate(() => window.mira.camera.lastManual)
  for (let i = 0; i < 12; i++) { await page.mouse.move(640 + (i + 1) * 30, 300); await page.waitForTimeout(30) }
  await page.waitForFunction(previous => window.mira.camera.lastManual > previous, lastLook)
  await page.waitForTimeout(700); const after = await eye()
  const swing = Math.atan2(Math.sin(after - before), Math.cos(after - before))
  assert.ok(Math.abs(swing) > 0, 'mouse look changes the camera angle')
  // A click now sends a beam for as long as it is held.
  await page.mouse.down(); await page.waitForFunction(() => window.mira.game.input.mouseFire === true)
  await page.mouse.up(); await page.waitForFunction(() => window.mira.game.input.mouseFire === false)
  // Right-click still switches to the cockpit and back.
  const mode = () => page.evaluate(() => Math.round(window.mira.params.get('camera.mode').value))
  const chase = await mode(); await page.mouse.click(640, 300, { button: 'right' }); await page.waitForTimeout(200)
  assert.notEqual(await mode(), chase); await page.mouse.click(640, 300, { button: 'right' }); await page.waitForTimeout(200); assert.equal(await mode(), chase)
  // Opening the menu lets the cursor go.
  await page.evaluate(() => window.mira.shell.openMenu()); await page.waitForFunction(() => document.pointerLockElement === null)
  console.log(JSON.stringify({ ok: true, swing: +swing.toFixed(2), errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
