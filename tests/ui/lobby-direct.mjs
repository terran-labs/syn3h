import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/lobby-direct'
await mkdir(out, { recursive: true })
for (const mode of ['desktop', 'phone', 'landscape']) {
  const browser = await (mode === 'desktop' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch())
  try {
    const page = await browser.newPage(mode === 'desktop' ? { viewport: { width: 1440, height: 1000 } } : devices[mode === 'phone' ? 'iPhone 14' : 'iPhone 14 landscape'])
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${process.env.SYN3H_URL}?room=lobby-direct-${Date.now()}`)
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // The lobby's opening (about nine seconds) hides its controls; a key skips to the settled lobby.
    await page.keyboard.press('Shift'); await page.waitForTimeout(700)
    // The lobby's controls are the corner dock now (About and Updates over the gear); it has no bottom buttons.
    const dock = page.locator('.lobby-gear-dock')
    await dock.waitFor({ state: 'visible' })
    assert.equal(await page.locator('.galaxy-links button').count(), 0, 'no bottom buttons')
    if (process.env.UX_BEFORE === '1') {
      await page.getByRole('button', { name: 'About Syn3h', exact: true }).click()
      await page.waitForTimeout(200)
      await page.screenshot({ path: `${out}/${mode}-before.png` })
      continue
    }
    assert.equal(await page.locator('.lobby-index, .lobby-message').count(), 0)
    if (process.env.UX_LAYOUT_ONLY !== '1') {
    // Waiting in the lobby must never start a tour or enter a world.
    await page.waitForTimeout(22000)
    assert.equal(await page.evaluate(() => syn3h.shell.activePanel), 'index')
    assert.equal(await page.evaluate(() => syn3h.shell.playing), false)
    assert.equal(await page.locator('.attract-overlay').count(), 0)
    await page.screenshot({ path: `${out}/${mode}-resting.png` })
    // Minimal holds the generated galaxy still after its layout and maps settle.
    const originalLevel = await page.evaluate(() => syn3h.game.quality.getQualityState().level)
    await page.evaluate(() => syn3h.game.quality.setLevel(0))
    let resting = false
    for (let attempt = 0; attempt < 12; attempt++) {
      const frames = await page.evaluate(() => syn3h.shell.graphics.galaxyFrames)
      await page.waitForTimeout(2000)
      if (frames === await page.evaluate(() => syn3h.shell.graphics.galaxyFrames)) { resting = true; break }
    }
    assert.ok(resting, 'Minimal galaxy settles with zero idle redraws')
    assert.ok(await page.evaluate(() => syn3h.shell.graphics.galaxyLive), 'resting galaxy remains visible')
    await page.evaluate(level => syn3h.game.quality.setLevel(level), originalLevel)

    }
    await page.waitForTimeout(600)
    const spacing = await page.evaluate(() => {
      // The corner dock keeps clear of the screen's bottom edge (and a phone's home indicator).
      const dock = document.querySelector('.lobby-gear-dock').getBoundingClientRect()
      return { bottom: innerHeight - dock.bottom }
    })
    console.log(`${mode} spacing ${JSON.stringify(spacing)}`)
    assert.ok(spacing.bottom >= 8)
    await page.screenshot({ path: `${out}/${mode}-lobby.png` })
    // The lobby has no panel buttons any more: About and Updates open as sheets from their
    // corner icons, checked in tests/ui/lobby-about.mjs.
    assert.deepEqual(errors, [])
    console.log(`${mode}: direct lobby PASS`)
  } finally { await browser.close() }
}
