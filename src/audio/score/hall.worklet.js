/**
 * The hall as an algorithm: a feedback delay network. It replaces a five second convolution,
 * which was the most expensive thing in the score, at a fraction of the cost, and unlike a
 * recorded impulse its tail can be lengthened while it rings.
 *
 * Sound enters through four diffusion steps. Each splits it across eight delays of different
 * lengths, mixes all eight together (a Hadamard matrix) and flips some polarities, so one
 * click becomes thousands of echoes within a fifth of a second. That cloud then circulates
 * in eight longer delays whose outputs are mixed into one another (a Householder matrix)
 * and fed back, each pass a little quieter and a little duller. `decay` is the time the
 * tail takes to fall 60 dB.
 *
 * The design follows Signalsmith Audio's "Let's Write a Reverb".
 * Plain JavaScript on purpose: the browser loads this file as an audio worklet module.
 */
const CHANNELS = 8

class Hall extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'decay', defaultValue: 5, minValue: 0.2, maxValue: 30, automationRate: 'k-rate' },
      { name: 'damping', defaultValue: 0.45, minValue: 0, maxValue: 0.95, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    let seed = 60221
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    const line = seconds => ({ data: new Float32Array(1 << Math.ceil(Math.log2(seconds * sampleRate + 2))), delay: Math.max(1, Math.round(seconds * sampleRate)) })
    // Diffusion: each step's delays are spread through a window twice as long as the last.
    this.steps = [0.015, 0.03, 0.06, 0.12].map(span => ({
      lines: Array.from({ length: CHANNELS }, (_, c) => line(span * (c + random()) / CHANNELS + 0.0005)),
      flip: Array.from({ length: CHANNELS }, () => random() < 0.5 ? -1 : 1),
    }))
    // The loop: eight delays from 100 to about 190 ms, no two sharing a common factor by design of the spacing.
    this.loop = Array.from({ length: CHANNELS }, (_, c) => line(0.1 * 2 ** (c / CHANNELS) + random() * 0.003))
    this.gain = new Float64Array(CHANNELS)
    this.dull = new Float64Array(CHANNELS)
    this.v = new Float64Array(CHANNELS)
    this.at = 0
  }
  process(inputs, outputs, parameters) {
    const inL = inputs[0][0], inR = inputs[0][1] ?? inL, outL = outputs[0][0], outR = outputs[0][1] ?? outL
    const frames = outL.length, v = this.v, damping = parameters.damping[0]
    for (let c = 0; c < CHANNELS; c++) this.gain[c] = Math.pow(10, -3 * this.loop[c].delay / sampleRate / parameters.decay[0])
    let at = this.at
    for (let i = 0; i < frames; i++) {
      const l = inL ? inL[i] : 0, r = inR ? inR[i] : 0
      for (let c = 0; c < CHANNELS; c++) v[c] = c & 1 ? r : l
      for (const step of this.steps) {
        for (let c = 0; c < CHANNELS; c++) {
          const { data, delay } = step.lines[c], mask = data.length - 1
          data[at & mask] = v[c]
          v[c] = data[(at - delay) & mask]
        }
        // Hadamard mix: three rounds of sums and differences, scaled to keep the energy.
        for (let span = 1; span < CHANNELS; span <<= 1) for (let a = 0; a < CHANNELS; a += span << 1) for (let b = a; b < a + span; b++) { const x = v[b], y = v[b + span]; v[b] = x + y; v[b + span] = x - y }
        for (let c = 0; c < CHANNELS; c++) v[c] *= step.flip[c] * 0.35355339
      }
      // Read what comes back round, duller and quieter, then mix every channel into every other.
      let sum = 0
      for (let c = 0; c < CHANNELS; c++) {
        const { data, delay } = this.loop[c], back = data[(at - delay) & (data.length - 1)]
        this.dull[c] += (1 - damping) * (back - this.dull[c])
        sum += this.dull[c]
      }
      sum *= 2 / CHANNELS
      let left = 0, right = 0
      for (let c = 0; c < CHANNELS; c++) {
        const back = this.dull[c] - sum, { data } = this.loop[c]
        data[at & (data.length - 1)] = v[c] + back * this.gain[c]
        if (c & 1) right += back; else left += back
      }
      outL[i] = left * 0.36; outR[i] = right * 0.36
      at++
    }
    this.at = at
    return true
  }
}
registerProcessor('hall', Hall)
