// The lobby's three sheets by keyboard (LobbySheet, Shell.openLobbySheet). Bugs caught: focus
// lost or left behind the sheet; a switch to another sheet that closes instead of morphing; keys
// that never reach a control inside the sheet; focus not returned to the button that opened the
// sheet; the name or the buttons left out of place after closing; a shader built when a sheet
// opens or closes (the worlds' fade must be a uniform, a hitch otherwise).
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/lobby-sheets.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { waitForState } from './stateWait.mjs'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
 // Desktop, an iPad mini upright and on its side (the owner's device, 21 November 2026), and a phone.
 for (const [width, height] of [[1440, 900], [744, 1133], [1133, 744], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  // Every WebGL program link, counted.
  await page.addInitScript(() => { const link = WebGL2RenderingContext.prototype.linkProgram; window.__links = 0; WebGL2RenderingContext.prototype.linkProgram = function (p) { window.__links++; return link.call(this, p) } })
  await page.goto(`${process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'}?room=lobby-sheets-${Date.now()}`)
  await waitForState(page, 'the settled lobby', () => document.documentElement.dataset.boot === 'done' && !window.mira?.shell?.galaxy?.opening && !document.documentElement.dataset.opening, undefined, 120)
  const links = await page.evaluate(() => window.__links)
  const active = () => page.evaluate(() => { const a = document.activeElement; return { dialog: a?.closest('dialog.lobby-sheet')?.className ?? null, button: a?.classList.contains('lobby-control') ? a.textContent.trim() : null } })
  // Welcome by keyboard: focus moves into its sheet and the name rises over it.
  await page.locator('.lobby-gear-dock .lobby-about').focus(); await page.keyboard.press('Enter')
  await waitForState(page, 'the Welcome sheet open with the name risen', () => !!document.querySelector('dialog.lobby-sheet-about[open]') && window.mira.shell.galaxy.liftShown === 1, undefined, 30)
  await waitForState(page, 'the worlds faded out', () => window.mira.shell.galaxy.worldsShown === 0, undefined, 30)
  assert.match((await active()).dialog ?? '', /lobby-sheet-about/, 'focus inside the Welcome sheet')
  const reach = async (word) => { for (let i = 0; i < 80; i++) { await page.keyboard.press('Tab'); if ((await active()).button === word) return true } return false }
  // Settings from beside the sheet: the sheet goes and the right-hand card takes over, with focus.
  assert.ok(await reach('Settings'), 'Tab reaches the Settings button beside the sheet')
  await page.keyboard.press('Enter')
  await waitForState(page, 'the settings card in place of Welcome, the name back down', () => !!document.querySelector('#lobby-settings') && !document.querySelector('dialog.lobby-sheet[open]') && window.mira.shell.galaxy.liftShown === 0, undefined, 30)
  assert.ok(await page.evaluate(() => document.activeElement?.closest('#lobby-settings') !== null), 'focus inside the settings card')
  // A key reaches a control inside the card: Enter toggles mute.
  const sound = page.locator('#lobby-settings .wi-card[data-section=sound]')
  await sound.locator('.wi-head').click()
  const mute = sound.getByRole('switch', { name: 'Mute audio' })
  await mute.waitFor({ state: 'visible', timeout: 10000 })
  const before = await page.evaluate(() => window.mira.params.get('audio.muted').value)
  await mute.focus(); await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.mira.params.get('audio.muted').value), !before, 'Enter reaches the mute switch inside the card')
  await page.keyboard.press('Enter')
  // Escape closes; focus returns to Settings, in its corner.
  await page.keyboard.press('Escape')
  await waitForState(page, 'the card closed', () => !document.querySelector('#lobby-settings'), undefined, 30)
  assert.deepEqual(await active(), { dialog: null, button: 'Settings' }, 'focus back on the Settings button')
  await waitForState(page, 'the worlds back', () => window.mira.shell.galaxy.worldsShown === 1, undefined, 30)
  assert.equal(await page.evaluate(() => window.__links), links, 'no shader built while sheets opened and closed')
  assert.ok(await page.evaluate(() => !!document.querySelector('.galaxy-ui > .lobby-gear-dock') && !document.querySelector('.lobby-gear-dock.is-beside-sheet')), 'the buttons back in their corner')
  assert.deepEqual(errors, [])
  console.log(`${width}x${height}: ok`)
  await page.close()
 }
 // The ring on the X. Bug caught (the owner, 23 November 2026: "not have the X circled by default
// ... it looks like it's receiving focus"): a sheet opened by a click or a tap moves focus to its X,
// and WebKit (and Chromium with nothing focused before) drew the keyboard ring on it. Opened by
// pointer, no ring; opened by keyboard, the ring; before any input at all, none. Chrome by mouse,
// WebKit by touch; Welcome, Updates and the Settings card.
for (const [engine, touch] of [[chromium, false], [webkit, true]]) {
  const b = engine === chromium ? browser : await webkit.launch()
  try {
    const page = await b.newPage({ viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: touch })
    await page.goto(`${process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'}?room=lobby-sheets-ring-${Date.now()}`)
    await waitForState(page, 'the settled lobby', () => document.documentElement.dataset.boot === 'done' && !window.mira?.shell?.galaxy?.opening && !document.documentElement.dataset.opening, undefined, 120)
    const sheets = [['Welcome', '.lobby-gear-dock .lobby-about', 'dialog.lobby-sheet-about .lobby-sheet-close'], ['Updates', '.lobby-version', 'dialog.lobby-sheet-updates .lobby-sheet-close'], ['Settings', '.lobby-gear', '.lobby-settings-close']]
    const ringed = close => page.evaluate(sel => { const x = document.querySelector(sel), s = x && getComputedStyle(x); return { focused: document.activeElement === x, ring: !!x && x.matches(':focus-visible') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && s.outlineColor !== 'rgba(0, 0, 0, 0)' } }, close)
    const closed = () => waitForState(page, 'nothing open', () => !document.querySelector('dialog.lobby-sheet[open]') && !document.querySelector('#lobby-settings:not([hidden])'), undefined, 10)
    const tag = engine === chromium ? 'chrome, mouse' : 'webkit, touch'
    // Before any input: opened by the game itself, no ring.
    await page.evaluate(() => window.mira.shell.showLobbyAbout()); await page.waitForTimeout(600)
    assert.deepEqual(await ringed(sheets[0][2]), { focused: true, ring: false }, `${tag}: opened before any input, Welcome's X has no ring`)
    await page.evaluate(() => window.mira.shell['aboutSheet'].close()); await closed()
    for (const [name, opener, close] of sheets) {
      const button = page.locator(opener).first()
      await (touch ? button.tap() : button.click()); await page.waitForTimeout(600)
      assert.deepEqual(await ringed(close), { focused: true, ring: false }, `${tag}: ${name} opened by pointer, its X has no ring`)
      await page.keyboard.press('Escape'); await closed()
      await button.evaluate(el => el.focus()); await page.keyboard.press('Enter'); await page.waitForTimeout(600)
      assert.deepEqual(await ringed(close), { focused: true, ring: true }, `${tag}: ${name} opened by keyboard, its X has the ring`)
      await page.keyboard.press('Escape'); await closed()
    }
    console.log(`${tag}: the X's ring follows the input`)
  } finally { if (b !== browser) await b.close() }
}
console.log('LOBBY SHEETS OK')
} finally { await browser.close() }
