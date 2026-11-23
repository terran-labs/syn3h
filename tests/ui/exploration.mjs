import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { waitForPanelMotion } from './panel-motion.mjs'
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
    await page.goto(`${process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'}?autoplay=1&room=exploration-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 90000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 90000 })
    await page.waitForFunction(() => window.mira.shell.playing && !window.mira.shell.transitioning, null, { timeout: 90000 })
    // ALT is height above the sea at rest (src/ui/altitude.ts): a parked buggy reads its
    // ground's height, a whole number with a real minus sign below the sea, labelled ALT, in
    // the units the setting chooses. Raising the sea to the buggy's wheels reads 0.
    await page.waitForFunction(() => mira.player.wheelsGrounded > 0, null, { timeout: 30000 })
    const readout = () => page.evaluate(() => {
      const right = document.querySelector('.focus-hud .fh-right'), left = document.querySelector('.focus-hud .fh-left')
      const text = selector => right.querySelector(selector)?.textContent ?? ''
      return { alt: text('[data-t="altitude"]'), unit: text('[data-t="heightUnit"]'), label: right.querySelector('small')?.textContent ?? '', speedUnit: left.querySelector('[data-t="speedUnit"]')?.textContent ?? '' }
    })
    const metres = n => Number(n.replace('\u2212', '-'))
    for (const [units, speed, height] of [[0, 'km/h', 'm'], [1, 'mph', 'ft']]) {
      await page.evaluate(units => mira.params.set('hud.units', units), units)
      await page.waitForFunction(unit => document.querySelector('.focus-hud [data-t="heightUnit"]')?.textContent === unit, height, { timeout: 5000 })
      const shown = await readout()
      assert.match(shown.alt, /^\u2212?\d+$/, `${mode}: ALT is a whole number ${JSON.stringify(shown)}`)
      assert.deepEqual([shown.unit, shown.speedUnit, shown.label], [height, speed, 'ALT'], `${mode}: ALT and speed follow the units setting`)
    }
    await page.evaluate(() => mira.params.set('hud.units', 0))
    const sea = await page.evaluate(() => mira.params.get('world.lavaAltitude').value)
    await page.evaluate(() => mira.params.set('world.lavaAltitude', Math.round(mira.player.contactHeight() * 2) / 2))
    // The sea glides there over 1.5 s; the floating buggy reads 0, give or take a wave.
    await page.waitForFunction(() => Math.abs(Number(document.querySelector('.focus-hud [data-t="altitude"]').textContent.replace('\u2212', '-'))) <= 1, null, { timeout: 10000 })
    assert.ok(Math.abs(metres((await readout()).alt)) <= 1, `${mode}: ALT reads 0 at the sea surface`)
    await page.evaluate(sea => mira.params.set('world.lavaAltitude', sea), sea)
    assert.equal(await page.locator('.shell-hud').isVisible(), false)
    assert.equal(await page.locator('.hud-navigation button').count(), 1)
    const map = await page.locator('.shell-minimap').boundingBox()
    // The minimap keeps the lower left corner on every screen, phones and tablets as on desktop
    // (the owner, 17 November 2026; hud-column.css, exploration.css): on screen, in the corner.
    const view = page.viewportSize()
    assert.ok(map.x >= 0 && map.x < 25 && map.y + map.height <= view.height && view.height - (map.y + map.height) < 25, `${mode}: map in the lower left corner ${JSON.stringify(map)}`)
    if (touch) {
      // The stick floats under the thumb, so nothing sits there until a drag, and it may land on
      // the map (the map takes no touches). The first-run drive hint sits just above the map,
      // never over it.
      assert.equal(await page.locator('.touch-stick').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'no permanent joystick')
      // Measured even while the spawn card hides it for a few seconds.
      const hint = await page.locator('.touch-stick-hint').evaluate(el => { const r = el.getBoundingClientRect(); return r.height ? { bottom: r.bottom, left: r.left } : null })
      assert.ok(hint && hint.bottom <= map.y, `${mode}: the drive hint sits above the minimap ${JSON.stringify({ hint, map })}`)
    }
    assert.match(await page.locator('.shell-minimap canvas:not(.shell-minimap-marks)').evaluate(el => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage), /radial-gradient/)
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-drive.png` })
    // Panels are open exactly when the cursor is free. A touch device has one switch instead.
    // After an automatic start a desktop browser may or may not have granted the cursor.
    if (touch && await page.locator('.world-inspector').isHidden()) await page.locator('.inspector-toggle').tap()
    else if (!touch && await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    await page.locator('.world-inspector').waitFor({ state: 'visible' })
    await waitForPanelMotion(page)
    // Touch presents the headers together in the collapsed list. An open phone card hides its peers.
    if (touch) {
      const open = page.locator('.world-inspector .wi-card.is-open > .wi-head')
      while (await open.count()) await open.first().tap()
    } else {
      for (const head of await page.locator('.wi-head').all()) await head.click()
    }
    await waitForPanelMotion(page)
    // Headers are finger-sized (44 px, 48 on touch). On a short screen the stack may scroll
    // vertically to fit them, so each must be reachable by scrolling, and nothing scrolls sideways.
    const layout = await page.evaluate(minimum => {
      const rail = document.querySelector('.world-inspector').getBoundingClientRect(), stack = document.querySelector('.wi-cards')
      const heads = [...document.querySelectorAll('.wi-head')].map(el => { el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(), s = stack.getBoundingClientRect(); return r.top >= Math.max(rail.top, s.top) - 1 && r.bottom <= Math.min(rail.bottom, s.bottom) + 1 && r.height >= minimum - .5 })
      stack.scrollTop = 0
      return { heads, sideways: stack.scrollWidth > stack.clientWidth + 1 || stack.closest('.world-inspector').scrollWidth > stack.closest('.world-inspector').clientWidth + 1 }
    }, touch ? 48 : 44)
    assert.ok(layout.heads.every(Boolean), 'every section header is full size and reachable')
    assert.equal(layout.sideways, false, 'stack never scrolls sideways')
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-all-sections.png` })
    // Sky and weather now live in the World card: close the others, open World and its Sun fold.
    const others = page.locator('.wi-card.is-open:not([data-section=world]) .wi-head')
    while (await others.count()) await others.first().click()
    const world = page.locator('.wi-cards > .wi-card[data-section=world]')
    const header = world.locator(':scope > .wi-head')
    if (await header.getAttribute('aria-expanded') !== 'true') {
      if (touch) await header.tap(); else await header.click()
    }
    await page.waitForFunction(() => document.querySelector('.wi-cards > [data-section=world] > .wi-head').getAttribute('aria-expanded') === 'true')
    await waitForPanelMotion(page)
    assert.ok(await world.locator(':scope > .wi-body').evaluate(el => el.clientHeight > 60), 'selected panel has usable internal space')
    const row = page.locator('.wi-row[data-id="sun.timeOfDay"]')
    await row.evaluate(el => { el.closest('details').open = true })
    await row.scrollIntoViewIfNeeded()
    if (touch) await row.locator('.wi-label').tap(); else await row.hover()
    await page.locator('#setting-tooltip').waitFor({ state: 'visible' })
    const tip = await page.locator('#setting-tooltip').boundingBox(), control = await row.boundingBox()
    assert.ok(tip.x >= 0 && tip.y >= 0 && tip.x + tip.width <= page.viewportSize().width && tip.y + tip.height <= page.viewportSize().height)
    if (!touch) assert.ok(tip.x + tip.width < control.x, 'description floats left of control')
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-tooltip.png` })
    // A phone shows one panel at a time: its title goes back to the list (its X would close the panels).
    const back = page.locator('.world-inspector.is-single .wi-card.is-open > .wi-head h3')
    if (await back.isVisible()) await back.tap()
    await page.locator('[data-section=players] > .wi-head').click()
    assert.equal(await page.locator('.rail-diagnostics input').isChecked(), false)
    await page.locator('.rail-diagnostics input').check()
    await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('show-diagnostics'))
    await page.locator('.rail-diagnostics input').uncheck()
    if (!touch) {
      // Any native select will do; the synthetic keys below never change its value. The
      // vehicle choice is a segmented picker now, so this uses the quality level's select.
      await page.locator('[data-section=performance] .wi-head').click()
      const select = page.locator('.wi-card[data-section=performance] .wi-level-select')
      await select.scrollIntoViewIfNeeded()
      await select.focus()
      // Check held keys before keyup: a leak can disappear before a frame assertion.
      for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter']) {
        const result = await select.evaluate((el, code) => {
          const input = window.mira.game.input
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
      assert.equal(await page.evaluate(() => mira.game.input.poll().y), 1)
      await select.evaluate(el => el.dispatchEvent(new KeyboardEvent('keyup', {code:'ArrowUp',bubbles:true})))
      assert.equal(await page.evaluate(() => mira.game.input.poll().y), 0)
      // That arrow key was pressed outside any field, which now means "drive": it may have
      // captured the cursor and closed the panels. Free it again before going on.
      if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
      await page.locator('.world-inspector').waitFor({ state: 'visible' })
    }
    if (touch) {
      // Touch closes with the stack's own Close panels, or on a phone with one panel open, that
      // panel's X: the Panels control fades out while the panels show.
      const single = await page.locator('.world-inspector.is-single').count()
      await page.locator(single ? '.world-inspector .wi-card.is-open > .wi-card-close' : '.world-inspector .panels-close').tap(); await page.locator('.world-inspector').waitFor({ state: 'hidden' })
      assert.equal(await page.locator('.world-inspector').isHidden(), true, 'returning to driving hides the panels')
      await page.locator('.inspector-toggle').tap()
      await page.locator('.world-inspector').waitFor({ state: 'visible' })
    } else {
      // Returning to driving captures the cursor, and the panels go with it.
      // Open game view: the top left holds the gear selector and its rows (hud-column.css).
      await page.mouse.click(720, 350); await page.locator('.world-inspector').waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.pointerLockElement === mira.game.canvas)
      assert.equal(await page.locator('.world-inspector').isHidden(), true, 'panels are closed while the cursor is captured')
      // Escape frees the cursor: panels. Escape again: paused. Never back to the solar system.
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => !document.pointerLockElement)
      await page.locator('.world-inspector').waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await page.locator('.pause-veil').waitFor({ state: 'visible' })
      assert.equal(await page.evaluate(() => mira.shell.menuOpen), false, 'Escape never returns to solar system')
      await page.keyboard.press('Escape')
      await page.locator('.pause-veil').waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.pointerLockElement === mira.game.canvas)
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
    assert.equal(await page.evaluate(() => mira.shell.menuOpen), false, 'Escape stays in the world')
    assert.equal(await page.locator('.pause-veil').isHidden(), true, 'Escape on the question does not pause')
    await page.locator('.exit-world').click(); await asking.waitFor({ state: 'visible' })
    await asking.click({ position: { x: 8, y: 8 } })
    await asking.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => mira.shell.menuOpen), false, 'a click outside stays in the world')
    await page.locator('.exit-world').click(); await asking.waitFor({ state: 'visible' })
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-exit-confirm.png` })
    await page.locator('.exit-leave').click()
    await page.waitForFunction(() => mira.shell.menuOpen)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `tests/ui/artifacts/exploration/${mode}-lobby.png` })
    assert.deepEqual(errors, [])
    console.log(`${mode}: exploration layout passed`)
  } finally { await browser.close() }
}
