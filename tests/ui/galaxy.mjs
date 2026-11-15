/**
 * The galaxy lobby, the default: the worlds orbit a sun in place of the index
 * panel; dragging swings the view; tapping a world flies to it, makes it the world and
 * leads to the name form; Back returns to the galaxy; the custom world opens the sliders;
 * Enter World is a descent to the spawn point. With ?galaxy=0 the panel lobby is used.
 *
 *   tools/heavy.sh node tests/ui/galaxy.mjs
 *
 * Needs a dev server; SYN3H_URL picks it (default http://127.0.0.1:5187/).
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
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
    await page.goto(`${base}?room=galaxy-${view.name}-${Date.now()}`, { waitUntil: 'load' })
    await ready(page)
    // Headless Chrome draws slowly, and the game would step its graphics level down to the
    // lowest, which retires the galaxy. Hold the level so this checks the galaxy itself.
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.waitForTimeout(4000)
    const state = () => page.evaluate(() => { const g = window.syn3h.shell.galaxy; return { open: document.querySelector('.syn3h-shell').classList.contains('galaxy-open'), live: g.live, frames: g.frames, labels: [...document.querySelectorAll('.galaxy-label:not([hidden])')].map(l => { const r = l.getBoundingClientRect(); return { id: l.dataset.world, x: r.left + r.width / 2, y: r.top } }) } })
    const first = await state()
    assert.equal(first.open, true); assert.equal(first.live, true)
    assert.deepEqual(first.labels.map(l => l.id).sort(), ['alpine', 'custom', 'desert', 'volcanic'], `${view.name}: a label for each world and the custom one`)
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
    // The custom world is a forming one: arriving opens the sliders that shape a world.
    await page.locator('.galaxy-label[data-world=custom]').click(); await settle(page, 'advanced')
    await page.screenshot({ path: `${out}/${view.name}-custom.png` })
    await page.evaluate(() => window.syn3h.shell.showPanel('index')); await settle(page, 'index')
    // Enter World from the name form: the descent. The lobby falls away, the game arrives.
    await page.locator('.galaxy-label[data-world=alpine]').click(); await settle(page, 'explore')
    const before = Date.now()
    await page.locator('.shell-play').click()
    await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-descending'), null, { timeout: 3000 })
    await page.waitForTimeout(1300); await page.screenshot({ path: `${out}/${view.name}-descent-dive.png` })
    await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${view.name}-descent-arrive.png` })
    await page.waitForFunction(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 15000 })
    const took = Date.now() - before
    assert.ok(took > 2500 && took < 9000, `${view.name}: the descent took ${took} ms`)
    // (A slow headless browser can have dropped the graphics level by now, which retires the galaxy.)
    assert.notEqual(await page.evaluate(() => window.syn3h.shell.galaxy?.live), true, 'the galaxy gives its graphics back')
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('game')).filter), 'none', 'the game is sharp again')
    assert.equal(await page.evaluate(() => window.syn3h.game.input.suspended), false, 'and it takes input')
    await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${view.name}-landed.png` })
    await context.close()
  }
  // The lowest graphics level keeps the galaxy, held still: no frames while nothing moves, a
  // drag draws, and a tap still flies to a world.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    page.on('pageerror', e => errors.push(`still: ${e.message}`))
    await page.goto(`${base}?room=galaxy-still-${Date.now()}`, { waitUntil: 'load' }); await ready(page)
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 0), 200) })
    await page.waitForTimeout(2500)
    const g = () => page.evaluate(() => { const g = window.syn3h.shell.galaxy; return { live: g?.live, frames: g?.frames, idle: g?.idle } })
    const a = await g(); await page.waitForTimeout(1500); const b = await g()
    assert.equal(b.live, true, 'level 0 keeps the galaxy')
    assert.equal(b.frames, a.frames, `held still it drew ${b.frames - a.frames} frames while idle`)
    assert.ok(b.idle > a.idle, 'and its loop is idling, not stopped')
    await page.mouse.move(195, 140); await page.mouse.down(); await page.mouse.move(330, 170, { steps: 8 }); await page.mouse.up()
    const c = await g(); assert.ok(c.frames > b.frames, 'a drag draws')
    await page.screenshot({ path: `${out}/still-swung.png` })
    await page.locator('.galaxy-label[data-world=desert]').click(); await settle(page, 'explore')
    assert.equal(await page.evaluate(() => window.syn3h.planets.currentPlanet().id), 'desert')
    // The flight eases in per frame, so a slow headless browser takes a while: wait for it to stop.
    let rest = false
    for (let i = 0; i < 20 && !rest; i++) { const d = await g(); await page.waitForTimeout(1000); rest = (await g()).frames === d.frames }
    assert.ok(rest, 'it settles still again after the flight')
    await page.close()
  }
  // There is no other lobby. Where the galaxy's shader will not start, its world names stay
  // as a row of buttons and a tap still leads to the name form.
  const flat = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await flat.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return this.className === 'galaxy-canvas' ? null : get.call(this, kind, ...rest) } })
  await flat.goto(`${base}?room=galaxy-flat-${Date.now()}`, { waitUntil: 'load' }); await ready(flat)
  assert.equal(await flat.evaluate(() => document.querySelector('.syn3h-shell').classList.contains('galaxy-flat')), true)
  assert.equal(await flat.locator('.planet-card').count(), 0)
  await flat.screenshot({ path: `${out}/flat.png` })
  await flat.locator('.galaxy-label[data-world=desert]').click(); await settle(flat, 'explore')
  assert.equal(await flat.evaluate(() => window.syn3h.planets.currentPlanet().id), 'desert')
  await flat.close()
  // Without WebGL 2 at all the lobby says so plainly (the game cannot draw there either).
  const bare = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await bare.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === 'webgl2' && !this.isConnected ? null : get.call(this, kind, ...rest) } })
  await bare.goto(`${base}?room=galaxy-bare-${Date.now()}`, { waitUntil: 'load' })
  await bare.waitForSelector('.lobby-unsupported:not([hidden])', { timeout: 120000 })
  assert.equal(await bare.evaluate(() => Boolean(window.syn3h?.shell?.galaxy)), false)
  await bare.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 120000 }); await bare.waitForTimeout(1500)
  await bare.screenshot({ path: `${out}/no-webgl2.png` })
  await bare.close()
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
