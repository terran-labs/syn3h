/**
 * The drop: a tap on a world flies from the solar system all the way into the follow camera
 * in one motion. No form, no panel, no lobby screen in between. This check taps a world (a
 * different one from the world in play, so the world is rebuilt on the way) and records:
 * that no panel ever opened, how long the drop took, every frame gap from tap to ground (the
 * longest, and when), and stills along the way. Desktop and phone.
 *
 *   SYN3H_URL=http://127.0.0.1:5193/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/drop.mjs
 *
 * Headless frame gaps are this Mac's, not a phone's: they find hitches (a main-thread stall
 * shows as one long gap), they do not prove smoothness on a device.
 */
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
const out = 'tests/ui/artifacts/drop'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], report = []
const ready = page => page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
try {
  for (const view of [{ name: 'desktop', viewport: { width: 1440, height: 900 } }, { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]) {
    const page = await browser.newPage(view)
    page.on('pageerror', e => errors.push(`${view.name}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${view.name}: ${m.text()}`) })
    await page.goto(`${base}?room=drop-${view.name}-${Date.now()}`, { waitUntil: 'load' }); await ready(page)
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.waitForFunction(() => window.syn3h.shell.graphics.planetMaps >= window.syn3h.planets.PLANETS.length, null, { timeout: 60000 })
    // Watch from the tap: every frame gap, and whether any panel other than the index opened.
    await page.evaluate(() => {
      const w = window; w.__gaps = []; w.__panels = new Set(); let last = performance.now()
      const tick = now => { w.__gaps.push([now - w.__t0, now - last]); last = now; const p = document.querySelector('.lobby-panels').dataset.activePanel; if (p && p !== 'index' && !document.querySelector('.syn3h-shell').classList.contains('is-playing')) w.__panels.add(p); if (!w.__done) requestAnimationFrame(tick) }
      w.__t0 = performance.now(); requestAnimationFrame(tick)
    })
    const target = 'alpine', where = await page.evaluate(id => window.syn3h.shell.galaxy.screen.find(s => s.id === id), target)
    const t0 = Date.now()
    await page.mouse.click(where.x, where.y)
    await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-descending'), null, { timeout: 1000 })
    for (const at of [300, 900, 1600, 2300, 3000, 3800, 4600, 5400]) { await page.waitForTimeout(Math.max(0, at - (Date.now() - t0))); await page.screenshot({ path: `${out}/${view.name}-${String(at).padStart(4, '0')}.png` }) }
    await page.waitForFunction(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 20000 })
    const took = Date.now() - t0
    await page.waitForTimeout(800); await page.screenshot({ path: `${out}/${view.name}-landed.png` })
    const watch = await page.evaluate(() => { window.__done = true; const g = window.__gaps.slice(1); const worst = g.reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]); return { panels: [...window.__panels], frames: g.length, worst: worst.map(v => Math.round(v)), over50: g.filter(x => x[1] > 50).map(x => `${Math.round(x[1])}ms@${Math.round(x[0])}`) } })
    assert.deepEqual(watch.panels, [], `${view.name}: a panel opened during the drop`)
    assert.equal(await page.evaluate(() => window.syn3h.planets.currentPlanet().id), target)
    assert.ok(took < 11000, `${view.name}: the drop took ${took} ms`)
    assert.equal(await page.evaluate(() => window.syn3h.game.input.suspended), false, 'and the game takes input')
    report.push({ view: view.name, ms: took, frames: watch.frames, worstGap: `${watch.worst[1]} ms at ${watch.worst[0]} ms`, over50: watch.over50.slice(0, 8).join(' ') })
    await page.close()
  }
  // WebKit at iPad size: the blur pass and the whole drop run there too.
  const safari = await webkit.launch()
  try {
    const page = await safari.newPage({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2 })
    page.on('pageerror', e => errors.push(`webkit: ${e.message}`))
    await page.goto(`${base}?room=drop-webkit-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.shell?.graphics.planetMaps >= window.syn3h.planets.PLANETS.length, null, { timeout: 120000 })
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    const t0 = Date.now()
    await page.locator('.galaxy-label[data-world="desert"]').dispatchEvent('click')
    await page.waitForTimeout(900); await page.screenshot({ path: `${out}/webkit-0900.png` })
    await page.waitForFunction(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 30000 })
    report.push({ view: 'webkit ipad', ms: Date.now() - t0 })
    await page.waitForTimeout(800); await page.screenshot({ path: `${out}/webkit-landed.png` })
  } finally { await safari.close() }
  console.table(report)
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
