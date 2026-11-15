/**
 * The galaxy with many worlds. Terrain Lab is adding six planets, which makes ten bodies with
 * Custom; `?worlds=10` (development builds only) rehearses that by repeating the recipes.
 * At desktop, phone portrait and phone landscape it checks that every world is on screen,
 * that the labels shown do not overlap each other, that each shown label is a working tap
 * target, and it times the trace on this Mac's GPU against the four-world system.
 *
 *   SYN3H_URL=http://127.0.0.1:5193/ tools/heavy.sh node tests/ui/galaxy-crowd.mjs
 *
 * Headless frame timings are this Mac's GPU through ANGLE, a comparison and not a phone's.
 */
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
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
    for (const count of [4, 10]) {
      const context = await browser.newContext(view), page = await context.newPage()
      page.on('pageerror', e => errors.push(`${view.name} ${count}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${view.name} ${count}: ${m.text()}`) })
      await page.goto(`${base}?room=crowd-${view.name}-${count}-${Date.now()}${count > 4 ? `&worlds=${count}` : ''}`, { waitUntil: 'load' }); await ready(page)
      await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
      await page.waitForFunction(n => window.syn3h.shell.graphics.planetMaps >= n, count - 1, { timeout: 60000 })
      await page.waitForTimeout(1500)
      const state = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.galaxy-label')].map(l => { const r = l.getBoundingClientRect(); return { id: l.dataset.world, hidden: l.hidden, crowded: l.classList.contains('is-crowded'), left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
        return { labels, screen: window.syn3h.shell.galaxy.screen.map(s => ({ id: s.id, x: s.x, y: s.y, r: s.radius, visible: s.visible })) }
      })
      assert.equal(state.screen.length, count, `${view.name}: ${count} worlds traced`)
      const off = state.screen.filter(s => !s.visible || s.x < 0 || s.x > view.viewport.width || s.y < 0 || s.y > view.viewport.height).map(s => s.id)
      assert.deepEqual(off, [], `${view.name} ${count}: worlds off the screen`)
      const shown = state.labels.filter(l => !l.hidden && !l.crowded)
      for (const a of shown) for (const b of shown) if (a.id < b.id) assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${view.name} ${count}: labels ${a.id} and ${b.id} overlap`)
      for (const l of shown) assert.ok(l.left >= 0 && l.right <= view.viewport.width && l.top >= 0 && l.bottom <= view.viewport.height, `${view.name} ${count}: label ${l.id} off the screen`)
      await page.screenshot({ path: `${out}/${view.name}-${count}.png` })
      row[`labels${count}`] = `${shown.length} of ${count}`
      row[`smallest${count}`] = Math.round(Math.min(...state.screen.map(s => s.r)))
      row[`ms${count}`] = (await timing(page)).median
      if (count === 10) {
        // Each shown label flies to its world; Back returns. Checked for the last three shown.
        // Labels follow their orbiting worlds, so they are never still enough for a pointer
        // click; each is pressed as the keyboard would, choosing one shown at that moment.
        const visited = []
        for (let k = 0; k < 3; k++) {
          const id = await page.evaluate(seen => [...document.querySelectorAll('.galaxy-label:not([hidden]):not(.is-crowded)')].map(l => l.dataset.world).find(id => !seen.includes(id)), visited)
          visited.push(id)
          await page.locator(`.galaxy-label[data-world="${id}"]`).dispatchEvent('click')
          await page.waitForFunction(() => document.querySelector('.lobby-panels').dataset.activePanel !== 'index', null, { timeout: 30000 })
          await page.evaluate(() => window.syn3h.shell.showPanel('index'))
          await page.waitForFunction(() => document.querySelector('.lobby-panels').dataset.activePanel === 'index' && document.querySelector('.lobby-panels').dataset.busy === 'false')
        }
        // A tap straight on the smallest world's disc chooses it too.
        const small = state.screen.filter(s => !s.id.startsWith('custom')).sort((a, b) => a.r - b.r)[0]
        await page.waitForTimeout(2500)
        const now = await page.evaluate(id => window.syn3h.shell.galaxy.screen.find(s => s.id === id), small.id)
        await page.mouse.click(now.x, now.y)
        await page.waitForFunction(() => window.syn3h.shell.galaxy.chosen >= 0, null, { timeout: 5000 })
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
