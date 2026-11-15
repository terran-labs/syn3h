// The Performance card against the real quality controller (game.quality), in desktop Chrome
// and iPhone WebKit: the level dropdown and its step arrows, Auto, fine-tune rows that follow
// the level, overrides marked and reset, keyboard isolation and the retired vocabulary.
// Serve the app first (tests/ui/README.md); base URL from SYN3H_URL.
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5211/'
const shots = 'tests/ui/artifacts/quality-card'
await mkdir(shots, { recursive: true })
const RETIRED = /\b(tiers?|safe|mobile|desktop|unmeasured)\b/i
const BUDGET = 'lava.particleBudget' // 240, 960, 960, 1600, 2400, 4800 from Minimal to Cinematic

const state = page => page.evaluate(() => syn3h.game.quality.getQualityState())
const settled = page => page.waitForFunction(() => !document.querySelector('.wi-cards').getAnimations({ subtree: true }).some(a => a.playState === 'running'))
const levelIs = (page, level) => page.waitForFunction(level => syn3h.game.quality.getQualityState().level === level, level, { timeout: 30000 })

for (const mode of process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop', 'phone']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? { ...devices['iPhone 14'] } : { viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(`${base}?autoplay=1&room=quality-card-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // With ?autoplay=1 the cursor is free and the rail is open; older shells need the toggle.
    if (!await page.locator('.world-inspector').isVisible()) await page.getByRole('button', { name: 'Open configuration rail' }).click()
    await page.locator('.world-inspector').waitFor({ state: 'visible' })
    const press = locator => touch ? locator.tap() : locator.click()

    // ---- A sixth card, after Vehicles, and no floating panel or header button. ----
    const sections = await page.locator('.wi-card').evaluateAll(cards => cards.map(card => card.dataset.section))
    assert.equal(sections[sections.indexOf('vehicles') + 1], 'performance', `Performance follows Vehicles: ${sections}`)
    assert.equal(await page.locator('.performance-toggle, .performance-panel').count(), 0, 'the old panel and its button are gone')
    const card = page.locator('.wi-card[data-section=performance]')
    await press(card.locator('.wi-head')); await settled(page)
    assert.equal(await card.locator('.wi-head h3').innerText().then(t => t.trim().toLowerCase()), 'performance')
    const select = card.getByRole('combobox', { name: 'Quality level' })
    const down = card.getByRole('button', { name: 'Lower quality level' }), up = card.getByRole('button', { name: 'Raise quality level' })
    const auto = card.locator('.wi-auto input')

    // The dropdown sits between the arrows: down on the left, up on the right.
    const [d, m, u] = await Promise.all([down.boundingBox(), select.boundingBox(), up.boundingBox()])
    assert.ok(d.x + d.width <= m.x && m.x + m.width <= u.x, 'down, level, up from left to right')
    for (const box of [d, u]) assert.ok(box.width >= 44 - .5 && box.height >= 44 - .5, 'arrow buttons are 44 px targets')
    assert.ok(m.height >= 44 - .5, 'level dropdown is a 44 px target')
    assert.deepEqual(await select.locator('option').allInnerTexts(), ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Cinematic'])
    assert.doesNotMatch(await card.innerText(), RETIRED, 'no retired words in the card')

    // ---- The dropdown chooses a level; the rows under it follow. ----
    await select.selectOption('2'); await levelIs(page, 2)
    assert.equal(await card.locator('.wi-level-of').innerText(), 'Level 3 of 6')
    const budget = card.locator(`.wi-row[data-id="${BUDGET}"]`)
    assert.equal(await budget.count(), 1, 'a preset-owned property is a row in the card')
    assert.equal(await page.locator(`.wi-card:not([data-section=performance]) .wi-row[data-id="${BUDGET}"]`).count(), 0, 'and only there')
    await budget.evaluate(row => { row.closest('details').open = true }); await budget.scrollIntoViewIfNeeded()
    assert.equal(await budget.locator('.wi-num').innerText(), '960')
    assert.match(await card.locator('.wi-head .wi-sum').innerText(), /^Medium/)

    // ---- Step arrows. ----
    await down.scrollIntoViewIfNeeded(); await press(up); await levelIs(page, 3)
    assert.equal(await select.inputValue(), '3'); assert.equal(await budget.locator('.wi-num').innerText(), '1600', 'rows resync on a level change')
    await press(down); await levelIs(page, 2)
    assert.equal(await budget.locator('.wi-num').innerText(), '960')

    // ---- The ends disable their arrow. ----
    await select.selectOption('0'); await levelIs(page, 0)
    assert.equal(await down.isDisabled(), true, 'nothing below Minimal'); assert.equal(await up.isDisabled(), false)
    await select.selectOption('5')
    await page.waitForFunction(() => syn3h.game.quality.getQualityState().level > 0, null, { timeout: 30000 })
    const top = await state(page)
    // The controller may hold a device below Cinematic; the arrow tracks the six, not the cap.
    if (top.level === 5) assert.equal(await up.isDisabled(), true, 'nothing above Cinematic')
    else console.log(`${mode}: Cinematic held at ${top.name} by the controller (ceiling ${top.ceiling}); top arrow not asserted`)
    assert.equal(await down.isDisabled(), false)
    await select.selectOption('2'); await levelIs(page, 2)

    // ---- Auto. ----
    const autoBefore = (await state(page)).auto
    assert.equal(await auto.isChecked(), autoBefore)
    await press(auto); await page.waitForFunction(was => syn3h.game.quality.getQualityState().auto !== was, autoBefore)
    assert.equal(await auto.isChecked(), !autoBefore)
    // Card summaries refresh on the next shell frame, after the control subscription.
    await page.waitForFunction(expected => /· Auto$/.test(document.querySelector('.wi-card[data-section=performance] .wi-head .wi-sum').textContent) === expected, !autoBefore)
    assert.equal(/· Auto$/.test(await card.locator('.wi-head .wi-sum').innerText()), !autoBefore, 'the summary says Auto when automatic')
    if (!autoBefore) { await press(auto); await page.waitForFunction(() => !syn3h.game.quality.getQualityState().auto) }
    // Hold the level for the rest of the checks, so the governor cannot move it underneath them.
    if ((await state(page)).auto) { await press(auto); await page.waitForFunction(() => !syn3h.game.quality.getQualityState().auto) }
    await levelIs(page, 2)

    // ---- An override appears, marked, and is reset; then "Reset all". ----
    const mark = budget.locator('.wi-changed'), resetAll = card.locator('[data-quality=reset-all]')
    assert.equal(await mark.isVisible(), false); assert.equal(await resetAll.isDisabled(), true)
    await budget.scrollIntoViewIfNeeded()
    await press(budget.locator('.wi-num')); await page.keyboard.type('1200'); await page.keyboard.press('Enter')
    await page.waitForFunction(id => id in syn3h.game.quality.getQualityState().overrides, BUDGET)
    assert.equal(await page.evaluate(id => syn3h.params.get(id).value, BUDGET), 1200)
    assert.equal(await mark.isVisible(), true, 'an override shows its mark')
    assert.equal(await budget.evaluate(row => row.classList.contains('is-changed')), true)
    assert.match(await mark.getAttribute('aria-label'), /Reset .* to the Medium value/)
    assert.equal(await resetAll.isDisabled(), false); assert.equal(await resetAll.innerText(), 'Reset all to Medium')
    await page.screenshot({ path: `${shots}/${mode}-override.png` })
    await press(mark)
    await page.waitForFunction(id => !(id in syn3h.game.quality.getQualityState().overrides), BUDGET)
    assert.equal(await budget.locator('.wi-num').innerText(), '960', 'reset puts the level value back')
    assert.equal(await mark.isVisible(), false)
    await page.evaluate(id => syn3h.params.set(id, 1440, 'local'), BUDGET)
    await page.waitForFunction(() => Object.keys(syn3h.game.quality.getQualityState().overrides).length > 0)
    await resetAll.scrollIntoViewIfNeeded(); await press(resetAll)
    await page.waitForFunction(() => Object.keys(syn3h.game.quality.getQualityState().overrides).length === 0)
    assert.equal(await budget.locator('.wi-num').innerText(), '960'); assert.equal(await resetAll.isDisabled(), true)

    // ---- A focused dropdown is typing: arrow keys and Space never drive. ----
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
      const result = await select.evaluate((el, code) => {
        el.focus()
        const input = window.syn3h.game.input, special = input.state.special, before = { ...input.poll() }
        el.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true }))
        const held = { ...input.poll() }
        el.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
        return { before, held, special: input.state.special === special }
      }, code)
      assert.deepEqual(result.held, result.before, `${code} on the level dropdown cannot drive`)
      assert.ok(result.special, `${code} cannot toggle the special ability`)
    }
    if (!touch) {
      await select.focus(); await page.keyboard.down('ArrowUp')
      assert.equal(await page.evaluate(() => syn3h.game.input.poll().y), 0, 'a held arrow on the dropdown does not drive')
      await page.keyboard.up('ArrowUp')
    }

    await page.screenshot({ path: `${shots}/${mode}-card.png` })
    assert.doesNotMatch(await card.innerText(), RETIRED, 'no retired words after all that')
    assert.deepEqual(errors, [])
    console.log(`${mode}: Performance card passed`)
  } finally { await browser.close() }
}
