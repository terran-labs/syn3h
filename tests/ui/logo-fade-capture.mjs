// Captures of the logo's two-stage fade in (silhouette, then glow) for review, on the loading
// screen and in the lobby, desktop and phone. Also checks the lobby replays its fade each time
// it is shown and that it starts from nothing as the loading veil lifts.
//   tools/heavy.sh node tests/ui/logo-fade-capture.mjs http://127.0.0.1:5232 /tmp/logo-fade
//
// Loading screen: the app's entry script is blocked so the veil stays up, and the CSS
// animations are paused and set to each moment with the Web Animations API, so the frames
// are exact. Lobby: the galaxy's clock is real time, so each frame is taken as the fade
// passes a moment and named by the fade's own time read back after the shot.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = (process.argv[2] ?? 'http://127.0.0.1:5232').replace(/\/$/, ''), out = process.argv[3] ?? '/tmp/logo-fade'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const views = { desktop: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } }
const report = {}, errors = []
try {
  for (const [name, view] of Object.entries(views)) {
    // The loading screen, frozen at each moment.
    const boot = await browser.newPage(view)
    await boot.route('**/src/main.ts', route => route.abort())
    await boot.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
    await boot.waitForSelector('.boot-wordmark')
    for (const t of [0, 0.5, 1, 1.5, 2.5, 3.5, 4.5, 6]) {
      await boot.evaluate(ms => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms } }, t * 1000)
      await boot.locator('.boot-veil').screenshot({ path: `${out}/${name}-boot-${t.toFixed(1)}s.png` })
    }
    await boot.close()

    // The lobby: its fade must start from nothing as the veil lifts.
    const page = await browser.newPage(view)
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}/?room=fade-${Date.now()}`)
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' && window.mira?.shell?.galaxy?.logo?.ok, null, { timeout: 180000 })
    const atLift = await page.evaluate(() => window.mira.shell.galaxy.logo.introTime)
    await page.evaluate(() => window.mira.params.set('gfx.level', 2))
    const shots = []
    const capture = async label => {
      for (const t of [0.05, 0.75, 1.5, 2.5, 3.5, 5]) {
        await page.waitForFunction(t => window.mira.shell.galaxy.logo.introTime >= t, t, { timeout: 20000 })
        const file = `${out}/${name}-lobby-${label}-${t.toFixed(2)}s.png`
        await page.screenshot({ path: file })
        shots.push([file, await page.evaluate(() => +window.mira.shell.galaxy.logo.introTime.toFixed(2))])
      }
    }
    await page.evaluate(() => window.mira.shell.galaxy.logo.replayIntro())
    await capture('first')
    // Into a world and back: a new showing of the lobby fades in again.
    await page.evaluate(() => window.mira.shell.play())
    await page.waitForTimeout(500)
    await page.evaluate(() => window.mira.shell.openMenu())
    await page.waitForFunction(() => window.mira.shell.galaxy.logo?.ok, null, { timeout: 30000 })
    const onReturn = await page.evaluate(() => window.mira.shell.galaxy.logo.introTime)
    await capture('return')
    report[name] = { introTimeAsVeilLifted: +atLift.toFixed(2), introTimeOnReturn: +onReturn.toFixed(2), shots }
    assert.ok(onReturn < 1, `${name}: the lobby fades in again on return (introTime ${onReturn})`)
    await page.close()
  }
} finally { await browser.close() }
report.errors = [...new Set(errors)]
console.log(JSON.stringify(report, null, 1))
