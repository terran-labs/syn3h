// The lobby's settings gear and panel on desktop, an iPhone 14, and an iPhone 14 on its side
// at the screen's full 844 by 390 (the panel must show six rows there).
//   SYN3H_URL=http://127.0.0.1:5173/ node tests/ui/lobby-settings.mjs
// Screenshots go to tests/ui/artifacts/lobby-settings: the lobby with the gear, Sound open with
// Advanced, and Graphics open.
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { openInTurn } from './lib/card-stack.mjs'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/'
const out = 'tests/ui/artifacts/lobby-settings'
await mkdir(out, { recursive: true })
const overlaps = (a, b) => a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1

for (const mode of ['desktop', 'phone', 'landscape']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(mode === 'landscape' ? { ...devices['iPhone 14 landscape'], viewport: { width: 844, height: 390 } } : touch ? devices['iPhone 14'] : { viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${base}?room=lobby-settings-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForTimeout(2000)
    const tap = (locator) => touch ? locator.tap() : locator.click()

    // The gear and the version beside it, clear of the planet labels, the buttons and the hint.
    const gear = page.getByRole('button', { name: 'Settings', exact: true })
    await gear.waitFor({ state: 'visible' })
    const gearBox = await gear.boundingBox()
    assert.ok(gearBox.width >= 44 && gearBox.height >= 44, `${mode}: gear is a 44 px target`)
    assert.equal(await page.locator('.galaxy-links [data-goto=settings]').count(), 0, `${mode}: no SETTINGS text button`)
    const version = page.locator('[data-lobby-version]')
    assert.match(await version.textContent(), /\S/, `${mode}: version shown beside the gear`)
    const versionBox = await version.boundingBox()
    // Planet captions are not in this list: they are fixed to orbiting planets and may pass
    // under anything, the gear included (the owner, 16 November 2026: captions may overlap).
    const others = await page.evaluate(() => [...document.querySelectorAll('.galaxy-links button')]
      .map((e) => { const r = e.getBoundingClientRect(); return { what: e.textContent.trim().slice(0, 20), x: r.x, y: r.y, width: r.width, height: r.height } })
      .filter((r) => r.width && r.height))
    for (const other of others) for (const [box, name] of [[gearBox, 'gear'], [versionBox, 'version']]) assert.ok(!overlaps(box, other), `${mode}: ${name} clears ${other.what} ${JSON.stringify([box, other])}`)
    const hint = others.find((o) => o.what.startsWith('Drag'))
    if (hint && versionBox.x < hint.x + hint.width) assert.ok(versionBox.y - (hint.y + hint.height) >= 16, `${mode}: version 16 px clear of the hint ${JSON.stringify([versionBox, hint])}`)
    await page.screenshot({ path: `${out}/${mode}-lobby.png` })
    // Focusable and titled with the full version; it opens Updates (checked at the end).
    assert.match(await version.getAttribute('title'), /^Version \S/)
    await version.focus(); assert.ok(await version.evaluate((el) => el === document.activeElement), `${mode}: version focusable`)

    // Open: focus moves into the panel; four cards, collapsed to one-line summaries.
    await tap(gear)
    const panel = page.locator('.world-inspector.lobby-settings')
    await panel.waitFor({ state: 'visible' })
    // Settings is one of the lobby's sheets (LobbySheet): focus moves into it.
    assert.ok(await page.evaluate(() => document.activeElement?.closest('dialog.lobby-sheet-settings') !== null), `${mode}: focus inside the panel`)
    // Not in a room here, so the Room card (host lock and reset) has nothing to act on and hides.
    assert.deepEqual(await panel.locator('.wi-card').evaluateAll((cards) => cards.filter((c) => c.getClientRects().length).map((c) => c.dataset.section)), ['sound', 'performance', 'controls'])
    assert.match(await panel.locator('.wi-card[data-section=sound] .wi-sum').textContent(), /Music \d+% · Master \d+%/)
    assert.match(await panel.locator('.lobby-settings-foot .build-line').textContent(), /Version \S/)

    // Sound: music and master volume shown directly, the rest under Advanced.
    await tap(panel.locator('.wi-card[data-section=sound] .wi-head'))
    const sound = panel.locator('.wi-card[data-section=sound]')
    await sound.locator('.wi-row[data-id="audio.music"]').waitFor({ state: 'visible' })
    await sound.locator('.wi-row[data-id="audio.master"]').waitFor({ state: 'visible' })
    assert.equal(await sound.locator(':scope .wi-body > .wi-row[data-id="audio.effects"]').count(), 0, `${mode}: effects is not up front`)
    await tap(sound.locator('.lobby-advanced > summary'))
    for (const id of ['audio.effects', 'audio.engine', 'audio.dirt', 'audio.wind', 'audio.world']) await sound.locator(`.lobby-advanced .wi-row[data-id="${id}"]`).waitFor({ state: 'visible' })
    // Moving the music slider sets the parameter.
    const before = await page.evaluate(() => window.syn3h.params.get('audio.music').value)
    const target = before > 0.5 ? 0.3 : 0.6
    await sound.locator('.wi-row[data-id="audio.music"] input[type=range]').evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })) }, target)
    assert.equal(await page.evaluate(() => window.syn3h.params.get('audio.music').value), target, `${mode}: music volume follows the slider`)
    // Every volume reads as a percentage, like the card's summary.
    for (const id of ['audio.music', 'audio.master', 'audio.effects']) assert.match(await sound.locator(`.wi-row[data-id="${id}"] .wi-num`).textContent(), /^\d+%$/, `${mode}: ${id} as a percentage`)
    assert.equal(await sound.locator('.wi-row[data-id="audio.music"] .wi-num').textContent(), `${Math.round(target * 100)}%`)
    // Show the two volumes at the top of the card, with Advanced open beneath them. Wait for
    // the cards to land first: a card mid-motion is pinned at its old height and cannot scroll.
    await page.waitForFunction(() => !document.querySelector('.world-inspector.lobby-settings').getAnimations({ subtree: true }).some((a) => a.playState === 'running' && a.effect?.target?.classList?.contains('wi-card')))
    await sound.locator('.wi-row[data-id="audio.music"]').evaluate((row) => row.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(400)
    // At least six rows show at once, whole, in the sheet (the owner's measure at 844 by 390).
    const whole = await panel.evaluate((p) => {
      const view = p.querySelector('.wi-cards').getBoundingClientRect()
      return [...p.querySelectorAll('.wi-card[data-section=sound] .wi-row')].filter((row) => { const r = row.getBoundingClientRect(); return r.height > 0 && r.top >= view.top - 1 && r.bottom <= view.bottom + 1 }).length
    })
    assert.ok(whole >= 6, `${mode}: ${whole} whole rows in view`)
    await page.screenshot({ path: `${out}/${mode}-sound.png` })
    // Mute is the standard switch: role and aria-checked agree with the setting, Space and
    // Enter toggle it, and its label text toggles it too.
    const mute = sound.getByRole('switch', { name: 'Mute audio' })
    const muted = () => page.evaluate(() => window.syn3h.params.get('audio.muted').value)
    const wasMuted = await muted()
    assert.equal(await mute.getAttribute('aria-checked'), String(wasMuted), `${mode}: mute aria-checked`)
    await mute.focus(); await page.keyboard.press('Space')
    assert.equal(await muted(), !wasMuted, `${mode}: Space toggles`); assert.equal(await mute.getAttribute('aria-checked'), String(!wasMuted))
    await page.keyboard.press('Enter')
    assert.equal(await muted(), wasMuted, `${mode}: Enter toggles`); assert.equal(await mute.getAttribute('aria-checked'), String(wasMuted))
    if (!touch) { await sound.locator('.wi-row[data-id="audio.muted"] .wi-label').click(); assert.equal(await muted(), !wasMuted, `${mode}: the label toggles`); await page.evaluate((v) => window.syn3h.params.set('audio.muted', v), wasMuted) }
    assert.ok((await sound.locator('.wi-row[data-id="audio.muted"] .wi-hit').boundingBox()).height >= 44 - .5, `${mode}: the switch is a 44 px target`)
    await page.evaluate((value) => window.syn3h.params.set('audio.music', value), before)

    // Graphics: the in-game quality stepper steps down and back up.
    await tap(sound.locator('.wi-head'))
    const graphics = panel.locator('.wi-card[data-section=performance]')
    await tap(graphics.locator('.wi-head'))
    await graphics.locator('[data-quality=down]').waitFor({ state: 'visible' })
    assert.equal(await graphics.locator('.performance-diagnostics').count(), 0, `${mode}: no frame diagnostics in the lobby`)
    const level = () => page.evaluate(() => window.syn3h.game.quality.getQualityState().level)
    const start = await level()
    const down = graphics.locator('[data-quality=down]'), up = graphics.locator('[data-quality=up]')
    if (await down.isDisabled()) { await tap(up); assert.equal(await level(), start + 1, `${mode}: steps up`); await tap(down); assert.equal(await level(), start, `${mode}: steps down`) }
    else { await tap(down); assert.equal(await level(), start - 1, `${mode}: steps down`); await tap(up); assert.equal(await level(), start, `${mode}: steps up`) }
    await page.waitForTimeout(400)
    // No label ends in an ellipsis: long ones wrap.
    const cut = await graphics.locator('.wi-label').evaluateAll((labels) => labels.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent))
    assert.deepEqual(cut, [], `${mode}: labels cut off`)
    await page.screenshot({ path: `${out}/${mode}-graphics.png` })
    // Auto quality is a switch of its own, apart from the stepper, saying on or off beside it.
    const auto = graphics.getByRole('switch', { name: 'Auto quality' })
    const autoOn = () => page.evaluate(() => window.syn3h.game.quality.getQualityState().auto)
    const autoBefore = await autoOn()
    assert.equal(await auto.getAttribute('aria-checked'), String(autoBefore), `${mode}: Auto aria-checked`)
    assert.equal((await graphics.locator('.wi-auto .s3-switch-word').textContent()).trim(), autoBefore ? 'on' : 'off')
    await tap(graphics.locator('.wi-auto .s3-switch-text'))
    assert.equal(await autoOn(), !autoBefore, `${mode}: the Auto quality label toggles it`)
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${out}/${mode}-graphics-auto-${autoBefore ? 'off' : 'on'}.png` })
    await tap(graphics.locator('.wi-auto .s3-switch-text'))
    assert.equal(await autoOn(), autoBefore)

    // Controls holds the personal control settings.
    await tap(panel.locator('.wi-card[data-section=controls] .wi-head'))
    for (const id of ['touch.leftHanded', 'camera.sensitivity', 'daydream.seconds']) await panel.locator(`.wi-row[data-id="${id}"]`).waitFor({ state: 'visible' })
    assert.equal(await panel.getByRole('switch', { name: 'Presentation mode · P' }).count(), 1, `${mode}: presentation mode is a switch`)
    await panel.locator('.wi-card[data-section=controls]').evaluate((c) => c.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}/${mode}-controls.png` })

    // Opening the cards in turn, with Sound's Advanced fold open so it is tall: the card open
    // longest closes when the next does not fit, and no open card is squeezed. Desktop is also
    // checked at a short laptop height.
    await panel.locator('.lobby-advanced').evaluate((fold) => { fold.open = true })
    for (const height of mode === 'desktop' ? [900, 700] : [null]) {
      if (height) await page.setViewportSize({ width: 1440, height })
      const tag = height ? `${mode}-${height}` : mode
      const history = await openInTurn(page, panel, ['sound', 'performance', 'controls', 'sound'], { tap: touch, prefix: `${out}/${tag}-stack`, label: tag })
      console.log(`${tag}: open after each step ${JSON.stringify(history)}`)
    }
    if (mode === 'desktop') await page.setViewportSize({ width: 1440, height: 900 })

    // Escape closes and focus returns to the gear (the close control does the same on phones).
    if (touch) await tap(page.locator('dialog.lobby-sheet-settings .lobby-sheet-close'))
    else await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('dialog.lobby-sheet-settings[open]'))
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('lobby-gear')), `${mode}: focus back on the gear`)
    if (!touch) {
      // Tab stays inside while open; a click outside closes without reaching the galaxy.
      await gear.click(); await panel.waitFor({ state: 'visible' })
      for (let i = 0; i < 30; i++) await page.keyboard.press('Tab')
      assert.ok(await page.evaluate(() => document.activeElement?.closest('dialog.lobby-sheet-settings') !== null), 'desktop: focus trapped')
      await page.mouse.click(120, 450)
      await page.waitForFunction(() => !document.querySelector('dialog.lobby-sheet-settings[open]'))
      assert.equal(await page.evaluate(() => document.querySelector('.shell-overlay .lobby-panels')?.hidden ?? true), true, 'desktop: outside click did not open a planet')
    }
    // The version beside the gear opens the Updates sheet.
    await tap(page.locator('[data-lobby-version]'))
    await page.locator('.lobby-sheet-updates .about-updates').waitFor({ state: 'visible', timeout: 10000 })
    await page.keyboard.press('Escape'); await page.locator('.lobby-sheet-updates').waitFor({ state: 'hidden' })
    // Closed, no settings panel shows (it waits in its closed sheet).
    assert.equal(await page.locator('.world-inspector.lobby-settings:visible').count(), 0)
    assert.deepEqual(errors, [], `${mode}: no page errors`)
    console.log(`${mode}: ok`)
  } finally { await browser.close() }
}
