// The lobby's name stands in the scene on every device that can draw it, however long its
// one-off field bake takes: a bake made to take 300 ms (the read back stubbed slow) still
// gives the in-scene name; a device without half-float targets (the extensions hidden) draws
// it from the 8-bit field; and a phone on its side under a 4x CPU throttle shows it through
// the opening. Screenshots and 8x zooms go to tests/ui/artifacts/wordmark/.
//   tools/heavy.sh node tests/ui/wordmark-capability.mjs   (SYN3H_URL, default http://127.0.0.1:5247/)
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5247/'
const out = 'tests/ui/artifacts/wordmark'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const SLOW_READBACK = () => {
  const read = WebGL2RenderingContext.prototype.readPixels
  WebGL2RenderingContext.prototype.readPixels = function (...args) { if (args[2] === 1 && args[3] === 1) { const until = performance.now() + 300; while (performance.now() < until) { /* a busy GPU */ } } return read.apply(this, args) }
}
const NO_FLOAT_TARGETS = () => {
  const get = WebGL2RenderingContext.prototype.getExtension
  WebGL2RenderingContext.prototype.getExtension = function (name) { return /color_buffer_(half_)?float/.test(name) ? null : get.call(this, name) }
}
const state = page => page.evaluate(() => { const g = syn3h.shell.galaxy, f = g.logo?.distanceField; return { placed: !!g.wordmarkScreenBox(), bakeMs: f && +f.lastBakeMs.toFixed(0), precise: f?.precise, fallback: window.syn3hStartup?.wordmarkFallback ?? null } })
const report = {}
try {
  for (const [name, init] of [['slow-bake', SLOW_READBACK], ['8-bit', NO_FLOAT_TARGETS], ['float', null]]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }), page = await context.newPage()
    if (init) await page.addInitScript(init)
    await page.goto(`${base}?room=cap-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    await page.evaluate(() => { window.__pin = setInterval(() => syn3h.params.set('gfx.level', 2), 400) })
    await page.keyboard.press('Shift')
    await page.waitForFunction(() => !!syn3h.shell.galaxy.wordmarkScreenBox(), null, { timeout: 20000 }).catch(() => {})
    const s = report[name] = await state(page)
    assert.equal(s.placed, true, `${name}: the name stands in the scene`); assert.equal(s.fallback, null, `${name}: no fallback recorded`)
    if (name === 'slow-bake') assert.ok(s.bakeMs >= 250, `the bake was made slow (${s.bakeMs} ms)`)
    if (name === '8-bit') assert.equal(s.precise, false, 'the 8-bit field is in use')
    const box = await page.evaluate(() => syn3h.shell.galaxy.wordmarkScreenBox())
    const clip = { x: Math.round(box.x + box.width * 0.62), y: Math.round(box.y + box.height * 0.05), width: Math.round(box.width * 0.2), height: Math.round(box.height * 0.9) }
    const png = await page.screenshot({ clip })
    const z = await browser.newPage({ viewport: { width: clip.width * 8, height: clip.height * 8 } })
    await z.setContent(`<body style="margin:0;overflow:hidden"><img src="data:image/png;base64,${png.toString('base64')}" style="display:block;width:${clip.width * 8}px;height:${clip.height * 8}px;image-rendering:pixelated"></body>`)
    await z.screenshot({ path: `${out}/cap-${name}-zoom.png` }); await z.close()
    await context.close()
  }
  // A phone on its side, 4x CPU throttle: the opening ends on the name in the scene.
  {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }), page = await context.newPage()
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.goto(`${base}?room=cap-land-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.documentElement.dataset.boot === 'done', null, { timeout: 180000 })
    await page.evaluate(() => { window.__pin = setInterval(() => syn3h.params.set('gfx.level', 2), 400) })
    for (const t of [2.4, 5.2, 7.6, 8.8]) {
      await page.evaluate(t => { const g = syn3h.shell.galaxy; g.replayOpening(syn3h.params.get('lobby.intro').value); g.openingAt = t; g.wake = 2 }, t)
      await page.waitForTimeout(900); await page.screenshot({ path: `${out}/cap-land-throttled-t${t.toFixed(1)}.png` })
    }
    await page.evaluate(() => { const g = syn3h.shell.galaxy; g.openingAt = null; g.replayOpening(0) })
    await page.waitForFunction(() => !!syn3h.shell.galaxy.wordmarkScreenBox(), null, { timeout: 20000 }).catch(() => {})
    const s = report.landThrottled = await state(page)
    assert.equal(s.placed, true, 'phone landscape, throttled: the name stands in the scene'); assert.equal(s.fallback, null)
    await page.screenshot({ path: `${out}/cap-land-throttled-settled.png` })
    await context.close()
  }
  console.log(JSON.stringify({ ok: true, report }))
} finally { await browser.close() }
