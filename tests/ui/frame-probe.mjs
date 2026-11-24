// ?frameProbe=1 sees what our passes drew (core/frameProbe.ts). Bug caught: a probe that reads
// zero whatever happens, so the owner's phone reports "no black frames" while the screen flashes
// and the search turns to the wrong cause. In normal play at Medium it must read frames, with
// the scene image, and count none bad; a frame cleared to transparent black must be counted as
// a bad output, and a frame drawn with the sun's intensity NaN as a NaN scene and non-finite
// sun values. Checked on desktop and on an emulated touch phone with ?shadows=1 (the link the
// owner opens), where the device gate otherwise holds shadows off. The counter box carries the
// probe's lines and its test control.
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/frame-probe.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { waitForState } from './stateWait.mjs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
async function check(name, query, touch) {
  const page = await browser.newPage(touch ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?autoplay=1&gfx=2&frameProbe=1&frameCanary=1&${query}&room=frame-probe-${Date.now()}`)
  await waitForState(page, 'the world running', () => window.mira?.game?.tick > 60 && window.mira.shell.playing && !window.mira.shell.transitioning, undefined, 180)
  if (await page.evaluate(() => window.mira.game.backend) !== 'webgpu') { console.log(`${name}: skipped, this browser did not start WebGPU`); await page.close(); return }
  await page.evaluate(() => window.mira.params.set('gfx.auto', false))
  await page.waitForTimeout(5000)
  const probe = () => page.evaluate(() => { const p = window.mira.game.frameProbe; return { probed: p.probed, withScene: p.withScene, bad: p.bad, testBad: p.testBad, counts: { ...p.counts }, nonFinite: { ...p.nonFinite }, nonFiniteFrames: p.nonFiniteFrames, shadows: !!window.mira.game.renderer.shadowMap.enabled && window.mira.params.get('gfx.shadowQuality')?.value > 0 } })
  const normal = await probe()
  console.log(`${name}, normal play: ${JSON.stringify(normal)}`)
  assert.ok(normal.probed > 60, 'frames read back')
  assert.ok(normal.withScene > 60, 'the scene image read too (the post chain draws at Medium)')
  assert.equal(normal.shadows, true, 'sun shadows on')
  assert.equal(normal.bad, 0, `no bad frame in normal play: ${JSON.stringify(normal.counts)} ${JSON.stringify(normal.nonFinite)}`)
  // The counter box: the probe's lines and its test control.
  const box = await page.evaluate(() => document.querySelector('.flash-counter')?.textContent ?? '')
  assert.match(box, /Black 0 of \d+\nscene 0  output 0/, box)
  assert.ok(await page.locator('.flash-counter button[aria-label="Test black"]').count(), 'Test black'); assert.ok(await page.locator('.flash-counter button[aria-label="Test drop"]').count(), 'Test drop')
  // A frame cleared to transparent black after it draws: a bad output, counted as a test.
  await page.evaluate(() => [...document.querySelectorAll('.flash-counter button')].find(b => b.getAttribute('aria-label') === 'Test black').click())
  await waitForState(page, 'the black frame counted', () => window.mira.game.frameProbe.testBad === 1, undefined, 20)
  const black = await probe()
  assert.equal(black.counts['output clear'], 1, `the cleared frame (${JSON.stringify(black.counts)})`)
  assert.equal(black.bad, 1, 'only that frame')
  // A frame drawn with the sun's intensity NaN: a NaN scene, and the sun's values not finite.
  await page.evaluate(() => window.mira.game.frameProbe.nanNext())
  await waitForState(page, 'the NaN frame counted', () => window.mira.game.frameProbe.testBad === 2, undefined, 20)
  await page.waitForTimeout(500)
  const nan = await probe()
  console.log(`${name}, after the tests: ${JSON.stringify(nan)}`)
  assert.ok(nan.counts['scene NaN'] >= 1, `a NaN scene counted (${JSON.stringify(nan.counts)})`)
  assert.equal(nan.nonFinite['sun light'], 1, 'the sun light counted as not finite')
  const report = await page.evaluate(() => window.mira.game.frameProbe.reportLines().join('\n'))
  assert.match(report, /Frame probe: \d+ frames read/)
  assert.deepEqual(errors, [])
  console.log(report)
  await page.close()
}
try {
  await check('desktop', '', false)
  await check('touch with ?shadows=1', 'shadows=1', true)
  console.log('ok')
} finally { await browser.close() }
