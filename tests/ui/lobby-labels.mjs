// Check live caption bounds, input, and reduced motion in Chrome.
// MIRA_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-labels.mjs
import '../../tools/lib/legacy-env.mjs'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const url = process.env.MIRA_URL
assert.ok(url, 'MIRA_URL is required')
const out = 'tests/ui/artifacts/lobby-labels'
await mkdir(out, { recursive: true })
const views = [
  ['portrait', 390, 844, true, 'no-preference'],
  ['landscape', 844, 390, true, 'no-preference'],
  ['landscape-small', 667, 375, true, 'reduce'],
  ['desktop', 1440, 900, false, 'no-preference'],
  ['desktop-1280', 1280, 800, false, 'reduce'],
]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [name, width, height, phone, reducedMotion] of views) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${url}?tap=0&intro=0&webgl=1&gfx=2&room=lobby-labels-${name}-${Date.now()}`)
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' &&
      !window.mira?.shell?.galaxy?.opening && [...document.querySelectorAll('.galaxy-label')].some(chip => getComputedStyle(chip).pointerEvents === 'auto'), null, { timeout: 120000 })
    await page.evaluate(() => document.fonts.ready.then(() => true))
    const measure = () => page.evaluate(() => [...document.querySelectorAll('.galaxy-label')]
      .filter(chip => !chip.hidden && Number(getComputedStyle(chip).opacity) > 0.05)
      .map(chip => ({ id: chip.dataset.world, box: chip.getBoundingClientRect().toJSON() })))
    const check = captions => {
      assert.ok(captions.length >= 2, `${name}: multiple visible captions`)
      for (const [i, { id, box }] of captions.entries()) {
        assert.ok(box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= height, `${name}: ${id} fits the viewport`)
        for (const other of captions.slice(0, i)) {
          const b = other.box
          assert.ok(box.right <= b.left || box.left >= b.right || box.bottom <= b.top || box.top >= b.bottom, `${name}: ${id} overlaps ${other.id}`)
        }
      }
    }
    const dismiss = page.locator('.update-banner .update-dismiss')
    if (await dismiss.isVisible()) await dismiss.click()
    await page.waitForTimeout(900)
    const resting = await measure()
    check(resting)
    await page.waitForTimeout(400)
    const later = await measure()
    check(later)
    if (reducedMotion === 'reduce') assert.deepEqual(later, resting, `${name}: captions hold with reduced motion`)
    await page.screenshot({ path: `${out}/check-${name}.png` })

    // Intercept the shared world activation so both real input routes can run in the same lobby.
    const target = await page.evaluate(() => {
      const galaxy = window.mira.shell.galaxy
      galaxy.clockHold = true
      window.captionPicks = []
      galaxy.options.onTap = id => { window.captionPicks.push(id); return true }
      const inside = (p, x, y) => Math.hypot(p.x - x, p.y - y) < p.radius
      for (const p of galaxy.screen) {
        const chip = document.querySelector(`.galaxy-label[data-world="${p.id}"]`)
        if (!p.visible || getComputedStyle(chip).pointerEvents !== 'auto') continue
        const box = chip.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2
        if (document.elementFromPoint(x, y)?.closest('.galaxy-label') !== chip ||
            !document.elementFromPoint(p.x, p.y)?.matches('.galaxy-canvas')) continue
        const inFront = [...galaxy.screen.filter(s => s.visible), galaxy.sunScreen].filter(s => s.depth < p.depth)
        if (inFront.some(s => inside(s, x, y) || inside(s, p.x, p.y))) continue
        return { id: p.id, caption: { x, y }, globe: { x: p.x, y: p.y } }
      }
    })
    assert.ok(target, `${name}: a caption and its globe are both reachable`)
    const tap = ({ x, y }) => phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y)
    const picks = () => page.evaluate(() => window.captionPicks)
    await tap(target.caption)
    assert.deepEqual(await picks(), [target.id], `${name}: tap activates its caption exactly once`)
    await tap(target.globe)
    assert.deepEqual(await picks(), [target.id, target.id], `${name}: globe activates the same world`)
    await page.locator(`.galaxy-label[data-world="${target.id}"]`).press('Enter')
    assert.deepEqual(await picks(), Array(3).fill(target.id), `${name}: keyboard activates the caption`)
    await page.evaluate(() => document.activeElement.blur())

    // Dragging from text still pans the scene and does not select the caption.
    const cdp = phone ? await context.newCDPSession(page) : null
    const start = await page.evaluate(id => {
      const galaxy = window.mira.shell.galaxy
      const chip = document.querySelector(`.galaxy-label[data-world="${id}"]`)
      const box = chip.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2
      return { x, y, yaw: galaxy.yaw, onCaption: document.elementFromPoint(x, y)?.closest('.galaxy-label') === chip }
    }, target.id)
    assert.ok(start.onCaption, `${name}: the drag starts on a caption`)
    const from = { x: start.x, y: start.y }
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
    else { await page.mouse.move(from.x, from.y); await page.mouse.down() }
    for (let step = 1; step <= 5; step++) {
      const at = { x: from.x + step * (from.x > width / 2 ? -12 : 12), y: from.y }
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at] })
      else await page.mouse.move(at.x, at.y)
      await page.waitForTimeout(80)
      check(await measure())
    }
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    else await page.mouse.up()
    assert.deepEqual(await picks(), Array(3).fill(target.id), `${name}: dragging selects nothing`)
    await page.waitForFunction(yaw => Math.abs(window.mira.shell.galaxy.yaw - yaw) > 0.02, start.yaw, { timeout: 5000 })

    await page.evaluate(() => {
      for (const chip of document.querySelectorAll('.galaxy-label.is-suppressed')) {
        if (chip.tabIndex >= 0 || getComputedStyle(chip).pointerEvents !== 'none') throw Error('A suppressed caption can take focus or a pointer')
      }
    })
    const settings = page.locator('.lobby-gear-dock .lobby-gear')
    if (phone) await settings.tap()
    else await settings.click()
    await page.locator('#lobby-settings').waitFor({ state: 'visible' })
    assert.deepEqual(await picks(), Array(3).fill(target.id), `${name}: the Settings dock takes its own tap`)

    assert.deepEqual(errors, [])
    console.log(`${name}: caption bounds, caption/globe/keyboard activation, and drag PASS`)
    await context.close()
  }
} finally { await browser.close() }
