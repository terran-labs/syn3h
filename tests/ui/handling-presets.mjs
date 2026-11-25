// The Handling dropdown in the sidebar's Vehicles card, on desktop and an iPhone 14.
//   MIRA_URL=http://127.0.0.1:5173/ node tests/ui/handling-presets.mjs
// Choosing a preset sets its settings; moving a slider shows Custom. Screenshots go to
// tests/ui/artifacts/handling-presets. A native dropdown cannot be captured open in a headless
// browser, so for the screenshot the list is shown in place (size = number of options).
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5173/'
const out = 'tests/ui/artifacts/handling-presets'
await mkdir(out, { recursive: true })

for (const mode of ['desktop', 'phone']) {
  const touch = mode === 'phone'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? devices['iPhone 14'] : { viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${base}?autoplay=1&room=handling-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    const rail = page.locator('.world-inspector')
    if (!(await rail.isVisible())) {
      if (touch) await page.locator('.inspector-toggle').tap()
      else { if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape'); if (!(await rail.isVisible())) await page.locator('.inspector-toggle').click() }
    }
    await rail.waitFor({ state: 'visible' })
    const card = page.locator('.wi-card[data-section=world]')
    if (!(await card.evaluate((c) => c.classList.contains('is-open')))) await card.locator('.wi-head').click()
    const vehicles = card.locator('details.wi-group[data-group=Vehicles]')
    if (!(await vehicles.evaluate((d) => d.open))) await vehicles.locator(':scope > summary').click()
    const fold = card.locator('details.wi-group[data-group=Buggy]')
    if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').click()
    const select = fold.locator('.wi-preset select')
    await select.waitFor({ state: 'visible' })
    assert.equal(await select.locator('option:checked').textContent(), 'Balanced', `${mode}: the default is Balanced`)

    // Choosing a preset sets its settings and its description.
    await select.selectOption({ label: 'Planted' })
    assert.equal(await page.evaluate(() => window.mira.params.get('buggy.fin').value), 0.4, `${mode}: Planted sets the fin`)
    assert.match(await fold.locator('.wi-preset-about').textContent(), /never steer themselves/)
    // A slider moved off every preset shows Custom.
    await page.evaluate(() => window.mira.params.set('buggy.fin', 0.45))
    assert.equal(await select.locator('option:checked').textContent(), 'Custom', `${mode}: a changed slider shows Custom`)
    // The dropdown catches up with the settings a moment later (about half a second): wait for it.
    await select.selectOption({ label: 'Balanced' })
    await page.waitForFunction(() => document.querySelector('.wi-card[data-section=world] details.wi-group[data-group=Buggy] .wi-preset select option:checked')?.textContent === 'Balanced', null, { timeout: 5000 })

    // The list shown open, for the screenshot.
    await select.evaluate((s) => { s.size = s.options.length; s.style.height = 'auto'; s.style.background = 'rgb(6 21 33 / .96)'; s.closest('.wi-preset').scrollIntoView({ block: 'start' }) })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/${mode}-buggy-presets.png` })
    await select.evaluate((s) => { s.size = 0; s.removeAttribute('style') })
    assert.deepEqual(errors, [], `${mode}: no page errors`)
    console.log(`${mode}: ok`)
  } finally { await browser.close() }
}
