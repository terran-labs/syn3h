/**
 * The About guide opened in play: from the sidebar it shows over the world, cancels held
 * fire, closes on Escape without firing, and leaves the address and the room alone.
 *
 *   SYN3H_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/about-in-play.mjs
 */
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/about-in-play'
await mkdir(out, { recursive: true })
for (const mode of ['desktop', 'phone', 'landscape']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? devices[mode === 'landscape' ? 'iPhone 14 landscape' : 'iPhone 14'] : { viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    // The guide has no images; none may load at any point.
    const images = []; page.on('request', r => { if (r.resourceType() === 'image') images.push(r.url()) })
    await page.goto(`${process.env.SYN3H_URL}?autoplay=1&room=about-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    const url = page.url(), room = await page.evaluate(() => syn3h.shell.room)
    if (touch) await page.locator('.inspector-toggle').tap()
    else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    await page.locator('.world-inspector').waitFor({ state: 'visible' })
    await page.locator('[data-section=players] > .wi-head').click()

    // Hold fire (L), then open the guide with it still down.
    await page.keyboard.down('l')
    await page.waitForFunction(() => syn3h.game.input.state.fire)
    await page.locator('.rail-about').click()
    const guide = page.locator('.in-play-about')
    await guide.waitFor({ state: 'visible' })
    assert.ok(await guide.evaluate(d => d.open && d.matches(':modal')), 'the guide is a modal')
    assert.match(await guide.innerText(), /About Syn3h/i)
    assert.equal(await page.evaluate(() => syn3h.game.input.state.fire), false, 'held fire is cancelled on open')
    assert.ok(await page.evaluate(() => document.activeElement?.closest('.in-play-about') !== null), 'focus moves into the guide')
    await page.screenshot({ path: `${out}/${mode}.png` })
    if (touch) {
      // One header row on a phone: title and Back side by side, Back a full tap target.
      const header = await guide.locator('header').boundingBox(), title = await guide.locator('h2').boundingBox(), back = await guide.locator('.about-back').boundingBox()
      assert.ok(header.height <= 56, `${mode}: header is ${header.height}px tall`)
      assert.ok(back.height >= 44 && title.x + title.width < back.x, `${mode}: title left, Back right, one row`)
    }
    if (!touch) {
      // Keyboard only: Tab stays inside the guide and reaches Back.
      for (let i = 0; i < 3; i++) await page.keyboard.press('Tab')
      assert.ok(await page.evaluate(() => document.activeElement?.closest('.in-play-about') !== null), 'Tab stays in the guide')
    }

    // Escape closes it and does nothing else; the still-held L does not fire.
    await page.keyboard.press('Escape')
    await guide.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => syn3h.game.input.suspended), false, 'play resumes')
    const tick = await page.evaluate(() => syn3h.game.tick)
    await page.waitForFunction(t => syn3h.game.tick > t + 10, tick)
    assert.equal(await page.evaluate(() => syn3h.game.input.state.fire), false, 'nothing fires on close')
    await page.keyboard.up('l')
    // A fresh press fires again.
    await page.keyboard.down('l')
    await page.waitForFunction(() => syn3h.game.input.state.fire)
    await page.keyboard.up('l')
    if (!touch) {
      // From the Paused veil: About opens over it, and closing leaves the world paused.
      await page.locator('.rail-pause').click()
      await page.locator('.pause-about').click()
      await guide.waitFor({ state: 'visible' })
      await page.screenshot({ path: `${out}/desktop-paused.png` })
      await page.keyboard.press('Escape')
      await guide.waitFor({ state: 'hidden' })
      assert.ok(await page.evaluate(() => syn3h.game.input.suspended), 'still paused after the guide closes')
      await page.locator('.pause-veil').click()
      await page.waitForFunction(() => !syn3h.game.input.suspended)
    }
    assert.equal(page.url(), url, 'the address is unchanged')
    assert.equal(await page.evaluate(() => syn3h.shell.room), room, 'the room is unchanged')
    assert.deepEqual(images, [], 'no image requests')
    assert.deepEqual(errors, [])
    console.log(mode, 'ok')
  } finally { await browser.close() }
}
