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
    const expected = ['you', 'game', 'players', 'vehicles', 'world', 'performance']
    assert.deepEqual(await order(), expected)
    await page.evaluate(() => syn3h.shell.inspector.rebuild())
    assert.deepEqual(await order(), expected, 'session card survives registry rebuild')
    const footer = rail.locator('.rail-foot'), header = rail.locator('.rail-command')
    const pause = header.locator('.rail-pause'), search = header.locator('.wi-search')
    assert.ok(await header.evaluate(el => el.nextElementSibling.classList.contains('wi-cards')))
    assert.ok(await footer.evaluate(el => el.previousElementSibling.classList.contains('wi-cards')))
    assert.ok(await header.locator('.rail-world').innerText(), 'header names the current world')
    assert.equal(await footer.getByRole('button', { name: 'Leave world', exact: true }).count(), 1)
    const headerBounds = await header.boundingBox()
    assert.ok(headerBounds.y >= 0 && headerBounds.y + headerBounds.height <= page.viewportSize().height, 'header stays in viewport')
    const bounds = await footer.boundingBox()
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height, 'footer stays in viewport')
    assert.ok((await pause.boundingBox()).height >= 44, 'Pause stays a full touch target')
    const nameBox = await header.locator('.rail-world').boundingBox()
    const searchBox = await search.boundingBox(), pauseBox = await pause.boundingBox()
    assert.ok(searchBox.height >= 44, 'search stays a full touch target')
    assert.ok(nameBox.x + nameBox.width <= searchBox.x && searchBox.x + searchBox.width <= pauseBox.x, 'world, search and Pause run left to right')
    const middle = box => box.y + box.height / 2
    assert.ok(Math.abs(middle(nameBox) - middle(searchBox)) < 1 && Math.abs(middle(searchBox) - middle(pauseBox)) < 1, 'all header controls share one row')
    assert.ok(pauseBox.x + pauseBox.width <= headerBounds.x + headerBounds.width, 'Pause fits within the header')
    assert.ok(await search.evaluate(el => { const css = getComputedStyle(el); return parseFloat(css.borderTopWidth) > 0 && css.borderTopStyle === 'solid' }), 'search has a visible field outline')
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
