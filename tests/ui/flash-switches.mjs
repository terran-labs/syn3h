// The black-flash link switches (src/core/flashSwitches.ts) in desktop Chrome. What must stay true:
// - Without a switch nothing changes: Medium keeps its shadows, shading, lite post tier and four
//   samples, the governor steps under slow frames, and the report says "Flash switches: none".
// - With them, at Medium (?gfx=2): the counter shows in play and counts a Test flash apart from real
//   ones; shadows, shading and the rest of Low's values are held, even after a level change; the
//   post tier is base; the scene has one sample; the governor does not step under slow frames;
//   the interface glass is Flat for the visit without changing the saved choice; and the report
//   names every switch.
// - ?post=off: no post chain, and the game still draws.
// - The v26.11.2305 sun shadow gate: on a touch device on WebGPU, shadows are held off at Medium
//   and at High, and the report says why; WebGL 2 (?webgl=1) on the same device keeps them;
//   ?shadows=1 turns them back on; desktop keeps them. Nothing is built in play while held.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/flash-switches.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })

async function open(query, phone = false) {
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(String(error.stack ?? error.message).slice(0, 400)))
  await page.goto(`${base}?autoplay=1&room=flash-switches-${Date.now()}&${query}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
  await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
  await page.waitForTimeout(1500)
  // An automatic start leaves the cursor free. A cursor taken here sends every mouse event to the
  // canvas, and the Test flash control could not be clicked (twice on main, November 2026).
  assert.equal(await page.evaluate(() => document.pointerLockElement?.id ?? null), null, 'an automatic start does not capture the cursor')
  return { page, context, errors }
}
// Test flash. If the click fails, say what is at the button's centre and why, before failing:
// the stack under the point, each ancestor's stacking styles, the top layer and pointer lock.
async function clickTestFlash(page) {
  try { await page.locator('.flash-counter button').click({ timeout: 30000 }) } catch (error) {
    const dump = await page.evaluate(() => {
      const button = document.querySelector('.flash-counter button'), r = button?.getBoundingClientRect()
      const x = r ? r.left + r.width / 2 : 0, y = r ? r.top + r.height / 2 : 0
      const name = e => e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '') : null
      const chain = []
      for (let e = button; e; e = e.parentElement) { const c = getComputedStyle(e); chain.push({ el: name(e), position: c.position, zIndex: c.zIndex, pointerEvents: c.pointerEvents, transform: c.transform, display: c.display, visibility: c.visibility, opacity: c.opacity, hidden: e.hidden }) }
      const canvas = document.getElementById('game'), cc = canvas && getComputedStyle(canvas)
      return {
        point: { x, y }, rect: r && { left: r.left, top: r.top, width: r.width, height: r.height },
        atPoint: document.elementsFromPoint(x, y).map(name),
        chain,
        canvas: cc && { position: cc.position, zIndex: cc.zIndex, pointerEvents: cc.pointerEvents, parent: name(canvas.parentElement) },
        pointerLock: name(document.pointerLockElement), fullscreen: name(document.fullscreenElement),
        modal: [...document.querySelectorAll('dialog[open]')].map(d => name(d) + (d.matches(':modal') ? ' (modal)' : '')),
        popovers: [...document.querySelectorAll(':popover-open')].map(name),
        counters: document.querySelectorAll('.flash-counter').length,
        shell: document.querySelector('.mira-shell')?.className,
      }
    })
    console.log('flash-switches: Test flash click failed; at the button:\n' + JSON.stringify(dump, null, 1))
    throw error
  }
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
    level: game.quality.governor.level, backend: game.backend, coarse: matchMedia('(pointer: coarse)').matches, postTier: game.quality.postTier, samples: game.renderer.samples, chain: !!game.postChain,
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
    const text = await report(page)
    assert.match(text, /^Flash switches: gfx=2$/m)
    assert.match(text, /^Sun shadows: on$/m)
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
    await clickTestFlash(page)
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
    assert.match(text, /^Flash switches: shadows=0, shading=0, post=base, lowrest=1, gfx=2, samples=1, freeze=1, ui=flat, blank=1$/m)
    assert.match(text, /^Sun shadows: off: \?shadows=0$/m)
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
    assert.match(await report(page), /^Flash switches: post=off, gfx=2, ui=flat$/m)
    assert.deepEqual(errors, [])
    await context.close()
  }
  // ---- The sun shadow gate on a touch device (v26.11.2305). ----
  const pipelines = page => page.evaluate(() => window.mira.game.renderer._pipelines?.caches?.size ?? -1)
  const toHigh = async page => {
    await page.evaluate(() => window.mira.game.quality.setLevel(3))
    await page.waitForFunction(() => window.mira.game.quality.governor.level === 3, null, { timeout: 60000 })
    await page.waitForTimeout(1500)
    return state(page)
  }
  {
    const { page, context, errors } = await open('gfx=2&diag=1', true)
    const s = await state(page)
    assert.deepEqual([s.backend, s.coarse, s.level, s.shadow], ['webgpu', true, 2, 0], `phone WebGPU at Medium: shadows held off ${JSON.stringify(s)}`)
    // Held: nothing new is built while playing at the held level.
    const before = await pipelines(page)
    await page.waitForTimeout(4000)
    assert.equal(await pipelines(page), before, 'no pipeline is built in play')
    const high = await toHigh(page)
    assert.deepEqual([high.level, high.shadow], [3, 0], `phone WebGPU at High: shadows held off ${JSON.stringify(high)}`)
    const text = await report(page)
    assert.match(text, /^Sun shadows: off: not yet proven on this device$/m)
    assert.match(text, /^Flash switches: gfx=2, diag=1$/m)
    console.log('flash-switches: phone report\n' + text)
    assert.deepEqual(errors, [])
    console.log('flash-switches: phone WebGPU gate ok', JSON.stringify({ medium: s.shadow, high: high.shadow, pipelines: before }))
    await context.close()
  }
  {
    const { page, context, errors } = await open('gfx=2&webgl=1', true)
    const s = await state(page)
    assert.deepEqual([s.backend, s.coarse, s.level, s.shadow], ['webgl', true, 2, 1], `phone WebGL 2 keeps its shadows ${JSON.stringify(s)}`)
    const text = await report(page)
    assert.match(text, /^Sun shadows: on$/m)
    assert.match(text, /^Flash switches: gfx=2, webgl=1$/m)
    assert.deepEqual(errors, [])
    await context.close()
  }
  {
    const { page, context, errors } = await open('gfx=2&shadows=1', true)
    const s = await state(page)
    assert.deepEqual([s.backend, s.coarse, s.shadow], ['webgpu', true, 1], `?shadows=1 turns phone shadows on ${JSON.stringify(s)}`)
    const high = await toHigh(page)
    assert.equal(high.shadow, 1, `?shadows=1 at High takes High's shadows ${JSON.stringify(high)}`)
    assert.match(await report(page), /^Sun shadows: on: \?shadows=1, though not yet proven on this device$/m)
    assert.deepEqual(errors, [])
    await context.close()
  }
  {
    const { page, context, errors } = await open('gfx=2')
    const high = await toHigh(page)
    assert.deepEqual([high.backend, high.coarse, high.shadow], ['webgpu', false, 1], `desktop High keeps its shadows ${JSON.stringify(high)}`)
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('flash-switches: ok')
} finally {
  await browser.close()
}
