// The black-flash link switches (src/core/flashSwitches.ts) in desktop Chrome. What must stay true:
// - Without a switch nothing changes: Medium keeps its shadows, shading, lite post tier and four
//   samples, the governor steps under slow frames, and the report says "Flash switches: none".
// - With them, at Medium (?gfx=2): the counter shows in play and counts a Test flash apart from real
//   ones; shadows, shading and the rest of Low's values are held, even after a level change; the
//   post tier is base; the scene has one sample; the governor does not step under slow frames;
//   the interface glass is Flat for the visit without changing the saved choice; and the report
//   names every switch.
// - ?post=off: no post chain, and the game still draws.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/flash-switches.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })

async function open(query) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(String(error.stack ?? error.message).slice(0, 400)))
  await page.goto(`${base}?autoplay=1&room=flash-switches-${Date.now()}&${query}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
  await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
  await page.waitForTimeout(1500)
  return { page, context, errors }
}
// The copied Diagnostics report, read from the same function the Copy button calls.
const report = page => page.evaluate(() => window.mira.shell.performancePanel?.source?.diagnosticReport?.() ?? '')
// Feed the governor slow frames (200 ms) for a while, and say whether it moved.
const slowFrames = page => page.evaluate(async () => {
  const q = window.mira.game.quality, g = q.governor, frame = q.frame.bind(q)
  const before = { level: g.level, rung: g.rung, changes: g.changes, ratio: window.mira.game.renderer.getPixelRatio() }
  q.frame = (metrics, judge) => frame({ ...metrics, frameMs: 200 }, judge)
  await new Promise(resolve => setTimeout(resolve, 7000))
  q.frame = frame
  return { before, after: { level: g.level, rung: g.rung, changes: g.changes, ratio: window.mira.game.renderer.getPixelRatio() } }
})
const state = page => page.evaluate(() => {
  const { game, params } = window.mira
  return {
    level: game.quality.governor.level, postTier: game.quality.postTier, samples: game.renderer.samples, chain: !!game.postChain,
    shadow: params.get('gfx.shadowQuality').value, shading: params.get('gfx.vehicleShading').value, bend: params.get('cover.bend').value, fog: params.get('gfx.fogBanks').value,
    glass: document.documentElement.dataset.glassMaterial, saved: localStorage.getItem('mira.glassMaterial.v2'), counter: !!document.querySelector('.flash-counter:not([hidden])'),
  }
})

try {
  // ---- No switch: Medium as it ships. ----
  {
    const { page, context, errors } = await open('gfx=2')
    const s = await state(page)
    assert.deepEqual([s.level, s.postTier, s.samples, s.chain, s.shadow, s.shading, s.bend, s.counter], [2, 'lite', 4, true, 1, 1, true, false], `Medium unchanged without switches ${JSON.stringify(s)}`)
    assert.match(await report(page), /^Flash switches: none$/m)
    // Auto quality on, the level pinned by ?gfx: slow frames still shed a rung.
    const moved = await slowFrames(page)
    assert.ok(moved.after.changes > moved.before.changes, `the governor steps under slow frames without freeze ${JSON.stringify(moved)}`)
    assert.deepEqual(errors, [])
    await context.close()
  }
  // ---- Every switch but post=off, at Medium. ----
  {
    const { page, context, errors } = await open('gfx=2&blank=1&shadows=0&shading=0&lowrest=1&post=base&samples=1&freeze=1&ui=flat')
    const savedBefore = await page.evaluate(() => localStorage.getItem('mira.glassMaterial.v2'))
    const s = await state(page)
    assert.equal(s.level, 2)
    assert.equal(s.postTier, 'base', 'post=base')
    assert.equal(s.samples, 0, 'samples=1: the renderer has no multisampling (three counts one sample as 0)')
    assert.deepEqual([s.shadow, s.shading, s.bend, s.fog], [0, 0, false, 1], `shadows=0, shading=0, lowrest=1 ${JSON.stringify(s)}`)
    assert.equal(s.glass, 'flat', 'ui=flat')
    assert.equal(s.counter, true, 'the counter shows in play')
    // Test flash: one cleared frame, counted apart from real ones.
    await page.locator('.flash-counter button').click()
    await page.waitForFunction(() => /Test seen 1 of 1/.test(document.querySelector('.flash-counter')?.textContent ?? ''), null, { timeout: 10000 })
    const counts = await page.evaluate(() => { const b = window.mira.game.blankFrames; return { total: b.total, blank: b.blank, seen: b.testsSeen } })
    assert.deepEqual(counts, { total: 0, blank: 0, seen: 1 }, 'a test flash is seen and is not a real blank frame')
    // Freeze: slow frames move nothing, not even the render scale.
    const frozen = await slowFrames(page)
    assert.deepEqual(frozen.after, frozen.before, `freeze=1: the governor does not step ${JSON.stringify(frozen)}`)
    // Held after a level change too, and never saved.
    await page.evaluate(() => window.mira.game.quality.setLevel(3))
    await page.waitForFunction(() => window.mira.game.quality.governor.level === 3, null, { timeout: 30000 })
    await page.waitForTimeout(500)
    const high = await state(page)
    assert.deepEqual([high.shadow, high.shading, high.bend, high.postTier], [0, 0, false, 'base'], `held at High ${JSON.stringify(high)}`)
    assert.equal(await page.evaluate(() => localStorage.getItem('mira.glassMaterial.v2')), savedBefore, 'the saved glass choice is untouched')
    const text = await report(page)
    assert.match(text, /^Flash switches: blank=1, shadows=0, shading=0, post=base, samples=1, lowrest=1, freeze=1, ui=flat$/m)
    assert.match(text, /scene samples 1,/, 'the report counts one sample')
    assert.match(text, /^Test flashes: 1 seen of 1 asked$/m)
    assert.deepEqual(errors, [])
    console.log('flash-switches: all at Medium ok', JSON.stringify({ frozen: frozen.after, high }))
    await context.close()
  }
  // ---- post=off: no chain, still drawing. ----
  {
    const { page, context, errors } = await open('gfx=2&post=off')
    const s = await state(page)
    assert.equal(s.chain, false, 'post=off: no post chain')
    assert.equal(s.glass, 'flat', 'post=off takes flat glass')
    // The draw calls of the last drawn frame, sampled over a second: the scene is drawn straight to the canvas.
    const drawn = await page.evaluate(async () => { const calls = []; for (let i = 0; i < 10; i++) { calls.push(window.mira.game.performance.drawCalls); await new Promise(res => setTimeout(res, 100)) } return calls })
    assert.ok(drawn.every(n => n > 20), `the game still draws the scene: ${drawn}`)
    assert.match(await report(page), /^Flash switches: post=off, ui=flat$/m)
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('flash-switches: ok')
} finally {
  await browser.close()
}
