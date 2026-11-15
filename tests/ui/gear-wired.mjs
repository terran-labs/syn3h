// The gear drum and the Zorb toggle, wired into the real shell (the drum in isolation is
// tests/ui/gear-selector.mjs). Checks: hidden in the lobby; in play the drum lists the rack
// with player-facing names; a click picks gear; the hints follow the gear in hand; the Zorb
// pill shows its key and state and follows both a click and the X key; with the cursor
// captured the arrow keys drive and never step through gear; on touch the Grapple's extra
// actions get buttons from the rack and the old duplicates stay hidden.
//
//   node tests/ui/gear-wired.mjs      (game on SYN3H_URL)
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5198/'
const out = 'tests/ui/artifacts/gear-wired'
await mkdir(out, { recursive: true })
const watch = (page) => { const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) }); return errors }
const box = (page, selector) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom } }, selector)
const apart = (a, b) => !a || !b || a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y

{
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = watch(page)
    await page.goto(`${base}?room=gear-wired-${Date.now()}`)
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    assert.equal(await page.locator('.gear-selector').isVisible(), false, 'no drum in the lobby')
    assert.equal(await page.locator('.zorb-toggle').isVisible(), false, 'no Zorb pill in the lobby')
    await page.locator('.galaxy-label.is-current').focus(); await page.keyboard.press('Enter')
    await page.waitForFunction(() => syn3h.shell.playing && !syn3h.shell.dropping && window.syn3hNet?.gear, null, { timeout: 120000 })
    await page.waitForFunction(() => document.pointerLockElement === syn3h.game.canvas, null, { timeout: 10000 })
    await page.waitForFunction(() => !document.querySelector('.gear-selector').hidden)
    // Driving: the drum is display only, the pill is a reminder.
    assert.equal(await page.locator('.gear-selector').getAttribute('data-mode'), 'locked')
    assert.equal(await page.locator('.zorb-toggle').isVisible(), true, 'Zorb pill shows while driving')
    assert.match(await page.locator('.zorb-toggle').innerText(), /X\s*ZORB\s*OFF/i)
    await page.screenshot({ path: `${out}/desktop-driving.png` })
    // The arrow keys drive, never step through gear, and X switches Zorb.
    const before = await page.evaluate(() => syn3hNet.gear.current)
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp')
    assert.equal(await page.evaluate(() => syn3hNet.gear.current), before, 'arrow keys leave the gear alone while driving')
    await page.keyboard.press('KeyX')
    await page.waitForFunction(() => document.querySelector('.zorb-toggle').getAttribute('aria-pressed') === 'true')
    assert.match(await page.locator('.zorb-toggle').innerText(), /ON/i)
    await page.keyboard.press('KeyX')
    await page.waitForFunction(() => document.querySelector('.zorb-toggle').getAttribute('aria-pressed') === 'false')
    // Cursor free: names, a click picks, hints follow.
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.pointerLockElement === null)
    await page.waitForFunction(() => document.querySelector('.gear-selector').dataset.mode === 'free')
    const names = await page.locator('.gear-selector .gs-item').allInnerTexts()
    const rack = await page.evaluate(() => syn3hNet.gear.list())
    assert.equal(names.length, rack.length, `one slot per gear (${names.join(', ')})`)
    for (const name of ['Plasma Tag', 'Grapple']) assert.ok(names.some(n => n.toLowerCase().includes(name.toLowerCase())), `${name} is on the drum: ${names.join(', ').replace(/\n/g, ' ')}`)
    await page.screenshot({ path: `${out}/desktop-free.png` })
    await page.locator('.gear-selector .gs-item', { hasText: /grapple/i }).click()
    await page.waitForFunction(() => syn3hNet.gear.current === 'bungee')
    await page.waitForFunction(() => document.querySelectorAll('.gear-selector .gs-hints li').length > 0)
    const hints = await page.locator('.gear-selector .gs-hints').innerText()
    assert.ok(hints.trim().length > 0, 'the Grapple shows its controls')
    await page.waitForTimeout(600)
    assert.match(await page.locator('.gear-selector .gs-item.is-active').innerText(), /grapple/i, 'the drum has turned to the Grapple')
    await page.screenshot({ path: `${out}/desktop-grapple.png` })
    // The pill is a real button with the cursor free.
    await page.locator('.zorb-toggle').click()
    assert.equal(await page.evaluate(() => syn3h.game.input.state.zorb), true, 'the pill switches Zorb on')
    await page.waitForFunction(() => document.querySelector('.zorb-toggle').getAttribute('aria-pressed') === 'true')
    await page.locator('.zorb-toggle').click()
    assert.equal(await page.evaluate(() => syn3h.game.input.state.zorb), false, 'and off again')
    // Nothing the drum or the pill covers: the minimap and the speed readout.
    for (const other of ['.shell-minimap', '.fh-left']) {
      assert.ok(apart(await box(page, '.gs-drum'), await box(page, other)), `the drum clears ${other}`)
      assert.ok(apart(await box(page, '.zorb-toggle'), await box(page, other)), `the Zorb pill clears ${other}`)
    }
    // A gear picked with the cursor leaves focus on the drum. Driving again: arrows drive.
    await page.keyboard.press('KeyW')
    await page.waitForFunction(() => document.pointerLockElement === syn3h.game.canvas, null, { timeout: 10000 })
    await page.keyboard.press('ArrowDown')
    assert.equal(await page.evaluate(() => syn3hNet.gear.current), 'bungee', 'arrows drive after picking gear')
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`)
    console.log('desktop: gear drum and Zorb toggle passed')
  } finally { await browser.close() }
}

for (const [name, device] of [['phone', devices['iPhone 14']], ['landscape', { ...devices['iPhone 14 landscape'] }]]) {
  const browser = await webkit.launch({ headless: true })
  try {
    const page = await browser.newPage({ ...device })
    const errors = watch(page)
    await page.goto(`${base}?room=gear-wired-${name}-${Date.now()}&autoplay=1`)
    await page.waitForFunction(() => window.syn3h?.shell.playing && !syn3h.shell.dropping && window.syn3hNet?.gear, null, { timeout: 120000 })
    await page.waitForFunction(() => !document.querySelector('.gear-selector').hidden)
    await page.evaluate(() => syn3hNet.gear.select('bungee'))
    await page.waitForFunction(() => syn3hNet.gear.current === 'bungee')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/${name}-grapple.png` })
    // The old LET OUT and LET GO stay hidden: the rack supplies the extra buttons now.
    for (const action of ['letOut', 'letGo']) assert.equal(await page.locator(`.touch-actions [data-action="${action}"]`).isVisible(), false, `${action} duplicate stays hidden`)
    assert.equal(await page.locator('.touch-actions [data-action="zorb"]').isVisible(), true, 'touch keeps its ZORB button')
    for (const other of ['.shell-minimap', '.touch-stick', '.touch-actions', '.fh-left']) assert.ok(apart(await box(page, '.gs-drum'), await box(page, other)), `${name}: the drum clears ${other}`)
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`)
    console.log(`${name}: gear drum on touch passed`)
  } finally { await browser.close() }
}
