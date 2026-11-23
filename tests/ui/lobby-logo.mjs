import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
// The lobby's flat animated logo (the fallback when the name cannot stand in the scene). Bugs
// caught: the logo drawing in its own GPU context beside the galaxy's; a lobby that stops
// animating it; the old SVG drawing over it; the logo not coming back after a lost GPU context;
// and the logo (and its GPU resources) held after leaving the lobby for a world.
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs lobby-logo
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { waitForState } from './stateWait.mjs'
await mkdir('tests/ui/artifacts/logo', { recursive: true })
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] } : {})
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    // The flat animated logo is the fallback now (the lobby's name stands in the scene,
    // src/ui/brand/wordmarkScene.ts): ask for it, and for no opening, to check it still works.
    await page.goto(`${process.env.MIRA_URL ?? 'http://127.0.0.1:5193/'}?wordmark=0&intro=0`)
    await page.waitForFunction(() => window.mira?.shell?.galaxy?.logo?.ok && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    await page.evaluate(() => { window.__pin = setInterval(() => window.mira.params.set('gfx.level', 2), 400) })
    assert.equal(await page.evaluate(() => { const g = window.mira.shell.galaxy; return g.logo.gl === g.gl && document.querySelectorAll('.galaxy-canvas').length === 1 }), true, 'logo shares the galaxy context')
    const before = await page.evaluate(() => window.mira.shell.galaxy.logo.introTime)
    // A drawing lobby advances the logo's clock on its next frames; a stopped one never does.
    await waitForState(page, 'the lobby to draw (the logo clock to advance)', before => window.mira.shell.galaxy.logo.introTime > before, before, 30)
    assert.ok(await page.evaluate(() => window.mira.shell.galaxy.logo.introTime) > before, 'ordinary lobby animates')
    assert.equal(await page.locator('.shell-logo').evaluate(el => getComputedStyle(el).opacity), '0', 'SVG does not draw over the animation')
    await page.screenshot({ path: `tests/ui/artifacts/logo/${engine.name()}.png` })
    await page.evaluate(() => window.mira.shell.showLobbyAbout())
    // Behind a sheet the galaxy dims and then holds the logo still (its sway, inert now, is
    // how the galaxy says so). Wait for that, not for a clock.
    await waitForState(page, 'the logo to hold still behind the About sheet', () => window.mira.shell.galaxy.logo.introTime > 1 && window.mira.shell.galaxy.logo.look.sway === 0, undefined, 30)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `tests/ui/artifacts/logo/${engine.name()}-settled.png` })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => { window.mira.shell.galaxy.wake = 2 })
    // Reduced motion holds the logo still and skips its fade on the next drawn frame: wait for
    // that frame, not for a clock (a loaded machine may not draw one in a fixed 300 ms).
    await waitForState(page, 'reduced motion to hold the logo still and skip its fade', () => window.mira.shell.galaxy.logo.look.sway === 0 && window.mira.shell.galaxy.logo.introTime > 1e5, undefined, 30)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(() => { clearInterval(window.__pin); window.mira.params.set('gfx.level', 0); window.mira.shell.galaxy.wake = 2 })
    // The lowest level's budget and stillness land on the next drawn frame: wait for it.
    await waitForState(page, 'the lowest graphics level to cut particles and sway', () => window.mira.shell.galaxy.logo.look.particles <= 220 && window.mira.shell.galaxy.logo.look.sway === 0, undefined, 30)
    // Restore the context through the browser's own extension; the SVG bridges the loss.
    await page.evaluate(() => { const g = window.mira.shell.galaxy; window.__oldLogo = g.logo; window.__loss = g.gl.getExtension('WEBGL_lose_context'); window.__loss.loseContext() })
    await page.waitForFunction(() => !document.querySelector('.mira-shell').classList.contains('has-animated-logo'))
    await page.evaluate(() => window.__loss.restoreContext())
    await page.waitForFunction(() => { const g = window.mira.shell.galaxy; return g.logo?.ok && g.logo !== window.__oldLogo && document.querySelector('.mira-shell').classList.contains('has-animated-logo') }, null, { timeout: 30000 })
    // Entering a world is asynchronous (Shell.enterWithoutFlight): once in it, the logo and its
    // GPU resources are gone; a logo still held in play is the leak this catches.
    await page.evaluate(() => window.mira.shell.play())
    await waitForState(page, 'in the world with the lobby logo released', () => window.mira.shell.playing && window.mira.shell.galaxy.logo === null, undefined, 60)
    await page.evaluate(() => window.mira.shell.openMenu())
    await page.waitForFunction(() => window.mira.shell.galaxy.logo?.ok)
    assert.equal(await page.locator('.galaxy-canvas').count(), 1)
    assert.deepEqual(errors, [])
    console.log(`${engine.name()}: LOBBY LOGO OK`)
  } finally { await browser.close() }
}
