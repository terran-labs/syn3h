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
import { waitForState } from './stateWait.mjs'
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
    // The opening (src/ui/galaxy/opening.ts) runs about nine seconds; a key skips straight to the
    // settled lobby, as for a player, and the checks below are of that lobby.
    await page.keyboard.press('Shift')
    // The settled lobby: the opening gone and every planet's label shown.
    await waitForState(page, 'the settled lobby (opening over, every planet labelled)', () => !window.syn3h.shell.galaxy.opening && document.querySelectorAll('.galaxy-label:not([hidden])').length >= window.syn3h.planets.PLANETS.length, undefined, 60)
    const state = () => page.evaluate(() => { const g = window.syn3h.shell.galaxy; return { open: document.querySelector('.syn3h-shell').classList.contains('galaxy-open'), live: g.live, frames: g.frames, labels: [...document.querySelectorAll('.galaxy-label:not([hidden])')].map(l => { const r = l.getBoundingClientRect(); return { id: l.dataset.world, x: r.left + r.width / 2, y: r.top } }) } })
    const first = await state()
    assert.equal(first.open, true); assert.equal(first.live, true)
    const planets = await page.evaluate(() => window.syn3h.planets.PLANETS.map(p => p.id))
    assert.deepEqual(first.labels.map(l => l.id).sort(), [...planets].sort(), `${view.name}: a label for each planet; the custom one is hidden for now`)
    for (const label of first.labels) assert.ok(label.x > 0 && label.x < view.viewport.width && label.y > 0 && label.y < view.viewport.height, `${view.name}: ${label.id} is on screen`)
    await page.screenshot({ path: `${out}/${view.name}-home.png` })
    // Dragging empty space swings the view: the worlds move across the screen.
    const from = { x: view.viewport.width * 0.5, y: view.viewport.height * 0.16 }
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 160, from.y + 30, { steps: 8 }); await page.mouse.up()
    // The swing plays out over drawn frames: wait until a label has moved, as the assertion needs.
    await waitForState(page, 'a label moved by the swing, with frames drawn', first => [...document.querySelectorAll('.galaxy-label:not([hidden])')].some(l => { const r = l.getBoundingClientRect(), b = first.labels.find(x => x.id === l.dataset.world); return b && Math.hypot(r.left + r.width / 2 - b.x, r.top - b.y) > 25 }) && window.syn3h.shell.galaxy.frames > first.frames, first, 30)
    const swung = await state()
    assert.ok(swung.frames > first.frames, 'it keeps drawing')
    assert.ok(swung.labels.some(l => { const before = first.labels.find(b => b.id === l.id); return before && Math.hypot(l.x - before.x, l.y - before.y) > 25 }), `${view.name}: the view swung`)
    await page.screenshot({ path: `${out}/${view.name}-swung.png` })
    // Behind a panel the galaxy dims and stops drawing; back at the index it is bright again.
    // Settings moved to the gear's sheet; About is a full lobby panel, as Settings was.
    await page.evaluate(() => window.syn3h.shell.showPanel('about')); await settle(page, 'about')
    await page.waitForFunction(() => window.syn3h.shell.galaxy.dim === 0.35, null, { timeout: 15000 })
    // A map arriving, or the camera still easing home, draws a frame; then it rests.
    let rests = false
    for (let i = 0; i < 20 && !rests; i++) { const f = (await state()).frames; await page.waitForTimeout(1200); rests = (await state()).frames === f }
    assert.ok(rests, `${view.name}: the galaxy keeps drawing behind a panel`)
    await page.screenshot({ path: `${out}/${view.name}-panel.png` })
    await page.evaluate(() => window.syn3h.shell.showPanel('index')); await settle(page, 'index')
    await page.waitForFunction(() => window.syn3h.shell.galaxy.dim === 1, null, { timeout: 15000 })
    // Tapping a world drops straight into it: no form, no panel, one motion to the ground.
    // A world well on screen and not the one in play: at the closer default zoom an outer world
    // can be off the edge of a phone, depending on where it is in its orbit.
    const alpine = await page.evaluate(() => {
      const current = window.syn3h.planets.currentPlanet().id, s = window.syn3h.shell.galaxy.screen
      const onScreen = p => p.visible && p.x > p.radius + 4 && p.x < innerWidth - p.radius - 4 && p.y > p.radius + 4 && p.y < innerHeight - p.radius - 4 && p.radius > 6 && p.id !== current
      return s.find(p => p.id === 'alpine' && onScreen(p)) ?? s.filter(onScreen).sort((a, b) => b.radius - a.radius)[0]
    })
    assert.ok(alpine, `${view.name}: a world is on screen to tap`)
    // Measure the actual transition. Screenshot transfer can finish after landing on a busy host.
    await page.evaluate(() => {
      const root = document.querySelector('.syn3h-shell')
      window.__dropTiming = { start: performance.now(), end: 0 }
      const observer = new MutationObserver(() => {
        if (root.classList.contains('is-playing') && !root.classList.contains('is-descending')) {
          window.__dropTiming.end = performance.now(); observer.disconnect()
        }
      })
      observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    })
    await page.mouse.click(alpine.x, alpine.y)
    await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-descending'), null, { timeout: 1000 })
    await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${view.name}-flying.png` })
    await page.waitForTimeout(1300); await page.screenshot({ path: `${out}/${view.name}-descent-dive.png` })
    await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${view.name}-descent-arrive.png` })
    await page.waitForFunction(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 15000 })
    assert.equal(await page.evaluate(() => window.syn3h.planets.currentPlanet().id), alpine.id)
    const took = await page.evaluate(() => window.__dropTiming.end - window.__dropTiming.start)
    assert.ok(took > 2500 && took < 11000, `${view.name}: the drop took ${took} ms`)
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
    await page.evaluate(() => { window.__pin = setInterval(() => { window.syn3h.shell.stopAttract(); window.syn3h.params.set('gfx.level', 0) }, 200) })
    // Every map painted first: each one arriving is a reason to draw.
    await page.waitForFunction(() => window.syn3h.shell.graphics.planetMaps >= window.syn3h.planets.PLANETS.length, null, { timeout: 60000 })
    // Let the finite resting tilt finish; after that the low-end lobby must stop drawing.
    await page.waitForFunction(() => {
      const g = window.syn3h.shell.galaxy
      return Math.abs(g.pitch - 20 * Math.PI / 180) < 1e-8 && !g.resting && g.swingResting
    }, null, { timeout: 15000 })
    await page.waitForTimeout(500)
    const g = () => page.evaluate(() => { const g = window.syn3h.shell.galaxy; return { live: g?.live, frames: g?.frames, idle: g?.idle } })
    const a = await g(); await page.waitForTimeout(1500); const b = await g()
    assert.equal(b.live, true, 'level 0 keeps the galaxy')
    assert.equal(b.frames, a.frames, `held still it drew ${b.frames - a.frames} frames while idle`)
    assert.ok(b.idle > a.idle, 'and its loop is idling, not stopped')
    await page.mouse.move(195, 140); await page.mouse.down(); await page.mouse.move(330, 170, { steps: 8 }); await page.mouse.up()
    const c = await g(); assert.ok(c.frames > b.frames, 'a drag draws')
    await page.screenshot({ path: `${out}/still-swung.png` })
    // Held still or not, a tap is the whole drop, drawn as it goes.
    await page.locator('.galaxy-label[data-world=desert]').dispatchEvent('click')
    await page.waitForFunction(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 20000 })
    assert.equal(await page.evaluate(() => window.syn3h.planets.currentPlanet().id), 'desert')
    await page.close()
  }
  // A returning player: the descent is shorter, and a key lands at once.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.addInitScript(() => localStorage.setItem('syn3h.descents', '3'))
    await page.goto(`${base}?room=galaxy-skip-${Date.now()}`, { waitUntil: 'load' }); await ready(page)
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.locator('.galaxy-label[data-world=desert]').dispatchEvent('click')
    await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-descending'), null, { timeout: 1000 })
    // A key lands at once: it skips the blurred fall through the air (Shell.descent), which an
    // unskipped drop always shows. Watched as state, not timed, so a busy machine cannot fail it.
    await page.evaluate(() => { const game = document.getElementById('game'); window.__blurred = false; new MutationObserver(() => { if (/blur/.test(game.style.filter)) window.__blurred = true }).observe(game, { attributes: true, attributeFilter: ['style'] }) })
    // The skip listens from the frame after the drop starts: press after two frames.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await page.keyboard.press('w')
    await page.waitForFunction(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 15000 })
    assert.equal(await page.evaluate(() => window.__blurred), false, 'a key skips the fall through the air')
    assert.equal(await page.evaluate(() => localStorage.getItem('syn3h.descents')), '4')
    await page.close()
  }
  // There is no other lobby. Where the galaxy's shader will not start, its world names stay
  // as a row of buttons and a tap goes straight into that world.
  const flat = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await flat.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return this.className === 'galaxy-canvas' ? null : get.call(this, kind, ...rest) } })
  await flat.goto(`${base}?room=galaxy-flat-${Date.now()}`, { waitUntil: 'load' }); await ready(flat)
  assert.equal(await flat.evaluate(() => document.querySelector('.syn3h-shell').classList.contains('galaxy-flat')), true)
  assert.equal(await flat.locator('.planet-card').count(), 0)
  await flat.screenshot({ path: `${out}/flat.png` })
  await flat.locator('.galaxy-label[data-world=desert]').dispatchEvent('click')
  await flat.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-playing'), null, { timeout: 20000 })
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
