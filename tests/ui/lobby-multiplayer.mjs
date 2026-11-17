// The lobby's buttons and what replaced the Multiplayer panel, for before and after captures:
// desktop 1440x900 (Chrome) and an iPhone 14 (WebKit). Captures the lobby, the Multiplayer
// panel when it exists, the invite view opened with J (desktop), and in play the Players &
// session card's invite and the Game card.
//   SYN3H_URL=http://127.0.0.1:5173/ MP_OUT=tests/ui/artifacts/lobby-multiplayer/after node tests/ui/lobby-multiplayer.mjs
import { chromium, webkit, devices } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/'
const out = process.env.MP_OUT ?? 'tests/ui/artifacts/lobby-multiplayer/after'
await mkdir(out, { recursive: true })
for (const [name, options] of Object.entries({ desktop: { viewport: { width: 1440, height: 900 } }, phone: devices['iPhone 14'] })) {
  const touch = name !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(options)
    const press = l => touch ? l.tap() : l.click()
    await page.goto(`${base}?room=mp-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // The lobby's opening (about nine seconds) hides its controls; a key skips to the settled lobby.
    await page.keyboard.press('Shift'); await page.waitForTimeout(1500)
    await page.screenshot({ path: `${out}/${name}-lobby.png` })
    const mp = page.locator('.galaxy-links [data-goto=multiplayer]')
    if (await mp.count()) { await press(mp); await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${name}-multiplayer-panel.png` }); await page.evaluate(() => window.syn3h.shell.showPanel('index')); await page.waitForTimeout(600) }
    if (!touch) { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('KeyJ'); await page.locator('.join-view').waitFor({ state: 'visible' }); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}-lobby-j.png` }); await page.locator('.join-close').click(); await page.locator('.join-view').waitFor({ state: 'hidden' })
      // J closes the invite view from its own focused buttons, and focus goes back to where it
      // was. Bug caught: a player clicks Copy, presses J, and nothing happens.
      const about = page.locator('.galaxy-links [data-goto=about]')
      await about.focus(); await page.evaluate(() => window.syn3h.shell.openJoin()); await page.locator('.join-view').waitFor({ state: 'visible' })
      await page.locator('.join-copy').click()
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('join-copy')), true, 'Copy keeps focus after a click')
      await page.keyboard.press('KeyJ'); await page.locator('.join-view').waitFor({ state: 'hidden', timeout: 3000 })
      assert.equal(await about.evaluate(el => el === document.activeElement), true, 'focus returns to where it was')
      // Space on a focused button still presses it and is not a shortcut; Escape closes from it.
      await about.focus(); await page.evaluate(() => window.syn3h.shell.openJoin()); await page.locator('.join-view').waitFor({ state: 'visible' })
      await page.locator('.join-copy').focus(); await page.keyboard.press('Space'); await page.waitForTimeout(300)
      assert.equal(await page.locator('.join-view').isVisible(), true, 'Space presses Copy and leaves the view open')
      await page.keyboard.press('Escape'); await page.locator('.join-view').waitFor({ state: 'hidden', timeout: 3000 })
    }
    await page.goto(`${base}?autoplay=1&room=mp-${name}-play-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30 && window.syn3h.shell.playing, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (touch) await page.locator('.inspector-toggle').tap(); else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    const rail = page.locator('.world-inspector'); await rail.waitFor({ state: 'visible' })
    await page.evaluate(() => window.syn3h.shell.inspector.revealCard('players'))
    await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}-play-players.png` })
    await press(page.locator('.rail-invite')); await page.locator('.join-view').waitFor({ state: 'visible' }); await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/${name}-play-invite.png` })
    console.log(`${name}: done`)
  } finally { await browser.close() }
}
