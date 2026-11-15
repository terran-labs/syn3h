import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
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
    assert.equal(await page.locator('.wi-top, .rail-close, .rail-world, .wi-quick, .gear-select').count(), 0)
    const order = () => page.locator('.wi-cards > [data-section]').evaluateAll(es => es.map(e => e.dataset.section))
    const expected = ['game', 'players', 'vehicles', 'world', 'sky', 'performance', 'you']
    assert.deepEqual(await order(), expected)
    await page.evaluate(() => syn3h.shell.inspector.rebuild())
    assert.deepEqual(await order(), expected, 'session card survives registry rebuild')
    const footer = page.locator('.rail-foot'), pause = footer.locator('.rail-pause'), search = footer.locator('.wi-search')
    const bounds = await footer.boundingBox()
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize().height, 'footer stays in viewport')
    assert.ok((await pause.boundingBox()).height >= 44, 'Pause stays a full touch target')
    await page.screenshot({ path: `${out}/${mode}-cards.png` })
    for (const section of expected) {
      await search.fill(section === 'sky' ? 'Sky' : section === 'players' ? 'Players' : section === 'you' ? 'You' : section)
      assert.ok(await page.locator(`.wi-cards > [data-section=${section}]`).isVisible(), `${section} is searchable`)
    }
    await search.fill(''); await search.blur()
    if (!touch) {
      await page.keyboard.press('Control+f')
      assert.ok(await search.evaluate(el => el === document.activeElement), 'search shortcut reaches bottom search')
      await search.blur()
    }
    await page.locator('[data-section=vehicles] .wi-head').click()
    const vehicle = page.locator('.wi-vehicle-select')
    await vehicle.scrollIntoViewIfNeeded()
    assert.ok(await vehicle.isVisible())
    await page.screenshot({ path: `${out}/${mode}-vehicle.png` })
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
