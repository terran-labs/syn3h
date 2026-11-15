/**
 * Shimmer: whatever goes in comes out an octave higher, and part of that goes round again
 * to come out an octave higher still, each pass a little darker. Fed into a long hall it is
 * the rising glow of ambient records: the music seems to give off light.
 *
 * The octave shift is granular. Two read heads chase the write head through a short delay
 * at twice its speed, each fading in and out under a window, half a grain apart, so one is
 * always sounding while the other jumps back.
 *
 * Plain JavaScript on purpose: the browser loads this file as an audio worklet module.
 */
class Shimmer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'feedback', defaultValue: 0.45, minValue: 0, maxValue: 0.7, automationRate: 'k-rate' }]
  }
  constructor() {
    super()
    this.size = 32768
    this.grain = Math.round(sampleRate * 0.09)
    this.echo = Math.round(sampleRate * 0.31)
    this.lines = [new Float32Array(this.size), new Float32Array(this.size)]
    this.returns = [new Float32Array(this.size), new Float32Array(this.size)]
    this.dark = [0, 0]
    this.write = 0
    this.head = 0
  }
  process(inputs, outputs, parameters) {
    const feedback = parameters.feedback[0], mask = this.size - 1, grain = this.grain
    const frames = outputs[0][0].length
    for (let channel = 0; channel < 2; channel++) {
      const input = inputs[0][channel] ?? inputs[0][0], output = outputs[0][channel]
      if (!output) continue
      const line = this.lines[channel], back = this.returns[channel]
      let write = this.write, head = this.head, dark = this.dark[channel]
      for (let i = 0; i < frames; i++) {
        // What went up an octave a moment ago returns, duller, to go up again.
        dark += 0.3 * (back[(write - this.echo) & mask] - dark)
        line[write] = (input ? input[i] : 0) + feedback * dark
        let out = 0
        for (let tap = 0; tap < 2; tap++) {
          const at = (head + tap * (grain >> 1)) % grain, window = Math.sin(Math.PI * at / grain)
          // Reading twice as fast as writing: the gap to the write head closes by one sample a sample.
          out += line[(write - (grain - at)) & mask] * window * window
        }
        back[write] = out
        output[i] = out
        write = (write + 1) & mask; head = (head + 1) % grain
      }
      this.dark[channel] = dark
      if (channel === 1 || !outputs[0][1]) { this.write = write; this.head = head }
    }
    return true
  }
}
registerProcessor('shimmer', Shimmer)
