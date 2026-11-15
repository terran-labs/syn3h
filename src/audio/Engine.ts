import { dirtVolume, engineIdle, engineRange, engineVolume, windVolume } from './params'

export interface MotionAudio { speed: number; throttle: number; airborne: boolean; kind?: string; wings?: boolean; slip?: number; altitude?: number; clearance?: number; zorbed?: boolean }
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
  private readonly squeal: GainNode
  private readonly filter: BiquadFilterNode
  private readonly dirtFilter: BiquadFilterNode
  private readonly oscillators: OscillatorNode[] = []
  private readonly pulse: OscillatorNode
  private readonly pulseDepth: GainNode
  private readonly squealOsc: OscillatorNode
  private windSource?: AudioBufferSourceNode
  private readonly vehicleGain: GainNode
  private zorbed = false
  private disposed = false
  constructor(private readonly context: BaseAudioContext, output: AudioNode, readonly noise = noiseBuffer(context)) {
    const own = <T extends AudioNode>(node:T):T => { this.nodes.push(node); return node }
    const gain = (destination:AudioNode) => { const g=own(context.createGain());g.gain.value=0;g.connect(destination);return g }
    // One bus fades every vehicle voice together, including modulation and road noise.
    this.vehicleGain = own(context.createGain()); this.vehicleGain.connect(output)
    output = this.vehicleGain
    this.tone=gain(output);this.roar=gain(output);this.dirt=gain(output);this.wind=gain(output);this.field=gain(output);this.squeal=gain(output)
    this.filter=own(context.createBiquadFilter());this.filter.type='lowpass';this.filter.Q.value=.6;this.filter.connect(this.roar)
    for (const ratio of [1,2.003]) { const o=own(context.createOscillator());o.type='triangle';o.frequency.value=36*ratio;const g=own(context.createGain());g.gain.value=ratio===1?.4:.1;o.connect(g).connect(this.tone);o.start();this.sources.push(o);this.oscillators.push(o) }
    const n=own(context.createBufferSource());n.buffer=noise;n.loop=true;n.connect(this.filter)
    this.dirtFilter=own(context.createBiquadFilter());this.dirtFilter.type='bandpass';this.dirtFilter.frequency.value=180;this.dirtFilter.Q.value=.6;n.connect(this.dirtFilter).connect(this.dirt);n.start();this.sources.push(n)
    this.pulse=own(context.createOscillator());this.pulseDepth=own(context.createGain());this.pulseDepth.gain.value=0;this.pulseDepth.connect(this.tone.gain);this.pulse.connect(this.pulseDepth).connect(this.dirt.gain);this.pulse.start();this.sources.push(this.pulse)
    const field=own(context.createOscillator());field.type='sine';field.frequency.value=147;field.connect(this.field);field.start();this.sources.push(field)
    this.squealOsc=own(context.createOscillator());this.squealOsc.type='triangle';this.squealOsc.frequency.value=760;this.squealOsc.connect(this.squeal);this.squealOsc.start();this.sources.push(this.squealOsc)
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
    smooth(this.dirt.gain,ground);smooth(this.pulse.frequency,p.pulse);smooth(this.pulseDepth.gain,ground*p.depth)
    smooth(this.dirtFilter.frequency,motion.kind==='tank'?330:180+unit(Math.abs(motion.speed)/55)*400)
    smooth(this.wind.gain,m.wind*level,.3)
    smooth(this.field.gain,motion.wings&&motion.kind!=='jet'?.025*level:0,.2)
    const slip=motion.airborne?0:unit(((motion.slip??0)-2)/14)
    smooth(this.squeal.gain,slip*engineVolume.value*.16*level,.08);smooth(this.squealOsc.frequency,700+slip*450,.15)
  }
  /** Fade before stopping sources; all intermediate nodes are explicitly disconnected. */
  dispose(immediate = false): void {
    if(this.disposed)return;this.disposed=true
    if(immediate){for(const source of this.sources){source.onended=null;source.stop()}for(const node of this.nodes)node.disconnect();this.sources.length=0;this.nodes.length=0;return}
    const now=this.context.currentTime
    for(const g of [this.tone,this.roar,this.dirt,this.wind,this.field,this.squeal,this.pulseDepth]){g.gain.cancelAndHoldAtTime(now);g.gain.linearRampToValueAtTime(0,now+.04)}
    for(const source of this.sources)source.stop(now+.05)
    this.sources[0].onended=()=>{for(const node of this.nodes)node.disconnect()}
  }
}
