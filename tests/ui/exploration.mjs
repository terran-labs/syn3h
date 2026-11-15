import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
await mkdir('tests/ui/artifacts/exploration', { recursive: true })
const modes = process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop', 'ipad', 'phone', 'landscape']
for (const mode of modes) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? { ...devices[mode === 'ipad' ? 'iPad (gen 7)' : mode === 'landscape' ? 'iPhone 14 landscape' : 'iPhone 14'] } : { viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'}?autoplay=1&room=exploration-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 90000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 90000 })
    assert.equal(await page.locator('.shell-hud').isVisible(), false)
    assert.equal(await page.locator('.hud-navigation button').count(), 1)
    const map = await page.locator('.shell-minimap').boundingBox()
    assert.ok(map.x < 25 && map.y > page.viewportSize().height * .2, 'map lives in lower left')
    if (touch) {
      const stick = await page.locator('.touch-stick').boundingBox()
      assert.ok(stick && map.y + map.height + 12 <= stick.y, 'touch minimap clears joystick and label')
    }
    assert.match(await page.locator('.shell-minimap canvas').evaluate(el => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage), /radial-gradient/)
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-drive.png` })
    // Panels are open exactly when the cursor is free. A touch device has one switch instead.
    if (touch && await page.locator('.world-inspector').isHidden()) await page.locator('.inspector-toggle').tap()
    await page.locator('.world-inspector').waitFor({ state: 'visible' })
    for (const head of await page.locator('.wi-head').all()) await head.click()
    const layout = await page.evaluate(() => {
      const rail = document.querySelector('.world-inspector').getBoundingClientRect()
      return [...document.querySelectorAll('.wi-head')].map(el => { const r = el.getBoundingClientRect(); return r.top >= rail.top && r.bottom <= rail.bottom && r.height >= 22 })
    })
    assert.ok(layout.every(Boolean), 'every section header stays visible')
    assert.equal(await page.locator('.wi-cards').evaluate(el => el.scrollHeight > el.clientHeight + 2), false, 'stack does not scroll or crop cards')
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-all-sections.png` })
    for (const head of await page.locator('.wi-card:not([data-section=sky]) .wi-head').all()) await head.click()
    assert.ok(await page.locator('.wi-card[data-section=sky] .wi-body').evaluate(el => el.clientHeight > 60), 'selected panel has usable internal space')
    const row = page.locator('.wi-row[data-id="sun.timeOfDay"]')
    await row.scrollIntoViewIfNeeded()
    if (touch) await row.locator('.wi-label').tap(); else await row.hover()
    await page.locator('.wi-tooltip').waitFor({ state: 'visible' })
    const tip = await page.locator('.wi-tooltip').boundingBox(), control = await row.boundingBox()
    assert.ok(tip.x >= 0 && tip.y >= 0 && tip.x + tip.width <= page.viewportSize().width && tip.y + tip.height <= page.viewportSize().height)
    if (!touch) assert.ok(tip.x + tip.width < control.x, 'description floats left of control')
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-tooltip.png` })
    await page.locator('.rail-players summary').click()
    assert.equal(await page.locator('.rail-diagnostics input').isChecked(), false)
    await page.locator('.rail-diagnostics input').check()
    await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('show-diagnostics'))
    await page.locator('.rail-diagnostics input').uncheck()
    if (!touch) {
      // Any native select will do; the synthetic keys below never change its value.
      const select = page.locator('.wi-vehicle-select')
      await select.focus()
      // Check held keys before keyup: a leak can disappear before a frame assertion.
      for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter']) {
        const result = await select.evaluate((el, code) => {
          const input = window.syn3h.game.input
          const before = { ...input.poll() }
          const event = new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true })
          el.dispatchEvent(event)
          const held = { ...input.poll() }
          el.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
          return { before, held, prevented: event.defaultPrevented, suspended: input.suspended }
        }, code)
        assert.equal(result.suspended, false)
        assert.equal(result.prevented, false, `${code} retains native select behavior`)
        assert.deepEqual(result.held, result.before, `${code} cannot drive, fire or toggle abilities`)
      }
      // A key begun outside the select must still be released inside it.
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {code:'ArrowUp'})))
      assert.equal(await page.evaluate(() => syn3h.game.input.poll().y), 1)
      await select.evaluate(el => el.dispatchEvent(new KeyboardEvent('keyup', {code:'ArrowUp',bubbles:true})))
      assert.equal(await page.evaluate(() => syn3h.game.input.poll().y), 0)
    }
    if (touch) {
      await page.locator('.rail-close').tap()
      assert.equal(await page.locator('.world-inspector').isHidden(), true, 'returning to driving hides the panels')
      await page.locator('.inspector-toggle').tap()
      await page.locator('.world-inspector').waitFor({ state: 'visible' })
    } else {
      // Returning to driving captures the cursor, and the panels go with it.
      await page.locator('.rail-close').click()
      await page.waitForFunction(() => document.pointerLockElement === syn3h.game.canvas)
      assert.equal(await page.locator('.world-inspector').isHidden(), true, 'panels are closed while the cursor is captured')
      // Escape frees the cursor: panels. Escape again: paused. Never back to the solar system.
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => !document.pointerLockElement)
      await page.locator('.world-inspector').waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await page.locator('.pause-veil').waitFor({ state: 'visible' })
      assert.equal(await page.evaluate(() => syn3h.shell.menuOpen), false, 'Escape never returns to solar system')
      await page.keyboard.press('Escape')
      await page.locator('.pause-veil').waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.pointerLockElement === syn3h.game.canvas)
      await page.keyboard.press('Escape')
      await page.locator('.world-inspector').waitFor({ state: 'visible' })
    }
    await page.locator('.exit-world').click()
    await page.waitForFunction(() => syn3h.shell.menuOpen)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-lobby.png` })
    assert.deepEqual(errors, [])
    console.log(`${mode}: exploration layout passed`)
  } finally { await browser.close() }
}
