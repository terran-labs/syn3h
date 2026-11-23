// Opening Welcome or Updates brings the name into view over the sheet, wherever the player had
// swiped, and closing it leaves the view where the name reads well (Galaxy.frameName). Bug
// caught (the owner, on an iPhone, 22 November 2026): swiped above the galaxy, the name was off
// the top of the screen behind Updates and still gone after closing it.
// Checked on a phone upright and on its side and a desktop, with motion and with reduced motion.
//   MIRA_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-sheet-name.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5173/'
const sizes = [
  ['phone', webkit, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['phone-landscape', webkit, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }],
  ['desktop', chromium, { viewport: { width: 1440, height: 900 } }],
  ['desktop, reduced motion', chromium, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }],
]
const arrived = page => page.waitForFunction(() => {
  const g = window.mira?.shell?.galaxy
  return document.documentElement.dataset.boot === 'done' && g && !g.opening && !g.returningHome && !document.documentElement.dataset.opening
}, null, { timeout: 180000 })
const view = page => page.evaluate(() => {
  const g = window.mira.shell.galaxy, panel = document.querySelector('dialog.lobby-sheet[open] .lobby-sheet-panel')?.getBoundingClientRect()
  return { pitch: g.pitch, distance: g.distance, want: g.freshPose(), box: g.wordmarkScreenBox(), shown: g.markShown, panelTop: panel?.top ?? null, w: innerWidth, h: innerHeight }
})
function whole(v, what) {
  const tag = `${what} ${JSON.stringify(v)}`
  assert.ok(Math.abs(v.pitch - v.want.pitch) < 1e-3 && Math.abs(v.distance / v.want.distance - 1) < 1e-3, `${what}: at the arrival tilt and distance ${tag}`)
  assert.ok(v.shown > 0.99, `${what}: the name is lit ${tag}`)
  assert.ok(v.box && v.box.x >= 0 && v.box.y >= 0 && v.box.x + v.box.width <= v.w && v.box.y + v.box.height <= v.h, `${what}: the name is whole on screen ${tag}`)
}
const browsers = new Map()
try {
  for (const [name, engine, options] of sizes) {
    if (!browsers.has(engine)) browsers.set(engine, await (engine === chromium ? engine.launch({ channel: 'chrome', headless: true }) : engine.launch()))
    const page = await browsers.get(engine).newPage(options)
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?room=lobby-sheet-name-${Date.now()}`)
    await arrived(page); await page.waitForTimeout(1200)
    for (const sheet of ['updatesSheet', 'aboutSheet']) {
      // Swipe up over the galaxy until the name is off the top of the screen.
      const c = await page.locator('.galaxy-canvas').boundingBox()
      await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.2); await page.mouse.down()
      await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.95, { steps: 12 }); await page.mouse.up()
      await page.waitForTimeout(800)
      await page.evaluate(s => window.mira.shell.openLobbySheet(window.mira.shell[s]), sheet)
      await page.waitForTimeout(1600)
      const open = await view(page)
      whole(open, `${name}, ${sheet} open`)
      assert.ok(open.panelTop !== null && open.box.y + open.box.height <= open.panelTop + 1, `${name}, ${sheet} open: the name stands above the sheet ${JSON.stringify(open)}`)
      await page.keyboard.press('Escape'); await page.waitForTimeout(250)
      // Closed: the view is already there; only the name's own settle from over the sheet remains.
      whole(await view(page), `${name}, ${sheet} just closed`)
      await page.waitForTimeout(900)
    }
    assert.deepEqual(errors, [], `${name}: no page errors`)
    console.log(`${name}: ok`)
    await page.close()
  }
} finally { for (const browser of browsers.values()) await browser.close() }
