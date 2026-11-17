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
    const nav = page.locator('.galaxy-links')
    await nav.waitFor({ state: 'visible' })
    if (process.env.UX_BEFORE === '1') {
      await nav.locator('[data-goto=multiplayer]').click()
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
      const hint = document.querySelector('.galaxy-hint').getBoundingClientRect(), nav = document.querySelector('.galaxy-links').getBoundingClientRect()
      const labels = [...document.querySelectorAll('.galaxy-label')].filter(el => !el.hidden && !el.classList.contains('is-crowded')).map(el => el.getBoundingClientRect().bottom)
      return { gap: nav.top - hint.bottom, above: hint.top - Math.max(0, ...labels), bottom: innerHeight - nav.bottom }
    })
    console.log(`${mode} spacing ${JSON.stringify(spacing)}`)
    assert.ok(spacing.gap >= 24 && spacing.gap <= 28 && spacing.above >= 23 && spacing.bottom >= 16)
    await page.screenshot({ path: `${out}/${mode}-lobby.png` })
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion })
      for (const name of ['multiplayer']) {
        await nav.locator(`[data-goto=${name}]`).click()
        // The requested panel is the only visible section from the first paint onward.
        assert.deepEqual(await page.locator('.lobby-panels > section:visible').evaluateAll(es => es.map(el => el.dataset.panel)), [name])
        await page.waitForFunction(() => document.querySelector('.lobby-panels').dataset.busy === 'false')
        const separated = await page.evaluate(() => {
          const panel = document.querySelector('.lobby-panels').getBoundingClientRect()
          const footer = document.querySelector('.lobby-footer').getBoundingClientRect()
          const links = document.querySelector('.galaxy-links').getBoundingClientRect()
          return { panelBottom: panel.bottom, footerTop: footer.top, footerBottom: footer.bottom, linksTop: links.top }
        })
        assert.ok(separated.panelBottom <= separated.footerTop && separated.footerBottom < separated.linksTop, `panel, status and navigation stay separate: ${JSON.stringify(separated)}`)
        await page.screenshot({ path: `${out}/${mode}-${name}-${reducedMotion}.png` })
      }
      await page.keyboard.press('Escape')
      await page.locator('.lobby-panels').waitFor({ state: 'hidden' })
      await nav.locator('[data-goto=multiplayer]').click()
      await page.waitForFunction(() => document.querySelector('.lobby-panels').dataset.busy === 'false')
      await page.mouse.click(4, 4)
      await page.locator('.lobby-panels').waitFor({ state: 'hidden' })
    }
    assert.deepEqual(errors, [])
    console.log(`${mode}: direct lobby PASS`)
  } finally { await browser.close() }
}
