// The lobby's planet glow (src/ui/galaxy/hoverGlow.ts): three worlds of different colours
// hovered on desktop, one focused from the keyboard, one pressed on a phone, each at two
// moments so the motion shows; that it goes when the pointer leaves and the lobby then rests;
// and what it costs a frame.
//   tools/heavy.sh node tests/ui/planet-glow.mjs   (SYN3H_URL, default http://127.0.0.1:5241/)
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5241/'
const out = 'tests/ui/artifacts/planet-glow'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const ready = page => page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
// Skips the opening as a player would (a key), and holds the graphics level.
const settle = async page => { await page.keyboard.press('Shift'); await page.evaluate(() => { window.__pin = setInterval(() => syn3h.params.set('gfx.level', 2), 400) }) }
/** A point on the world's disc that nothing is drawn over (a label can cover part of a world). */
const onDisc = (page, w) => page.evaluate(w => { for (const [dx, dy] of [[0, 0], [0, 0.5], [0.5, 0], [-0.5, 0], [0, -0.5], [0.4, 0.4], [-0.4, 0.4]]) { const x = w.x + dx * w.radius, y = w.y + dy * w.radius; if (document.elementFromPoint(x, y)?.classList.contains('galaxy-canvas')) return { x, y } } return null }, w)
const crop = (p, r = 3.2) => ({ x: Math.max(0, p.x - p.radius * r), y: Math.max(0, p.y - p.radius * r), width: p.radius * r * 2, height: p.radius * r * 2 })
const report = {}
try {
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    await page.goto(`${base}?room=glow-${Date.now()}`); await ready(page); await settle(page); await page.waitForTimeout(3000)
    // Hold the orbits still so the two moments differ only by the glow's own motion.
    await page.evaluate(() => { syn3h.shell.galaxy.clockHold = true })
    const worlds = await page.evaluate(() => syn3h.shell.galaxy.screen.filter(p => p.visible && p.radius > 14).map(p => ({ ...p })))
    const picked = ['volcanic', 'archipelago', 'methane', 'alpine', 'desert', 'badlands'].map(id => worlds.find(w => w.id.startsWith(id))).filter(Boolean).slice(0, 4)
    for (const world of picked) {
      const at = await onDisc(page, world)
      if (!at) continue
      await page.mouse.move(at.x, at.y)
      for (const moment of [0, 1]) {
        await page.waitForTimeout(moment ? 700 : 400)
        const now = await page.evaluate(id => syn3h.shell.galaxy.screen.find(p => p.id === id), world.id)
        await page.screenshot({ path: `${out}/hover-${world.id}-${moment}.png`, clip: crop(now) })
      }
      const why = await page.evaluate(([x, y]) => { const g = syn3h.shell.galaxy; return { glow: g.glow.id, strength: g.glow.strength, hover: g.hoverId, focus: g.focusId, press: g.pressId, opening: g.opening, backdrop: g.backdrop, chosen: g.chosen, at: document.elementFromPoint(x, y)?.className, near: g.screen.filter(p => Math.hypot(p.x - x, p.y - y) < p.radius + 10).map(p => p.id + (p.visible ? '' : '(hidden)')) } }, [at.x, at.y])
      assert.equal(why.glow, world.id, `hovering ${world.id} makes it glow ${JSON.stringify(why)}`)
    }
    // Leaving: the glow goes and the lobby comes to rest again.
    await page.mouse.move(20, 450); await page.waitForTimeout(800)
    assert.equal(await page.evaluate(() => syn3h.shell.galaxy.glow.strength), 0, 'the glow goes when the pointer leaves')
    // Keyboard focus on a label.
    const focus = picked[1] ?? picked[0]
    await page.evaluate(id => document.querySelector(`.galaxy-label[data-world="${id}"]`).focus(), focus.id)
    for (const moment of [0, 1]) {
      await page.waitForTimeout(moment ? 700 : 400)
      const now = await page.evaluate(id => syn3h.shell.galaxy.screen.find(p => p.id === id), focus.id)
      await page.screenshot({ path: `${out}/focus-${focus.id}-${moment}.png`, clip: crop(now, 3) })
    }
    // What it costs: the galaxy frame with a world glowing and with none, to the GPU's finish.
    report.frameMs = await page.evaluate(async id => {
      const g = syn3h.shell.galaxy, gl = g.gl, px = new Uint8Array(4), time = () => { const t = []; for (let i = 0; i < 40; i++) { g.wake = 2; g.last = 0; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const s = performance.now(); g.loop(performance.now()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t.push(performance.now() - s) } t.sort((a, b) => a - b); return +t[20].toFixed(2) }
      const glowing = time(); document.activeElement?.blur(); g.hoverId = g.focusId = null; await new Promise(r => setTimeout(r, 600)); const none = time()
      return { glowing, none }
    }, focus.id)
    await page.close()
  }
  {
    // A phone: a finger pressed on a world (no hover on touch). Held down with raw touch events.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }), page = await context.newPage()
    await page.goto(`${base}?room=glow-phone-${Date.now()}`); await ready(page)
    await page.evaluate(() => { window.__pin = setInterval(() => syn3h.params.set('gfx.level', 2), 400) }); await page.waitForTimeout(9000)
    await page.evaluate(() => { syn3h.shell.galaxy.clockHold = true })
    const world = await page.evaluate(() => syn3h.shell.galaxy.screen.filter(p => p.visible).sort((a, b) => b.radius - a.radius)[0])
    const at = await onDisc(page, world), cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
    for (const moment of [0, 1]) { await page.waitForTimeout(moment ? 700 : 400); await page.screenshot({ path: `${out}/press-phone-${world.id}-${moment}.png`, clip: crop(world, 3) }) }
    assert.equal(await page.evaluate(() => syn3h.shell.galaxy.glow.id), world.id, 'a pressed world glows on touch')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await context.close()
  }
  console.log(JSON.stringify({ ok: true, report }))
} finally { await browser.close() }
