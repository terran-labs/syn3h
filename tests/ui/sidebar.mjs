// The in-play panels do their jobs, on a desktop and on a phone. Bugs caught: a section missing
// from the panels or not found by search; Reset world wiping the world on one press; Pause not
// pausing or not resuming; open cards lost when a desktop's panels close and reopen; the panels unable
// to open or close with the controls a player has (the Panels button while they are closed;
// Close panels, or on a phone with one panel open that panel's X, while they are open); motion
// played under reduced motion. Layout (sizes, order, rows) is the owner's to tune and is not
// pinned here; touch layout lives in phone-panels.mjs.
//   SYN3H_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/sidebar.mjs
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'

const SECTIONS = ['you', 'game', 'players', 'vehicles', 'world', 'performance', 'chat']
const openSections = page => page.evaluate(() => [...document.querySelectorAll('.world-inspector .wi-card.is-open')].map(c => c.dataset.section))
const settled = page => page.waitForFunction(() => !document.querySelector('.world-inspector').getAnimations().some(a => a.playState === 'running'))

for (const mode of ['desktop', 'phone']) {
  const touch = mode === 'phone'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? devices['iPhone 14'] : { viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${process.env.SYN3H_URL}?autoplay=1&room=sidebar-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForFunction(() => document.querySelector('.syn3h-shell')?.classList.contains('is-playing') && !document.querySelector('.syn3h-shell').classList.contains('is-descending'), null, { timeout: 120000 })
    await page.waitForTimeout(800)
    const rail = page.locator('.world-inspector')
    const press = locator => touch ? locator.tap() : locator.click()
    // Whatever close control the player can see: the open panel's own X (a phone with one panel
    // open, from v26.11.2202), else Close panels.
    const closePanels = async () => {
      for (const selector of ['.world-inspector .wi-card.is-open > .wi-card-close', '.world-inspector .panels-close']) {
        const control = page.locator(selector).first()
        if (await control.isVisible()) { await press(control); await rail.waitFor({ state: 'hidden' }); return }
      }
      assert.fail(`${mode}: no visible control closes the open panels`)
    }
    const openPanels = async () => { await press(page.locator('.inspector-toggle')); await rail.waitFor({ state: 'visible' }); await settled(page) }

    if (touch) { if (await rail.isVisible()) await closePanels(); await openPanels() }
    else {
      if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
      await rail.waitFor({ state: 'visible' }); await settled(page)
    }

    // Every section is there, and survives a rebuild of the parameter registry.
    const present = () => page.locator('.wi-cards > [data-section]').evaluateAll(es => es.map(e => e.dataset.section).sort())
    assert.deepEqual(await present(), [...SECTIONS].sort(), `${mode}: every section is in the panels`)
    await page.evaluate(() => syn3h.shell.inspector.rebuild())
    assert.deepEqual(await present(), [...SECTIONS].sort(), `${mode}: every section survives a registry rebuild`)

    // Search finds each section, and the vehicle controls by what a player would type.
    const header = rail.locator('.rail-command'), search = header.locator('.wi-search')
    for (const section of SECTIONS) {
      await search.fill(section === 'players' ? 'Players' : section === 'you' ? 'Me' : section)
      assert.ok(await page.locator(`.wi-cards > [data-section=${section}]`).isVisible(), `${mode}: ${section} is found by search`)
    }
    await search.fill('vehicle')
    assert.ok(await page.locator('.wi-vehicle-picker').first().isVisible(), `${mode}: "vehicle" finds the vehicle picker`)
    await search.fill(''); await search.blur()
    if (!touch) {
      await page.keyboard.press('Control+f')
      assert.ok(await search.evaluate(el => el === document.activeElement), 'Ctrl+F reaches the search')
      await search.blur()
    }

    // Reset world asks before it wipes anything.
    const seedBefore = await page.evaluate(() => syn3h.params.get('world.seed').value)
    await page.evaluate(() => { syn3h.params.set('world.seed', 4242, 'local'); document.querySelector('.wi-card[data-section=world] [data-wi=reset]').click() })
    assert.equal(await page.evaluate(() => syn3h.params.get('world.seed').value), 4242, `${mode}: one press on Reset world only asks`)
    await page.evaluate(seed => syn3h.params.set('world.seed', seed, 'local'), seedBefore)

    // A card opens from its header. On a desktop it is still open after the panels close and
    // reopen; on a phone Show panels always opens the list (the owner, 19 November 2026,
    // Inspector.open), so there the check is that the player's own controls close and reopen them.
    await press(page.locator('.wi-cards > [data-section=you] > .wi-head')); await settled(page)
    const open = await openSections(page)
    assert.ok(open.includes('you'), `${mode}: a card opens from its header (${JSON.stringify(open)})`)
    if (touch) { await closePanels(); await openPanels() }
    else {
      await page.evaluate(() => { const i = syn3h.shell.inspector; i.open = false; i.open = true }); await settled(page)
      assert.deepEqual(await openSections(page), open, `${mode}: open cards survive closing the panels`)
    }

    // Pause pauses, and the veil resumes.
    await press(header.locator('.rail-pause'))
    await page.waitForFunction(() => syn3h.game.input.suspended)
    await page.locator('.pause-veil').click()
    await page.waitForFunction(() => !syn3h.game.input.suspended)

    // Reduced motion: the panels appear without animating. (On a phone Resume returns to
    // driving, closing the panels; they are opened again with the Panels button.)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    if (touch) { await rail.waitFor({ state: 'hidden' }); await press(page.locator('.inspector-toggle')); await rail.waitFor({ state: 'visible' }) }
    else await page.evaluate(() => { const i = syn3h.shell.inspector; i.open = false; i.open = true })
    assert.equal(await rail.evaluate(el => el.getAnimations().length), 0, `${mode}: reduced motion skips the panels' animation`)
    assert.deepEqual(errors, [], `${mode}: no page errors`)
    console.log(`${mode}: sidebar ok`)
  } finally { await browser.close() }
}
