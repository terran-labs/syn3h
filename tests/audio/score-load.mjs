// Measures what the adaptive score costs the audio thread, full and lighter tier, in real
// Chrome playing in real time, at 1x, 4x and 6x CPU throttle. Reports the browser's own
// figures (AudioContext.renderCapacity: share of real time spent rendering, and underruns)
// and the offline render speed of the busiest passage.
//   node tests/audio/score-load.mjs [http://127.0.0.1:5188]
import { chromium } from 'playwright-core'

const origin = process.argv[2] ?? 'http://127.0.0.1:5188'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-experimental-web-platform-features'] })
try {
  const rows = []
  for (const lite of [false, true]) for (const throttle of [1, 4, 6]) {
    const page = await browser.newPage(), cdp = await page.context().newCDPSession(page)
    await page.goto(`${origin}/score.html`)
    await page.waitForSelector('#power')
    if (lite) await page.check('#lite')
    await page.click('#power'); await page.click('[data-scene="Tag chase"]')
    await page.waitForTimeout(1500)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
    await page.click('#surge')
    // The busiest passage: a chase, a surge, then the release with every instrument in.
    const result = await page.evaluate(async () => {
      const capacity = scoreLab.context.renderCapacity, samples = []
      if (!capacity) {
        // Older route: frames the output device was left without.
        const stats = scoreLab.context.playbackStats
        if (!stats) return { supported: false }
        const before = { frames: stats.totalFrames ?? stats.totalDuration, under: stats.underrunFrames ?? stats.fallbackFramesDuration ?? stats.underrunDuration, events: stats.underrunEvents ?? stats.fallbackFramesEvents }
        await new Promise(resolve => setTimeout(resolve, 16000))
        const after = { frames: stats.totalFrames ?? stats.totalDuration, under: stats.underrunFrames ?? stats.fallbackFramesDuration ?? stats.underrunDuration, events: stats.underrunEvents ?? stats.fallbackFramesEvents }
        return { supported: 'playbackStats', underruns: (after.under - before.under) / Math.max(1e-9, after.frames - before.frames), underrunEvents: after.events - before.events, lite: scoreLab.score.synth.lite, nodes: scoreLab.score.synth.nodeCount, section: scoreLab.score.role }
      }
      capacity.addEventListener('update', e => samples.push({ average: e.averageLoad, peak: e.peakLoad, underruns: e.underrunRatio }))
      capacity.start({ updateInterval: 1 })
      await new Promise(resolve => setTimeout(resolve, 16000))
      const max = key => Math.max(...samples.map(s => s[key])), mean = key => samples.reduce((a, s) => a + s[key], 0) / samples.length
      return { supported: true, readings: samples.length, average: mean('average'), worstAverage: max('average'), peak: max('peak'), underruns: max('underruns'), lite: scoreLab.score.synth.lite, nodes: scoreLab.score.synth.nodeCount, section: scoreLab.score.role }
    })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    rows.push({ tier: lite ? 'lighter' : 'full', throttle, ...result })
    console.log(JSON.stringify(rows.at(-1)))
    await page.close()
  }
  const page = await browser.newPage()
  await page.goto(`${origin}/score.html`)
  // Pure signal-processing cost, with no game or scheduling in the way: 30 s of a release in
  // a full chase (every instrument sounding), scheduled up front and rendered flat out.
  for (const lite of [false, true]) {
    const r = await page.evaluate(async lite => {
      const { Composer, levels } = await import('/src/audio/score/Composer.ts'), { ScoreSynth } = await import('/src/audio/score/ScoreSynth.ts')
      const seconds = 30, context = new OfflineAudioContext(2, 44100 * seconds, 44100), synth = new ScoreSynth(context, context.destination, lite)
      await synth.ready
      const mood = { intensity: 0.95, lift: 0.6, darkness: 0.9, triumph: 0.5 }
      synth.setLevel(1, 0.1); synth.setLevels(levels(mood), 0, 0.9, { tension: 1, release: 1 })
      const composer = new Composer(1234); composer.cue('release')
      // Scheduled one second at a time, as play does, so no parameter carries a 30 s backlog of events.
      let t = 0.1
      const d = 15 / 100, fill = until => { while (t < until) { synth.play(composer.step(mood), t, d); t += d } }
      fill(1.3)
      for (let second = 1; second < seconds - 1; second++) context.suspend(second).then(() => { fill(second + 1.3); return context.resume() })
      await new Promise(resolve => setTimeout(resolve, 100))
      const started = performance.now(), buffer = await context.startRendering(), ms = performance.now() - started
      let peak = 0; for (const v of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(v))
      return { ms, share: ms / (seconds * 1000), nodes: synth.nodeCount, peak }
    }, lite)
    console.log(`${lite ? 'lighter' : 'full   '} tier: ${r.nodes} nodes, 30 s renders in ${Math.round(r.ms)} ms = ${(r.share * 100).toFixed(1)}% of one core here; at 4x slower ${(r.share * 400).toFixed(0)}%, at 6x slower ${(r.share * 600).toFixed(0)}%  (peak ${r.peak.toFixed(2)})`)
  }
} finally { await browser.close() }
