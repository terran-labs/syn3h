// Measures how the adaptive score builds over minutes, in real Chromium, offline: for the lobby
// and for play by day and by night, the theremin lead's level against the whole mix, how much
// of the time it sounds, when the mix reaches its fullest layer count, and the mix's peak and
// loudness. A report, not a gate: the invariants live in tests/audio/score.test.ts.
//
//   SYN3H_ROOM_PORT=<spare> npx vite --host 127.0.0.1 --port <spare> --strictPort &
//   tools/heavy.sh node tests/audio/score-build.mjs http://127.0.0.1:<spare> [seconds] [label]
//
// Each state renders twice with the same seed: the full mix, then the lead alone (every other
// layer trimmed to zero). The score is deterministic, so the two runs play the same notes and
// the ratio of their window loudness is the lead's level in the mix. The bus compressor works
// a little harder on the full mix, so the ratio errs by a dB or two toward the lead.
import { chromium } from 'playwright-core'
import { writeFile, mkdir } from 'node:fs/promises'

const origin = process.argv[2] ?? 'http://127.0.0.1:5188'
const seconds = Number(process.argv[3] ?? 480)
const label = process.argv[4] ?? 'run'
const states = [
  { name: 'lobby', playing: false, hour: 16.5 },
  { name: 'world day', playing: true, hour: 13 },
  { name: 'world night', playing: true, hour: 23.5 },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const out = {}
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`${origin}/score.html`)
  for (const state of states) {
    const run = solo => page.evaluate(async ([state, seconds, solo]) => {
      await import('/src/world/sky/skyParams.ts')
      const { Score } = await import('/src/audio/score/Score.ts')
      const { LAYERS } = await import('/src/audio/score/ScoreSynth.ts')
      const { params } = await import('/shared/params.ts')
      params.set('sun.timeOfDay', state.hour)
      const rate = 24000, context = new OfflineAudioContext(2, rate * seconds, rate)
      const score = new Score(context, context.destination, 1234)
      await score.synth.ready
      if (solo) {
        for (const layer of LAYERS) score.synth.trim[layer] = layer === 'theremin' ? 1 : 0
        // One-shots outside the layer trims: the telemetry beep, the riser, the drop and crash, the brass hit, the endless rise.
        for (const node of [score.synth.beepVca, score.synth.riserVca, score.synth.crashVca, score.synth.boomVca, score.synth.braamVca, score.synth.riseBus]) node?.disconnect()
      }
      const WINDOW = 5, windows = Math.floor(seconds / WINDOW)
      const seen = Array.from({ length: windows }, () => new Set()), leadOn = new Array(windows).fill(0), ticks = new Array(windows).fill(0), roles = new Array(windows).fill('')
      const synth = score.synth, play = synth.play.bind(synth)
      // Note layers, as the composer writes them; held layers (pad, drone, air) are always there.
      synth.play = (step, time, duration) => {
        const w = Math.min(windows - 1, Math.floor(time / WINDOW))
        for (const key of ['arp', 'bass', 'kick', 'snare', 'hat', 'pluck', 'bell', 'strings', 'brass', 'lead', 'riser', 'beep']) if (step[key] !== undefined) seen[w].add(key)
        if (step.chord) seen[w].add('pad')
        play(step, time, duration)
      }
      const input = { playing: state.playing, speed: state.playing ? 24 : 0, throttle: state.playing ? 0.6 : 0, airborne: false, clearance: 0, altitude: 20, submerged: 0, lava: 0 }
      const tick = () => {
        score.update(input)
        const t = context.currentTime, w = Math.min(windows - 1, Math.floor(t / WINDOW))
        // The lead is sounding when its note gate and its bus are both open.
        const lead = synth.leadVca.gain.value * synth.leadBus.gain.value
        ticks[w]++; if (lead > 0.004) leadOn[w]++
        roles[w] = score.role
      }
      score.setActive(true, 2)
      tick()
      const pending = []
      for (let n = 1; n * 0.1 < seconds - 0.2; n++) pending.push(context.suspend(n * 0.1).then(() => { tick(); return context.resume() }))
      const buffer = await context.startRendering(); await Promise.allSettled(pending)
      const left = buffer.getChannelData(0), right = buffer.getChannelData(1)
      let bad = 0, peak = 0
      const rms = []
      for (let w = 0; w < windows; w++) {
        let sum = 0
        for (let i = w * WINDOW * rate; i < (w + 1) * WINDOW * rate; i++) {
          const l = left[i], r = right[i]
          if (!Number.isFinite(l) || !Number.isFinite(r)) { bad++; continue }
          peak = Math.max(peak, Math.abs(l), Math.abs(r)); sum += ((l + r) / 2) ** 2
        }
        rms.push(Math.sqrt(sum / (WINDOW * rate)))
      }
      return { rms, peak, bad, layers: seen.map(s => s.size + 2), leadOn: leadOn.map((n, w) => n / Math.max(1, ticks[w])), roles }
    }, [state, seconds, solo])
    const full = await run(false), lead = await run(true)
    const db = v => 20 * Math.log10(Math.max(v, 1e-9))
    const rel = full.rms.map((v, w) => db(lead.rms[w]) - db(v))
    const max = Math.max(...full.layers), reach = full.layers.findIndex(n => n === max) * 5
    const sounding = full.leadOn.reduce((a, b) => a + b, 0) / full.leadOn.length
    const audible = rel.filter((_, w) => full.leadOn[w] > 0.1)
    const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : -Infinity }
    const loud = full.rms.slice(2).reduce((a, b) => a + b * b, 0) / (full.rms.length - 2)
    const firstLead = full.leadOn.findIndex(v => v > 0.1)
    const summary = {
      leadMedianDb: median(audible), leadMaxDb: Math.max(...rel), leadSoundingShare: sounding, firstLeadAt: firstLead < 0 ? null : firstLead * 5,
      fullestLayers: max, fullestAt: reach, peak: full.peak, loudnessDb: 10 * Math.log10(loud), bad: full.bad + lead.bad,
      firstMinuteDb: db(Math.sqrt(full.rms.slice(1, 12).reduce((a, b) => a + b * b, 0) / 11)),
    }
    out[state.name] = { summary, timeline: full.rms.map((v, w) => ({ t: w * 5, db: +db(v).toFixed(1), leadDb: +rel[w].toFixed(1), leadOn: +full.leadOn[w].toFixed(2), layers: full.layers[w], role: full.roles[w] })) }
    console.log(state.name.padEnd(12), JSON.stringify(summary, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v))
  }
  await mkdir('tests/audio/artifacts', { recursive: true })
  await writeFile(`tests/audio/artifacts/score-build-${label}.json`, JSON.stringify(out, null, 1))
  if (errors.length) { console.error(errors); process.exitCode = 1 }
} finally {
  await browser.close()
}
