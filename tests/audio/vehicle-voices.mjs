// Every speed-dependent vehicle voice, alone, across the speed range, rendered offline in real
// Chromium and measured: overall level, level in the 1.5 to 6 kHz band (where hearing is most
// sensitive), the level of the band's strongest narrow component (its peak bin and three bins
// either side, about 18 Hz: a tone puts most of the band there, noise very little) and the
// strongest partials. A report, not a gate.
//
//   tools/heavy.sh node tests/audio/vehicle-voices.mjs http://127.0.0.1:<port> [label]
import { chromium } from 'playwright-core'
import { writeFile, mkdir } from 'node:fs/promises'

const origin = process.argv[2] ?? 'http://127.0.0.1:5188'
const label = process.argv[3] ?? 'run'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`${origin}/score.html`)
  const result = await page.evaluate(async () => {
    const E = await import('/src/audio/Engine.ts')
    const rate = 48000, N = 16384
    const fft = (re, im) => {
      const n = re.length
      for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] } }
      for (let len = 2; len <= n; len <<= 1) {
        const a = -2 * Math.PI / len
        for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
          const c = Math.cos(a * k), s = Math.sin(a * k), xr = re[i + k + len / 2], xi = im[i + k + len / 2]
          const tr = xr * c - xi * s, ti = xr * s + xi * c
          re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti; re[i + k] += tr; im[i + k] += ti
        }
      }
    }
    const db = v => 10 * Math.log10(Math.max(v, 1e-20))
    async function render(kind, voice, motion) {
      const context = new OfflineAudioContext(1, rate * 2, rate)
      const engine = new E.Engine(context, context.destination)
      if (!engine[voice]) return null
      for (const other of ['tone', 'roar', 'dirt', 'wind', 'field', 'squeal', 'scrub']) if (other !== voice && engine[other]) engine[other].disconnect()
      const m = { kind, airborne: false, throttle: 1, ...motion }
      engine.update(m, true)
      const ticks = []
      for (let t = 0.05; t < 1.95; t += 0.05) ticks.push(context.suspend(t).then(() => { engine.update(m, true); return context.resume() }))
      const buffer = await context.startRendering(); await Promise.allSettled(ticks)
      const x = buffer.getChannelData(0).subarray(rate * 2 - N)
      const re = new Float64Array(N), im = new Float64Array(N)
      let rms = 0
      for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); re[i] = x[i] * w; rms += x[i] * x[i] }
      fft(re, im)
      const power = Array.from({ length: N / 2 }, (_, k) => (re[k] ** 2 + im[k] ** 2) / (N * N) * 8 / 3 * 2)
      const hz = k => k * rate / N, lo = Math.ceil(1500 * N / rate), hi = Math.floor(6000 * N / rate)
      let band = 0; for (let k = lo; k <= hi; k++) band += power[k]
      let peakK = lo; for (let k = lo; k <= hi; k++) if (power[k] > power[peakK]) peakK = k
      // Strongest partials anywhere: local maxima, at least 3 bins apart.
      const peaks = []
      for (let k = 3; k < N / 2 - 3; k++) if (power[k] > power[k - 1] && power[k] >= power[k + 1] && power[k] > 1e-12) peaks.push(k)
      peaks.sort((a, b) => power[b] - power[a])
      const top = []; for (const k of peaks) { if (top.every(t => Math.abs(t - k) > 3)) top.push(k); if (top.length === 3) break }
      let narrow = 0; for (let k = peakK - 3; k <= peakK + 3; k++) narrow += power[k]
      return { level: db(rms / N), band: db(band), narrow: db(narrow), bandPeakHz: Math.round(hz(peakK)), partials: top.sort((a, b) => a - b).map(k => Math.round(hz(k))), pitch: Math.round(E.voiceProfile(m).pitch) }
    }
    const out = []
    const speeds = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 105]
    for (const kind of ['buggy-syn3h', 'buggy-classic', 'jet', 'hovercraft', 'tank']) for (const voice of ['tone', 'roar', 'dirt', 'field']) for (const speed of speeds) {
      const r = await render(kind, voice, { speed, wings: voice === 'field', slip: 0, slide: 0 })
      if (r) out.push({ kind, voice, speed, ...r })
    }
    // Slip voices for the buggy: what ordinary fast cornering gives them (wheel slip 5 m/s, body
    // sideways 1 m/s, measured in tests/audio/slip-runs.ts) and a real slide (12 m/s both).
    for (const [name, slip, slide] of [['ordinary', 5, 1], ['slide', 12, 12]]) for (const voice of ['squeal', 'scrub']) for (const speed of speeds) {
      const r = await render('buggy-syn3h', voice, { speed, slip, slide })
      if (r) out.push({ kind: 'buggy-syn3h', voice: `${voice} (${name})`, speed, ...r })
    }
    return out
  })
  await mkdir('tests/audio/artifacts', { recursive: true })
  await writeFile(`tests/audio/artifacts/vehicle-voices-${label}.json`, JSON.stringify(result, null, 1))
  const by = new Map()
  for (const r of result) { const key = `${r.kind} ${r.voice}`; by.set(key, [...(by.get(key) ?? []), r]) }
  for (const [key, rows] of by) {
    const at = s => rows.find(r => r.speed === s)
    const f = (s, k) => at(s) ? at(s)[k].toFixed(0) : '-'
    console.log(`${key.padEnd(32)} band dB @30/60/100: ${f(30, 'band')}/${f(60, 'band')}/${f(100, 'band')}  level @100 ${f(100, 'level')}  band tone @30/60/100 ${f(30, 'narrow')}/${f(60, 'narrow')}/${f(100, 'narrow')} dB (at ${at(100)?.bandPeakHz} Hz)  partials @100 ${at(100)?.partials.join(',')}  model pitch max ${Math.max(...rows.map(r => r.pitch))} Hz`)
  }
} finally {
  await browser.close()
}
