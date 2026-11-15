/**
 * The galaxy lobby prototype (?galaxy=1): the worlds orbit a sun in place of the index
 * panel; dragging swings the view; tapping a world flies to it, makes it the world and
 * leads to the name form; Back returns to the galaxy; Play gives its graphics back. Without
 * the option the ordinary lobby is untouched.
 *
 *   tools/heavy.sh node tests/ui/galaxy.mjs
 *
 * Needs the lane dev server on 5187.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/galaxy'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
const ready = page => page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
const settle = (page, id) => page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, id, { timeout: 30000 })
try {
  for (const view of [{ name: 'desktop', viewport: { width: 1440, height: 900 } }, { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]) {
    const context = await browser.newContext(view), page = await context.newPage()
    page.on('pageerror', e => errors.push(`${view.name}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${view.name}: ${m.text()}`) })
    await page.goto(`http://127.0.0.1:5187/?galaxy=1&room=galaxy-${view.name}-${Date.now()}`, { waitUntil: 'load' })
    await ready(page); await page.waitForTimeout(4000)
    const state = () => page.evaluate(() => { const g = window.syn3h.shell.galaxy; return { open: document.querySelector('.syn3h-shell').classList.contains('galaxy-open'), live: g.live, frames: g.frames, labels: [...document.querySelectorAll('.galaxy-label:not([hidden])')].map(l => { const r = l.getBoundingClientRect(); return { id: l.dataset.world, x: r.left + r.width / 2, y: r.top } }), starfield: window.syn3h.shell.graphics.starfieldLive } })
    const first = await state()
    assert.equal(first.open, true); assert.equal(first.live, true); assert.equal(first.starfield, false, 'one sky at a time')
    assert.equal(first.labels.length, 3, `${view.name}: a label for each world`)
    for (const label of first.labels) assert.ok(label.x > 0 && label.x < view.viewport.width && label.y > 0 && label.y < view.viewport.height, `${view.name}: ${label.id} is on screen`)
    await page.screenshot({ path: `${out}/${view.name}-home.png` })
    // Dragging empty space swings the view: the worlds move across the screen.
    const from = { x: view.viewport.width * 0.5, y: view.viewport.height * 0.16 }
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 160, from.y + 30, { steps: 8 }); await page.mouse.up()
    await page.waitForTimeout(700)
    const swung = await state()
    assert.ok(swung.frames > first.frames, 'it keeps drawing')
    assert.ok(swung.labels.some(l => { const before = first.labels.find(b => b.id === l.id); return before && Math.hypot(l.x - before.x, l.y - before.y) > 25 }), `${view.name}: the view swung`)
    await page.screenshot({ path: `${out}/${view.name}-swung.png` })
    // Tapping a world: the camera flies to it, it becomes the world, and the name form follows.
    const alpine = (await state()).labels.find(l => l.id === 'alpine')
    await page.mouse.click(alpine.x, alpine.y - 18)
    await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${view.name}-flying.png` })
    await settle(page, 'explore')
    assert.equal(await page.evaluate(() => window.syn3h.planets.currentPlanet().id), 'alpine')
    assert.equal((await state()).open, false)
    await page.screenshot({ path: `${out}/${view.name}-arrived.png` })
    // Back: the whole system again.
    await page.locator('[data-panel=explore] .panel-back').click(); await settle(page, 'index')
    assert.equal((await state()).open, true)
    // Play: the galaxy's graphics are handed back.
    await page.evaluate(() => { const s = window.syn3h.shell; s.onPlay = () => {}; s.play() })
    await page.waitForTimeout(600)
    assert.equal(await page.evaluate(() => window.syn3h.shell.galaxy.live), false)
    await context.close()
  }
  // Without the option nothing changes.
  const plain = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await plain.goto(`http://127.0.0.1:5187/?room=galaxy-off-${Date.now()}`, { waitUntil: 'load' }); await ready(plain)
  assert.equal(await plain.evaluate(() => document.querySelector('.syn3h-shell').classList.contains('is-galaxy') || Boolean(window.syn3h.shell.galaxy)), false)
  await plain.close()
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
