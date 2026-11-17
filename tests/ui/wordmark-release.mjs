// The lobby as released: no address flags. The opening strip on desktop, phone portrait and
// phone landscape; the name with the camera above, edge-on to and below the orbital plane; the
// name leaving when a world is chosen; and the loading view at 2 and 12 seconds on a slow link.
//   tools/heavy.sh node tests/ui/wordmark-release.mjs <prefix>
// SYN3H_URL picks the dev server (default http://127.0.0.1:5241/).
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5241/'
const prefix = process.argv[2] ?? 'release'
const out = 'tests/ui/artifacts/wordmark'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const views = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'phone-land', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]
const shot = (page, name) => page.screenshot({ path: `${out}/${prefix}-${name}.png` })
const ready = page => page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
const messages = []
try {
  for (const view of views) {
    const context = await browser.newContext(view), page = await context.newPage()
    page.on('pageerror', e => messages.push(`${view.name}: ${e.message}`))
    await page.goto(`${base}?room=rel-${Date.now()}`); await ready(page)
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.keyboard.press('Shift'); await page.waitForTimeout(2000)
    // The opening, replayed and held at moments across it.
    // Each frame carries its time, stamped in a corner for the strip.
    for (const t of [0.3, 1.2, 1.9, 2.4, 3.3, 4.2, 5.2, 6.2, 7.0, 7.6, 8.1, 8.8]) {
      await page.evaluate(t => {
        const g = syn3h.shell.galaxy; g.replayOpening(syn3h.params.get('lobby.intro').value); g.openingAt = t; g.wake = 2
        let stamp = document.getElementById('strip-time'); if (!stamp) { stamp = document.createElement('div'); stamp.id = 'strip-time'; stamp.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;font:600 15px/1 ui-monospace,monospace;color:#fff;background:rgb(0 0 0 / .6);padding:5px 8px;border-radius:6px'; document.body.append(stamp) }
        stamp.textContent = `t = ${t.toFixed(1)} s`
      }, t)
      await page.waitForTimeout(350); await shot(page, `${view.name}-open-t${t.toFixed(1)}`)
    }
    await page.evaluate(() => document.getElementById('strip-time')?.remove())
    await page.evaluate(() => { const g = syn3h.shell.galaxy; g.openingAt = null; g.replayOpening(0) })
    await page.waitForTimeout(9500)
    const box = await page.evaluate(() => syn3h.shell.galaxy.wordmarkScreenBox())
    console.log(view.name, 'settled name box', JSON.stringify(box), 'viewport', JSON.stringify(view.viewport))
    await shot(page, `${view.name}-settled`)
    if (view.name !== 'phone-land') {
      // Above, edge-on to and below the plane: the name follows the camera's side.
      for (const [name, pitch] of [['above', 0.5], ['edge', 0.0], ['below', -0.2]]) {
        // Held there every frame: left alone, the lobby eases back to its resting tilt.
        await page.evaluate(pitch => { const g = syn3h.shell.galaxy; clearInterval(window.__hold); window.__hold = setInterval(() => { g.swingPitch = { aim: pitch, aimSpeed: 0, view: pitch, viewSpeed: 0 }; g.wake = 2 }, 16) }, pitch)
        await page.waitForTimeout(3500)
        console.log(view.name, name, 'pitch', await page.evaluate(() => syn3h.shell.galaxy.pitch.toFixed(3)), 'name box', JSON.stringify(await page.evaluate(() => syn3h.shell.galaxy.wordmarkScreenBox())))
        await shot(page, `${view.name}-plane-${name}`)
      }
      await page.evaluate(() => clearInterval(window.__hold)); await page.waitForTimeout(3000)
    }
    if (view.name === 'desktop') {
      // Leaving: the name un-reveals from the instant a world is chosen. Held at three moments
      // with the camera kept in the lobby, so each frame shows the name and not the flight.
      for (const t of [0.1, 0.25, 0.4]) {
        await page.evaluate(t => { const g = syn3h.shell.galaxy; g.leaving = performance.now() - t * 1000; g.wake = 2 }, t)
        await page.waitForTimeout(40); await shot(page, `leave-t${t.toFixed(2)}`)
      }
      await page.evaluate(() => { syn3h.shell.galaxy.leaving = null })
      // And a real choice: the name is gone well before the drop.
      const id = await page.evaluate(() => syn3h.shell.galaxy.screen.find(p => p.visible)?.id)
      await page.evaluate(id => syn3h.shell.galaxy.choose(id), id); await page.waitForTimeout(600); await shot(page, 'leave-real-0.6s')
    }
    await context.close()
  }
  // The loading view on a slow link: at 2 seconds, and at 12 with the second line.
  for (const view of [views[0], views[2]]) {
    const context = await browser.newContext(view), page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 250 * 1024, uploadThroughput: 64 * 1024 })
    const started = Date.now()
    await page.goto(`${base}?room=rel-slow-${Date.now()}`, { waitUntil: 'commit' })
    for (const at of [2, 12]) {
      await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - started)))
      const state = await page.evaluate(() => ({ boot: document.documentElement.dataset.boot, line: document.querySelector('.boot-status')?.textContent, second: document.querySelector('.boot-still')?.textContent, shown: document.querySelector('.boot-still')?.hasAttribute('data-shown'), live: document.querySelector('.syn3h-loading .loading-phase')?.textContent ?? null, wordmark: !!document.querySelector('.boot-veil svg.boot-wordmark') }))
      console.log(view.name, `loading at ${at}s`, JSON.stringify(state))
      await shot(page, `${view.name}-loading-${at}s`)
    }
    await context.close()
  }
} finally { await browser.close() }
if (messages.length) console.log('messages:\n' + messages.join('\n'))
console.log('done')
