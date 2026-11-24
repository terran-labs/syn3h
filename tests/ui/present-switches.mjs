// The presentation switches do what they say (core/flashSwitches.ts). Bug caught: a switch the
// owner opens on his phone to test how the frame reaches the screen that changes nothing, so his
// answer means nothing. ?canvasAlpha=opaque configures the canvas opaque (premultiplied without
// it); ?presentHold=1 draws no frame while the previous frame's GPU work is unfinished and keeps
// drawing otherwise; ?canvasBackdrop=1 puts magenta behind the canvas in play, which every frame
// we draw covers.
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/present-switches.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { waitForState } from './stateWait.mjs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    const configure = GPUCanvasContext.prototype.configure
    GPUCanvasContext.prototype.configure = function (c) { if (this.canvas.id === 'game') window.__alphaMode = c.alphaMode; return configure.call(this, c) }
  })
  await page.goto(`${base}?autoplay=1&gfx=2&${query}&room=present-${Date.now()}`)
  await waitForState(page, 'the world running', () => window.mira?.game?.tick > 60 && window.mira.shell.playing && !window.mira.shell.transitioning, undefined, 180)
  return { page, errors }
}
// Drawn frames, counted from Game's own record of the last draw (Game.step sets lastDraw on each).
async function countDraws(page, ms) {
  return page.evaluate(ms => new Promise(resolve => {
    const g = window.mira.game; let n = 0, last = g.lastDraw; const end = performance.now() + ms
    const tick = () => { if (g.lastDraw !== last) { n++; last = g.lastDraw } if (performance.now() < end) requestAnimationFrame(tick); else resolve(n) }
    tick()
  }), ms)
}
try {
  {
    const { page, errors } = await open('')
    if (await page.evaluate(() => window.mira.game.backend) !== 'webgpu') { console.log('skipped: this browser did not start WebGPU'); process.exit(0) }
    assert.equal(await page.evaluate(() => window.__alphaMode), 'premultiplied', 'the canvas is premultiplied without the switch')
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-flash-backdrop')), false)
    console.log(`without ?presentHold: ${await countDraws(page, 2000)} frames in 2 s`)
    assert.deepEqual(errors, [])
    await page.close()
  }
  {
    const { page, errors } = await open('canvasAlpha=opaque&presentHold=1&canvasBackdrop=1')
    assert.equal(await page.evaluate(() => window.__alphaMode), 'opaque', '?canvasAlpha=opaque')
    // ?presentHold=1: the game keeps drawing; while the GPU is held busy no frame is drawn.
    const free = await countDraws(page, 2000)
    assert.ok(free > 10, `frames keep being drawn (${free} in 2 s)`)
    // GPU work that does not finish for a second: the queue's completion never arrives. At most the
    // frame already under way draws; after it, none until the work is done.
    const held = await page.evaluate(async () => {
      const g = window.mira.game, q = g.renderer.backend.device.queue, done = q.onSubmittedWorkDone
      let release; const gate = new Promise(r => { release = r })
      q.onSubmittedWorkDone = () => gate.then(() => done.call(q))
      const skipped = g.presentHeldFrames
      let draws = 0, last = g.lastDraw
      const end = performance.now() + 1000
      await new Promise(resolve => { const tick = () => { if (g.lastDraw !== last) { draws++; last = g.lastDraw } if (performance.now() < end) requestAnimationFrame(tick); else resolve() }; tick() })
      q.onSubmittedWorkDone = done; release()
      return { during: draws, skipped: g.presentHeldFrames - skipped }
    })
    assert.ok(held.during <= 1, `no frame drawn while the previous frame's work runs (${held.during})`)
    assert.ok(held.skipped > 10, `the held frames counted (${held.skipped})`)
    assert.ok(await countDraws(page, 1000) > 5, 'drawing resumes')
    // ?canvasBackdrop=1: magenta behind the canvas in play, and no magenta through a drawn frame.
    await waitForState(page, 'the backdrop on', () => document.documentElement.hasAttribute('data-flash-backdrop'), undefined, 5)
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 0, 255)')
    const shot = await page.screenshot({ clip: { x: 0, y: 200, width: 1280, height: 300 } })
    const magenta = await page.evaluate(async b64 => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
      const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, img.width, img.height).data; let n = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] < 16 && d[i + 2] > 240) n++
      return n
    }, shot.toString('base64'))
    assert.equal(magenta, 0, 'every drawn frame covers the backdrop')
    const report = await page.evaluate(() => window.mira.game.presentHeldFrames)
    console.log(`opaque canvas; ${free} frames in 2 s with presentHold; ${held.skipped} held while busy (total ${report}); backdrop magenta and covered`)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('ok')
} finally { await browser.close() }
