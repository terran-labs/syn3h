/**
 * A choir by voice modelling. Twenty singers in four parts, two of men and two of women.
 *
 * Each singer is a glottal pulse: the puff of air a vocal fold lets through once per cycle,
 * rising slowly and shutting fast. That shape already has the soft spectrum of a voice, which
 * a sawtooth does not. Every singer has their own vibrato, drift, tuning and breathing swell,
 * so twenty of them sound like a room of people and not one voice copied.
 *
 * The sum of each section then passes through five formants, the resonances of a throat and
 * mouth. `open` moves those formants from a closed "oo" to an open "ah", so the choir can
 * open its mouth as the music climbs.
 *
 * Plain JavaScript on purpose: the browser loads this file as an audio worklet module.
 * Message: { notes: [hz, hz, hz, hz], glide: seconds }. Parts 0 and 1 are men, 2 and 3 women.
 */
const MEN = { oo: [350, 600, 2400, 2675, 2950], ooGain: [1, 0.12, 0.04, 0.04, 0.02], ah: [600, 1040, 2250, 2450, 2750], ahGain: [1, 0.45, 0.35, 0.3, 0.1], width: [60, 70, 110, 120, 130] }
const WOMEN = { oo: [325, 700, 2530, 3500, 4950], ooGain: [1, 0.25, 0.04, 0.02, 0.01], ah: [800, 1150, 2900, 3900, 4950], ahGain: [1, 0.5, 0.1, 0.1, 0.03], width: [80, 90, 120, 130, 140] }

// The glottal pulse, tabulated once: open slowly, shut fast, stay shut. 0.32 is its average,
// removed so the voice carries no constant offset. A table is far cheaper than two cosines a sample.
const PULSE = new Float32Array(4096)
for (let i = 0; i < PULSE.length; i++) {
  const phase = i / PULSE.length
  PULSE[i] = (phase < 0.45 ? 0.5 - 0.5 * Math.cos(phase * 6.981317) : phase < 0.6 ? Math.cos((phase - 0.45) * 10.471976) : 0) - 0.32
}

class Choir extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return ['men', 'women', 'open'].map(name => ({ name, defaultValue: name === 'open' ? 0.3 : 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }))
  }
  constructor() {
    super()
    let seed = 90210
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    this.random = random
    this.singers = []
    for (let part = 0; part < 4; part++) for (let n = 0; n < 5; n++) {
      this.singers.push({ part, side: (part + n) % 2, hz: 220, target: 220, phase: random(), tune: 1 + (random() - 0.5) * 0.008, rate: 4.4 + random() * 1.6, depth: 0.003 + random() * 0.004, vibrato: random() * 6.283, swell: random() * 6.283, swellRate: 0.07 + random() * 0.12, step: 0, loud: 1 })
    }
    this.glide = 0.001
    // Four filter banks: men left, men right, women left, women right. Five formants each.
    this.banks = Array.from({ length: 4 }, () => ({ x1: 0, x2: 0, y1: new Float64Array(5), y2: new Float64Array(5), b0: new Float64Array(5), a1: new Float64Array(5), a2: new Float64Array(5), gain: new Float64Array(5) }))
    this.sums = Array.from({ length: 4 }, () => new Float32Array(128))
    this.port.onmessage = event => {
      const { notes, glide } = event.data
      for (const singer of this.singers) singer.target = notes[singer.part]
      this.glide = 1 - Math.exp(-128 / (sampleRate * Math.max(0.01, glide)))
    }
  }
  /** Set a bank's formants for a mouth that is `open` between "oo" (0) and "ah" (1). */
  shape(bank, voice, open) {
    for (let f = 0; f < 5; f++) {
      const hz = voice.oo[f] + (voice.ah[f] - voice.oo[f]) * open, w = 2 * Math.PI * hz / sampleRate, alpha = Math.sin(w) / (2 * hz / voice.width[f]), a0 = 1 + alpha
      bank.b0[f] = alpha / a0; bank.a1[f] = -2 * Math.cos(w) / a0; bank.a2[f] = (1 - alpha) / a0
      bank.gain[f] = voice.ooGain[f] + (voice.ahGain[f] - voice.ooGain[f]) * open
    }
  }
  process(_inputs, outputs, parameters) {
    const left = outputs[0][0], right = outputs[0][1] ?? left, frames = left.length
    const men = parameters.men[0], women = parameters.women[0], open = parameters.open[0]
    if (men < 0.0005 && women < 0.0005) return true
    for (const sum of this.sums) sum.fill(0, 0, frames)
    for (const singer of this.singers) {
      // A section that is not singing costs nothing.
      if ((singer.part < 2 ? men : women) < 0.0005) { singer.hz = singer.target; continue }
      // Pitch, vibrato and the breathing swell move slowly, so once per block is enough.
      singer.hz += (singer.target - singer.hz) * this.glide
      singer.vibrato += 2 * Math.PI * singer.rate * frames / sampleRate
      singer.swell += 2 * Math.PI * singer.swellRate * frames / sampleRate
      singer.step = singer.hz * singer.tune * (1 + singer.depth * Math.sin(singer.vibrato) + (this.random() - 0.5) * 0.002) / sampleRate
      singer.loud = 0.75 + 0.25 * Math.sin(singer.swell)
      const sum = this.sums[(singer.part < 2 ? 0 : 2) + singer.side]
      let phase = singer.phase
      for (let i = 0; i < frames; i++) {
        phase += singer.step; if (phase >= 1) phase -= 1
        sum[i] += PULSE[(phase * 4096) | 0] * singer.loud
      }
      singer.phase = phase
    }
    for (let b = 0; b < 4; b++) {
      const level = b < 2 ? men : women
      if (level < 0.0005) continue
      const bank = this.banks[b], sum = this.sums[b], out = b % 2 ? right : left
      this.shape(bank, b < 2 ? MEN : WOMEN, open)
      for (let i = 0; i < frames; i++) {
        // A little breath in every throat.
        const x = sum[i] + (this.random() - 0.5) * 0.03
        let y = 0
        for (let f = 0; f < 5; f++) {
          const v = bank.b0[f] * (x - bank.x2) - bank.a1[f] * bank.y1[f] - bank.a2[f] * bank.y2[f]
          bank.y2[f] = bank.y1[f]; bank.y1[f] = v; y += v * bank.gain[f]
        }
        bank.x2 = bank.x1; bank.x1 = x
        out[i] += y * level * 0.5
      }
    }
    return true
  }
}
registerProcessor('choir', Choir)
