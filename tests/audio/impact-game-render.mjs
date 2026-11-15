// Render the production GameAudio event paths with real Web Audio nodes in Chromium.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const origin = process.argv[2]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  // A minimal document on the dev origin avoids loading the renderer for an audio test.
  await page.route('**/audio-routing-test', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Audio routing test</body></html>' }))
  await page.goto(`${origin}/audio-routing-test`)
  const results = await page.evaluate(async () => {
    const { GameAudio } = await import('/src/audio/index.ts')
    const { CrashWatcher } = await import('/src/audio/Impacts.ts')
    const results = {}
    for (const event of ['contact', 'landing', 'terrain', 'zorb']) {
      const context = new OfflineAudioContext(1, 44100 * 3, 44100)
      // GameAudio only schedules onto running contexts. Offline rendering starts afterward.
      Object.defineProperty(context, 'state', { get: () => 'running' })
      const p = { x: 0, y: 0, z: 0 }, velocity = { x: 20, y: 0, z: 0 }
      const v = { kind: 'tank', zorbed: false, object: { position: p }, body: { isValid: () => true, translation: () => p, linvel: () => velocity }, wheelsGrounded: 4, wingsOpen: false, landedThisStep: false, landingImpact: 15 }
      const audio = Object.assign(Object.create(GameAudio.prototype), {
        context, enabled: true, paused: false, local: v, effects: context.destination,
        terrain: { surfaceAt: () => 'snow' }, crashes: new CrashWatcher(),
        cueStops: new Set(), events: new Map(), remote: new Map(), impactSeed: 0,
      })
      audio.fixedUpdate()
      if (event === 'contact') audio.impact(15)
      if (event === 'landing') v.landedThisStep = true
      if (event === 'zorb') v.zorbed = true
      velocity.x = 0
      audio.fixedUpdate()
      const shots = audio.cueStops.size
      const data = (await context.startRendering()).getChannelData(0)
      let peak = 0, sum = 0
      for (const value of data) { peak = Math.max(peak, Math.abs(value)); sum += value * value }
      results[event] = { shots, remaining: audio.cueStops.size, peak, rms: Math.sqrt(sum / data.length) }
    }
    return results
  })
  for (const event of ['contact', 'landing', 'terrain']) {
    assert.equal(results[event].shots, 1, event)
    assert.equal(results[event].remaining, 0, `${event} cleanup`)
    assert.ok(results[event].peak > 0.05 && results[event].peak < 1, `${event} audible without clipping`)
  }
  assert.equal(results.zorb.shots, 0)
  assert.equal(results.zorb.peak, 0)
  console.log('Production impact rendering passed', JSON.stringify(results))
} finally { await browser.close() }
