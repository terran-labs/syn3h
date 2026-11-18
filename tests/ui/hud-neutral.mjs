// The HUD and menus in one pass, for current-against-new sheets: in play (desktop and phone)
// with the Game card open (switches, segmented choices, sliders), the Players & session card,
// toasts and the pause veil; the lobby with its settings panel open. Pale sky (Badlands at noon)
// and night. Full screenshots go to NEUTRAL_OUT.
//   SYN3H_URL=http://127.0.0.1:5173/ NEUTRAL_OUT=/tmp/shots node tests/ui/hud-neutral.mjs
import { chromium, webkit, devices } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/'
const out = process.env.NEUTRAL_OUT ?? 'tests/ui/artifacts/hud-neutral'
await mkdir(out, { recursive: true })
for (const [name, options] of Object.entries({ desktop: { viewport: { width: 1440, height: 900 } }, phone: devices['iPhone 14'] })) {
  const touch = name !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(options)
    const press = l => touch ? l.tap() : l.click()
    // Lobby, settings open.
    await page.goto(`${base}?room=neutral-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.keyboard.press('Shift'); await page.waitForTimeout(1200)
    await page.screenshot({ path: `${out}/${name}-lobby.png` })
    await press(page.getByRole('button', { name: 'Settings', exact: true }))
    const panel = page.locator('.world-inspector.lobby-settings'); await panel.waitFor({ state: 'visible' })
    await press(panel.locator('.wi-card[data-section=performance] .wi-head')); await page.waitForTimeout(700)
    await page.screenshot({ path: `${out}/${name}-lobby-settings.png` })
    // Play: Badlands at noon, then night.
    await page.goto(`${base}?autoplay=1&planet=badlands&seed=1&room=neutral-${name}-play-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30 && window.syn3h.shell.playing, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (touch) await page.locator('.inspector-toggle').tap(); else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    const rail = page.locator('.world-inspector'); await rail.waitFor({ state: 'visible' })
    const settle = () => page.waitForFunction(() => !document.querySelector('.world-inspector').getAnimations({ subtree: true }).some(a => a.playState === 'running')).then(() => page.waitForTimeout(400))
    await page.evaluate(() => { for (const c of document.querySelectorAll('.world-inspector .wi-card.is-open')) c.querySelector('.wi-head').click() }); await settle()
    await press(rail.locator('.wi-card[data-section=game] > .wi-head')); await settle()
    for (const [scene, hour] of [['day', 12.5], ['night', 0.5]]) {
      await page.evaluate(h => window.syn3h.params.set('sun.timeOfDay', h), hour); await page.waitForTimeout(900)
      await page.screenshot({ path: `${out}/${name}-play-${scene}.png` })
    }
    await page.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 12.5))
    await page.evaluate(() => window.syn3h.shell.toast?.('A message from the game')); await page.waitForTimeout(400)
    await page.evaluate(() => window.syn3h.shell.inspector.revealCard('players')); await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}/${name}-play-players.png` })
    // The invite view, About, the leave question, then pause, then (phone) the drive buttons.
    await press(page.locator('.rail-invite')); await page.locator('.join-view').waitFor({ state: 'visible' }); await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/${name}-invite.png` })
    await press(page.locator('.join-close')); await page.locator('.join-view').waitFor({ state: 'hidden' })
    if (touch && await page.locator('.world-inspector').isHidden()) await page.locator('.inspector-toggle').tap()
    await page.evaluate(() => document.querySelector('.rail-about')?.click()); await page.waitForTimeout(800)
    await page.screenshot({ path: `${out}/${name}-about.png` })
    await page.evaluate(() => window.syn3h.shell.closeAbout?.()); await page.waitForTimeout(400)
    if (touch && await page.locator('.world-inspector').isHidden()) await page.locator('.inspector-toggle').tap()
    await press(page.locator('.rail-command .exit-world')); await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/${name}-leave-question.png` })
    await press(page.locator('.exit-stay')); await page.waitForTimeout(400)
    if (touch) { if (await page.locator('.world-inspector').isVisible()) await page.locator('.inspector-toggle').tap(); await page.waitForTimeout(600); await page.screenshot({ path: `${out}/${name}-touch.png` }) }
    await page.evaluate(() => window.syn3h.shell.requestPause?.()); await page.waitForTimeout(700)
    await page.screenshot({ path: `${out}/${name}-pause.png` })
    console.log(`${name}: done`)
  } finally { await browser.close() }
}
