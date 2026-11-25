// The present-side link switches for the iPhone Safari empty frames (src/core/flashSwitches.ts:
// presentLate, frameCap, shadowUpdate), at phone size on WebGPU with sun shadows on at Medium.
// Bug caught: a switch the owner tests on his iPhone that silently does nothing, so a clean or
// flashing result there says nothing. What must stay true:
// - Without them: the canvas texture is taken once per drawn frame and no copy fills it, and both
//   shadow cascades are drawn every frame.
// - ?presentLate=1: the canvas texture is filled by one copy in a submit of its own, the last of
//   the frame, and the game still draws (no magenta behind it with ?canvasBackdrop=1).
// - ?frameCap=30: in play no two drawn frames are less than 30 ms apart.
// - ?shadowUpdate=once: no shadow map pass after the first; =2: about half the frames draw them.
// - Every case: no page error, and no pipeline is built in play.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/present-side-switches.mjs [shot dir]
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })

/** Per drawn frame: when its GPU work started, how many shadow map passes, and the order of submits. */
const record = () => {
  const w = window; w.__frames = []; let frame = null, fresh = false
  // A frame starts at the first GPU call of an animation frame (the canvas texture is not always first).
  const touch = () => { if (fresh) { fresh = false; frame = { at: performance.now(), shadowPasses: 0, submits: [] }; w.__frames.push(frame) } }
  const createView = GPUTexture.prototype.createView
  GPUTexture.prototype.createView = function (...a) { const v = createView.apply(this, a); v.__label = this.label; return v }
  const begin = GPUCommandEncoder.prototype.beginRenderPass
  GPUCommandEncoder.prototype.beginRenderPass = function (d) {
    touch()
    if (frame && d?.colorAttachments?.[0]?.view?.__label?.startsWith('ShadowMap')) frame.shadowPasses++
    return begin.call(this, d)
  }
  const finish = GPUCommandEncoder.prototype.finish
  GPUCommandEncoder.prototype.finish = function (...a) { const b = finish.apply(this, a); b.__label = this.label; return b }
  const submit = GPUQueue.prototype.submit
  GPUQueue.prototype.submit = function (buffers) { touch(); frame?.submits.push(buffers.map(b => b.__label || '?').join('+')); return submit.call(this, buffers) }
  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = cb => raf(t => { fresh = true; cb(t) })
}

async function run(query) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(String(error.message).slice(0, 300)))
  await page.addInitScript(record)
  await page.goto(`${base}?autoplay=1&gfx=2&shadows=1&freeze=1&canvasBackdrop=1&room=present-switches-${Date.now()}${query ? '&' + query : ''}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
  await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
  await page.waitForTimeout(2000)
  const pipelines = () => page.evaluate(() => window.mira.game.renderer._pipelines?.caches?.size ?? -1)
  const before = await pipelines()
  await page.evaluate(() => { window.__frames.length = 0 })
  await page.waitForTimeout(3000)
  // Complete frames only: the last may still be drawing.
  const frames = (await page.evaluate(() => window.__frames.slice(0, -1).map(f => ({ at: f.at, shadowPasses: f.shadowPasses, submits: f.submits }))))
  const after = await pipelines()
  const shadows = await page.evaluate(() => window.mira.game.renderer.shadowMap.enabled)
  if (out) await page.screenshot({ path: `${out}/phone-${query.replaceAll(/[&=]/g, '_') || 'default'}.png` })
  await context.close()
  const gaps = frames.slice(1).map((f, i) => f.at - frames[i].at)
  return { query, frames: frames.length, minGapMs: Math.round(Math.min(...gaps)), withShadowPasses: frames.filter(f => f.shadowPasses > 0).length,
    shadowPassesPerFrame: Math.max(...frames.map(f => f.shadowPasses)), lastSubmit: [...new Set(frames.map(f => f.submits.at(-1)))], copies: frames.filter(f => f.submits.includes('presentLate copy')).length,
    pipelinesBuilt: after - before, shadows, errors }
}

try {
  const plain = await run('')
  console.log(JSON.stringify(plain))
  assert.ok(plain.frames > 10 && plain.shadows, 'the default draws, with shadows')
  assert.equal(plain.copies, 0, 'no copy by default')
  assert.equal(plain.withShadowPasses, plain.frames, 'shadows drawn every frame by default')
  assert.ok(plain.shadowPassesPerFrame >= 2, 'both Medium cascades drawn')

  const late = await run('presentLate=1')
  console.log(JSON.stringify(late))
  assert.ok(late.frames > 10, 'presentLate draws')
  assert.equal(late.copies, late.frames, 'every frame is filled by one copy')
  assert.deepEqual(late.lastSubmit, ['presentLate copy'], 'the copy is the last submit of each frame')

  const capped = await run('frameCap=30')
  console.log(JSON.stringify(capped))
  assert.ok(capped.frames > 10, 'frameCap draws')
  assert.ok(capped.minGapMs >= 29, `no two frames under 30 ms apart (${capped.minGapMs})`)

  const once = await run('shadowUpdate=once')
  console.log(JSON.stringify(once))
  assert.ok(once.frames > 10 && once.shadows, 'shadowUpdate=once draws, shadows on')
  assert.equal(once.withShadowPasses, 0, 'no shadow map pass in play')

  const every2 = await run('shadowUpdate=2')
  console.log(JSON.stringify(every2))
  const share = every2.withShadowPasses / every2.frames
  assert.ok(share > 0.35 && share < 0.65, `about half the frames draw shadow maps (${share.toFixed(2)})`)

  for (const r of [plain, late, capped, once, every2]) {
    assert.deepEqual(r.errors, [], `${r.query || 'default'}: no page error`)
    assert.equal(r.pipelinesBuilt, 0, `${r.query || 'default'}: no pipeline built in play`)
  }
  console.log('present-side-switches: ok')
} finally { await browser.close() }
