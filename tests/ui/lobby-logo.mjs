import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
await mkdir('tests/ui/artifacts/logo', { recursive: true })
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] } : {})
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    // The flat animated logo is the fallback now (the lobby's name stands in the scene,
    // src/ui/brand/wordmarkScene.ts): ask for it, and for no opening, to check it still works.
    await page.goto(`${process.env.SYN3H_URL ?? 'http://127.0.0.1:5193/'}?wordmark=0&intro=0`)
    await page.waitForFunction(() => window.syn3h?.shell?.galaxy?.logo?.ok && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    assert.equal(await page.evaluate(() => { const g = window.syn3h.shell.galaxy; return g.logo.gl === g.gl && document.querySelectorAll('.galaxy-canvas').length === 1 }), true, 'logo shares the galaxy context')
    const before = await page.evaluate(() => window.syn3h.shell.galaxy.logo.introTime)
    await page.waitForTimeout(700)
    assert.ok(await page.evaluate(() => window.syn3h.shell.galaxy.logo.introTime) > before, 'ordinary lobby animates')
    assert.equal(await page.locator('.shell-logo').evaluate(el => getComputedStyle(el).opacity), '0', 'SVG does not draw over the animation')
    await page.screenshot({ path: `tests/ui/artifacts/logo/${engine.name()}.png` })
    await page.evaluate(() => window.syn3h.shell.showLobbyAbout())
    // Behind a sheet the galaxy dims and then holds the logo still (its sway, inert now, is
    // how the galaxy says so). Wait for that, not for a clock.
    await page.waitForFunction(() => window.syn3h.shell.galaxy.logo.introTime > 1 && window.syn3h.shell.galaxy.logo.look.sway === 0, null, { timeout: 10000 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `tests/ui/artifacts/logo/${engine.name()}-settled.png` })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => { window.syn3h.shell.galaxy.wake = 2 })
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => window.syn3h.shell.galaxy.logo.look.sway), 0)
    assert.ok(await page.evaluate(() => window.syn3h.shell.galaxy.logo.introTime) > 1e5, 'reduced motion skips the fade')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(() => { clearInterval(window.__pin); window.syn3h.params.set('gfx.level', 0); window.syn3h.shell.galaxy.wake = 2 })
    await page.waitForTimeout(300)
    assert.ok(await page.evaluate(() => window.syn3h.shell.galaxy.logo.look.particles) <= 220)
    assert.equal(await page.evaluate(() => window.syn3h.shell.galaxy.logo.look.sway), 0)
    // Restore the context through the browser's own extension; the SVG bridges the loss.
    await page.evaluate(() => { const g = window.syn3h.shell.galaxy; window.__oldLogo = g.logo; window.__loss = g.gl.getExtension('WEBGL_lose_context'); window.__loss.loseContext() })
    await page.waitForFunction(() => !document.querySelector('.syn3h-shell').classList.contains('has-animated-logo'))
    await page.evaluate(() => window.__loss.restoreContext())
    await page.waitForFunction(() => { const g = window.syn3h.shell.galaxy; return g.logo?.ok && g.logo !== window.__oldLogo && document.querySelector('.syn3h-shell').classList.contains('has-animated-logo') }, null, { timeout: 30000 })
    await page.evaluate(() => window.syn3h.shell.play())
    assert.equal(await page.evaluate(() => window.syn3h.shell.galaxy.logo), null, 'leaving lobby disposes logo')
    await page.evaluate(() => window.syn3h.shell.openMenu())
    await page.waitForFunction(() => window.syn3h.shell.galaxy.logo?.ok)
    assert.equal(await page.locator('.galaxy-canvas').count(), 1)
    assert.deepEqual(errors, [])
    console.log(`${engine.name()}: LOBBY LOGO OK`)
  } finally { await browser.close() }
}
