/** Offline audio acceptance and an audition artifact. Run through the shared heavy queue. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const base = process.env.SYN3H_URL
assert.ok(base, 'SYN3H_URL is required')
const out = process.env.SYN3H_OUT ?? '/tmp/syn3h-gear-audio'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  await page.goto(base)
  const result = await page.evaluate(async () => {
    const { synthCue } = await import('/src/audio/Cues.ts')
    const { noiseBuffer } = await import('/src/audio/Engine.ts')
    const names = ['yoinkGrab', 'yoinkFling', 'yoinkGust', 'bigRedCharge', 'bigRedReady', 'bigRedFizzle', 'pesterLaunch', 'pesterCatch', 'thunderFire']
    const rate = 22050, reports = [], pcm = []
    for (const name of names) {
      const context = new OfflineAudioContext(1, rate * 2, rate)
      let ended = 0
      const stop = synthCue(context, context.destination, name, noiseBuffer(context), () => { ended++ })
      const buffer = await context.startRendering()
      await new Promise(resolve => setTimeout(resolve, 0))
      const data = buffer.getChannelData(0)
      let peak = 0, sum = 0, tail = 0
      for (let i = 0; i < data.length; i++) {
        const x = data[i]
        peak = Math.max(peak, Math.abs(x)); sum += x * x
        if (i > rate) tail = Math.max(tail, Math.abs(x))
        pcm.push(Math.round(Math.max(-1, Math.min(1, x)) * 32767))
      }
      stop(); stop()
      reports.push({ name, peak, rms: Math.sqrt(sum / data.length), tail, ended })
    }
    return { rate, reports, pcm }
  })
  for (const r of result.reports) {
    assert.ok(Number.isFinite(r.rms) && r.rms > .001, `${r.name} is audible and finite`)
    assert.ok(r.peak < 1, `${r.name} does not clip`)
    assert.ok(r.tail < .00001, `${r.name} stops before the next cue`)
    assert.equal(r.ended, 1, `${r.name} cleans up exactly once`)
  }
  const wav = Buffer.alloc(44 + result.pcm.length * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(result.rate, 24); wav.writeUInt32LE(result.rate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  result.pcm.forEach((x, i) => wav.writeInt16LE(x, 44 + i * 2))
  await writeFile(`${out}/gear-cues.wav`, wav)
  await writeFile(`${out}/levels.json`, JSON.stringify(result.reports, null, 2))
  console.log(JSON.stringify(result.reports))
  console.log('GEAR AUDIO OK')
} finally { await browser.close() }
