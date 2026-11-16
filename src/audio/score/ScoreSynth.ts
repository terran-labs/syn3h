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
 *   plucked strings (physical model), brass, bell (modal) ──────────────────┤
 *   sung choir (voice model), string section, low brass hit, endless rise ──┤
 *   shimmer: an octave-up cascade into the hall ────────────────────────────┤
 *   sends: tempo-synced ping-pong delay, convolution hall ──────────────────┘
 *
 * At a release an additive pipe organ, a high choir and an octave halo join the pads.
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

export const LAYERS = ['pad', 'drone', 'choir', 'organ', 'sequencer', 'pluck', 'strings', 'bass', 'drums', 'theremin', 'brass', 'bells', 'shimmer', 'air', 'tags', 'weather'] as const
export type Layer = (typeof LAYERS)[number]
/** Where the composition is in its arc, as the synthesiser needs it. Both 0..1. */
export interface Arc { tension: number; release: number; /** 0..1, how far forward the theremin may come (arc.ts). Left out, as before. */ lead?: number }

export class ScoreSynth {
  /** Per-layer level trims, 0 to mute. The lab uses these to solo and mute layers. */
  readonly trim: Record<Layer, number> = { pad: 1, drone: 1, choir: 1, organ: 1, sequencer: 1, pluck: 1, strings: 1, bass: 1, drums: 1, theremin: 1, brass: 1, bells: 1, shimmer: 1, air: 1, tags: 1, weather: 1 }
  /**
   * Convoy harmony. Null is the ordinary score. Otherwise up to three nearby vehicles each
   * carry part of the arrangement, heard from their side and only as loud as they are near:
   * the first the strings, the second the brass and the women of the choir, the third the
   * organ and the bell. Alone, those parts are silent.
   */
  convoy: readonly { level: number; pan: number }[] | null = null
  /** 0 calm to 1 gale, from the game's weather. The score's own wind layer gives way to the real one, so two winds never blow at once. */
  wind = 0
  /** Pitch ratio applied to the telemetry beep: above 1 when something is closing on the listener. */
  doppler = 1
  /** Resolves when the worklets (plucked strings, sung choir, shimmer) have loaded or failed to; the score plays without them meanwhile. */
  readonly ready: Promise<void>
  private readonly nodes: AudioNode[] = []
  private readonly sources: AudioScheduledSourceNode[] = []
  private readonly out: GainNode
  private readonly pump: GainNode
  private readonly swell: GainNode
  private readonly output: AudioNode
  private parked = true
  private parkAt = Infinity
  private readonly dry: GainNode
  /** Audio time at which the breath before a release begins; Infinity when none is pending. */
  private hushAt = Infinity
  private readonly padBus: GainNode
  private readonly padFilter: BiquadFilterNode
  private readonly padOscs: OscillatorNode[][] = []
  private readonly drone: OscillatorNode[] = []
  private readonly droneGain: GainNode
  private readonly choirOscs: OscillatorNode[] = []
  private readonly choirGain: GainNode
  private readonly highChoirOscs: OscillatorNode[] = []
  private readonly highChoirGain: GainNode
  private readonly organOscs: OscillatorNode[] = []
  private readonly organGain: GainNode
  private readonly haloOscs: OscillatorNode[] = []
  private readonly haloGain: GainNode
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
  private readonly pluckBus: GainNode
  private pluck?: AudioWorkletNode
  private readonly brassOscs: OscillatorNode[] = []
  private readonly brassFilter: BiquadFilterNode
  private readonly brassVca: GainNode
  private readonly brassWaver: GainNode
  private readonly brassBus: GainNode
  private readonly bellPartials: { osc: OscillatorNode; vca: GainNode; ratio: number; level: number; ring: number }[] = []
  private readonly bellBus: GainNode
  private choir?: AudioWorkletNode
  private readonly organPan: StereoPannerNode
  private readonly brassPan: StereoPannerNode
  private readonly bellPan: StereoPannerNode
  private readonly stringPan: StereoPannerNode
  private readonly tags: { carrier: OscillatorNode; modulator: OscillatorNode; index: GainNode; vca: GainNode }[] = []
  private readonly tagBus: GainNode
  private nextTag = 0
  private readonly sweep: OscillatorNode
  private readonly sweepVca: GainNode
  private readonly sweepPan: StereoPannerNode
  private readonly weatherBus: GainNode
  private hall?: AudioWorkletNode
  private riseOn = false
  private braamUntil = -1
  private readonly riseOut: AudioNode[]
  private readonly braamOut: AudioNode[]
  private shimmer?: AudioWorkletNode
  private readonly shimmerOut: GainNode
  private readonly stringOscs: OscillatorNode[][] = []
  private readonly stringVca: GainNode
  private readonly stringBus: GainNode
  private readonly braamOscs: OscillatorNode[] = []
  private readonly braamFilter: BiquadFilterNode
  private readonly braamVca: GainNode
  private readonly rise: { osc: OscillatorNode; vca: GainNode }[] = []
  private readonly riseBus: GainNode
  private risePhase = 0
  private riseTime = 0
  private rootHz = 55
  private chordHz = [220, 220, 220, 220]
  private readonly delays: DelayNode[] = []
  private readonly reverbSend: GainNode
  private brightness = 0.4
  private drums = 0
  private disposed = false

  /**
   * `lite` builds a cheaper graph for phones: no sung choir (filtered saws stand in), no shimmer,
   * no halo or endless rise, fewer oscillators in the pads, strings, bell and low brass, and a
   * 1.6 second hall in place of 5.5. The hall is the largest single cost. Same music, less air.
   */
  constructor(private readonly context: BaseAudioContext, output: AudioNode, readonly lite = false, /** Use the algorithmic hall (hall.worklet.js), a quarter of the cost of the convolution. */ readonly network = lite) {
    const c = context
    const own = <T extends AudioNode>(node: T): T => { this.nodes.push(node); return node }
    const gain = (value: number, ...to: (AudioNode | AudioParam)[]) => { const g = own(c.createGain()); g.gain.value = value; for (const node of to) g.connect(node as AudioNode); return g }
    const osc = (type: OscillatorType, hz = 110) => { const o = own(c.createOscillator()); o.type = type; o.frequency.value = hz; this.sources.push(o); return o }
    const filter = (type: BiquadFilterType, hz: number, q = 0.7) => { const f = own(c.createBiquadFilter()); f.type = type; f.frequency.value = hz; f.Q.value = q; return f }
    const pan = (value: number, to: AudioNode) => { const p = own(c.createStereoPanner()); p.pan.value = value; p.connect(to); return p }
    const loop = (buffer: AudioBuffer) => { const s = own(c.createBufferSource()); s.buffer = buffer; s.loop = true; this.sources.push(s); return s }

    // Not connected yet: the whole graph stays unplugged, and so uncomputed, until the score is
    // asked to sound, and is unplugged again once it has faded out. A player listening to a
    // recording, or with music off, pays nothing for the score.
    this.out = gain(0); this.output = output
    // A gentle bus compressor glues the layers and keeps a full passage from towering over a quiet one.
    const glue = own(c.createDynamicsCompressor()); glue.threshold.value = -20; glue.knee.value = 14; glue.ratio.value = 3; glue.attack.value = 0.02; glue.release.value = 0.25
    // After the compressor, so it cannot be flattened: the release is allowed to be louder than the build.
    this.swell = gain(0.8, this.out); glue.connect(this.swell)
    // `sum` is every instrument heard directly. The hall and the echoes return beside it, so the
    // breath before a release can silence the instruments and leave only their tail hanging.
    const sum = this.dry = gain(0.46, glue), wet = gain(0.46, glue)
    this.pump = gain(1, sum)

    // Hall and ping-pong delay, both fed by sends.
    // The hall is either a convolution with a generated impulse (the original, and the most
    // expensive thing here) or the feedback delay network in hall.worklet.js, which costs a
    // quarter as much and whose tail can grow while it rings. If the network cannot load, the
    // convolution takes its place.
    this.reverbSend = gain(0.9, wet)
    const reverb = gain(1)
    const convolve = () => { const hall = own(c.createConvolver()); hall.buffer = hallImpulse(c, lite ? 1.6 : 5.5); reverb.connect(hall).connect(this.reverbSend) }
    const hallReady = !network ? (convolve(), Promise.resolve()) : context.audioWorklet.addModule(new URL('./hall.worklet.js', import.meta.url).href).then(() => {
      if (this.disposed) return
      this.hall = own(new AudioWorkletNode(context, 'hall', { numberOfInputs: 1, channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2] }))
      reverb.connect(this.hall).connect(this.reverbSend)
    }).catch(convolve)
    const left = own(c.createDelay(1.5)), right = own(c.createDelay(1.5)), damp = filter('lowpass', 3200)
    this.delays.push(left, right)
    const delayIn = gain(1, left)
    left.connect(pan(-0.75, wet)); right.connect(pan(0.75, wet))
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
      for (let i = lite ? 1 : 0; i < 3; i++) {
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

    // High choir: the same idea an octave up with brighter formants. It enters only at a release
    // or high in open air, so its arrival means something.
    this.highChoirGain = gain(0, gain(0.6, sum), reverb)
    const highFormants = ([[850, 9, 1], [1200, 10, 0.5], [2900, 9, 0.25]] as const).map(([hz, q, level]) => { const f = filter('bandpass', hz, q); f.connect(gain(level, this.highChoirGain)); return f })
    for (let i = 0; i < 2; i++) {
      const o = osc('sawtooth', 660); o.detune.value = i ? 8 : -8
      const waver = gain(9); osc('sine', 4.7 + i * 0.6).connect(waver); waver.connect(o.detune)
      const level = gain(0.3); o.connect(level); for (const f of highFormants) level.connect(f)
      this.highChoirOscs.push(o)
    }

    // Pipe organ: one oscillator per chord voice, its waveform built from drawbar harmonics
    // (8', 4', 2 2/3', 2', 1 1/3', 1'). Sines summed this way are what an organ actually is.
    const drawbars = new Float32Array([0, 1, 0.7, 0.45, 0.35, 0, 0.18, 0, 0.12]), pipes = c.createPeriodicWave(new Float32Array(drawbars.length), drawbars)
    this.organPan = pan(0, gain(0.5, sum))
    this.organGain = gain(0, this.organPan, reverb)
    for (let voice = 0; voice < 4; voice++) { const o = osc('sine', 220); o.setPeriodicWave(pipes); o.connect(pan((voice - 1.5) * 0.4, gain(0.16, this.organGain))); this.organOscs.push(o) }

    // Halo: the chord two octaves up as bare sines, heard only through the hall. It grows with
    // the build, so the air above the music seems to open before the release lands.
    this.haloGain = gain(0, reverb)
    const shiver = gain(0.5, this.haloGain); osc('sine', 0.23).connect(gain(0.35, shiver.gain))
    for (let voice = 0; voice < (lite ? 0 : 4); voice++) { const o = osc('sine', 880); o.detune.value = (voice - 1.5) * 5; o.connect(gain(0.25, shiver)); this.haloOscs.push(o) }

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
    // It stands at a distance: less than half its direct sound, more of it in the hall, and a
    // narrower, slower vibrato (8 cents at 4.8 Hz, from 16 at 5.6) so it wails less.
    this.leadBus = gain(0, gain(0.45, sum), gain(0.4, delayIn), gain(1.3, reverb))
    this.leadVca = gain(0, this.leadBus)
    const waver = gain(8); osc('sine', 4.8).connect(waver)
    for (const [type, level] of [['sine', 0.5], ['triangle', 0.2]] as const) { const o = osc(type, 440); waver.connect(o.detune); o.connect(gain(level, this.leadVca)); this.leadOscs.push(o) }
    // Telemetry beep: a plain sine a long way off.
    this.beep = osc('sine', 1000); this.beepVca = gain(0, gain(0.25, pan(0.4, sum)), gain(0.5, delayIn), reverb); this.beep.connect(this.beepVca)

    // Brass: two saws whose filter opens as the note swells, a pitch that scoops up into the
    // note, and vibrato that only arrives once the note is held. The horn of a 1970s polysynth.
    this.brassPan = pan(0, sum)
    this.brassBus = gain(0, this.brassPan, gain(0.25, delayIn), gain(0.7, reverb))
    this.brassFilter = filter('lowpass', 300, 1.3); this.brassVca = gain(0, this.brassBus); this.brassFilter.connect(this.brassVca)
    this.brassWaver = gain(0); osc('sine', 5.2).connect(this.brassWaver)
    for (const detune of [-9, 9]) { const o = osc('sawtooth', 220); o.detune.value = detune; this.brassWaver.connect(o.detune); o.connect(gain(0.4, this.brassFilter)); this.brassOscs.push(o) }

    // Bell: modal synthesis. A bell is a handful of pure tones at fixed, inharmonic ratios (hum,
    // prime, the minor-third tierce, quint, nominal and up), each dying at its own rate.
    this.bellPan = pan(0, gain(0.5, sum))
    this.bellBus = gain(0, this.bellPan, reverb)
    const partials = [[0.5, 0.25, 6], [1, 0.5, 4.5], [1.2, 0.35, 3.2], [1.5, 0.2, 2.4], [2.003, 0.45, 2], [2.5, 0.15, 1.2], [3, 0.2, 1], [4.01, 0.12, 0.6]] as const
    for (const [ratio, level, ring] of lite ? partials.slice(0, 5) : partials) {
      const o = osc('sine', 220 * ratio), vca = gain(0, this.bellBus); o.connect(vca)
      this.bellPartials.push({ osc: o, vca, ratio, level, ring })
    }

    this.pluckBus = gain(0, sum, gain(0.3, delayIn), gain(0.55, reverb))

    // Tag notes: a bright two-operator ping, for tag beams that have been turned into music.
    this.tagBus = gain(0, sum, gain(0.35, delayIn), gain(0.5, reverb))
    for (let i = 0; i < 3; i++) {
      const carrier = osc('sine', 880), modulator = osc('sine', 1760), index = gain(0, carrier.frequency), vca = gain(0, pan((i - 1) * 0.5, this.tagBus))
      modulator.connect(index); carrier.connect(vca)
      this.tags.push({ carrier, modulator, index, vca })
    }

    // Space weather: one sine that sweeps. Falling, it is a whistler, the radio trace of distant
    // lightning; rising in short chirps, it is the dawn chorus of the magnetosphere.
    this.weatherBus = gain(0, gain(0.35, sum), reverb)
    this.sweep = osc('sine', 3000); this.sweepVca = gain(0); this.sweepPan = pan(0, this.weatherBus)
    this.sweep.connect(this.sweepVca).connect(this.sweepPan)

    // String section: three notes of the chord, each two saws, through the resonances of a
    // wooden body (the three peaking filters), bowed short. It drives the build and the climb.
    this.stringPan = pan(0, sum)
    this.stringBus = gain(0, this.stringPan, gain(0.5, reverb))
    this.stringVca = gain(0, this.stringBus)
    const body = [filter('lowpass', 3400, 0.7), filter('peaking', 290, 1.5), filter('peaking', 700, 2), filter('peaking', 2600, 2)]
    body.slice(1).forEach((f, n) => { f.gain.value = [4, 3, 5][n] })
    body.reduce((from, to) => { from.connect(to); return to }).connect(this.stringVca)
    for (let voice = 0; voice < 3; voice++) {
      const pair: OscillatorNode[] = []
      for (const detune of lite ? [0] : [-6, 7]) { const o = osc('sawtooth', 220); o.detune.value = detune; o.connect(gain(0.16, pan((voice - 1) * 0.5, body[0]))); pair.push(o) }
      this.stringOscs.push(pair)
    }

    // Low brass hit: a stack of saws on the bass note, driven hard, the filter thrown open and
    // let fall. It answers a turn to a dark mode and a tag landing on you.
    this.braamFilter = filter('lowpass', 150, 1); this.braamVca = gain(0)
    // Connected only while a hit is sounding: an unconnected voice is not computed at all.
    this.braamOut = [sum, gain(0.6, reverb)]
    const growl = own(c.createWaveShaper()); growl.curve = tanhCurve; growl.oversample = '2x'
    this.braamFilter.connect(growl).connect(this.braamVca)
    const stack = [[1, -8], [1.5, 0], [1, 8], [2, 5]] as const
    for (const [ratio, detune] of lite ? stack.slice(0, 2) : stack) { const o = osc('sawtooth', 55 * ratio); o.detune.value = detune; o.connect(gain(0.3, this.braamFilter)); this.braamOscs.push(o) }

    // Endless rise (Shepard and Risset): eight sines an octave apart glide upward together. Each
    // fades in at the bottom and out at the top, so the ear hears a climb that never arrives.
    // It runs under the climb and is cut at the release.
    this.riseBus = gain(0)
    this.riseOut = [gain(0.5, sum), reverb]
    for (let n = 0; n < (lite ? 0 : 8); n++) { const o = osc('sine', 30), vca = gain(0, this.riseBus); o.connect(vca); this.rise.push({ osc: o, vca }) }

    // Shimmer: an octave-up cascade (shimmer.worklet.js) fed from the pads, choir, strings,
    // bell and theremin, and returned through the hall.
    const shimmerIn = gain(1)
    this.shimmerOut = gain(0, reverb, gain(0.25, sum))
    for (const [from, amount] of [[this.padBus, 0.5], [this.pluckBus, 0.5], [this.bellBus, 0.7], [this.leadBus, 0.4], [this.organGain, 0.4]] as const) from.connect(gain(amount, shimmerIn))

    // Plucked strings, a sung choir and the shimmer are audio worklets. Each loads on its own:
    // if one fails, or a browser has no worklets, the score plays on without it.
    const load = (file: string, then: () => void) => context.audioWorklet.addModule(file).then(() => { if (!this.disposed) then() }).catch(() => {})
    this.ready = Promise.all([
      load(new URL('./pluck.worklet.js', import.meta.url).href, () => {
        this.pluck = own(new AudioWorkletNode(context, 'pluck', { numberOfInputs: 0, outputChannelCount: [2] }))
        this.pluck.connect(this.pluckBus)
      }),
      lite ? Promise.resolve() : load(new URL('./choir.worklet.js', import.meta.url).href, () => {
        this.choir = own(new AudioWorkletNode(context, 'choir', { numberOfInputs: 0, outputChannelCount: [2] }))
        this.choir.connect(gain(0.7, sum)); this.choir.connect(reverb); this.choir.connect(gain(0.6, shimmerIn))
        // The oscillator choirs were the fallback. Unplugged, they cost nothing.
        this.choirGain.disconnect(); this.highChoirGain.disconnect()
        this.sing(0.01)
      }),
      lite ? Promise.resolve() : load(new URL('./shimmer.worklet.js', import.meta.url).href, () => {
        this.shimmer = own(new AudioWorkletNode(context, 'shimmer', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2] }))
        shimmerIn.connect(this.shimmer); this.shimmer.connect(this.shimmerOut)
      }),
      hallReady,
    ]).then(() => {})
    for (const source of this.sources) source.start()
  }

  get nodeCount(): number { return this.nodes.length }

  /** Overall level of the score, for fading it in and out. */
  setLevel(level: number, seconds = 1.5): void {
    const now = this.context.currentTime
    if (level > 0 && this.parked) { this.out.connect(this.output); this.parked = false }
    this.parkAt = level > 0 ? Infinity : now + seconds * 2 + 0.5
    this.out.gain.cancelScheduledValues(now)
    this.out.gain.setTargetAtTime(level, now, seconds / 3)
  }

  /** Move every layer toward the levels the mood asks for. Called every frame. */
  setLevels(level: Levels, depth: number, reverb: number, arc: Arc = { tension: 0, release: 0 }): void {
    const now = this.context.currentTime, to = (param: AudioParam, value: number, tau = 0.5) => param.setTargetAtTime(value, now, tau)
    if (!this.parked && now > this.parkAt) { this.out.disconnect(); this.parked = true }
    // While unplugged nothing reads these parameters, so nothing clears what is scheduled on them.
    // Scheduling every frame regardless would pile up events for as long as the score stayed silent.
    if (this.parked) return
    const trim = this.trim, bright = unit(level.brightness + 0.3 * arc.tension + 0.2 * arc.release)
    this.brightness = bright; this.drums = level.drums
    to(this.swell.gain, 0.72 + 0.1 * arc.tension + 0.33 * arc.release, 0.3)
    to(this.padBus.gain, level.pad * 0.9 * trim.pad)
    to(this.padFilter.frequency, 320 + bright ** 1.5 * 4200)
    to(this.droneGain.gain, level.drone * 0.4 * trim.drone)
    // The low choir is always near; the release brings it and the high choir fully forward.
    // The men are always near; the women are held back for a release or for high open air, so
    // their entry means something. The mouths open as the music climbs. The oscillator choirs
    // are the fallback and fall silent once the sung choir has loaded.
    // In a convoy the neighbours carry these parts: each is as loud as its vehicle is near, and sits on its side.
    // A part with no neighbour to carry it stays with the player, and a far neighbour only
    // softens its part: driving alone or at a distance never thins the music out.
    const carried = (slot: number) => { const voice = this.convoy?.[slot]; return voice ? 0.4 + 0.6 * voice.level : 1 }, side = (slot: number) => this.convoy?.[slot]?.pan ?? 0
    to(this.stringPan.pan, side(0), 0.3); to(this.brassPan.pan, side(1), 0.3); to(this.organPan.pan, side(2), 0.3); to(this.bellPan.pan, side(2), 0.3)
    const men = unit(Math.max(level.choir, arc.release * 0.9, 0.2)) * trim.choir, women = unit(Math.max(arc.release, (level.choir - 0.5) * 2)) * trim.choir * carried(1)
    to(this.choirGain.gain, this.choir ? 0 : men * 0.5, 1.2)
    to(this.highChoirGain.gain, this.choir ? 0 : women * 0.45, 0.8)
    if (this.choir) {
      to(this.choir.parameters.get('men')!, men * 0.9, 1.2)
      to(this.choir.parameters.get('women')!, women, 0.6)
      to(this.choir.parameters.get('open')!, unit(0.15 + 0.6 * arc.tension + 0.25 * level.choir), 1)
    }
    to(this.shimmerOut.gain, unit(0.15 + 0.5 * arc.tension + 0.35 * level.choir + 0.3 * arc.release) * 0.7 * trim.shimmer, 1.5)
    to(this.stringBus.gain, 0.55 * trim.strings * carried(0))
    to(this.tagBus.gain, 0.5 * trim.tags)
    to(this.weatherBus.gain, 0.5 * trim.weather)
    this.climb(arc, now)
    to(this.organGain.gain, unit(Math.max(arc.release, level.choir * 0.5)) * 0.5 * trim.organ * carried(2), 0.8)
    to(this.haloGain.gain, unit(arc.tension * 0.7 + level.choir * 0.4) * 0.12 * trim.pad, 1.5)
    to(this.arpBus.gain, level.arp * 0.6 * trim.sequencer)
    to(this.bassBus.gain, level.bass * 0.5 * trim.bass)
    to(this.bassDrive.gain, 0.5 + level.drive * 3.5)
    to(this.bassTrim.gain, 1.5 - level.drive * 0.75)
    // The climb's drum roll and the release's heartbeat sound however calm the play is.
    to(this.drumBus.gain, Math.max(level.drums, arc.tension > 0.5 ? 0.6 : 0, arc.release * 0.7) * 0.8 * trim.drums)
    // The lead's bus. `arc.lead` (time of day, the lobby) scales it; when it may sing at all it
    // keeps a floor, so a night theme over a moving mix is distant rather than lost.
    to(this.leadBus.gain, Math.max(level.lead * 0.6, arc.lead === undefined ? 0 : 0.6, arc.release) * 0.2 * trim.theremin * unit(arc.lead ?? 1), 1)
    to(this.airBus.gain, level.air * 0.1 * trim.air * (1 - 0.8 * unit(this.wind)), 2)
    to(this.pluckBus.gain, 0.5 * trim.pluck)
    to(this.brassBus.gain, 0.45 * trim.brass * carried(1))
    to(this.bellBus.gain, 0.6 * trim.bells * carried(2))
    // Under water the hall grows, as if the sound had nowhere to go.
    to(this.reverbSend.gain, reverb * (0.8 + 0.5 * unit(depth)))
    // The algorithmic hall can do what a recorded impulse cannot: its tail lengthens at a release and under water.
    if (this.hall) to(this.hall.parameters.get('decay')!, (this.lite ? 4 : 5.5) * (1 + 0.6 * arc.release + 0.5 * unit(depth)), 0.5)
    if (this.braamUntil >= 0 && now > this.braamUntil) { this.braamVca.disconnect(); this.braamUntil = -1 }
  }

  /** Schedule one sixteenth of the composition at `time`. `duration` is one sixteenth in seconds. */
  play(step: Step, time: number, duration: number): void {
    if (this.disposed) return
    const t = time
    if (step.chord) {
      this.voice(step.chord.pad, t, 0.18)
      this.drone[0].frequency.setTargetAtTime(midiHz(step.chord.root), t, 0.4)
      this.drone[1].frequency.setTargetAtTime(midiHz(step.chord.root), t, 0.4)
      this.drone[2].frequency.setTargetAtTime(midiHz(step.chord.root + 19), t, 0.4)
      this.choirOscs[0].frequency.setTargetAtTime(midiHz(step.chord.pad[2]), t, 0.3)
      this.choirOscs[1].frequency.setTargetAtTime(midiHz(step.chord.pad[3]), t, 0.3)
      this.highChoirOscs[0].frequency.setTargetAtTime(midiHz(step.chord.pad[0] + 12), t, 0.3)
      this.highChoirOscs[1].frequency.setTargetAtTime(midiHz(step.chord.pad[2] + 12), t, 0.3)
      this.rootHz = midiHz(step.chord.root)
      // A turn to a dark mode lands with low brass as well as the sub drop.
      if (step.impact && (step.chord.mode === 'phrygian' || step.chord.mode === 'harmonic')) this.braam(t)
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
      // A short glide (less swoop between notes) and a softer onset.
      for (const o of this.leadOscs) o.frequency.setTargetAtTime(hz, t, 0.035)
      this.leadVca.gain.setTargetAtTime(step.lead.velocity, t, 0.16)
      this.leadVca.gain.setTargetAtTime(0, t + hold * 0.9, 0.3)
    }
    if (step.pluck) this.pluck?.port.postMessage({ t, hz: midiHz(step.pluck.midi), velocity: step.pluck.velocity, sustain: 1.5 + duration * step.pluck.steps })
    if (step.brass) {
      const hz = midiHz(step.brass.midi), hold = duration * step.brass.steps, v = step.brass.velocity
      for (const o of this.brassOscs) { o.frequency.setValueAtTime(hz * 0.983, t); o.frequency.exponentialRampToValueAtTime(hz, t + 0.12) }
      this.brassFilter.frequency.setValueAtTime(260, t); this.brassFilter.frequency.linearRampToValueAtTime(700 + 2600 * v, t + 0.28); this.brassFilter.frequency.setTargetAtTime(900, t + 0.28, hold * 0.7)
      this.brassVca.gain.setTargetAtTime(0.5 * v, t, 0.07); this.brassVca.gain.setTargetAtTime(0, t + hold * 0.92, 0.2)
      this.brassWaver.gain.setValueAtTime(0, t); this.brassWaver.gain.linearRampToValueAtTime(13, t + 1)
    }
    if (step.bell) {
      const hz = midiHz(step.bell.midi)
      for (const p of this.bellPartials) {
        p.osc.frequency.setValueAtTime(hz * p.ratio, t)
        p.vca.gain.setTargetAtTime(p.level * 0.45 * step.bell.velocity, t, 0.002); p.vca.gain.setTargetAtTime(0, t + 0.01, p.ring * 0.45)
      }
    }
    if (step.tag) {
      const tag = this.tags[this.nextTag++ % this.tags.length], hz = midiHz(step.tag.midi), v = step.tag.velocity
      tag.carrier.frequency.setValueAtTime(hz, t); tag.modulator.frequency.setValueAtTime(hz * 2, t)
      tag.index.gain.setValueAtTime(hz * 2.2 * v, t); tag.index.gain.setTargetAtTime(hz * 0.1, t, 0.05)
      tag.vca.gain.setTargetAtTime(0.4 * v, t, 0.002); tag.vca.gain.setTargetAtTime(0, t + 0.02, 0.12)
    }
    if (step.beep) {
      this.beep.frequency.setValueAtTime(midiHz(step.beep) * this.doppler, t)
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
    // A suspension resolving: only the one voice moves, and slowly enough to be heard moving.
    if (step.resolve) this.voice(step.resolve, t, 0.35)
    if (step.strings) {
      step.strings.midi.forEach((midi, voice) => { for (const o of this.stringOscs[voice]) o.frequency.setValueAtTime(midiHz(midi), t) })
      this.stringVca.gain.setTargetAtTime(0.6 * step.strings.velocity, t, 0.012); this.stringVca.gain.setTargetAtTime(0, t + 0.06, 0.075)
    }
    // The breath: pads, drone and bass fall away and leave the hall ringing. The impact restores them.
    if (step.breath) { this.dry.gain.setTargetAtTime(0.02, t, 0.07); this.hushAt = t }
    if (step.riser) this.riser(t, duration * step.riser)
    if (step.impact) this.impact(t)
  }

  /** Tune the pads, organ and halo to four chord voices, gliding over `glide` seconds. */
  private voice(pad: number[], time: number, glide: number): void {
    this.chordHz = pad.map(midiHz)
    this.sing(glide)
    pad.forEach((midi, voice) => {
      const hz = midiHz(midi)
      for (const o of this.padOscs[voice]) o.frequency.setTargetAtTime(hz, time, glide)
      this.organOscs[voice].frequency.setTargetAtTime(hz, time, glide)
      this.haloOscs[voice]?.frequency.setTargetAtTime(hz * 4, time, glide)
    })
  }

  /** Give the sung choir its four parts: men on the root and fifth, women on the third and colour an octave up. */
  private sing(glide: number): void {
    const [root, third, fifth, colour] = this.chordHz
    this.choir?.port.postMessage({ notes: [root, fifth, third * 2, colour * 2], glide })
  }

  /** The endless rise. Called every frame; it only sounds while the arc is in its climb. */
  private climb(arc: Arc, now: number): void {
    const rising = arc.tension > 0.5 && arc.release < 0.5 && now < this.hushAt, dt = Math.min(0.25, Math.max(0, now - this.riseTime))
    this.riseTime = now
    // Plugged in only while it climbs.
    if (rising && !this.riseOn) { for (const to of this.riseOut) this.riseBus.connect(to); this.riseOn = true }
    else if (!rising && this.riseOn && this.riseBus.gain.value < 0.001) { this.riseBus.disconnect(); this.riseOn = false }
    this.riseBus.gain.setTargetAtTime(rising ? (arc.tension - 0.5) * 0.5 * this.trim.pad : 0, now, rising ? 0.8 : 0.05)
    if (!rising) return
    // One octave every twelve seconds, faster as the climb nears its top.
    this.risePhase = (this.risePhase + dt * (0.06 + 0.08 * arc.tension)) % 1
    this.rise.forEach(({ osc: o, vca }, n) => {
      const place = (n + this.risePhase) / this.rise.length
      // A partial that wraps from the top to the bottom is silent at both ends, so it can jump.
      o.frequency.setTargetAtTime(27.5 * 2 ** (place * this.rise.length), now, place < 0.02 ? 0.001 : 0.05)
      vca.gain.setTargetAtTime(0.5 * Math.sin(Math.PI * place) ** 2, now, 0.05)
    })
  }

  /**
   * Space weather. A whistler falls from `from` to `to` Hz over about a second; a chorus is a
   * handful of quick rising chirps. `place` is -1..1 across the stereo field.
   */
  whistler(time: number, from: number, to: number, seconds: number, place: number, level = 1): void {
    this.sweepPan.pan.setValueAtTime(place, time)
    this.sweep.frequency.setValueAtTime(from, time); this.sweep.frequency.exponentialRampToValueAtTime(to, time + seconds)
    this.sweepVca.gain.setTargetAtTime(0.4 * level, time, seconds * 0.12); this.sweepVca.gain.setTargetAtTime(0, time + seconds * 0.6, seconds * 0.15)
  }
  chorus(time: number, chirps: number, place: number): void {
    for (let n = 0; n < chirps; n++) {
      const at = time + n * 0.19, from = 1400 + 300 * (n % 3)
      this.sweepPan.pan.setValueAtTime(place, at)
      this.sweep.frequency.setValueAtTime(from, at); this.sweep.frequency.exponentialRampToValueAtTime(from * 2.1, at + 0.14)
      this.sweepVca.gain.setTargetAtTime(0.28, at, 0.015); this.sweepVca.gain.setTargetAtTime(0, at + 0.09, 0.02)
    }
  }

  /** A low brass hit on the current bass note. */
  braam(time: number = this.context.currentTime + 0.02, strength = 1): void {
    const ratios = [1, 1.5, 1, 2]
    this.braamOscs.forEach((o, n) => o.frequency.setValueAtTime(this.rootHz * ratios[n], time))
    this.braamFilter.frequency.setValueAtTime(140, time); this.braamFilter.frequency.linearRampToValueAtTime(1200, time + 0.22); this.braamFilter.frequency.setTargetAtTime(220, time + 0.22, 0.5)
    if (this.braamUntil < 0) for (const to of this.braamOut) this.braamVca.connect(to)
    this.braamUntil = time + 5
    this.braamVca.gain.setTargetAtTime(0.4 * strength * this.trim.brass, time, 0.035); this.braamVca.gain.setTargetAtTime(0, time + 0.9, 0.45)
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
    this.pump.gain.setTargetAtTime(1, time, 0.01); this.dry.gain.setTargetAtTime(0.46, time, 0.004); this.hushAt = Infinity
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
