/**
 * The instruments of the adaptive score, built once as a fixed Web Audio graph.
 *
 * Every voice is persistent: notes are played by scheduling frequency and gain automation on
 * oscillators that never stop, so a busy passage allocates nothing and cannot click from a
 * voice being cut. Nothing here is a recording; the reverb impulse and the noise are
 * generated from a seed.
 *
 *   pads (12 detuned saws) ─┐
 *   drone (sub sine)        ├─ pump (ducked by the kick) ─┐
 *   bass (saw, drive)       ┘                             ├─ output
 *   arpeggio, bells, choir, drums, riser, impact ─────────┤
 *   sends: tempo-synced ping-pong delay, convolution hall ┘
 */
import { midiHz, seeded, unit, type Levels, type Step } from './Composer'

const tanhCurve = (() => {
  const curve = new Float32Array(1025)
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 512 - 1) * 2.5)
  return curve
})()

/** A stereo hall: decaying noise that loses its treble as it dies, like air in a big room. */
export function hallImpulse(context: BaseAudioContext, seconds = 3.4, seed = 3141): AudioBuffer {
  const rate = context.sampleRate, length = Math.floor(rate * seconds), preDelay = Math.floor(rate * 0.018)
  const buffer = context.createBuffer(2, length, rate), random = seeded(seed)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / (length - preDelay)
      // The one-pole lowpass closes as the tail decays.
      const k = 0.55 - 0.47 * t
      low += k * ((random() * 2 - 1) - low)
      data[i] = low * Math.exp(-5.2 * t) * (1 - t)
    }
  }
  return buffer
}

export function whiteNoise(context: BaseAudioContext, seed = 2718): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), data = buffer.getChannelData(0), random = seeded(seed)
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1
  return buffer
}

/** Lowpass that turns the whole mix into what a submerged cockpit would hear. */
export function applySubmerge(filter: BiquadFilterNode, depth: number, time: number): void {
  const d = unit(depth)
  filter.frequency.setTargetAtTime(20000 * (320 / 20000) ** d, time, 0.08)
  filter.Q.setTargetAtTime(0.7 + 3.2 * d, time, 0.08)
}

export class ScoreSynth {
  private readonly nodes: AudioNode[] = []
  private readonly sources: AudioScheduledSourceNode[] = []
  private readonly out: GainNode
  private readonly pump: GainNode
  private readonly padBus: GainNode
  private readonly padFilter: BiquadFilterNode
  private readonly padOscs: OscillatorNode[][] = []
  private readonly drone: OscillatorNode[] = []
  private readonly droneGain: GainNode
  private readonly choirOscs: OscillatorNode[] = []
  private readonly choirGain: GainNode
  private readonly arpOscs: OscillatorNode[] = []
  private readonly arpFilter: BiquadFilterNode
  private readonly arpVca: GainNode
  private readonly arpBus: GainNode
  private readonly bassOscs: OscillatorNode[] = []
  private readonly bassFilter: BiquadFilterNode
  private readonly bassDrive: GainNode
  private readonly bassTrim: GainNode
  private readonly bassVca: GainNode
  private readonly bassBus: GainNode
  private readonly drumBus: GainNode
  private readonly kick: OscillatorNode
  private readonly kickVca: GainNode
  private readonly hatVca: GainNode
  private readonly snareVca: GainNode
  private readonly snareBody: OscillatorNode
  private readonly snareBodyVca: GainNode
  private readonly riserFilter: BiquadFilterNode
  private readonly riserVca: GainNode
  private readonly boom: OscillatorNode
  private readonly boomVca: GainNode
  private readonly crashVca: GainNode
  private readonly bells: { carrier: OscillatorNode; modulator: OscillatorNode; index: GainNode; vca: GainNode }[] = []
  private readonly leadBus: GainNode
  private readonly delays: DelayNode[] = []
  private readonly reverbSend: GainNode
  private nextBell = 0
  private brightness = 0.4
  private drums = 0
  private disposed = false

  constructor(private readonly context: BaseAudioContext, output: AudioNode) {
    const c = context
    const own = <T extends AudioNode>(node: T): T => { this.nodes.push(node); return node }
    const gain = (value: number, ...to: (AudioNode | AudioParam)[]) => { const g = own(c.createGain()); g.gain.value = value; for (const node of to) g.connect(node as AudioNode); return g }
    const osc = (type: OscillatorType, hz = 110) => { const o = own(c.createOscillator()); o.type = type; o.frequency.value = hz; this.sources.push(o); return o }
    const filter = (type: BiquadFilterType, hz: number, q = 0.7) => { const f = own(c.createBiquadFilter()); f.type = type; f.frequency.value = hz; f.Q.value = q; return f }
    const pan = (value: number, to: AudioNode) => { const p = own(c.createStereoPanner()); p.pan.value = value; p.connect(to); return p }
    const loop = (buffer: AudioBuffer) => { const s = own(c.createBufferSource()); s.buffer = buffer; s.loop = true; this.sources.push(s); return s }

    this.out = gain(0, output)
    // A gentle bus compressor glues the layers and keeps a full passage from towering over a quiet one.
    const glue = own(c.createDynamicsCompressor()); glue.threshold.value = -20; glue.knee.value = 14; glue.ratio.value = 3; glue.attack.value = 0.02; glue.release.value = 0.25
    glue.connect(this.out)
    const sum = gain(0.6, glue)
    this.pump = gain(1, sum)

    // Hall and ping-pong delay, both fed by sends.
    const hall = own(c.createConvolver()); hall.buffer = hallImpulse(c)
    this.reverbSend = gain(0.9, sum); hall.connect(this.reverbSend)
    const reverb = gain(1, hall)
    const left = own(c.createDelay(1.5)), right = own(c.createDelay(1.5)), damp = filter('lowpass', 3200)
    this.delays.push(left, right)
    const delayIn = gain(1, left)
    left.connect(pan(-0.75, sum)); right.connect(pan(0.75, sum))
    left.connect(gain(0.46, right)); right.connect(damp); damp.connect(gain(0.42, left))

    // Pads: four chord voices, each three saws spread in pitch and across the stereo field.
    this.padFilter = filter('lowpass', 900, 0.9)
    this.padBus = gain(0, this.pump, gain(0.55, reverb))
    this.padFilter.connect(this.padBus)
    const spread = [-0.7, 0, 0.7].map(p => pan(p, this.padFilter))
    for (let voice = 0; voice < 4; voice++) {
      const group: OscillatorNode[] = []
      for (let i = 0; i < 3; i++) {
        const o = osc('sawtooth'); o.detune.value = (i - 1) * 11 + (voice - 1.5) * 2
        o.connect(gain(0.1, spread[(i + voice) % 3])); group.push(o)
      }
      this.padOscs.push(group)
    }
    // A very slow sweep keeps a held chord from sounding frozen.
    const sweep = osc('sine', 0.06); sweep.connect(gain(220, this.padFilter.frequency))

    this.droneGain = gain(0, this.pump)
    const sub = osc('sine', 55), fifth = osc('triangle', 110)
    sub.connect(gain(0.32, this.droneGain)); fifth.connect(gain(0.12, this.droneGain)); this.drone.push(sub, fifth)

    // Choir: saws through three "ah" formants, with vibrato. This is the hair-raising layer.
    this.choirGain = gain(0, sum, gain(0.9, reverb))
    const formants = ([[720, 9, 1], [1150, 10, 0.55], [2700, 9, 0.22]] as const).map(([hz, q, level]) => { const f = filter('bandpass', hz, q); f.connect(gain(level, this.choirGain)); return f })
    const vibrato = osc('sine', 5.1), vibratoDepth = gain(7)
    vibrato.connect(vibratoDepth)
    for (let i = 0; i < 2; i++) {
      const o = osc('sawtooth', 440); o.detune.value = i ? 6 : -6; vibratoDepth.connect(o.detune)
      const level = gain(0.3); o.connect(level); for (const f of formants) level.connect(f)
      this.choirOscs.push(o)
    }

    // Arpeggio: a plucked saw and square through a resonant filter, thrown into the delay.
    this.arpFilter = filter('lowpass', 800, 5)
    this.arpVca = gain(0)
    this.arpBus = gain(0, sum, gain(0.42, delayIn), gain(0.3, reverb))
    this.arpFilter.connect(this.arpVca).connect(this.arpBus)
    for (const [type, detune, level] of [['sawtooth', -5, 0.5], ['square', 6, 0.28]] as const) {
      const o = osc(type); o.detune.value = detune; o.connect(gain(level, this.arpFilter)); this.arpOscs.push(o)
    }

    // Bass: saw over a sine sub, filter envelope, then a drive stage that only bites in combat.
    this.bassFilter = filter('lowpass', 300, 3.5)
    this.bassDrive = gain(1); this.bassTrim = gain(1); this.bassVca = gain(0)
    this.bassBus = gain(0, this.pump)
    const shaper = own(c.createWaveShaper()); shaper.curve = tanhCurve; shaper.oversample = '2x'
    this.bassFilter.connect(this.bassDrive).connect(shaper).connect(this.bassTrim).connect(this.bassVca).connect(this.bassBus)
    for (const [type, level] of [['sawtooth', 0.2], ['sine', 0.22]] as const) { const o = osc(type, 55); o.connect(gain(level, this.bassFilter)); this.bassOscs.push(o) }

    // Drums, all from one sine and one noise loop.
    const noise = loop(whiteNoise(c))
    this.drumBus = gain(0, sum)
    const drumVerb = gain(0.12, reverb)
    this.kick = osc('sine', 50); this.kickVca = gain(0, this.drumBus); this.kick.connect(this.kickVca)
    const hatFilter = filter('highpass', 7500); this.hatVca = gain(0, this.drumBus); noise.connect(hatFilter).connect(this.hatVca)
    const snareFilter = filter('bandpass', 1900, 0.6); this.snareVca = gain(0, this.drumBus, drumVerb); noise.connect(snareFilter).connect(this.snareVca)
    this.snareBody = osc('triangle', 185); this.snareBodyVca = gain(0, this.drumBus); this.snareBody.connect(this.snareBodyVca)

    // Riser and impact: the swell into a section and the drop that lands it.
    this.riserFilter = filter('bandpass', 500, 1.6); this.riserVca = gain(0, sum, gain(0.5, reverb)); noise.connect(this.riserFilter).connect(this.riserVca)
    this.boom = osc('sine', 40); this.boomVca = gain(0, sum); this.boom.connect(this.boomVca)
    const crashFilter = filter('highpass', 3500); this.crashVca = gain(0, sum, gain(0.8, reverb)); noise.connect(crashFilter).connect(this.crashVca)

    // Bells: three two-operator FM voices in rotation, so a long note can ring under the next.
    this.leadBus = gain(0, sum, gain(0.5, delayIn), gain(0.75, reverb))
    for (let i = 0; i < 3; i++) {
      const carrier = osc('sine', 880), modulator = osc('sine', 1760), index = gain(0, carrier.frequency), vca = gain(0, pan((i - 1) * 0.35, this.leadBus))
      modulator.connect(index); carrier.connect(vca)
      this.bells.push({ carrier, modulator, index, vca })
    }
    for (const source of this.sources) source.start()
  }

  get nodeCount(): number { return this.nodes.length }

  /** Overall level of the score, for fading it in and out. */
  setLevel(level: number, seconds = 1.5): void {
    const now = this.context.currentTime
    this.out.gain.cancelScheduledValues(now)
    this.out.gain.setTargetAtTime(level, now, seconds / 3)
  }

  /** Move every layer toward the levels the mood asks for. Called every frame. */
  setLevels(level: Levels, depth: number, reverb: number): void {
    const now = this.context.currentTime, to = (param: AudioParam, value: number, tau = 0.5) => param.setTargetAtTime(value, now, tau)
    this.brightness = level.brightness; this.drums = level.drums
    to(this.padBus.gain, level.pad * 0.9)
    to(this.padFilter.frequency, 380 + level.brightness ** 1.6 * 6500)
    to(this.droneGain.gain, level.drone * 0.4)
    to(this.choirGain.gain, level.choir * 0.5, 1.2)
    to(this.arpBus.gain, level.arp * 0.6)
    to(this.bassBus.gain, level.bass * 0.5)
    to(this.bassDrive.gain, 0.5 + level.drive * 3.5)
    to(this.bassTrim.gain, 1.5 - level.drive * 0.75)
    to(this.drumBus.gain, level.drums * 0.8)
    to(this.leadBus.gain, level.lead * 0.5)
    // Under water the hall grows, as if the sound had nowhere to go.
    to(this.reverbSend.gain, reverb * (0.8 + 0.5 * unit(depth)))
  }

  /** Schedule one sixteenth of the composition at `time`. `duration` is one sixteenth in seconds. */
  play(step: Step, time: number, duration: number): void {
    if (this.disposed) return
    const t = time
    if (step.chord) {
      step.chord.pad.forEach((midi, voice) => { for (const o of this.padOscs[voice]) o.frequency.setTargetAtTime(midiHz(midi), t, 0.09) })
      this.drone[0].frequency.setTargetAtTime(midiHz(step.chord.root), t, 0.25)
      this.drone[1].frequency.setTargetAtTime(midiHz(step.chord.root + 19), t, 0.25)
      this.choirOscs[0].frequency.setTargetAtTime(midiHz(step.chord.pad[2] + 12), t, 0.3)
      this.choirOscs[1].frequency.setTargetAtTime(midiHz(step.chord.pad[3] + 12), t, 0.3)
      // Echoes fall on dotted eighths. Retimed only here so a tempo drift never warbles them.
      for (const delay of this.delays) delay.delayTime.setTargetAtTime(Math.min(1.4, duration * 3), t, 0.2)
    }
    if (step.arp) {
      const hz = midiHz(step.arp.midi), gate = duration * step.arp.steps
      for (const o of this.arpOscs) o.frequency.setValueAtTime(hz, t)
      this.arpFilter.frequency.setValueAtTime(700 + this.brightness * 5200 * step.arp.velocity, t)
      this.arpFilter.frequency.setTargetAtTime(280 + this.brightness * 900, t, 0.07)
      this.arpVca.gain.setTargetAtTime(0.5 * step.arp.velocity, t, 0.003)
      this.arpVca.gain.setTargetAtTime(0, t + gate * 0.7, 0.04)
    }
    if (step.bass) {
      const hz = midiHz(step.bass.midi), gate = duration * step.bass.steps
      for (const o of this.bassOscs) o.frequency.setValueAtTime(hz, t)
      this.bassFilter.frequency.setValueAtTime(350 + this.brightness * 1900 * step.bass.velocity, t)
      this.bassFilter.frequency.setTargetAtTime(130, t, 0.09)
      this.bassVca.gain.setTargetAtTime(step.bass.velocity, t, 0.004)
      this.bassVca.gain.setTargetAtTime(0, t + gate * 0.8, 0.03)
    }
    if (step.lead) {
      const bell = this.bells[this.nextBell++ % this.bells.length], hz = midiHz(step.lead.midi), hold = duration * step.lead.steps
      bell.carrier.frequency.setValueAtTime(hz, t); bell.modulator.frequency.setValueAtTime(hz * 3.5, t)
      bell.index.gain.setValueAtTime(hz * 1.6 * step.lead.velocity, t); bell.index.gain.setTargetAtTime(hz * 0.05, t, 0.18)
      bell.vca.gain.setTargetAtTime(0.4 * step.lead.velocity, t, 0.004)
      bell.vca.gain.setTargetAtTime(0, t + 0.03, 0.35 + hold * 0.6)
    }
    if (step.kick) {
      this.kick.frequency.setValueAtTime(165, t); this.kick.frequency.exponentialRampToValueAtTime(44, t + 0.1)
      this.kickVca.gain.setTargetAtTime(0.6 * step.kick, t, 0.002); this.kickVca.gain.setTargetAtTime(0, t + 0.09, 0.06)
      // Sidechain: pads, drone and bass duck under the kick and swell back, the pulse of the track.
      this.pump.gain.setTargetAtTime(1 - 0.6 * this.drums * step.kick, t, 0.005); this.pump.gain.setTargetAtTime(1, t + 0.06, duration * 0.9)
    }
    if (step.snare) {
      this.snareVca.gain.setTargetAtTime(0.5 * step.snare, t, 0.002); this.snareVca.gain.setTargetAtTime(0, t + 0.02, 0.055)
      this.snareBody.frequency.setValueAtTime(230, t); this.snareBody.frequency.exponentialRampToValueAtTime(150, t + 0.08)
      this.snareBodyVca.gain.setTargetAtTime(0.35 * step.snare, t, 0.002); this.snareBodyVca.gain.setTargetAtTime(0, t + 0.02, 0.04)
    }
    const hat = step.openHat ?? step.hat
    if (hat) { this.hatVca.gain.setTargetAtTime(0.22 * hat, t, 0.001); this.hatVca.gain.setTargetAtTime(0, t + 0.008, step.openHat ? 0.11 : 0.018) }
    if (step.riser) this.riser(t, duration * step.riser)
    if (step.impact) this.impact(t)
  }

  /** A noise swell that rises for `seconds` and is cut dead where the next section lands. */
  riser(time: number, seconds: number): void {
    this.riserFilter.frequency.setValueAtTime(350, time); this.riserFilter.frequency.exponentialRampToValueAtTime(7000, time + seconds)
    this.riserVca.gain.setValueAtTime(0.0001, time); this.riserVca.gain.exponentialRampToValueAtTime(0.22, time + seconds)
    this.riserVca.gain.setTargetAtTime(0, time + seconds, 0.02)
  }

  /** A sub drop and a crash. Also used directly for a capture or a win. */
  impact(time: number = this.context.currentTime + 0.02, strength = 1): void {
    this.boom.frequency.setValueAtTime(95, time); this.boom.frequency.exponentialRampToValueAtTime(33, time + 0.9)
    this.boomVca.gain.setTargetAtTime(0.5 * strength, time, 0.004); this.boomVca.gain.setTargetAtTime(0, time + 0.15, 0.5)
    this.crashVca.gain.setTargetAtTime(0.2 * strength, time, 0.003); this.crashVca.gain.setTargetAtTime(0, time + 0.03, 0.6)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const source of this.sources) { try { source.stop() } catch { /* never started in a closed context */ } }
    for (const node of this.nodes) node.disconnect()
  }
}
