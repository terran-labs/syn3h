// The owner's rule, 15 November 2026: "Panels being open or closed should be a simple
// function of cursor locking." And: Escape with the cursor already free pauses, with a
// floating "Paused. Click to resume" and all audio faded to nothing in about half a second.
//
//   node tests/ui/cursor-panels.mjs      (game on SYN3H_URL)
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5198/'
await mkdir('tests/ui/artifacts/cursor-panels', { recursive: true })
const visible = page => page.evaluate(() => !document.querySelector('.world-inspector').hidden)
// Closing fades the panels out before they are hidden: wait for the end of the fade.
const closed = page => page.waitForFunction(() => document.querySelector('.world-inspector').hidden, null, { timeout: 5000 }).then(() => false)
const locked = page => page.evaluate(() => document.pointerLockElement === syn3h.game.canvas)
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    // The room name must not contain "panel": networking stores a rejoin key named after the room.
    await page.goto(`${base}?room=cursor-lock-${Date.now()}`)
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // The lobby is cursor-free by nature and keeps its own panels.
    assert.equal(await page.locator('.lobby-gear-dock').isVisible(), true)
    // Entering a world from a real gesture captures the cursor: you arrive driving, display only.
    await page.locator('.galaxy-label.is-current').focus(); await page.keyboard.press('Enter')
    await page.waitForFunction(() => syn3h.shell.playing && !syn3h.shell.dropping, null, { timeout: 120000 })
    await page.waitForFunction(() => document.pointerLockElement === syn3h.game.canvas, null, { timeout: 10000 })
    assert.equal(await visible(page), false, 'captured cursor: no panels')
    assert.equal(await page.locator('.hud-navigation').isVisible(), false, 'a desktop has no panel toggle')
    await page.screenshot({ path: 'tests/ui/artifacts/cursor-panels/1-driving.png' })
    // Escape frees the cursor and the panels appear.
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.pointerLockElement)
    await page.waitForFunction(() => !document.querySelector('.world-inspector').hidden)
    await page.screenshot({ path: 'tests/ui/artifacts/cursor-panels/2-free.png' })
    // Fields and sliders work with the cursor free, and nothing tries to recapture.
    const search = page.locator('.wi-search'); await search.click(); await search.fill('time')
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('KeyW')
    assert.equal(await locked(page), false, 'typing in a field never captures the cursor')
    assert.equal(await visible(page), true)
    await search.fill('')
    // The lock lost from outside (not by our request) also opens the panels: follow the event.
    await page.mouse.click(500, 420)
    await page.waitForFunction(() => document.pointerLockElement === syn3h.game.canvas)
    await page.waitForFunction(() => document.querySelector('.world-inspector').hidden)
    await page.evaluate(() => document.exitPointerLock())
    await page.waitForFunction(() => !document.querySelector('.world-inspector').hidden)
    // A drive key outside any field is the keyboard way back to driving.
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('KeyW')
    await page.waitForFunction(() => document.pointerLockElement === syn3h.game.canvas)
    assert.equal(await closed(page), false)
    // Escape in a text field only leaves the field; it does not pause.
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.pointerLockElement)
    await page.locator('.wi-search').click(); await page.keyboard.press('Escape')
    assert.equal(await page.locator('.pause-veil').isHidden(), true, 'Escape in a field does not pause')
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('wi-search')), false, 'Escape leaves the field')
    await page.mouse.click(500, 420); await page.waitForFunction(() => document.pointerLockElement === syn3h.game.canvas)
    // Escape, then Escape again: paused. Audio fades to nothing and its clock stops.
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.pointerLockElement)
    assert.equal(await page.evaluate(() => syn3h.audio.state), 'running')
    await page.keyboard.press('Escape')
    await page.locator('.pause-veil').waitFor({ state: 'visible' })
    assert.match(await page.locator('.pause-veil').innerText(), /Paused\s+Click to resume/i)
    assert.equal(await page.evaluate(() => syn3h.game.input.suspended), true, 'no driving while paused')
    await page.waitForFunction(() => syn3h.audio.state === 'suspended', null, { timeout: 3000 })
    assert.ok(await page.evaluate(() => syn3h.audio.outputLevel) < -80, 'silent while paused')
    await page.screenshot({ path: 'tests/ui/artifacts/cursor-panels/3-paused.png' })
    // Click resumes, recaptures the cursor (so the panels close) and the audio returns.
    await page.locator('.pause-veil').click()
    await page.locator('.pause-veil').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.pointerLockElement === syn3h.game.canvas)
    await page.waitForFunction(() => syn3h.audio.state === 'running' && syn3h.audio.outputLevel > -50, null, { timeout: 5000 })
    assert.equal(await closed(page), false)
    assert.equal(await page.evaluate(() => syn3h.game.input.suspended), false)
    // Escape while paused resumes too; and a drive key.
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.pointerLockElement)
    await page.keyboard.press('Escape'); await page.locator('.pause-veil').waitFor({ state: 'visible' })
    await page.keyboard.press('KeyW'); await page.locator('.pause-veil').waitFor({ state: 'hidden' })
    // Nothing about the panels is stored: a reload with no gesture has the cursor free, panels open.
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(key => /inspector|panel|\brail/i.test(key))), [], 'no stored panel state')
    assert.deepEqual(errors, [])
    console.log('desktop: panels follow the cursor lock; Escape frees, then pauses; audio fades and stops; resume recaptures')
  } finally { await browser.close() }
}
{
  // Touch has no cursor: one switch between driving and the panels, and a Pause entry.
  const browser = await webkit.launch()
  try {
    const page = await browser.newPage(devices['iPhone 14'])
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?autoplay=1&room=cursor-lock-touch-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    assert.equal(await visible(page), false, 'touch starts driving')
    await page.locator('.inspector-toggle').tap()
    await page.waitForFunction(() => !document.querySelector('.world-inspector').hidden)
    await page.locator('.rail-pause').tap()
    await page.locator('.pause-veil').waitFor({ state: 'visible' })
    assert.match(await page.locator('.pause-veil').innerText(), /Tap to resume/i)
    await page.screenshot({ path: 'tests/ui/artifacts/cursor-panels/4-touch-paused.png' })
    await page.locator('.pause-veil').tap()
    await page.locator('.pause-veil').waitFor({ state: 'hidden' })
    assert.equal(await closed(page), false, 'resuming on touch returns to driving')
    assert.deepEqual(errors, [])
    console.log('phone: one switch between driving and panels; pause and tap to resume')
  } finally { await browser.close() }
}
