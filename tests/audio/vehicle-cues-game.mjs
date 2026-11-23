// Run only on a candidate with the Materialize cancel seam and main.ts audio bindings.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${process.argv[2]}/?autoplay=1&vehicle=buggy`)
  await page.waitForFunction(() => window.mira?.game.tick > 15, null, { timeout: 120000 })
  // Autoplay has no trusted gesture. Let its unsuccessful unlock finish, then use a
  // real key: the first canvas click is consumed by cursor capture before window handlers.
  await page.waitForFunction(() => !mira.audio.unlocking, null, { timeout: 30000 })
  await page.mouse.click(10, 10)
  await page.keyboard.press('KeyH')
  await page.waitForFunction(() => mira.audio.state === 'running', null, { timeout: 30000 }).catch(async error => {
    console.log('Unlock failure', await page.evaluate(() => ({ state: mira.audio.state, paused: mira.audio.isPaused, enabled: mira.audio.enabled, pending: mira.audio.pending?.state, errors: mira.audio.errors, cost: mira.audio.unlockCost, tick: mira.game.tick })))
    throw error
  })
  await page.evaluate(() => {
    const { audio, params } = mira
    params.set('bots.count', 0)
    window.vehicleSoundEvents = []
    const original = audio.materialize.bind(audio)
    audio.materialize = (cue, p, v) => {
      original(cue, p, v)
      vehicleSoundEvents.push({ cue, kind: v.kind, voices: audio.materializing.size, at: performance.now() })
    }
    window.hopSoundEvents = 0
    const hop = audio.zorbPulse.bind(audio)
    audio.zorbPulse = p => { hopSoundEvents++; hop(p) }
    mira.swapVehicle('tank')
  })
  await page.waitForFunction(() => vehicleSoundEvents.some(e => e.cue === 'materializeRelease'), null, { timeout: 60000 })
  await page.waitForFunction(() => mira.audio.materializing.size === 0)
  const normal = await page.evaluate(() => vehicleSoundEvents.splice(0))
  assert.deepEqual(normal.map(e => e.cue), ['materializeStart', 'materializeRelease'])
  assert.equal(normal[0].voices, 1)
  await page.evaluate(() => { mira.swapVehicle('hovercraft'); mira.swapVehicle('buggy') })
  await page.waitForFunction(() => vehicleSoundEvents.some(e => e.cue === 'materializeRelease'), null, { timeout: 60000 })
  const interrupted = await page.evaluate(() => vehicleSoundEvents.splice(0))
  assert.deepEqual(interrupted.map(e => e.cue), ['materializeStart', 'materializeCancel', 'materializeStart', 'materializeRelease'])
  assert.equal(interrupted[1].voices, 0, 'cancel removes the held voice before replacement')
  await page.waitForFunction(() => mira.audio.materializing.size === 0)
  // Permit an air hop so the event check does not depend on the selected terrain's slope.
  await page.evaluate(() => mira.params.set('zorb.airHops', true))
  await page.keyboard.press('KeyX')
  await page.waitForFunction(() => mira.player.zorb.radius >= mira.player.zorb.target * .5 && mira.player.zorbed, null, { timeout: 30000 })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => hopSoundEvents === 1, null, { timeout: 30000 })
  const hops = await page.evaluate(() => ({ sounds: hopSoundEvents, hops: mira.player.zorb.hops }))
  assert.equal(hops.hops, 1)
  await page.waitForTimeout(700)
  assert.equal(await page.evaluate(() => mira.audio.cueStops.size), 0, 'all switch and hop sources cleaned up')
  assert.deepEqual(errors, [])
  console.log('Actual switch and hop events PASS', JSON.stringify({ normal, interrupted, hops }))
} finally { await browser.close() }
