/**
 * The instruments of the adaptive score, built once as a fixed Web Audio graph.
 *
 * Every voice is persistent: notes are played by scheduling frequency and gain automation on
 * oscillators that never stop, so a busy passage allocates nothing and cannot click from a
 * voice being cut. Nothing here is a recording; the reverb impulse and the noise are
 * generated from a seed.
 *
 *   pads (12 drifting saws, ensemble chorus) ─┐
 *   drone (two beating subs)                  ├─ pump (ducked by the kick) ─┐
 *   bass (saw, drive)                         ┘                             ├─ output
 *   sequencer, theremin, choir, low drums, wind, telemetry, riser, impact ──┤
 *   sends: tempo-synced ping-pong delay, convolution hall ──────────────────┘
 *
 * The sound aimed for is an analogue studio of the 1970s pointed at deep space: thick saws
 * that drift against each other, a theremin, a male choir, tape echo and a very long hall.
 */
import { midiHz, seeded, unit, type Levels, type Step } from './Composer'

const tanhCurve = (() => {
  const curve = new Float32Array(1025)
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 512 - 1) * 2.5)
  return curve
})()

/** A stereo hall: decaying noise that loses its treble as it dies, like air in a big room. */
export function hallImpulse(context: BaseAudioContext, seconds = 5.5, seed = 3141): AudioBuffer {
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
  private readonly leadOscs: OscillatorNode[] = []
  private readonly leadVca: GainNode
  private readonly leadBus: GainNode
  private readonly beep: OscillatorNode
  private readonly beepVca: GainNode
  private readonly airBus: GainNode
  private readonly delays: DelayNode[] = []
  private readonly reverbSend: GainNode
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
    // Each voice drifts a few cents on its own slow cycle, the way analogue oscillators do, and
    // the sum runs through an ensemble chorus (two swept delays). That movement is what turns
    // a buzzing sawtooth into a string machine.
    this.padFilter = filter('lowpass', 700, 2.2)
    this.padBus = gain(0, this.pump, gain(0.7, reverb))
    this.padFilter.connect(gain(0.7, this.padBus))
    for (const [time, rate, depth, side] of [[0.013, 0.31, 0.003, -0.85], [0.019, 0.43, 0.004, 0.85]] as const) {
      const delay = own(c.createDelay(0.05)); delay.delayTime.value = time
      osc('sine', rate).connect(gain(depth, delay.delayTime))
      this.padFilter.connect(delay); delay.connect(pan(side, gain(0.55, this.padBus)))
    }
    const spread = [-0.7, 0, 0.7].map(p => pan(p, this.padFilter))
    for (let voice = 0; voice < 4; voice++) {
      const group: OscillatorNode[] = [], drift = gain(6)
      osc('sine', 0.09 + voice * 0.037).connect(drift)
      for (let i = 0; i < 3; i++) {
        const o = osc('sawtooth'); o.detune.value = (i - 1) * 16 + (voice - 1.5) * 2; drift.connect(o.detune)
        o.connect(gain(0.1, spread[(i + voice) % 3])); group.push(o)
      }
      this.padOscs.push(group)
    }
    // A very slow sweep keeps a held chord from sounding frozen.
    const sweep = osc('sine', 0.05); sweep.connect(gain(260, this.padFilter.frequency))

    this.droneGain = gain(0, this.pump)
    // Two subs a few cents apart beat against each other, a slow throb under everything.
    const sub = osc('sine', 55), beat = osc('sine', 55), fifth = osc('triangle', 110)
    beat.detune.value = 9
    sub.connect(gain(0.2, this.droneGain)); beat.connect(gain(0.2, this.droneGain)); fifth.connect(gain(0.1, this.droneGain)); this.drone.push(sub, beat, fifth)

    // Choir: saws through three formants, with vibrato, in a men's register.
    this.choirGain = gain(0, sum, gain(0.9, reverb))
    const formants = ([[600, 10, 1], [1000, 10, 0.5], [2500, 9, 0.2]] as const).map(([hz, q, level]) => { const f = filter('bandpass', hz, q); f.connect(gain(level, this.choirGain)); return f })
    const vibrato = osc('sine', 5.1), vibratoDepth = gain(7)
    vibrato.connect(vibratoDepth)
    for (let i = 0; i < 2; i++) {
      const o = osc('sawtooth', 440); o.detune.value = i ? 6 : -6; vibratoDepth.connect(o.detune)
      const level = gain(0.3); o.connect(level); for (const f of formants) level.connect(f)
      this.choirOscs.push(o)
    }

    // Sequencer: two low saws through a resonant filter, each note echoed by the delay.
    this.arpFilter = filter('lowpass', 500, 6)
    this.arpVca = gain(0)
    this.arpBus = gain(0, sum, gain(0.6, delayIn), gain(0.35, reverb))
    this.arpFilter.connect(this.arpVca).connect(this.arpBus)
    for (const detune of [-7, 7]) { const o = osc('sawtooth'); o.detune.value = detune; o.connect(gain(0.4, this.arpFilter)); this.arpOscs.push(o) }

    // Bass: saw over a sine sub, filter envelope, then a drive stage that only bites in combat.
    this.bassFilter = filter('lowpass', 300, 3.5)
    this.bassDrive = gain(1); this.bassTrim = gain(1); this.bassVca = gain(0)
    this.bassBus = gain(0, this.pump)
    const shaper = own(c.createWaveShaper()); shaper.curve = tanhCurve; shaper.oversample = '2x'
    this.bassFilter.connect(this.bassDrive).connect(shaper).connect(this.bassTrim).connect(this.bassVca).connect(this.bassBus)
    for (const [type, level] of [['sawtooth', 0.2], ['sine', 0.22]] as const) { const o = osc(type, 55); o.connect(gain(level, this.bassFilter)); this.bassOscs.push(o) }

    // Low drums, all from sines and one noise loop: a heartbeat kick and a taiko-like drum.
    const noise = loop(whiteNoise(c))
    this.drumBus = gain(0, sum)
    const drumVerb = gain(0.4, reverb)
    this.kick = osc('sine', 50); this.kickVca = gain(0, this.drumBus); this.kick.connect(this.kickVca)
    const hatFilter = filter('highpass', 7500); this.hatVca = gain(0, this.drumBus); noise.connect(hatFilter).connect(this.hatVca)
    const snareFilter = filter('bandpass', 600, 0.8); this.snareVca = gain(0, this.drumBus, drumVerb); noise.connect(snareFilter).connect(this.snareVca)
    this.snareBody = osc('sine', 90); this.snareBodyVca = gain(0, this.drumBus, drumVerb); this.snareBody.connect(this.snareBodyVca)

    // Wind in the void: a band of noise that wanders, almost all of it in the hall.
    this.airBus = gain(0, gain(0.3, sum), reverb)
    const airFilter = filter('bandpass', 1300, 1.2); osc('sine', 0.045).connect(gain(700, airFilter.frequency)); noise.connect(airFilter).connect(this.airBus)

    // Riser and impact: the swell into a section and the drop that lands it.
    this.riserFilter = filter('bandpass', 500, 1.6); this.riserVca = gain(0, sum, gain(0.5, reverb)); noise.connect(this.riserFilter).connect(this.riserVca)
    this.boom = osc('sine', 40); this.boomVca = gain(0, sum); this.boom.connect(this.boomVca)
    const crashFilter = filter('highpass', 3500); this.crashVca = gain(0, sum, gain(0.8, reverb)); noise.connect(crashFilter).connect(this.crashVca)

    // Theremin: one gliding voice with vibrato and a slow attack. It sings; it never plinks.
    this.leadBus = gain(0, sum, gain(0.4, delayIn), gain(0.9, reverb))
    this.leadVca = gain(0, this.leadBus)
    const waver = gain(16); osc('sine', 5.6).connect(waver)
    for (const [type, level] of [['sine', 0.5], ['triangle', 0.2]] as const) { const o = osc(type, 440); waver.connect(o.detune); o.connect(gain(level, this.leadVca)); this.leadOscs.push(o) }
    // Telemetry beep: a plain sine a long way off.
    this.beep = osc('sine', 1000); this.beepVca = gain(0, gain(0.25, pan(0.4, sum)), gain(0.5, delayIn), reverb); this.beep.connect(this.beepVca)
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
    to(this.padFilter.frequency, 320 + level.brightness ** 1.5 * 4200)
    to(this.droneGain.gain, level.drone * 0.4)
    to(this.choirGain.gain, level.choir * 0.5, 1.2)
    to(this.arpBus.gain, level.arp * 0.6)
    to(this.bassBus.gain, level.bass * 0.5)
    to(this.bassDrive.gain, 0.5 + level.drive * 3.5)
    to(this.bassTrim.gain, 1.5 - level.drive * 0.75)
    to(this.drumBus.gain, level.drums * 0.8)
    to(this.leadBus.gain, level.lead * 0.2, 1)
    to(this.airBus.gain, level.air * 0.1, 2)
    // Under water the hall grows, as if the sound had nowhere to go.
    to(this.reverbSend.gain, reverb * (0.8 + 0.5 * unit(depth)))
  }

  /** Schedule one sixteenth of the composition at `time`. `duration` is one sixteenth in seconds. */
  play(step: Step, time: number, duration: number): void {
    if (this.disposed) return
    const t = time
    if (step.chord) {
      step.chord.pad.forEach((midi, voice) => { for (const o of this.padOscs[voice]) o.frequency.setTargetAtTime(midiHz(midi), t, 0.18) })
      this.drone[0].frequency.setTargetAtTime(midiHz(step.chord.root), t, 0.4)
      this.drone[1].frequency.setTargetAtTime(midiHz(step.chord.root), t, 0.4)
      this.drone[2].frequency.setTargetAtTime(midiHz(step.chord.root + 19), t, 0.4)
      this.choirOscs[0].frequency.setTargetAtTime(midiHz(step.chord.pad[2]), t, 0.3)
      this.choirOscs[1].frequency.setTargetAtTime(midiHz(step.chord.pad[3]), t, 0.3)
      // Echoes fall on dotted eighths. Retimed only here so a tempo drift never warbles them.
      for (const delay of this.delays) delay.delayTime.setTargetAtTime(Math.min(1.4, duration * 3), t, 0.2)
    }
    if (step.arp) {
      const hz = midiHz(step.arp.midi), gate = duration * step.arp.steps
      for (const o of this.arpOscs) o.frequency.setValueAtTime(hz, t)
      this.arpFilter.frequency.setValueAtTime(350 + this.brightness * 2600 * step.arp.velocity, t)
      this.arpFilter.frequency.setTargetAtTime(180 + this.brightness * 500, t, 0.12)
      this.arpVca.gain.setTargetAtTime(0.5 * step.arp.velocity, t, 0.005)
      this.arpVca.gain.setTargetAtTime(0, t + gate * 0.85, 0.06)
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
      const hz = midiHz(step.lead.midi), hold = duration * step.lead.steps
      for (const o of this.leadOscs) o.frequency.setTargetAtTime(hz, t, 0.06)
      this.leadVca.gain.setTargetAtTime(step.lead.velocity, t, 0.09)
      this.leadVca.gain.setTargetAtTime(0, t + hold * 0.9, 0.3)
    }
    if (step.beep) {
      this.beep.frequency.setValueAtTime(midiHz(step.beep), t)
      this.beepVca.gain.setTargetAtTime(0.1, t, 0.004); this.beepVca.gain.setTargetAtTime(0, t + duration * 1.2, 0.008)
    }
    if (step.kick) {
      this.kick.frequency.setValueAtTime(120, t); this.kick.frequency.exponentialRampToValueAtTime(38, t + 0.14)
      this.kickVca.gain.setTargetAtTime(0.65 * step.kick, t, 0.003); this.kickVca.gain.setTargetAtTime(0, t + 0.1, 0.11)
      // Sidechain: pads, drone and bass dip under the kick and swell back.
      this.pump.gain.setTargetAtTime(1 - 0.4 * this.drums * step.kick, t, 0.008); this.pump.gain.setTargetAtTime(1, t + 0.08, duration * 1.2)
    }
    if (step.snare) {
      this.snareVca.gain.setTargetAtTime(0.3 * step.snare, t, 0.002); this.snareVca.gain.setTargetAtTime(0, t + 0.015, 0.04)
      this.snareBody.frequency.setValueAtTime(125, t); this.snareBody.frequency.exponentialRampToValueAtTime(62, t + 0.16)
      this.snareBodyVca.gain.setTargetAtTime(0.6 * step.snare, t, 0.003); this.snareBodyVca.gain.setTargetAtTime(0, t + 0.05, 0.12)
    }
    const hat = step.openHat ?? step.hat
    if (hat) { this.hatVca.gain.setTargetAtTime(0.1 * hat, t, 0.001); this.hatVca.gain.setTargetAtTime(0, t + 0.008, step.openHat ? 0.11 : 0.018) }
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
