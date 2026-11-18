// Renders the lobby's music offline, 30 s of the lobby at rest and 30 s of the opening (the
// Big Bang's swell and drop as a tap begins it, then the lobby), to WAV files, with a summary of
// each: loudness, where the energy sits in the spectrum, and how many bright attacks it has (plucks, strikes).
// Generated audio only: the score is synthesised by src/audio/score in real Chromium.
//
//   (a dev server of this worktree)  node tools/lobby-audio-render.mjs http://127.0.0.1:<port>/ <out dir> <label>
// Writes <out dir>/<label>-lobby.wav, <label>-opening.wav and <label>-summary.json.
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const origin = (process.argv[2] ?? 'http://127.0.0.1:5188').replace(/\/+$/, '')
const out = process.argv[3] ?? '/tmp/lobby-drama/audio'
const label = process.argv[4] ?? 'render'
const SECONDS = 30, RATE = 44100, START = 0.5
await mkdir(out, { recursive: true })

/** In-place radix-2 FFT of real data, returning magnitudes up to Nyquist. */
function spectrum(x) {
  const n = x.length, re = Float64Array.from(x), im = new Float64Array(n)
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]] } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
  return Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]))
}
const dB = power => +(10 * Math.log10(power + 1e-20)).toFixed(1)

/** Loudness, spectrum bands and sharp attacks of a mono signal. */
function summarise(mono, rate) {
  let square = 0, peak = 0
  for (const v of mono) { square += v * v; peak = Math.max(peak, Math.abs(v)) }
  const rms = Math.sqrt(square / mono.length)
  // Spectrum: average of 4096-point frames, in octave bands, and the centroid.
  const N = 4096, bands = [[20, 125], [125, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]]
  const energy = new Array(bands.length).fill(0)
  let weighted = 0, total = 0
  const window = Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)))
  for (let at = 0; at + N <= mono.length; at += N) {
    const mags = spectrum(Array.from({ length: N }, (_, i) => mono[at + i] * window[i]))
    mags.forEach((m, k) => {
      const hz = k * rate / N, p = m * m
      weighted += hz * p; total += p
      const b = bands.findIndex(([lo, hi]) => hz >= lo && hz < hi); if (b >= 0) energy[b] += p
    })
  }
  const bandTotal = energy.reduce((a, b) => a + b, 0)
  // Bright attacks (plucks, strikes): 1024-sample frames whose energy between 1 and 8 kHz jumps
  // more than 6 dB above the four frames before it, and is no more than 40 dB under the loudest.
  const F = 1024, hann = Array.from({ length: F }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (F - 1))), upper = []
  for (let at = 0; at + F <= mono.length; at += F / 2) {
    const mags = spectrum(Array.from({ length: F }, (_, i) => mono[at + i] * hann[i]))
    let e = 0; mags.forEach((m, k) => { const hz = k * rate / F; if (hz >= 1000 && hz < 8000) e += m * m }); upper.push(e)
  }
  const loudest = Math.max(...upper)
  const jump = i => i >= 4 && upper[i] > loudest * 1e-4 && upper[i] > 4 * (upper[i - 1] + upper[i - 2] + upper[i - 3] + upper[i - 4]) / 4
  let attacks = 0
  for (let i = 4; i < upper.length; i++) if (jump(i) && !jump(i - 1)) attacks++
  return {
    rmsDb: dB(rms * rms), peakDb: dB(peak * peak), crestDb: +(dB(peak * peak) - dB(rms * rms)).toFixed(1),
    centroidHz: Math.round(weighted / total),
    bandsPercent: Object.fromEntries(bands.map(([lo, hi], i) => [`${lo}-${hi} Hz`, +(100 * energy[i] / bandTotal).toFixed(1)])),
    brightAttacksPerMinute: +(attacks * 60 / (mono.length / rate)).toFixed(1),
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const summary = {}
try {
  const page = await browser.newPage()
  await page.goto(`${origin}/score.html`)
  for (const kind of ['lobby', 'opening']) {
    const r = await page.evaluate(async ({ kind, SECONDS, RATE, START }) => {
      const { renderScene, wav } = await import('/src/audio/score/demo.ts')
      const { POP_SECONDS } = await import('/src/ui/galaxy/opening.ts')
      const bang = kind === 'opening' ? { start: START, pop: START + POP_SECONDS } : undefined
      const r = await renderScene('Lobby', SECONDS, 1234, RATE, undefined, undefined, false, false, [], bang)
      const bytes = new Uint8Array(wav(r.left, r.right, r.rate))
      let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768))
      const mono = Array.from(r.left, (v, i) => (v + r.right[i]) / 2)
      return { wav: btoa(text), mono, pop: POP_SECONDS }
    }, { kind, SECONDS, RATE, START })
    await writeFile(`${out}/${label}-${kind}.wav`, Buffer.from(r.wav, 'base64'))
    const mono = Float32Array.from(r.mono)
    // The lobby at rest is measured after its fade in; the opening whole, and its first 3 s apart.
    const rest = mono.subarray(RATE * 8)
    summary[kind] = kind === 'lobby' ? summarise(rest, RATE) : { popSeconds: r.pop, whole: summarise(mono, RATE), firstThreeSeconds: summarise(mono.subarray(0, RATE * 3), RATE) }
  }
} finally {
  await browser.close()
}
await writeFile(`${out}/${label}-summary.json`, JSON.stringify(summary, null, 1))
console.log(JSON.stringify(summary, null, 1))
