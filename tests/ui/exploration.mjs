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
    // Height above ground is measured from the contact surfaces: resting on its wheels, the
    // buggy reads 0 m, not the height of the middle of its body.
    await page.waitForFunction(() => syn3h.player.wheelsGrounded > 0, null, { timeout: 30000 })
    await page.waitForFunction(() => document.querySelector('.focus-hud [data-t="altitude"]').textContent === '0', null, { timeout: 10000 })
    assert.equal(await page.locator('.shell-hud').isVisible(), false)
    assert.equal(await page.locator('.hud-navigation button').count(), 1)
    const map = await page.locator('.shell-minimap').boundingBox()
    assert.ok(map.x < 25 && map.y > page.viewportSize().height * .2, 'map lives in lower left')
    if (touch) {
      // The stick floats under the thumb, so nothing sits there until a drag; the first-run
      // hint has the lower left instead and must clear the minimap.
      assert.equal(await page.locator('.touch-stick').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'no permanent joystick')
      // Measured even while the spawn card hides it for a few seconds.
      const hint = await page.locator('.touch-stick-hint').evaluate(el => { const r = el.getBoundingClientRect(); return r.height ? { y: r.top } : null })
      assert.ok(hint && map.y + map.height + 12 <= hint.y, 'touch minimap clears the drive hint')
    }
    assert.match(await page.locator('.shell-minimap canvas').evaluate(el => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage), /radial-gradient/)
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-drive.png` })
    // Panels are open exactly when the cursor is free. A touch device has one switch instead.
    // After an automatic start a desktop browser may or may not have granted the cursor.
    if (touch && await page.locator('.world-inspector').isHidden()) await page.locator('.inspector-toggle').tap()
    else if (!touch && await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    await page.locator('.world-inspector').waitFor({ state: 'visible' })
    for (const head of await page.locator('.wi-head').all()) await head.click()
    await page.waitForFunction(() => !document.querySelector('.wi-cards').getAnimations({ subtree: true }).some(a => a.playState === 'running'))
    // Headers are finger-sized (44 px, 48 on touch). On a short screen the stack may scroll
    // vertically to fit them, so each must be reachable by scrolling, and nothing scrolls sideways.
    const layout = await page.evaluate(minimum => {
      const rail = document.querySelector('.world-inspector').getBoundingClientRect(), stack = document.querySelector('.wi-cards')
      const heads = [...document.querySelectorAll('.wi-head')].map(el => { el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(), s = stack.getBoundingClientRect(); return r.top >= Math.max(rail.top, s.top) - 1 && r.bottom <= Math.min(rail.bottom, s.bottom) + 1 && r.height >= minimum - .5 })
      stack.scrollTop = 0
      return { heads, sideways: stack.scrollWidth > stack.clientWidth + 1 || document.querySelector('.world-inspector').scrollWidth > rail.width + 1 }
    }, touch ? 48 : 44)
    assert.ok(layout.heads.every(Boolean), 'every section header is full size and reachable')
    assert.equal(layout.sideways, false, 'stack never scrolls sideways')
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-all-sections.png` })
    for (const head of await page.locator('.wi-card:not([data-section=sky]) .wi-head').all()) await head.click()
    await page.waitForFunction(() => !document.querySelector('.wi-cards').getAnimations({ subtree: true }).some(a => a.playState === 'running'))
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
      await page.locator('[data-section=vehicles] .wi-head').click()
      const select = page.locator('.wi-vehicle-select')
      await select.scrollIntoViewIfNeeded()
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
      // That arrow key was pressed outside any field, which now means "drive": it may have
      // captured the cursor and closed the panels. Free it again before going on.
      if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
      await page.locator('.world-inspector').waitFor({ state: 'visible' })
    }
    if (touch) {
      await page.locator('.inspector-toggle').tap(); await page.locator('.world-inspector').waitFor({ state: 'hidden' })
      assert.equal(await page.locator('.world-inspector').isHidden(), true, 'returning to driving hides the panels')
      await page.locator('.inspector-toggle').tap()
      await page.locator('.world-inspector').waitFor({ state: 'visible' })
    } else {
      // Returning to driving captures the cursor, and the panels go with it.
      await page.mouse.click(100, 150); await page.locator('.world-inspector').waitFor({ state: 'hidden' })
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
    // Exit world asks first. Escape and a click outside mean stay; neither pauses nor leaves.
    const asking = page.locator('.exit-confirm')
    await page.locator('.exit-world').click()
    await asking.waitFor({ state: 'visible' })
    assert.match(await asking.innerText(), /Leave this world\?/i)
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('exit-stay')), true, 'Stay has the focus')
    await page.keyboard.press('Escape')
    await asking.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => syn3h.shell.menuOpen), false, 'Escape stays in the world')
    assert.equal(await page.locator('.pause-veil').isHidden(), true, 'Escape on the question does not pause')
    await page.locator('.exit-world').click(); await asking.waitFor({ state: 'visible' })
    await asking.click({ position: { x: 8, y: 8 } })
    await asking.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => syn3h.shell.menuOpen), false, 'a click outside stays in the world')
    await page.locator('.exit-world').click(); await asking.waitFor({ state: 'visible' })
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-exit-confirm.png` })
    await page.locator('.exit-leave').click()
    await page.waitForFunction(() => syn3h.shell.menuOpen)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-lobby.png` })
    assert.deepEqual(errors, [])
    console.log(`${mode}: exploration layout passed`)
  } finally { await browser.close() }
}
