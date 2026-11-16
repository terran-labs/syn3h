import { dirtVolume, engineIdle, engineRange, engineVolume, slipVolume, windVolume } from './params'

export interface MotionAudio { speed: number; throttle: number; airborne: boolean; kind?: string; wings?: boolean; slip?: number; altitude?: number; clearance?: number; zorbed?: boolean; /** Metres per second the body moves sideways (along its right axis) with at least two wheels down: a slide. */ slide?: number; /** The ground under a sliding vehicle (src/world/terrain/surface.ts), read only while it slides. */ surface?: string }
export const unit = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
export function motionMix(motion: MotionAudio) {
  const speed = unit(Math.abs(motion.speed) / 55), load = unit(Math.abs(motion.throttle))
  return { pitch: engineIdle.value + engineRange.value * (speed * .72 + load * .28),
    engine: engineVolume.value * (.22 + load * .5 + speed * .28),
    dirt: motion.airborne ? 0 : dirtVolume.value * Math.sqrt(speed),
    wind: windVolume.value * unit(speed * speed + (motion.airborne ? .25 : 0) + unit((motion.altitude ?? 0) / 600) * .3) }
}
/** Blend a circular overlap so decoded loops and generated noise have no boundary jump. */
export function seamlessBuffer(context: BaseAudioContext, input: AudioBuffer): AudioBuffer {
  const overlap = Math.min(Math.floor(context.sampleRate * .08), Math.floor(input.length / 4)), length = input.length - overlap
  const out = context.createBuffer(input.numberOfChannels, length, input.sampleRate)
  for (let c = 0; c < input.numberOfChannels; c++) {
    const src = input.getChannelData(c), dst = out.getChannelData(c)
    dst.set(src.subarray(overlap))
    for (let i = 0; i < overlap; i++) { const t = i / overlap; dst[length - overlap + i] = src[input.length - overlap + i] * (1 - t) + src[i] * t }
  }
  return out
}
export function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate), data = buffer.getChannelData(0)
  let last = 0, seed = 1777
  for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; last = (last + (seed / 2147483648 - 1) * .035) / 1.035; data[i] = last * 5 }
  return seamlessBuffer(context, buffer)
}
/**
 * The tyre squeal this replaced (16 November 2026), kept for the before and after report: a
 * triangle tone of 700 to 1150 Hz, heard whenever a grounded wheel's lateral slip passed 2 m/s.
 * At 100 m/s that is a slip angle of about one degree, so it sounded in ordinary fast driving,
 * and the triangle's odd harmonics put a narrow tone at 2.1 to 5.8 kHz.
 */
export const LEGACY_SLIP = (slip: number, airborne: boolean) => airborne ? 0 : unit((slip - 2) / 14)

/**
 * The scrub follows the body sliding sideways, not the wheels' contact slip: a bump or a landing
 * kicks single wheels sideways at up to 150 m/s for a frame or two (measured on rough ground),
 * while the body barely moves sideways (under 3 m/s). A real slide moves the whole vehicle.
 * SLIP_ALLOW (m/s) plus SLIP_ALLOW_PER_MS per m/s of speed is the sideways speed allowed before
 * the scrub starts: about 4.5 degrees of slip angle at 50 m/s, 3 at 100.
 */
export const SLIP_ALLOW = 2.5
export const SLIP_ALLOW_PER_MS = 0.03
/** Sideways speed beyond the allowance over which the scrub rises to full, growing with speed. */
const SLIP_SPAN = 4, SLIP_SPAN_PER_MS = 0.04
/**
 * How each ground colours the scrub: `centre` (Hz) of its noise band at full slide, `body`
 * the share of low rumble under it, `grit` the depth of its roughness and `rate` (Hz) how
 * coarse that roughness is. Loose ground hisses; rock is coarse; ice is smooth and quiet.
 */
const SCRUB: Record<string, { centre: number; body: number; grit: number; rate: number; level: number }> = {
  sand: { centre: 1150, body: 0.25, grit: 0.25, rate: 31, level: 0.8 },
  dust: { centre: 1050, body: 0.3, grit: 0.3, rate: 27, level: 0.85 },
  regolith: { centre: 1000, body: 0.35, grit: 0.35, rate: 23, level: 0.85 },
  snow: { centre: 900, body: 0.3, grit: 0.15, rate: 19, level: 0.6 },
  ice: { centre: 800, body: 0.15, grit: 0.1, rate: 15, level: 0.45 },
  rock: { centre: 650, body: 0.6, grit: 0.6, rate: 13, level: 1 },
  road: { centre: 700, body: 0.5, grit: 0.45, rate: 17, level: 0.9 },
  glass: { centre: 750, body: 0.4, grit: 0.5, rate: 15, level: 0.9 },
  mud: { centre: 450, body: 0.8, grit: 0.4, rate: 9, level: 0.85 },
  grass: { centre: 700, body: 0.5, grit: 0.3, rate: 21, level: 0.8 },
  soil: { centre: 650, body: 0.55, grit: 0.4, rate: 17, level: 0.9 },
  track: { centre: 650, body: 0.55, grit: 0.4, rate: 17, level: 0.9 },
}
const SCRUB_GENERAL = { centre: 750, body: 0.5, grit: 0.4, rate: 17, level: 0.9 }
/**
 * The tyre scrub for a motion: `level` 0..1 before the Tyre slip volume, the band `centre` in
 * Hz (never above 1.5 kHz), and the surface's body and grit. Silent until the lateral slip
 * passes the allowance for this speed, then eased in, so a slide never switches on.
 */
export function slipVoice(m: Pick<MotionAudio, 'speed' | 'slide' | 'airborne' | 'surface'>) {
  const speed = Number.isFinite(m.speed) ? Math.abs(m.speed) : 0, slip = m.airborne ? 0 : Math.max(0, Number.isFinite(m.slide ?? 0) ? m.slide ?? 0 : 0)
  const allowance = SLIP_ALLOW + SLIP_ALLOW_PER_MS * speed
  const a = unit((slip - allowance) / (SLIP_SPAN + SLIP_SPAN_PER_MS * speed)), amount = a * a * (3 - 2 * a)
  const ground = SCRUB[m.surface ?? ''] ?? SCRUB_GENERAL
  // Brighter the harder and faster the tyres slide, within the band below the most sensitive part of hearing.
  const centre = Math.min(1500, ground.centre * (0.55 + 0.45 * amount) * (0.85 + 0.3 * unit(slip / 30)))
  return { level: amount * ground.level, centre, body: ground.body, grit: ground.grit, rate: ground.rate * (0.7 + 0.6 * unit(slip / 25)) }
}
/** Seconds for the heard slide to rise and to fall: brief kicks are smoothed away, a held slide comes through. */
export const SLIDE_ATTACK = 0.15, SLIDE_RELEASE = 0.1
export const followSlide = (held: number, slip: number, dt: number) => held + (slip - held) * (1 - Math.exp(-Math.max(0, dt) / (slip > held ? SLIDE_ATTACK : SLIDE_RELEASE)))
/** The scrub's gain for a `slipVoice` level: on the Tyre slip volume alone, never the Engine volume. */
export const scrubGain = (level: number) => unit(level) * slipVolume.value * 0.25
/** White noise for the scrub, one buffer per context: the engine's noise is red and has little above 500 Hz. */
const whiteBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()
function whiteBuffer(context: BaseAudioContext): AudioBuffer {
  let buffer = whiteBuffers.get(context)
  if (buffer) return buffer
  buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
  const data = buffer.getChannelData(0)
  let seed = 90210
  for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1 }
  whiteBuffers.set(context, buffer = seamlessBuffer(context, buffer))
  return buffer
}

export function voiceProfile(m: MotionAudio) {
  const speed = unit(Math.abs(m.speed) / 55), load = unit(Math.abs(m.throttle)), flight = m.wings ? 1 : 0
  switch (m.kind) {
    case 'jet': return { pitch: 74 + load * 70 + speed * 25, tone: .5 - flight * .3, roar: .18 + load * (.35 + flight * .8), cutoff: 450 + load * 2200 + flight * 1200, pulse: 24, depth: .04 }
    case 'hovercraft': return { pitch: 62 + load * 44 + speed * 20, tone: .65, roar: .35 + load * .25 + .25 * (1 - unit((m.clearance ?? 2) / 8)), cutoff: 500 + speed * 850, pulse: 32 + load * 15, depth: .18 }
    case 'tank': return { pitch: 27 + load * 18 + speed * 22, tone: 1.4, roar: .65, cutoff: 210 + load * 170, pulse: 12 + speed * 36, depth: .55 }
    case 'buggy-classic': return { pitch: motionMix(m).pitch, tone: 1, roar: .45, cutoff: 300 + load * 450 + speed * 400, pulse: 16 + speed * 25, depth: .2 }
    default: return { pitch: 95 + load * 110 + speed * 210, tone: .75, roar: .14 + speed * .15, cutoff: 600 + speed * 1700, pulse: 9, depth: .06 }
  }
}
/**
 * How much of its motor a vehicle is heard to run, 0 to 1. A buggy with its wings out is
 * gliding: the hub motors are off, and what is left is the wind and the hum of the wing
 * fields. The jet's engines are what keep it up, so its wings change nothing here.
 */
export function motorLevel(m: MotionAudio): number {
  return m.wings && m.kind?.startsWith('buggy') ? 0 : 1
}
/** A fixed graph avoids allocating or clicking when a respawn changes vehicle kind. */
export class Engine {
  private readonly nodes: AudioNode[] = []
  private readonly sources: AudioScheduledSourceNode[] = []
  private readonly tone: GainNode
  private readonly roar: GainNode
  private readonly dirt: GainNode
  private readonly wind: GainNode
  private readonly field: GainNode
  /** The tyre scrub: band-passed noise with a low body and a rough grit, on its own volume. */
  private readonly scrub: GainNode
  private readonly scrubBand: BiquadFilterNode
  private readonly scrubBody: GainNode
  private readonly grit: OscillatorNode
  private readonly gritDepth: GainNode
  private readonly filter: BiquadFilterNode
  private readonly dirtFilter: BiquadFilterNode
  private readonly oscillators: OscillatorNode[] = []
  private readonly pulse: OscillatorNode
  private readonly pulseDepth: GainNode
  private windSource?: AudioBufferSourceNode
  private readonly vehicleGain: GainNode
  private zorbed = false
  /** The sideways speed heard, smoothed (followSlide), and when it was last updated. */
  private slide = 0
  private slideAt = -1
  private disposed = false
  constructor(private readonly context: BaseAudioContext, output: AudioNode, readonly noise = noiseBuffer(context)) {
    const own = <T extends AudioNode>(node:T):T => { this.nodes.push(node); return node }
    const gain = (destination:AudioNode) => { const g=own(context.createGain());g.gain.value=0;g.connect(destination);return g }
    // One bus fades every vehicle voice together, including modulation and road noise.
    this.vehicleGain = own(context.createGain()); this.vehicleGain.connect(output)
    output = this.vehicleGain
    this.tone=gain(output);this.roar=gain(output);this.dirt=gain(output);this.wind=gain(output);this.field=gain(output);this.scrub=gain(output)
    this.filter=own(context.createBiquadFilter());this.filter.type='lowpass';this.filter.Q.value=.6;this.filter.connect(this.roar)
    for (const ratio of [1,2.003]) { const o=own(context.createOscillator());o.type='triangle';o.frequency.value=36*ratio;const g=own(context.createGain());g.gain.value=ratio===1?.4:.1;o.connect(g).connect(this.tone);o.start();this.sources.push(o);this.oscillators.push(o) }
    const n=own(context.createBufferSource());n.buffer=noise;n.loop=true;n.connect(this.filter)
    this.dirtFilter=own(context.createBiquadFilter());this.dirtFilter.type='bandpass';this.dirtFilter.frequency.value=180;this.dirtFilter.Q.value=.6;n.connect(this.dirtFilter).connect(this.dirt);n.start();this.sources.push(n)
    this.pulse=own(context.createOscillator());this.pulseDepth=own(context.createGain());this.pulseDepth.gain.value=0;this.pulseDepth.connect(this.tone.gain);this.pulse.connect(this.pulseDepth).connect(this.dirt.gain);this.pulse.start();this.sources.push(this.pulse)
    const field=own(context.createOscillator());field.type='sine';field.frequency.value=147;field.connect(this.field);field.start();this.sources.push(field)
    // Tyre scrub: white noise through a wide band (Q 0.8) and a lowpass at 1.8 kHz, with a low
    // body under it, its level roughened by a slow sawtooth so it grinds instead of hissing evenly.
    const white=own(context.createBufferSource());white.buffer=whiteBuffer(context);white.loop=true;white.start();this.sources.push(white)
    this.scrubBand=own(context.createBiquadFilter());this.scrubBand.type='bandpass';this.scrubBand.frequency.value=700;this.scrubBand.Q.value=.8
    const shelf=own(context.createBiquadFilter());shelf.type='lowpass';shelf.frequency.value=1800;shelf.Q.value=.5
    const scrubIn=own(context.createGain());scrubIn.gain.value=1;scrubIn.connect(this.scrub)
    white.connect(this.scrubBand).connect(shelf).connect(scrubIn)
    const bodyFilter=own(context.createBiquadFilter());bodyFilter.type='lowpass';bodyFilter.frequency.value=240;bodyFilter.Q.value=.6
    this.scrubBody=own(context.createGain());this.scrubBody.gain.value=0;n.connect(bodyFilter).connect(this.scrubBody).connect(scrubIn)
    this.grit=own(context.createOscillator());this.grit.type='sawtooth';this.grit.frequency.value=17
    this.gritDepth=own(context.createGain());this.gritDepth.gain.value=0;this.grit.connect(this.gritDepth).connect(scrubIn.gain);this.grit.start();this.sources.push(this.grit)
  }
  get nodeCount():number {return this.disposed?0:this.nodes.length}
  setWind(buffer: AudioBuffer): void {
    if(this.windSource || this.disposed)return
    const s=this.context.createBufferSource(),f=this.context.createBiquadFilter();s.buffer=seamlessBuffer(this.context,buffer);s.loop=true;f.type='lowpass';f.frequency.value=1600;s.connect(f).connect(this.wind);s.start();this.windSource=s;this.sources.push(s);this.nodes.push(s,f)
  }
  update(motion: MotionAudio, enabled = true): void {
    if(this.disposed)return
    if (Boolean(motion.zorbed) !== this.zorbed) {
      this.zorbed = Boolean(motion.zorbed)
      const now = this.context.currentTime
      this.vehicleGain.gain.cancelAndHoldAtTime(now)
      this.vehicleGain.gain.linearRampToValueAtTime(this.zorbed ? 0 : 1, now + .2)
    }
    const m=motionMix(motion),p=voiceProfile(motion),now=this.context.currentTime,level=enabled?1:0
    const motor=motorLevel(motion)*level
    const smooth=(param:AudioParam,value:number,time=.12)=>param.setTargetAtTime(value,now,time)
    this.oscillators.forEach((o,i)=>smooth(o.frequency,p.pitch*(i?2.003:1),.18))
    smooth(this.filter.frequency,p.cutoff);smooth(this.tone.gain,m.engine*p.tone*motor);smooth(this.roar.gain,m.engine*p.roar*motor)
    const ground=m.dirt*(motion.kind==='tank'?1.35:1)*level
    smooth(this.dirt.gain,ground);smooth(this.pulse.frequency,p.pulse);smooth(this.pulseDepth.gain,ground*p.depth*motor)
    smooth(this.dirtFilter.frequency,motion.kind==='tank'?330:180+unit(Math.abs(motion.speed)/55)*400)
    smooth(this.wind.gain,m.wind*level,.3)
    smooth(this.field.gain,motion.wings&&motion.kind!=='jet'?.025*level:0,.2)
    // Tyre scrub, on its own slider. Soft onset and release (0.12 s and 0.25 s) so it never clicks or whistles on and off.
    this.slide=followSlide(this.slide,motion.airborne?0:motion.slide??0,this.slideAt<0?0:now-this.slideAt);this.slideAt=now
    const scrub=slipVoice({...motion,slide:this.slide}),scrubLevel=scrubGain(scrub.level)*level
    smooth(this.scrub.gain,scrubLevel,scrubLevel>this.scrub.gain.value?.12:.25)
    smooth(this.scrubBand.frequency,scrub.centre,.15);smooth(this.scrubBody.gain,scrub.body*2,.2)
    smooth(this.gritDepth.gain,scrub.grit*.8,.2);smooth(this.grit.frequency,scrub.rate,.2)
  }
  /** Fade before stopping sources; all intermediate nodes are explicitly disconnected. */
  dispose(immediate = false): void {
    if(this.disposed)return;this.disposed=true
    if(immediate){for(const source of this.sources){source.onended=null;source.stop()}for(const node of this.nodes)node.disconnect();this.sources.length=0;this.nodes.length=0;return}
    const now=this.context.currentTime
    for(const g of [this.tone,this.roar,this.dirt,this.wind,this.field,this.scrub,this.pulseDepth]){g.gain.cancelAndHoldAtTime(now);g.gain.linearRampToValueAtTime(0,now+.04)}
    for(const source of this.sources)source.stop(now+.05)
    this.sources[0].onended=()=>{for(const node of this.nodes)node.disconnect()}
  }
}
