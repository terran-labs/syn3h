/**
 * The galaxy with many worlds: the lobby as it ships, and the most the galaxy holds
 * (`?worlds=12`, development builds only, repeats the recipes). At desktop, phone portrait
 * and phone landscape it checks that every world is traced, that each caption of a world on
 * screen is anchored on screen with it, and that a tap on the smallest world's disc begins a
 * drop. Captions may overlap each other and clip at the screen's edge, and the closer default
 * view lets outer worlds run off the edges (the owner, 16 November 2026), so none is checked. It times the trace on this Mac's GPU for both systems.
 *
 *   SYN3H_URL=http://127.0.0.1:5193/ tools/heavy.sh node tests/ui/galaxy-crowd.mjs
 *
 * Headless frame timings are this Mac's GPU through ANGLE, a comparison and not a phone's.
 */
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { waitForState } from './stateWait.mjs'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
const out = 'tests/ui/artifacts/galaxy-crowd'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], report = []
const ready = page => page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
// Milliseconds of GPU work per galaxy frame: draw synchronously and wait for the GPU each time.
const timing = page => page.evaluate(() => {
  const g = window.syn3h.shell.galaxy, gl = g.gl, times = [], px = new Uint8Array(4)
  for (let i = 0; i < 40; i++) { cancelAnimationFrame(g.frame); g.last = 0; g.wake = 2; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); g.loop(performance.now()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); times.push(performance.now() - t) }
  times.sort((a, b) => a - b); return { median: +times[20].toFixed(2), pixels: gl.drawingBufferWidth * gl.drawingBufferHeight }
})
try {
  for (const view of [{ name: 'desktop', viewport: { width: 1440, height: 900 } }, { name: 'portrait', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }, { name: 'landscape', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }]) {
    const row = { view: view.name }
    // The lobby as it ships, then the most worlds the galaxy holds (development builds repeat the recipes).
    for (const count of ['default', 12]) {
      const context = await browser.newContext(view), page = await context.newPage()
      page.on('pageerror', e => errors.push(`${view.name} ${count}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${view.name} ${count}: ${m.text()}`) })
      await page.goto(`${base}?room=crowd-${view.name}-${count}-${Date.now()}${count === 'default' ? '' : `&worlds=${count}`}`, { waitUntil: 'load' }); await ready(page)
      await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
      await page.waitForFunction(() => window.syn3h.shell.graphics.planetMaps >= window.syn3h.planets.PLANETS.length, null, { timeout: 60000 })
      // Measured in the settled lobby: the opening over and a few frames drawn since.
      const drawn = await page.evaluate(() => window.syn3h.shell.galaxy.frames)
      await waitForState(page, 'the settled lobby (opening over, frames drawn)', drawn => !window.syn3h.shell.galaxy.opening && window.syn3h.shell.galaxy.frames > drawn + 3, drawn, 60)
      const state = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.galaxy-label')].map(l => { const r = l.getBoundingClientRect(); return { id: l.dataset.world, hidden: l.hidden, crowded: l.classList.contains('is-crowded'), left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
        return { labels, screen: window.syn3h.shell.galaxy.screen.map(s => ({ id: s.id, x: s.x, y: s.y, r: s.radius, visible: s.visible })) }
      })
      assert.equal(state.screen.length, state.labels.length, `${view.name} ${count}: a traced world for every label`)
      // Twelve with the forming world, eleven while the lobby hides it.
      if (count !== 'default') assert.ok(state.screen.length >= count - 1 && state.screen.length <= count, `${view.name}: ${state.screen.length} worlds traced of ${count}`)
      const onScreen = new Set(state.screen.filter(s => s.visible && s.x >= 0 && s.x <= view.viewport.width && s.y >= 0 && s.y <= view.viewport.height).map(s => s.id))
      const shown = state.labels.filter(l => !l.hidden && !l.crowded)
      // A world on screen keeps its caption's anchor, the top centre under the planet, on screen
      // too: a caption detached from its planet fails here, one clipped at the edge does not.
      for (const l of shown.filter(l => onScreen.has(l.id))) { const x = (l.left + l.right) / 2; assert.ok(x >= 0 && x <= view.viewport.width && l.top >= 0 && l.top <= view.viewport.height, `${view.name} ${count}: the ${l.id} caption is anchored off the screen`) }
      await page.screenshot({ path: `${out}/${view.name}-${count}.png` })
      row[`labels${count}`] = `${shown.length} of ${state.screen.length}`
      row[`smallest${count}`] = Math.round(Math.min(...state.screen.map(s => s.r)))
      row[`ms${count}`] = (await timing(page)).median
      if (count === 'default') {
        // A tap straight on the smallest world's disc is a drop into it: the smallest world,
        // a moon a few pixels across on a phone, is still a working target.
        const small = state.screen.filter(s => onScreen.has(s.id)).sort((a, b) => a.r - b.r)[0]
        row.smallestWorld = `${small.id} ${Math.round(small.r)} px`
        const now = await page.evaluate(id => window.syn3h.shell.galaxy.screen.find(s => s.id === id), small.id)
        await page.mouse.click(now.x, now.y)
        await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-descending'), null, { timeout: 5000 })
        assert.equal(await page.evaluate(() => window.syn3h.shell.galaxy.flight !== undefined || window.syn3h.shell.galaxy.flightDone), true, `${view.name}: the tap on ${small.id} began a drop`)
      }
      await context.close()
    }
    report.push(row)
  }
  // WebKit, as the iPad runs it: the texture array of maps and the close map work there too.
  const safari = await webkit.launch()
  try {
    const page = await safari.newPage({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2 })
    page.on('pageerror', e => errors.push(`webkit: ${e.message}`))
    await page.goto(`${base}?room=crowd-webkit-${Date.now()}&worlds=10`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.shell?.graphics.planetMaps >= 9, null, { timeout: 120000 })
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    assert.equal(await page.evaluate(() => window.syn3h.shell.graphics.galaxyLive), true, 'webkit: the galaxy runs')
    await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/webkit-ipad-10.png` })
    await page.locator('.galaxy-label[data-world="desert"]').dispatchEvent('click')
    await page.waitForFunction(() => window.syn3h.shell.galaxy.closeIndex >= 0, null, { timeout: 60000 })
    await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/webkit-ipad-close.png` })
  } finally { await safari.close() }
  console.table(report)
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
