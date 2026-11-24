// Quality changes and arriving vehicles do not pile up work in the renderer (core/retire.ts). Bug
// caught: the game slows or dies after many quality changes. Every mesh a rebuild drops kept its
// three render object and uniform buffer for the life of the page, about 170 per quality cycle at
// phone size and about 8 per arriving vehicle, without a ceiling, on exactly the phones that step
// quality most. After the first cycle has built everything once, more cycles and more arrivals
// must leave the counts where they were, within a small fixed slack (an object first drawn late,
// such as a bot's vehicle). The counts are three's own: its live render objects, and the uniform
// buffers it reports (renderer.info.memory, as the loss record keeps them). Bots arrive in kinds
// chosen at random, and a kind seen for the first time is warmed in the showroom and kept on
// purpose (one set per kind, so its pipelines are not rebuilt in play): arrivals are measured
// on the render objects outside that warm-up.
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/render-object-leak.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { waitForState } from './stateWait.mjs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const CYCLES = 4, ARRIVALS = 5
// Far below one leaking quality cycle (about 170); five leaking rounds of two arriving bots, about 80.
const SLACK = 40
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?autoplay=1&gfx=2&room=ro-leak-${Date.now()}`)
  await waitForState(page, 'the world running', () => window.mira?.game?.tick > 60 && window.mira.shell.playing, undefined, 180)
  if (await page.evaluate(() => window.mira.game.backend) !== 'webgpu') { console.log('skipped: this browser did not start WebGPU'); process.exit(0) }
  await page.evaluate(() => window.mira.params.set('gfx.auto', false))
  const counts = () => page.evaluate(() => {
    const r = window.mira.game.renderer
    let warm = 0
    for (const ro of r._objects._renderObjects) { let o = ro.object; while (o && o.name !== 'Showroom warm') o = o.parent; if (o) warm++ }
    return { renderObjects: r._objects._renderObjects.size, outsideWarmUp: r._objects._renderObjects.size - warm, uniformBuffers: r.info.memory.uniformBuffers }
  })
  const cycle = async () => {
    for (const q of [1, 0, 1, 2, 3, 2]) { await page.evaluate(q => window.mira.params.set('gfx.quality', q), q); await page.waitForTimeout(1500) }
    await page.waitForTimeout(1000)
  }
  const bots = async n => {
    await page.evaluate(n => { const p = window.mira.params; if (p.get('bots.keepCount')) p.set('bots.keepCount', true); p.set('bots.count', n) }, n)
    await waitForState(page, `${n} bots`, n => window.mira.bots.vehicles.length === n, n, 90)
    await page.waitForTimeout(3000)
  }
  // Quality cycles, no bots: every level built once, then more cycles.
  await cycle()
  const first = await counts()
  for (let i = 0; i < CYCLES; i++) await cycle()
  const cycled = await counts()
  console.log(`after the first cycle: ${JSON.stringify(first)}; after ${CYCLES} more: ${JSON.stringify(cycled)}`)
  assert.ok(cycled.renderObjects <= first.renderObjects + SLACK, `render objects grew from ${first.renderObjects} to ${cycled.renderObjects}`)
  assert.ok(cycled.uniformBuffers <= first.uniformBuffers + SLACK, `uniform buffers grew from ${first.uniformBuffers} to ${cycled.uniformBuffers}`)
  // Bots arriving and leaving: one round to build them, then more.
  await bots(2); await bots(0)
  const arrived = await counts()
  for (let i = 0; i < ARRIVALS; i++) { await bots(2); await bots(0) }
  const last = await counts()
  console.log(`after one arrival round: ${JSON.stringify(arrived)}; after ${ARRIVALS} more: ${JSON.stringify(last)}`)
  assert.ok(last.outsideWarmUp <= arrived.outsideWarmUp + SLACK, `render objects outside the showroom warm-up grew from ${arrived.outsideWarmUp} to ${last.outsideWarmUp}`)
  assert.deepEqual(errors, [])
  console.log('ok')
} finally { await browser.close() }
