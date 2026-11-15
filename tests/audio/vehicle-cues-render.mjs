import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/vehicle-audio-test', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Vehicle audio test</body></html>' }))
  await page.goto(`${process.argv[2]}/vehicle-audio-test`)
  const results = await page.evaluate(async () => {
    const { synthMaterialize, synthZorbPulse } = await import('/src/audio/VehicleCues.ts')
    const { noiseBuffer } = await import('/src/audio/Engine.ts')
    const result = {}
    for (const [name, at, cancel] of [['normal', 1, false], ['long', 2.5, false], ['early', .05, false], ['cancel', .5, true]]) {
      const rate = 44100, context = new OfflineAudioContext(1, rate * 4, rate)
      let ended = 0
      const voice = synthMaterialize(context, context.destination, noiseBuffer(context), () => ended++)
      const pause = context.suspend(at)
      const rendered = context.startRendering()
      await pause
      const actionAt = context.currentTime
      if (cancel) { voice.stop(); voice.stop(); voice.release() } else { voice.release(); voice.release() }
      await context.resume()
      const data = (await rendered).getChannelData(0)
      const rms = (a, b) => {
        let sum = 0; const from = Math.floor(a * rate), to = Math.floor(b * rate)
        for (let i = from; i < to; i++) sum += data[i] ** 2
        return Math.sqrt(sum / (to - from))
      }
      let peak = 0, invalid = 0
      for (const value of data) { peak = Math.max(peak, Math.abs(value)); if (!Number.isFinite(value)) invalid++ }
      result[name] = { peak, invalid, ended, gather: rms(0, .025), held: rms(.25, .45), release: rms(actionAt, actionAt + .15), tail: rms(actionAt + .7, 3.9) }
    }
    const pulseContext = new OfflineAudioContext(1, 44100, 44100)
    let pulseEnded = 0
    synthZorbPulse(pulseContext, pulseContext.destination, () => pulseEnded++)
    const pulse = (await pulseContext.startRendering()).getChannelData(0)
    let peak = 0, tail = 0
    for (let i = 0; i < pulse.length; i++) {
      peak = Math.max(peak, Math.abs(pulse[i]))
      if (i > .45 * 44100) tail = Math.max(tail, Math.abs(pulse[i]))
    }
    result.pulse = { peak, tail, ended: pulseEnded, invalid: pulse.some(v => !Number.isFinite(v)) ? 1 : 0 }
    return result
  })
  for (const [name, r] of Object.entries(results)) {
    assert.equal(r.invalid, 0, name); assert.equal(r.ended, 1, `${name} cleanup once`)
    assert.ok(r.peak > .05 && r.peak < .9, `${name} audible without clipping`)
    assert.equal(r.tail, 0, `${name} no lingering sound`)
  }
  for (const name of ['normal', 'long']) {
    assert.ok(results[name].held > .015, `${name} held shimmer`)
    assert.ok(results[name].held > results[name].gather * 2, `${name} gathers`)
    assert.ok(results[name].release > results[name].held, `${name} audible drop`)
  }
  assert.equal(results.cancel.release, 0, 'cancel must not play a drop')
  console.log('Vehicle switch render PASS', JSON.stringify(results))
} finally { await browser.close() }
