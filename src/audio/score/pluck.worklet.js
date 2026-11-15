/**
 * Plucked strings by physical modelling (Karplus-Strong). A burst of noise circulates in a
 * delay line one period long; each pass through a gentle lowpass wears away the treble first,
 * which is exactly how a real string loses energy. The result is a koto or a harp, with no
 * sample and no oscillator.
 *
 * Plain JavaScript on purpose: the browser loads this file as an audio worklet module.
 * Messages: { t: seconds on the audio clock, hz, velocity 0..1, sustain: seconds to fall 60 dB }.
 */
class Pluck extends AudioWorkletProcessor {
  constructor() {
    super()
    this.voices = Array.from({ length: 10 }, (_, i) => ({ line: new Float32Array(4096), length: 0, at: 0, blend: 0, loss: 0, level: 0, pan: (i % 2 ? 1 : -1) * (0.2 + 0.08 * (i % 5)) }))
    this.pending = []
    this.seed = 22222
    this.port.onmessage = event => this.pending.push(event.data)
  }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 2147483648 - 1 }
  start(note) {
    const period = sampleRate / note.hz
    if (!(period > 4 && period < 4094)) return
    // The quietest voice gives way.
    const voice = this.voices.reduce((quiet, v) => v.level < quiet.level ? v : quiet)
    // The loop's lowpass delays by `blend` of a sample, so the line is cut to make up the rest.
    voice.length = Math.ceil(period); voice.blend = voice.length - period; voice.at = 0
    // Loop gain for the asked decay: -60 dB after `sustain` seconds of periods.
    voice.loss = Math.pow(10, -3 / (note.hz * note.sustain))
    // A soft pluck is a duller burst: smooth the noise more when the velocity is low.
    const smoothing = 0.15 + 0.75 * note.velocity
    let last = 0, sum = 0
    for (let i = 0; i < voice.length; i++) { last += smoothing * (this.random() - last); voice.line[i] = last; sum += last }
    // Remove the average so the string does not carry a constant offset.
    for (let i = 0; i < voice.length; i++) voice.line[i] = (voice.line[i] - sum / voice.length) * note.velocity
    voice.level = note.velocity
  }
  process(_inputs, outputs) {
    const left = outputs[0][0], right = outputs[0][1] ?? left, frames = left.length
    for (let n = this.pending.length - 1; n >= 0; n--) if (this.pending[n].t <= currentTime + frames / sampleRate) this.start(this.pending.splice(n, 1)[0])
    for (const voice of this.voices) {
      if (voice.level < 0.0002) continue
      const { line, length, blend, loss } = voice, l = 0.5 - voice.pan * 0.5, r = 0.5 + voice.pan * 0.5
      let at = voice.at, peak = 0
      for (let i = 0; i < frames; i++) {
        const next = at + 1 === length ? 0 : at + 1, sample = line[at]
        line[at] = loss * ((1 - blend) * sample + blend * line[next])
        left[i] += sample * l; right[i] += sample * r
        if (sample > peak) peak = sample; else if (-sample > peak) peak = -sample
        at = next
      }
      voice.at = at
      // Track the envelope so a finished string frees its voice.
      voice.level = Math.max(peak, voice.level * 0.9)
    }
    return true
  }
}
registerProcessor('pluck', Pluck)
