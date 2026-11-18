// The lobby's three sheets by keyboard (LobbySheet, Shell.openLobbySheet). Bugs caught: focus
// lost or left behind the sheet; a switch to another sheet that closes instead of morphing; keys
// that never reach a control inside the sheet; focus not returned to the button that opened the
// sheet; the name or the buttons left out of place after closing.
//   SYN3H_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/lobby-sheets.mjs
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { waitForState } from './stateWait.mjs'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'}?room=lobby-sheets-${Date.now()}`)
  await waitForState(page, 'the settled lobby', () => document.documentElement.dataset.boot === 'done' && !window.syn3h?.shell?.galaxy?.opening && !document.documentElement.dataset.opening, undefined, 120)
  const active = () => page.evaluate(() => { const a = document.activeElement; return { dialog: a?.closest('dialog.lobby-sheet')?.className ?? null, button: a?.classList.contains('lobby-control') ? a.textContent.trim() : null } })
  // Welcome by keyboard: focus moves into its sheet and the name rises over it.
  await page.locator('.lobby-gear-dock .lobby-about').focus(); await page.keyboard.press('Enter')
  await waitForState(page, 'the Welcome sheet open with the name risen', () => !!document.querySelector('dialog.lobby-sheet-about[open]') && window.syn3h.shell.galaxy.liftShown === 1, undefined, 30)
  assert.match((await active()).dialog ?? '', /lobby-sheet-about/, 'focus inside the Welcome sheet')
  // Tab reaches the buttons beside the sheet; Settings from there morphs: one sheet open throughout.
  let reached = false
  for (let i = 0; i < 80 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await active()).button === 'Settings' }
  assert.ok(reached, 'Tab reaches the Settings button beside the sheet')
  await page.keyboard.press('Enter')
  await waitForState(page, 'the Settings sheet in place of Welcome', () => !!document.querySelector('dialog.lobby-sheet-settings[open]') && !document.querySelector('dialog.lobby-sheet-about[open]'), undefined, 30)
  assert.equal(await page.evaluate(() => window.syn3h.shell.galaxy.liftShown), 1, 'the name stays risen through the switch')
  // A key reaches a control inside the sheet: Enter toggles mute.
  const sound = page.locator('dialog.lobby-sheet-settings .wi-card[data-section=sound]')
  await sound.locator('.wi-head').click()
  const mute = sound.getByRole('switch', { name: 'Mute audio' })
  await mute.waitFor({ state: 'visible', timeout: 10000 })
  const before = await page.evaluate(() => window.syn3h.params.get('audio.muted').value)
  await mute.focus(); await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.syn3h.params.get('audio.muted').value), !before, 'Enter reaches the mute switch inside the sheet')
  await page.keyboard.press('Enter')
  // Escape closes; focus returns to the button that opened this sheet, back in its corner, and the name comes down.
  await page.keyboard.press('Escape')
  await waitForState(page, 'every sheet closed and the name back down', () => !document.querySelector('dialog.lobby-sheet[open]') && window.syn3h.shell.galaxy.liftShown === 0, undefined, 30)
  assert.deepEqual(await active(), { dialog: null, button: 'Settings' }, 'focus back on the Settings button')
  assert.ok(await page.evaluate(() => !!document.querySelector('.galaxy-ui > .lobby-gear-dock') && !document.querySelector('.lobby-gear-dock.is-beside-sheet')), 'the buttons back in their corner')
  assert.deepEqual(errors, [])
  console.log('LOBBY SHEETS OK')
} finally { await browser.close() }
