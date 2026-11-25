// The gear drum and the Zorb row, wired into the real shell. Bugs it catches: gear missing
// from the drum, a click not picking gear, hints not following the gear in hand, the arrow
// keys stepping through gear while driving, the Zorb row not following X or a click, and on
// touch the equipped gear showing the wrong action or the Grapple duplicating buttons. Hidden in the lobby.
//
//   node tests/ui/gear-wired.mjs      (game on MIRA_URL)
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5198/'
const out = 'tests/ui/artifacts/gear-wired'
await mkdir(out, { recursive: true })
const watch = (page) => { const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) }); return errors }
// Only what is drawn: the floating drive stick is hidden at the corner until a thumb lands.
const box = (page, selector) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length || !e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom } }, selector)
const apart = (a, b) => !a || !b || a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y

{
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = watch(page)
    await page.goto(`${base}?room=gear-wired-${Date.now()}`)
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    assert.equal(await page.locator('.gear-selector').isVisible(), false, 'no drum in the lobby')
    assert.equal(await page.locator('.hud-accessories [data-id=zorb]').isVisible(), false, 'no Zorb control in the lobby')
    // Into play the way the other checks go, then capture the cursor with a click on the view.
    await page.goto(`${base}?room=gear-wired-${Date.now()}&autoplay=1`)
    await page.waitForFunction(() => window.mira?.shell.playing && !mira.shell.dropping && window.miraNet?.gear, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (await page.locator('.world-inspector').isVisible() && await page.locator('.inspector-toggle').isVisible()) await page.locator('.inspector-toggle').click()
    await page.mouse.click(720, 300)
    await page.waitForFunction(() => document.pointerLockElement === mira.game.canvas, null, { timeout: 10000 })
    await page.waitForFunction(() => !document.querySelector('.gear-selector').hidden && document.querySelector('.gear-selector').dataset.mode === 'locked')
    // Driving: the drum is display only, the pill is a reminder.
    assert.equal(await page.locator('.gear-selector').getAttribute('data-mode'), 'locked')
    assert.equal(await page.locator('.touch-actions [data-action=fire]').isVisible(), false, 'desktop has no touch gear control')
    assert.equal(await page.locator('.hud-accessories [data-id=zorb]').isVisible(), true, 'Zorb control shows while driving')
    // Driving: no gear hints (the owner, 17 November 2026).
    // Zorb's key shows while driving too, to the right of its name (the owner, 18 November 2026).
    assert.match(await page.locator('.hud-accessories [data-id=zorb]').innerText(), /^\s*ZORB\s*X\s*$/i)
    assert.equal(await page.locator('.gear-selector .gs-keyhint').isVisible(), false, 'no number-key hint while driving')
    assert.equal(await page.locator('.gear-selector .gs-hints').isVisible(), false, 'no gear hints while driving')
    assert.equal(await page.locator('.hud-accessories [data-id=zorb]').getAttribute('aria-pressed'), 'false')
    await page.screenshot({ path: `${out}/desktop-driving.png` })
    // The arrow keys drive, never step through gear, and X switches Zorb.
    const before = await page.evaluate(() => miraNet.gear.current)
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp')
    assert.equal(await page.evaluate(() => miraNet.gear.current), before, 'arrow keys leave the gear alone while driving')
    await page.keyboard.press('KeyX')
    await page.waitForFunction(() => document.querySelector('.hud-accessories [data-id=zorb]').getAttribute('aria-pressed') === 'true')
    await page.keyboard.press('KeyX')
    await page.waitForFunction(() => document.querySelector('.hud-accessories [data-id=zorb]').getAttribute('aria-pressed') === 'false')
    // Cursor free: names, a click picks, hints follow.
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.pointerLockElement === null)
    await page.waitForFunction(() => document.querySelector('.gear-selector').dataset.mode === 'free')
    const names = await page.locator('.gear-selector .gs-item').allInnerTexts()
    assert.match(await page.locator('.hud-accessories [data-id=zorb]').innerText(), /ZORB\s*X/i, 'name, then key, with the cursor free')
    const rack = await page.evaluate(() => miraNet.gear.list())
    assert.equal(names.length, rack.length, `one slot per gear (${names.join(', ')})`)
    for (const name of ['Plasma Tag', 'Grapple']) assert.ok(names.some(n => n.toLowerCase().includes(name.toLowerCase())), `${name} is on the drum: ${names.join(', ').replace(/\n/g, ' ')}`)
    await page.screenshot({ path: `${out}/desktop-free.png` })
    // The drum shows the selected gear and one either side (the owner, 18 November 2026): a click
    // on a neighbour picks it; a gear further round is reached by its number key.
    await page.locator('.gear-selector .gs-item', { hasText: /plasma thunder/i }).click()
    await page.waitForFunction(() => miraNet.gear.current === 'red')
    const grapple = await page.evaluate(() => miraNet.gear.list().indexOf('bungee') + 1)
    await page.keyboard.press(`Digit${grapple}`)
    await page.waitForFunction(() => miraNet.gear.current === 'bungee')
    await page.waitForFunction(() => document.querySelectorAll('.gear-selector .gs-hints li').length > 0)
    const hints = await page.locator('.gear-selector .gs-hints').innerText()
    assert.ok(hints.trim().length > 0, 'the Grapple shows its controls')
    await page.waitForTimeout(600)
    assert.match(await page.locator('.gear-selector .gs-item.is-active').innerText(), /grapple/i, 'the drum has turned to the Grapple')
    await page.screenshot({ path: `${out}/desktop-grapple.png` })
    // The pill is a real button with the cursor free.
    await page.locator('.hud-accessories [data-id=zorb]').click()
    assert.equal(await page.evaluate(() => mira.game.input.state.zorb), true, 'the pill switches Zorb on')
    await page.waitForFunction(() => document.querySelector('.hud-accessories [data-id=zorb]').getAttribute('aria-pressed') === 'true')
    await page.locator('.hud-accessories [data-id=zorb]').click()
    assert.equal(await page.evaluate(() => mira.game.input.state.zorb), false, 'and off again')
    // Nothing the drum or the pill covers: the minimap and the speed readout.
    for (const other of ['.shell-minimap', '.fh-left']) {
      assert.ok(apart(await box(page, '.gs-drum'), await box(page, other)), `the drum clears ${other}`)
      assert.ok(apart(await box(page, '.hud-accessories'), await box(page, other)), `the accessories clear ${other}`)
    }
    // A gear picked with the cursor leaves focus on the drum. Driving again: arrows drive.
    await page.keyboard.press('KeyW')
    await page.waitForFunction(() => document.pointerLockElement === mira.game.canvas, null, { timeout: 10000 })
    await page.keyboard.press('ArrowDown')
    assert.equal(await page.evaluate(() => miraNet.gear.current), 'bungee', 'arrows drive after picking gear')
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`)
    console.log('desktop: gear drum and Zorb row passed')
  } finally { await browser.close() }
}

for (const [name, device, viewport] of [
  ['phone', devices['iPhone 14'], { width: 390, height: 844 }],
  ['landscape', devices['iPhone 14 landscape'], { width: 844, height: 390 }],
]) {
  const browser = await webkit.launch({ headless: true })
  try {
    const page = await browser.newPage({ ...device, viewport })
    const errors = watch(page)
    await page.goto(`${base}?room=gear-wired-${name}-${Date.now()}&autoplay=1`)
    await page.waitForFunction(() => window.mira?.shell.playing && !mira.shell.dropping && window.miraNet?.gear, null, { timeout: 120000 })
    await page.waitForFunction(() => !document.querySelector('.gear-selector').hidden)
    await page.evaluate(() => document.fonts.ready.then(() => null))
    const actionButton = page.locator('.touch-actions [data-action=fire]')
    const actions = [
      ['beam', 'TAG', 'Tag with Plasma Tag'],
      ['red', 'CHARGE', 'Charge Plasma Thunder'],
      ['pester', 'SEND', 'Send a Chaser'],
      ['yoink', 'GRAB', 'Grab with Yoink'],
      ['bungee', 'HOOK', 'Hook with Grapple'],
    ]
    for (const [gear, text, accessibleName] of actions) {
      await page.evaluate(id => miraNet.gear.select(id), gear)
      const action = page.getByRole('button', { name: accessibleName, exact: true }).and(actionButton)
      await action.waitFor({ state: 'visible' })
      assert.equal((await action.innerText()).trim(), text)
      assert.ok(await action.evaluate(button => {
        const range = document.createRange()
        range.selectNodeContents(button.querySelector('.glass-press-label') ?? button)
        const label = range.getBoundingClientRect()
        const disc = button.getBoundingClientRect()
        return range.getClientRects().length === 1 && label.width > 0 && label.left > disc.left && label.right < disc.right
      }), `${name}: ${text} fits on one line in the disc`)
      if (gear === 'red') await page.screenshot({ path: `${out}/${name}-charge.png`, scale: 'css' })
    }
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/${name}-grapple.png`, scale: 'css' })
    // The old LET OUT and LET GO stay hidden: the rack supplies the extra buttons now.
    for (const action of ['letOut', 'letGo']) assert.equal(await page.locator(`.touch-actions [data-action="${action}"]`).isVisible(), false, `${action} duplicate stays hidden`)
    assert.equal(await page.locator('.touch-actions [data-action="zorb"]').isVisible(), true, 'touch keeps its ZORB button')
    for (const other of ['.shell-minimap', '.touch-stick', '.touch-actions', '.fh-left']) assert.ok(apart(await box(page, '.gs-drum'), await box(page, other)), `${name}: the drum clears ${other}`)
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`)
    console.log(`${name}: gear drum on touch passed`)
  } finally { await browser.close() }
}
