import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { openInTurn } from './lib/card-stack.mjs'
const out = 'tests/ui/artifacts/sidebar'
await mkdir(out, { recursive: true })
for (const mode of ['desktop', 'ipad', 'phone', 'landscape']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? devices[mode === 'ipad' ? 'iPad (gen 7)' : mode === 'landscape' ? 'iPhone 14 landscape' : 'iPhone 14'] : { viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${process.env.SYN3H_URL}?autoplay=1&room=sidebar-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (touch) await page.locator('.inspector-toggle').tap()
    else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    const rail = page.locator('.world-inspector')
    await rail.waitFor({ state: 'visible' })
    await page.waitForFunction(() => !document.querySelector('.world-inspector').getAnimations().some(a => a.playState === 'running'))
    assert.equal(await page.locator('.wi-top, .rail-close, .wi-quick, .gear-select').count(), 0)
    const order = () => page.locator('.wi-cards > [data-section]').evaluateAll(es => es.map(e => e.dataset.section))
    const expected = ['you', 'game', 'players', 'vehicles', 'world', 'performance', 'chat']
    assert.deepEqual(await order(), expected)
    await page.evaluate(() => syn3h.shell.inspector.rebuild())
    assert.deepEqual(await order(), expected, 'session card survives registry rebuild')
    const header = rail.locator('.rail-command')
    const pause = header.locator('.rail-pause'), search = header.locator('.wi-search'), leave = header.getByRole('button', { name: 'Leave world', exact: true })
    assert.ok(await header.evaluate(el => el.nextElementSibling.classList.contains('wi-cards')))
    // The top row's controls are the search, Pause and Leave world, nothing else (the owner, 17 November 2026; the magnifier is a drawing in the field).
    assert.deepEqual(await header.locator(':scope > :is(input, button)').evaluateAll(es => es.map(e => e.className.split(' ')[0])), ['wi-search', 'rail-pause', 'exit-world'], 'the top row holds search, Pause and Leave world')
    assert.equal(await leave.count(), 1, 'Leave world has its name')
    for (const control of [search, pause, leave]) assert.ok((await control.boundingBox()).height >= 44 - .5, 'top row controls are full touch targets')
    assert.ok((await pause.boundingBox()).width >= 44 - .5 && (await leave.boundingBox()).width >= 44 - .5, 'icon buttons are full touch targets')
    const worldActions = rail.locator('.wi-card[data-section=world] .wi-world-actions button')
    assert.deepEqual(await worldActions.evaluateAll(es => es.map(el => el.getAttribute('aria-label'))), ['Copy world', 'Paste world', 'Reset world to defaults'])
    const seedBefore = await page.evaluate(() => syn3h.params.get('world.seed').value)
    await page.evaluate(() => { syn3h.params.set('world.seed', 4242, 'local'); document.querySelector('.wi-card[data-section=world] [data-wi=reset]').click() })
    assert.equal(await page.evaluate(() => syn3h.params.get('world.seed').value), 4242, 'one press on Reset only asks')
    assert.equal(await worldActions.nth(2).evaluate(el => el.classList.contains('is-warning')), true, 'Reset waits for a second press')
    await page.evaluate(seed => syn3h.params.set('world.seed', seed, 'local'), seedBefore)
    const headerBounds = await header.boundingBox()
    assert.ok(headerBounds.y >= 0 && headerBounds.y + headerBounds.height <= page.viewportSize().height, 'header stays in viewport')
    const searchBox = await search.boundingBox(), pauseBox = await pause.boundingBox(), leaveBox = await leave.boundingBox()
    assert.ok(searchBox.x + searchBox.width <= pauseBox.x && pauseBox.x + pauseBox.width <= leaveBox.x, 'search, Pause and Leave world run left to right')
    const middle = box => box.y + box.height / 2
    assert.ok(Math.abs(middle(searchBox) - middle(pauseBox)) < 1 && Math.abs(middle(pauseBox) - middle(leaveBox)) < 1, 'all header controls share one row')
    assert.ok(leaveBox.x + leaveBox.width <= headerBounds.x + headerBounds.width + .5, 'Leave world fits within the row')
    await page.screenshot({ path: `${out}/${mode}-cards.png` })
    for (const section of expected) {
      await search.fill(section === 'sky' ? 'Sky' : section === 'players' ? 'Players' : section === 'you' ? 'Me' : section)
      assert.ok(await page.locator(`.wi-cards > [data-section=${section}]`).isVisible(), `${section} is searchable`)
    }
    for (const term of ['vehicle', 'colour']) {
      await search.fill(term)
      assert.ok(await page.locator('[data-section=you] .wi-vehicle-picker').isVisible(), `${term} finds Me vehicle controls`)
    }
    assert.equal(await page.locator('[data-section=vehicles] .wi-vehicle-picker').count(), 0)
    assert.equal(await page.locator('[data-section=you] .wi-colour-dots i').count(), 2)
    await search.fill(''); await search.blur()
    if (!touch) {
      await page.keyboard.press('Control+f')
      assert.ok(await search.evaluate(el => el === document.activeElement), 'search shortcut reaches pinned search')
      await search.blur()
    }
    await page.locator('[data-section=you] .wi-head').click()
    const vehicle = page.locator('.wi-vehicle-picker')
    await vehicle.scrollIntoViewIfNeeded()
    assert.ok(await vehicle.isVisible())
    await page.screenshot({ path: `${out}/${mode}-vehicle.png` })
    // Opening cards one after another: the card open longest closes to make room, and no
    // open card is squeezed. Desktop is also checked at a short laptop height.
    const stackIds = ['you', 'game', 'vehicles', 'world', 'performance', 'you']
    const sizes = mode === 'desktop' ? [[1440, 1000], [1440, 700]] : [null]
    for (const size of sizes) {
      if (size) await page.setViewportSize({ width: size[0], height: size[1] })
      const tag = size ? `${mode}-${size[1]}` : mode
      const history = await openInTurn(page, rail, stackIds, { tap: touch, prefix: `${out}/${tag}-stack`, label: tag })
      console.log(`${tag}: open after each step ${JSON.stringify(history)}`)
      // Phones keep one card open at a time.
      if (mode === 'phone' || mode === 'landscape') assert.ok(history.every(open => open.length === 1), `${tag}: one card open at a time (${JSON.stringify(history)})`)
      // Bug caught: on a phone, hiding the panels with its own button and bringing them back
      // closed the card the player had open.
      if (touch) {
        const open = await page.evaluate(() => [...document.querySelectorAll('.world-inspector .wi-card.is-open')].map(c => c.dataset.section))
        await page.locator('.inspector-toggle').tap(); await rail.waitFor({ state: 'hidden' })
        await page.locator('.inspector-toggle').tap(); await rail.waitFor({ state: 'visible' }); await page.waitForTimeout(400)
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.world-inspector .wi-card.is-open')].map(c => c.dataset.section)), open, `${tag}: the open card survives the panels button`)
      }
      // The order survives the rail closing and reopening.
      const before = await page.evaluate(() => [...document.querySelectorAll('.world-inspector .wi-card.is-open')].map(c => c.dataset.section))
      await page.evaluate(() => { const i = syn3h.shell.inspector; i.open = false; i.open = true })
      await page.waitForFunction(() => !document.querySelector('.world-inspector').getAnimations().some(a => a.playState === 'running'))
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.world-inspector .wi-card.is-open')].map(c => c.dataset.section)), before, `${tag}: open cards survive closing the rail`)
    }
    if (mode === 'desktop') await page.setViewportSize({ width: 1440, height: 1000 })
    const pinnedBefore = await header.boundingBox()
    await rail.locator('.wi-cards').evaluate(el => { el.scrollTop = el.scrollHeight })
    assert.deepEqual(await header.boundingBox(), pinnedBefore, 'scrolling cards does not move the header')
    await pause.click()
    await page.waitForFunction(() => syn3h.game.input.suspended)
    await page.locator('.pause-veil').click()
    await page.waitForFunction(() => !syn3h.game.input.suspended)
    if (touch) {
      // Resume already requests driving; let its closing animation finish before toggling.
      await rail.waitFor({ state: 'hidden' })
      await page.locator('.inspector-toggle').tap()
    } else {
      if (!await page.evaluate(() => !!document.pointerLockElement)) await page.mouse.click(100, 150)
      await page.waitForFunction(() => !!document.pointerLockElement)
      await rail.waitFor({ state: 'hidden' })
      await page.keyboard.press('Escape')
      await rail.waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => syn3h.game.input.suspended)
      await page.locator('.pause-veil').click()
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => { const i = syn3h.shell.inspector; i.open = false; i.open = true })
    assert.equal(await rail.evaluate(el => el.getAnimations().length), 0, 'reduced motion skips sidebar animation')
    assert.deepEqual(errors, [])
    console.log(`${mode}: sidebar PASS`)
  } finally { await browser.close() }
}
