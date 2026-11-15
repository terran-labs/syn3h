import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const phone of (process.env.PHONE_ONLY ? [true] : [false, true])) {
    const device = phone ? 'phone' : 'desktop'
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone, isMobile: phone })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    // Hold GPU initialization to inspect the cover before Shell exists.
    await page.addInitScript(() => {
      const original = navigator.gpu.requestAdapter.bind(navigator.gpu)
      const gate = new Promise(resolve => { window.releaseStartup = resolve })
      navigator.gpu.requestAdapter = async (...args) => { await gate; return original(...args) }
    })
    await page.goto('http://127.0.0.1:5187/?vehicle=jet&room=flight-ui', { waitUntil: 'domcontentloaded' })
    await page.locator('.syn3h-loading').waitFor({ state: 'visible' })
    // The device check has reported by now; the veil from index.html is what is on screen.
    assert.equal(await page.locator('.syn3h-loading progress').getAttribute('value'), '0.05')
    assert.equal(await page.evaluate(() => document.documentElement.dataset.boot), 'loading')
    await page.screenshot({ path: `tests/ui/artifacts/${device}-loading-indeterminate.png` })
    await page.evaluate(() => dispatchEvent(new CustomEvent('syn3h:loading', { detail: { phase: 'Preparing terrain', progress: .42, elapsedMs: 4200 } })))
    assert.equal(await page.locator('.loading-phase').textContent(), 'Preparing terrain')
    assert.equal(await page.locator('.syn3h-loading progress').getAttribute('value'), '0.42')
    await page.screenshot({ path: `tests/ui/artifacts/${device}-loading-progress.png` })
    await page.evaluate(() => window.releaseStartup())
    await page.waitForFunction(() => window.syn3h?.game.tick > 25, null, { timeout: 60000 })
    assert.equal(await page.locator('.syn3h-loading').isVisible(), false)
    await page.evaluate(() => { syn3h.shell.setLoadingMessages(['A custom message']); syn3h.shell.play() })
    await page.waitForFunction(() => window.syn3hNet?.connected)
    await page.keyboard.press('h')
    assert.equal(await page.locator('.spawn-help').isVisible(), true)
    assert.match(await page.locator('.spawn-help').textContent(), phone ? /THR/ : /Q \/ E/)
    await page.evaluate(() => syn3h.shell.setMapEntities([{ x: 100, z: 50, heading: 0, color: '#ff2222' }, { x: -100, z: -50, heading: 1, color: '#22ffff' }]))
    await page.waitForTimeout(200)
    const before = await page.locator('.shell-minimap').getAttribute('data-revision')
    const imageBefore = await page.locator('.shell-minimap canvas').evaluate(c => c.toDataURL())
    await page.evaluate(() => syn3h.params.set('world.seed', 13579))
    await page.waitForFunction(before => document.querySelector('.shell-minimap').dataset.revision !== before, before)
    await page.waitForTimeout(200)
    assert.notEqual(await page.locator('.shell-minimap canvas').evaluate(c => c.toDataURL()), imageBefore)
    if (phone) {
      const up = await page.locator('[data-action=throttleUp]').boundingBox(), down = await page.locator('[data-action=throttleDown]').boundingBox(), stick = await page.locator('.touch-stick').boundingBox()
      const cdp = await context.newCDPSession(page)
      const thrust = { x: up.x + 30, y: up.y + 30, id: 1 }, negative = { x: down.x + 30, y: down.y + 30, id: 2 }, bank = { x: stick.x + stick.width - 8, y: stick.y + stick.height / 2, id: 3 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [thrust, bank] })
      await page.waitForFunction(() => syn3h.game.input.state.z === 1 && syn3h.game.input.state.x > .8)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [thrust, negative, bank] })
      await page.waitForFunction(() => syn3h.game.input.state.z === 0)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [thrust, bank] })
      await page.waitForFunction(() => syn3h.game.input.state.z === -1 && syn3h.game.input.state.x === 0)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      await page.waitForFunction(() => syn3h.game.input.state.z === 0)
      const map = await page.locator('.shell-minimap').boundingBox(), help = await page.locator('.spawn-help').boundingBox(), menu = await page.locator('.hud-navigation').boundingBox()
      assert.ok(map.y >= menu.y + menu.height); assert.ok(help.y + help.height < up.y)
    }
    await page.screenshot({ path: `tests/ui/artifacts/${device}-jet-hud.png` })
    await page.locator('.shell-menu-button').click()
    assert.equal(await page.locator('.touch-controls').isVisible(), false)
    assert.equal(await page.locator('.shell-minimap').isVisible(), false)
    await page.keyboard.press('Escape'); await page.keyboard.press('?')
    assert.equal(await page.locator('.spawn-help').isVisible(), true)
    await page.waitForTimeout(8700)
    assert.equal(await page.locator('.spawn-help').isVisible(), false)
    assert.deepEqual(errors, [])
    console.log(`${device}: loading, jet controls, map regeneration and help passed`)
    await context.close()
  }
} finally { await browser.close() }
