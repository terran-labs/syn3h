import { dirtVolume, engineIdle, engineRange, engineVolume, windVolume } from './params'

export interface MotionAudio { speed: number; throttle: number; airborne: boolean }
const unit = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
export function motionMix(motion: MotionAudio) {
  const speed = unit(Math.abs(motion.speed) / 55)
  const load = unit(Math.abs(motion.throttle))
  return {
    pitch: engineIdle.value + engineRange.value * (speed * 0.72 + load * 0.28),
    engine: engineVolume.value * (0.22 + load * 0.5 + speed * 0.28),
    dirt: motion.airborne ? 0 : dirtVolume.value * Math.sqrt(speed),
    wind: windVolume.value * unit(speed * speed + (motion.airborne ? 0.25 : 0)),
  }
}

export function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i++) {
    last = (last + (Math.random() * 2 - 1) * 0.035) / 1.035
    data[i] = last * 5
  }
  return buffer
}

/** Filtered harmonics and uneven combustion keep the engine from sounding like a sine test. */
export class Engine {
  private readonly sources: AudioScheduledSourceNode[] = []
  private readonly engine: GainNode
  private readonly dirt: GainNode
  private readonly wind: GainNode
  private readonly filter: BiquadFilterNode
  private readonly oscillators: OscillatorNode[] = []
  private windSource?: AudioBufferSourceNode
  constructor(private readonly context: BaseAudioContext, output: AudioNode, readonly noise = noiseBuffer(context)) {
    const gain = () => { const g = context.createGain(); g.gain.value = 0; g.connect(output); return g }
    this.engine = gain(); this.dirt = gain(); this.wind = gain()
    this.filter = context.createBiquadFilter()
    this.filter.type = 'lowpass'; this.filter.frequency.value = 340; this.filter.Q.value = 0.7
    this.filter.connect(this.engine)
    for (const detune of [-9, 9]) {
      const oscillator = context.createOscillator()
      oscillator.type = 'sawtooth'; oscillator.frequency.value = engineIdle.value; oscillator.detune.value = detune
      const level = context.createGain(); level.gain.value = 0.24
      oscillator.connect(level).connect(this.filter)
      oscillator.start(); this.sources.push(oscillator); this.oscillators.push(oscillator)
    }
    const source = context.createBufferSource(); source.buffer = noise; source.loop = true
    const dirtFilter = context.createBiquadFilter(); dirtFilter.type = 'bandpass'; dirtFilter.frequency.value = 160; dirtFilter.Q.value = 0.65
    source.connect(dirtFilter).connect(this.dirt)
    const combustion = context.createGain(); combustion.gain.value = 0.35
    source.connect(combustion).connect(this.filter)
    source.start(); this.sources.push(source)
    const flutter = context.createOscillator(); flutter.frequency.value = 11
    const depth = context.createGain(); depth.gain.value = 6
    flutter.connect(depth)
    for (const oscillator of this.oscillators) depth.connect(oscillator.frequency)
    flutter.start(); this.sources.push(flutter)
  }
  setWind(buffer: AudioBuffer): void {
    if (this.windSource) return
    const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true
    const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1800
    source.connect(filter).connect(this.wind); source.start()
    this.windSource = source; this.sources.push(source)
  }
  update(motion: MotionAudio, enabled = true): void {
    const mix = motionMix(motion), now = this.context.currentTime
    for (const oscillator of this.oscillators) oscillator.frequency.setTargetAtTime(mix.pitch, now, 0.15)
    this.filter.frequency.setTargetAtTime(220 + mix.pitch * 4, now, 0.15)
    this.engine.gain.setTargetAtTime(enabled ? mix.engine : 0, now, 0.08)
    this.dirt.gain.setTargetAtTime(enabled ? mix.dirt : 0, now, 0.12)
    this.wind.gain.setTargetAtTime(enabled ? mix.wind : 0, now, 0.25)
  }
  dispose(): void {
    for (const source of this.sources) { source.stop(); source.disconnect() }
    this.engine.disconnect(); this.dirt.disconnect(); this.wind.disconnect()
  }
}
