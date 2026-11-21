// The lobby's three sheets by keyboard (LobbySheet, Shell.openLobbySheet). Bugs caught: focus
// lost or left behind the sheet; a switch to another sheet that closes instead of morphing; keys
// that never reach a control inside the sheet; focus not returned to the button that opened the
// sheet; the name or the buttons left out of place after closing; a shader built when a sheet
// opens or closes (the worlds' fade must be a uniform, a hitch otherwise).
//   SYN3H_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/lobby-sheets.mjs
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { waitForState } from './stateWait.mjs'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  // Every WebGL program link, counted.
  await page.addInitScript(() => { const link = WebGL2RenderingContext.prototype.linkProgram; window.__links = 0; WebGL2RenderingContext.prototype.linkProgram = function (p) { window.__links++; return link.call(this, p) } })
  await page.goto(`${process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'}?room=lobby-sheets-${Date.now()}`)
  await waitForState(page, 'the settled lobby', () => document.documentElement.dataset.boot === 'done' && !window.syn3h?.shell?.galaxy?.opening && !document.documentElement.dataset.opening, undefined, 120)
  const links = await page.evaluate(() => window.__links)
  const active = () => page.evaluate(() => { const a = document.activeElement; return { dialog: a?.closest('dialog.lobby-sheet')?.className ?? null, button: a?.classList.contains('lobby-control') ? a.textContent.trim() : null } })
  // Welcome by keyboard: focus moves into its sheet and the name rises over it.
  await page.locator('.lobby-gear-dock .lobby-about').focus(); await page.keyboard.press('Enter')
  await waitForState(page, 'the Welcome sheet open with the name risen', () => !!document.querySelector('dialog.lobby-sheet-about[open]') && window.syn3h.shell.galaxy.liftShown === 1, undefined, 30)
  await waitForState(page, 'the worlds faded out', () => window.syn3h.shell.galaxy.worldsShown === 0, undefined, 30)
  assert.match((await active()).dialog ?? '', /lobby-sheet-about/, 'focus inside the Welcome sheet')
  // Tab reaches the buttons beside the sheet; Updates from there morphs: one sheet open throughout.
  const reach = async (word) => { for (let i = 0; i < 80; i++) { await page.keyboard.press('Tab'); if ((await active()).button === word) return true } return false }
  assert.ok(await reach('Updates'), 'Tab reaches the Updates button beside the sheet')
  await page.keyboard.press('Enter')
  await waitForState(page, 'the Updates sheet in place of Welcome', () => !!document.querySelector('dialog.lobby-sheet-updates[open]') && !document.querySelector('dialog.lobby-sheet-about[open]'), undefined, 30)
  assert.equal(await page.evaluate(() => window.syn3h.shell.galaxy.liftShown), 1, 'the name stays risen through the switch')
  // Settings from beside the sheet: the sheet goes and the right-hand card takes over, with focus.
  assert.ok(await reach('Settings'), 'Tab reaches the Settings button beside the sheet')
  await page.keyboard.press('Enter')
  await waitForState(page, 'the settings card in place of the sheet, the name back down', () => !!document.querySelector('#lobby-settings') && !document.querySelector('dialog.lobby-sheet[open]') && window.syn3h.shell.galaxy.liftShown === 0, undefined, 30)
  assert.ok(await page.evaluate(() => document.activeElement?.closest('#lobby-settings') !== null), 'focus inside the settings card')
  // A key reaches a control inside the card: Enter toggles mute.
  const sound = page.locator('#lobby-settings .wi-card[data-section=sound]')
  await sound.locator('.wi-head').click()
  const mute = sound.getByRole('switch', { name: 'Mute audio' })
  await mute.waitFor({ state: 'visible', timeout: 10000 })
  const before = await page.evaluate(() => window.syn3h.params.get('audio.muted').value)
  await mute.focus(); await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.syn3h.params.get('audio.muted').value), !before, 'Enter reaches the mute switch inside the card')
  await page.keyboard.press('Enter')
  // Escape closes; focus returns to Settings, in its corner.
  await page.keyboard.press('Escape')
  await waitForState(page, 'the card closed', () => !document.querySelector('#lobby-settings'), undefined, 30)
  assert.deepEqual(await active(), { dialog: null, button: 'Settings' }, 'focus back on the Settings button')
  await waitForState(page, 'the worlds back', () => window.syn3h.shell.galaxy.worldsShown === 1, undefined, 30)
  assert.equal(await page.evaluate(() => window.__links), links, 'no shader built while sheets opened and closed')
  assert.ok(await page.evaluate(() => !!document.querySelector('.galaxy-ui > .lobby-gear-dock') && !document.querySelector('.lobby-gear-dock.is-beside-sheet')), 'the buttons back in their corner')
  assert.deepEqual(errors, [])
  console.log('LOBBY SHEETS OK')
} finally { await browser.close() }
