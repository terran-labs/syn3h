// The lobby's planet captions sit under their planets and nowhere else: at phone landscape
// (844x390, 667x375), phone portrait (390x844) and desktop (1440x900, 1280x800), settled and
// while the view is dragged, every caption's centre is level with its planet's centre and its
// top sits CAPTION_GAP below the planet's limb, within a pixel. No plate or leader exists.
// Pointing at a planet changes only its caption's opacity, never its place or size. Captions
// may overlap each other; that is the design (the owner, 16 November 2026).
//   SYN3H_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-labels.mjs
// Screenshots go to tests/ui/artifacts/lobby-labels/.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const url = process.env.SYN3H_URL
assert.ok(url, 'SYN3H_URL is required')
/** Must match CAPTION_GAP in src/ui/Shell.ts. */
const GAP = 5
const out = 'tests/ui/artifacts/lobby-labels'
await mkdir(out, { recursive: true })
const views = { landscape: [844, 390, true], 'landscape-small': [667, 375, true], portrait: [390, 844, true], desktop: [1440, 900, false], 'desktop-1280': [1280, 800, false] }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [name, [width, height, phone]] of Object.entries(views)) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone }), page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${url}?room=lobby-labels-${name}-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    // Hold the graphics level, as galaxy.mjs does: a slow headless browser would retire the galaxy.
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.waitForTimeout(3500)
    // Each caption against its planet, read in one frame: horizontal offset of the centres, and
    // the gap from the limb to the caption's top, minus GAP.
    const measure = () => page.evaluate(() => {
      const screen = window.syn3h.shell.galaxy.screen
      return [...document.querySelectorAll('.galaxy-label')].filter(c => !c.hidden).map(c => {
        const r = c.getBoundingClientRect(), p = screen.find(s => s.id === c.dataset.world)
        return { id: c.dataset.world, dx: r.left + r.width / 2 - p.x, dy: r.top - (p.y + p.radius), width: r.width, height: r.height, opacity: Number(getComputedStyle(c).opacity) }
      })
    })
    const check = (captions, when) => {
      assert.ok(captions.length > 0, `${name}: captions are shown ${when}`)
      for (const c of captions) {
        assert.ok(Math.abs(c.dx) <= 1, `${name}: the ${c.id} caption is centred under its planet ${when} (${c.dx.toFixed(2)} px off)`)
        assert.ok(Math.abs(c.dy - GAP) <= 1, `${name}: the ${c.id} caption sits ${GAP} px below its planet ${when} (${c.dy.toFixed(2)} px)`)
      }
    }
    assert.equal(await page.evaluate(() => document.querySelectorAll('.galaxy-labels .s3-plate, .galaxy-labels .s3-leader').length), 0, `${name}: no plates or leaders`)
    for (let sample = 0; sample < 3; sample++) { check(await measure(), 'settled'); await page.waitForTimeout(400) }
    await page.screenshot({ path: `${out}/check-${name}.png` })
    // While the view is dragged, several frames: the captions stay with their planets.
    const from = { x: width * 0.5, y: height * 0.22 }
    const cdp = phone ? await context.newCDPSession(page) : null
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
    else { await page.mouse.move(from.x, from.y); await page.mouse.down() }
    for (let step = 1; step <= 6; step++) {
      const at = { x: from.x + step * 18, y: from.y + step * 4 }
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at] })
      else await page.mouse.move(at.x, at.y)
      await page.waitForTimeout(60)
      check(await measure(), `while dragged (step ${step})`)
    }
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    else await page.mouse.up()
    await page.waitForTimeout(1500)
    // Pointing at a planet raises only its caption's opacity: same place, same size.
    const target = await page.evaluate(() => { const p = window.syn3h.shell.galaxy.screen.find(s => s.visible && s.x > 0 && s.x < innerWidth && s.y > 0 && s.y < innerHeight && s.radius > 4); return { id: p.id, x: p.x, y: p.y } })
    const before = (await measure()).find(c => c.id === target.id)
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x, y: target.y }] })
    else await page.mouse.move(target.x, target.y)
    await page.waitForTimeout(500)
    const pointed = await page.evaluate(() => document.querySelector('.galaxy-label.is-pointed')?.dataset.world)
    const after = (await measure()).find(c => c.id === pointed)
    assert.ok(after, `${name}: pointing near ${target.id} points at a world with a caption`)
    const was = pointed === target.id ? before : after
    assert.ok(after.opacity >= was.opacity, `${name}: pointing does not dim the ${pointed} caption`)
    assert.ok(Math.abs(after.width - was.width) < 0.5 && Math.abs(after.height - was.height) < 0.5, `${name}: pointing does not resize the ${pointed} caption`)
    check([after], 'while pointed at')
    await page.screenshot({ path: `${out}/point-${name}.png` })
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    else await page.mouse.move(2, 2)
    await page.evaluate(id => document.querySelector(`.galaxy-label[data-world="${id}"]`).focus(), target.id)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}/focus-${name}.png` })
    assert.deepEqual(errors, [])
    console.log(`${name}: captions under their planets, settled and dragged; pointing at ${pointed} lifts ${was.opacity.toFixed(2)} to ${after.opacity.toFixed(2)} PASS`)
    await context.close()
  }
} finally { await browser.close() }
