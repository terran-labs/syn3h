// No in-game control in the lobby. Bug caught (the owner on an iPad mini, 21 November 2026,
// "completely broken"): after a visit to a world, the in-game Panels control stayed attached
// and, once the lobby's settings card opened, rose over the lobby, because the card is the
// sidebar component and the touch rule that lifts Panels over an open sidebar matched it.
// Each size enters a world, returns to the lobby, opens Settings, and checks that no in-game
// HUD control shows, with the lobby at rest and with the card open.
//   MIRA_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-no-hud.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5173/'
const HUD = '.hud-navigation, .shell-hud, .focus-hud, .touch-controls, .gear-selector, .gear-actions, .shell-minimap, .rail-command, .match-hud, .race-hud, .pause-veil, .pause-actions'
const sizes = [
  ['ipad-portrait', webkit, { viewport: { width: 744, height: 1133 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
  ['ipad-landscape', webkit, { viewport: { width: 1133, height: 744 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
  ['phone', webkit, devices['iPhone 14']],
  ['desktop', chromium, { viewport: { width: 1440, height: 900 } }],
]
const browsers = new Map()
try {
  for (const [name, engine, options] of sizes) {
    if (!browsers.has(engine)) browsers.set(engine, await (engine === chromium ? engine.launch({ channel: 'chrome', headless: true }) : engine.launch()))
    const page = await browsers.get(engine).newPage(options)
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?autoplay=1&room=lobby-no-hud-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30 && document.querySelector('.mira-shell')?.classList.contains('is-playing'), null, { timeout: 180000 })
    await page.waitForTimeout(2000)
    // Back to the lobby, as leaving a world does.
    await page.evaluate(() => window.mira.shell.openMenu())
    await page.waitForFunction(() => !document.querySelector('.mira-shell').classList.contains('is-playing') && !document.querySelector('.shell-overlay').hidden)
    await page.waitForTimeout(1500)
    const shown = () => page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((el) => {
      const s = getComputedStyle(el)
      return el.getClientRects().length > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0.01
    }).map((el) => el.className), HUD)
    assert.deepEqual(await shown(), [], `${name}: no in-game control in the lobby at rest`)
    const gear = page.locator('.lobby-gear-dock .lobby-gear')
    if (options.hasTouch) await gear.tap(); else await gear.click()
    await page.locator('#lobby-settings').waitFor({ state: 'visible' })
    await page.waitForTimeout(600)
    assert.deepEqual(await shown(), [], `${name}: no in-game control in the lobby with Settings open`)
    assert.deepEqual(errors, [], `${name}: no page errors`)
    console.log(`${name}: ok`)
    await page.close()
  }
} finally { for (const browser of browsers.values()) await browser.close() }
