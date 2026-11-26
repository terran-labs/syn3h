export type GearCue = 'yoinkGrab' | 'yoinkFling' | 'yoinkGust' | 'bigRedCharge' | 'bigRedReady' | 'bigRedFizzle' | 'pesterLaunch' | 'pesterCatch' | 'thunderFire' | 'thunderBurst' | 'thunderCrackle'
export type Cue = 'capture'|'contested'|'lost'|'win'|'tick'|'tag'|'join'|'leave'|'click'|'deploy'|'retract'|'lava'|'splash'|'bungeeLaunch'|'bungeeAttach'|'bungeeRelease'|'beam'|'tagged'|'materialize'|GearCue
const notes:Record<Exclude<Cue,'beam'|'tagged'|'materialize'|GearCue>,readonly number[]>={capture:[330,440,660],contested:[220,233,220],lost:[330,220],win:[262,330,392,523],tick:[660],tag:[520,260,780],join:[392,523],leave:[392,294],click:[880],deploy:[110,440],retract:[440,110],lava:[150,64,58,205],splash:[320,170],bungeeLaunch:[196,392,587],bungeeAttach:[147,98,196],bungeeRelease:[392,294,147]}
/** Seconds the materialize swoosh builds for when the caller does not say. */
export const MATERIALIZE_SECONDS = 1.4
export interface CueOptions {
  /** Loudness relative to the cue's own, default 1: a skip's splash scales with how hard it hit. */
  level?: number
  /**
   * Materialize only: seconds the swoosh builds before the vehicle lands. Pass the length of
   * the spawn hold and the crackle and rise stretch to fill it (0.4 to 8 s).
   */
  seconds?: number
}
/** A bounded one-shot graph. The returned cleanup also supports immediate shutdown. */
export function synthCue(context:BaseAudioContext,output:AudioNode,cue:Cue,noise:AudioBuffer,onEnd:()=>void=()=>{},options:CueOptions={}):()=>void {
  if(isGearCue(cue))return synthGearCue(context,output,cue,noise,onEnd)
  if(cue==='beam'||cue==='tagged'||cue==='materialize')return voiced(context,output,cue,noise,onEnd,options)
  const now=context.currentTime,sequence=notes[cue],step=cue==='win'?.18:cue==='lava'?.16:cue==='click'?.025:cue==='tick'?.045:.09
  const nodes:AudioNode[]=[],sources:AudioScheduledSourceNode[]=[]
  const gain=context.createGain();gain.gain.value=0;gain.connect(output);nodes.push(gain)
  // Lava is thick and sticky: a low gulp that ends in one rising bubble, not a sizzle.
  const duration=cue==='lava'?.75:cue==='splash'?.42:sequence.length*step+.15
  const level=Math.max(0,Math.min(2,options.level??1))
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime((cue==='click'?.025:cue==='lava'?.34:cue==='splash'?.2:.12)*level+1e-4,now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+duration)
  const o=context.createOscillator();o.type='sine';o.frequency.value=sequence[0]
  sequence.forEach((frequency,i)=>o.frequency.exponentialRampToValueAtTime(frequency,now+.008+i*step));o.connect(gain);o.start(now);o.stop(now+duration+.02);nodes.push(o);sources.push(o)
  if(cue==='lava'||cue==='splash') {const n=context.createBufferSource(),f=context.createBiquadFilter();n.buffer=noise;f.type=cue==='lava'?'lowpass':'bandpass';f.frequency.value=cue==='lava'?240:1700;f.Q.value=cue==='lava'?1:.7;n.connect(f).connect(gain);n.start(now);n.stop(now+duration+.02);nodes.push(n,f);sources.push(n)}
  let ended=false
  const clean=()=>{if(ended)return;ended=true;for(const node of nodes)node.disconnect();onEnd()}
  o.onended=clean
  return ()=>{for(const source of sources){try{source.stop()}catch{ /* A completed source is already silent. */ }}clean()}
}

/**
 * The three sounds that used to be recordings, synthesised (owner's rule, 15 November 2026:
 * no audio files ship). `beam` is the tag beam leaving, `tagged` confirms a tag, and
 * `materialize` is a vehicle arriving: a swoosh that builds with electric crackle, then lands.
 */
function voiced(context:BaseAudioContext,output:AudioNode,cue:'beam'|'tagged'|'materialize',noise:AudioBuffer,onEnd:()=>void,options:CueOptions):()=>void {
  const now=context.currentTime,nodes:AudioNode[]=[],sources:AudioScheduledSourceNode[]=[]
  const out=context.createGain();out.connect(output);nodes.push(out)
  const keep=<T extends AudioNode>(node:T):T=>{nodes.push(node);return node}
  const tone=(type:OscillatorType,to:AudioNode,stop:number)=>{const o=keep(context.createOscillator());o.type=type;o.connect(to);o.start(now);o.stop(stop);sources.push(o);return o}
  // The shared noise buffer loops, and each use starts somewhere else in it.
  const hiss=(to:AudioNode,stop:number)=>{const n=keep(context.createBufferSource());n.buffer=noise;n.loop=true;n.connect(to);n.start(now,Math.random()*Math.max(0,noise.duration-.1));n.stop(stop);sources.push(n);return n}
  const env=(to:AudioNode)=>{const g=keep(context.createGain());g.gain.value=0;g.connect(to);return g}
  const filter=(type:BiquadFilterType,frequency:number,q:number,to:AudioNode)=>{const f=keep(context.createBiquadFilter());f.type=type;f.frequency.value=frequency;f.Q.value=q;f.connect(to);return f}
  let end:number
  if(cue==='beam') {
    // A bright falling chirp: a filtered saw with a sine an octave above it.
    end=now+.26
    const g=env(out);g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(.42,now+.004);g.gain.exponentialRampToValueAtTime(.0001,now+.24)
    const band=filter('bandpass',1400,1.6,g);band.frequency.setValueAtTime(2400,now);band.frequency.exponentialRampToValueAtTime(500,now+.2)
    const saw=tone('sawtooth',band,end);saw.frequency.setValueAtTime(1700,now);saw.frequency.exponentialRampToValueAtTime(260,now+.2)
    const top=env(g);top.gain.setValueAtTime(.5,now)
    const sine=tone('sine',top,end);sine.frequency.setValueAtTime(3400,now);sine.frequency.exponentialRampToValueAtTime(520,now+.16)
  } else if(cue==='tagged') {
    // A confirmation: a short spark, then three rising bell tones that ring out.
    end=now+.6
    const spark=env(out);spark.gain.setValueAtTime(.22,now);spark.gain.exponentialRampToValueAtTime(.0001,now+.05)
    hiss(filter('bandpass',2800,.8,spark),now+.08)
    ;[587,880,1175].forEach((frequency,i)=>{
      const at=now+i*.065,g=env(out);g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(.13,at+.006);g.gain.exponentialRampToValueAtTime(.0001,at+.4)
      const o=tone('sine',g,end);o.frequency.value=frequency
      const partial=env(g);partial.gain.setValueAtTime(.25,now);tone('sine',partial,end).frequency.value=frequency*2.76
    })
  } else {
    // A vehicle arriving. Air rushes in and rises in pitch, sparks crackle faster as it
    // builds, and it lands with a soft low thump and a chime. `seconds` stretches the build.
    const build=Math.min(8,Math.max(.4,options.seconds??MATERIALIZE_SECONDS)),land=now+build;end=land+.7
    const swoosh=env(out);swoosh.gain.setValueAtTime(.0001,now);swoosh.gain.exponentialRampToValueAtTime(.26,land-.03);swoosh.gain.exponentialRampToValueAtTime(.0001,land+.28)
    const sweep=filter('bandpass',300,1.1,swoosh);sweep.frequency.setValueAtTime(260,now);sweep.frequency.exponentialRampToValueAtTime(3600,land);sweep.frequency.exponentialRampToValueAtTime(500,land+.25)
    hiss(sweep,end)
    const hum=env(out);hum.gain.setValueAtTime(.0001,now);hum.gain.exponentialRampToValueAtTime(.07,land-.03);hum.gain.exponentialRampToValueAtTime(.0001,land+.12)
    for(const detune of [-9,9]){const o=tone('triangle',hum,land+.2);o.detune.value=detune;o.frequency.setValueAtTime(98,now);o.frequency.exponentialRampToValueAtTime(392,land)}
    // Crackle: brief bursts of bright noise, sparse at first and crowding toward the landing.
    const crackle=env(out);hiss(filter('highpass',4200,.7,crackle),land+.1)
    const sparks=Math.min(90,Math.round(8+build*11))
    for(let i=0;i<sparks;i++){const at=now+build*Math.sqrt((i+Math.random())/sparks),level=.05+.2*Math.random()*((at-now)/build);crackle.gain.setValueAtTime(level,at);crackle.gain.setTargetAtTime(0,at+.002,.004+Math.random()*.008)}
    crackle.gain.setValueAtTime(0,land+.05)
    const thump=env(out);thump.gain.setValueAtTime(.0001,land-.01);thump.gain.linearRampToValueAtTime(.3,land+.006);thump.gain.exponentialRampToValueAtTime(.0001,land+.32)
    const low=tone('sine',thump,land+.36);low.frequency.setValueAtTime(140,land-.01);low.frequency.exponentialRampToValueAtTime(52,land+.2)
    for(const [frequency,level] of [[784,.09],[1176,.05]] as const){const g=env(out);g.gain.setValueAtTime(0,land);g.gain.linearRampToValueAtTime(level,land+.008);g.gain.exponentialRampToValueAtTime(.0001,land+.62);tone('sine',g,end).frequency.value=frequency}
  }
  let ended=false
  const clean=()=>{if(ended)return;ended=true;clearTimeout(timer);for(const node of nodes)node.disconnect();onEnd()}
  // An offline render never reaches this timer and is discarded whole; a live context cleans up here.
  const timer=setTimeout(clean,Math.max(0,(end-now)*1000+80))
  return ()=>{for(const source of sources){try{source.stop()}catch{ /* A completed source is already silent. */ }}clean()}
}


interface GearVoice { seconds: number; from: number; to: number; tone: OscillatorType; gain: number; air: number }
/** Short event cues. Charge is a pickup sound; the ready cue marks the actual full charge. */
const gearVoices: Record<GearCue, GearVoice> = {
  yoinkGrab: { seconds: .48, from: 110, to: 440, tone: 'sine', gain: .2, air: .04 },
  yoinkFling: { seconds: .32, from: 540, to: 130, tone: 'triangle', gain: .2, air: .12 },
  yoinkGust: { seconds: .3, from: 350, to: 90, tone: 'sine', gain: .1, air: .25 },
  bigRedCharge: { seconds: .55, from: 65, to: 196, tone: 'triangle', gain: .18, air: .03 },
  bigRedReady: { seconds: .4, from: 392, to: 587, tone: 'sine', gain: .18, air: .02 },
  bigRedFizzle: { seconds: .28, from: 180, to: 45, tone: 'triangle', gain: .12, air: .13 },
  pesterLaunch: { seconds: .45, from: 660, to: 990, tone: 'sine', gain: .11, air: .08 },
  pesterCatch: { seconds: .4, from: 880, to: 1760, tone: 'sine', gain: .12, air: .15 },
  thunderFire: { seconds: .7, from: 145, to: 38, tone: 'sine', gain: .36, air: .28 },
  // Plasma Thunder's firework: a deep whump as it bursts, then a dry crackle of its twinkles.
  thunderBurst: { seconds: 1.4, from: 95, to: 28, tone: 'sine', gain: .42, air: .34 },
  thunderCrackle: { seconds: .9, from: 2600, to: 1900, tone: 'square', gain: .035, air: .3 },
}
function isGearCue(cue: Cue): cue is GearCue { return Object.hasOwn(gearVoices, cue) }

/** Three bounded sources per event. The final source owns cleanup, including offline renders. */
function synthGearCue(context: BaseAudioContext, output: AudioNode, cue: GearCue, noise: AudioBuffer, onEnd: () => void): () => void {
  const voice = gearVoices[cue], now = context.currentTime, end = now + voice.seconds
  const nodes: AudioNode[] = [], sources: AudioScheduledSourceNode[] = []
  const keep = <T extends AudioNode>(node: T): T => { nodes.push(node); return node }
  const envelope = (level: number): GainNode => {
    const gain = keep(context.createGain())
    gain.connect(output)
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(level, now + .012)
    gain.gain.exponentialRampToValueAtTime(.0001, end)
    return gain
  }
  const body = envelope(voice.gain)
  const fundamental = keep(context.createOscillator())
  fundamental.type = voice.tone
  fundamental.frequency.setValueAtTime(voice.from, now)
  fundamental.frequency.exponentialRampToValueAtTime(voice.to, end - .02)
  fundamental.connect(body)
  const harmonicGain = keep(context.createGain())
  harmonicGain.gain.value = .22
  harmonicGain.connect(body)
  const harmonic = keep(context.createOscillator())
  harmonic.type = 'sine'
  harmonic.frequency.setValueAtTime(voice.from * 2.01, now)
  harmonic.frequency.exponentialRampToValueAtTime(voice.to * 2, end - .02)
  harmonic.connect(harmonicGain)
  const air = envelope(voice.air), filter = keep(context.createBiquadFilter())
  filter.type = cue === 'thunderFire' || cue === 'thunderBurst' ? 'lowpass' : 'bandpass'
  filter.Q.value = .7
  filter.frequency.setValueAtTime(cue === 'thunderFire' || cue === 'thunderBurst' ? 650 : voice.from * 3, now)
  filter.frequency.exponentialRampToValueAtTime(cue === 'thunderFire' || cue === 'thunderBurst' ? 110 : Math.max(100, voice.to * 2), end)
  filter.connect(air)
  const hiss = keep(context.createBufferSource())
  hiss.buffer = noise
  hiss.loop = true
  hiss.connect(filter)
  sources.push(fundamental, harmonic, hiss)
  let ended = false
  const clean = () => { if (ended) return; ended = true; for (const node of nodes) node.disconnect(); onEnd() }
  hiss.onended = clean
  for (const source of sources) { source.start(now); source.stop(end + .02) }
  return () => {
    for (const source of sources) { try { source.stop() } catch { /* Already silent. */ } }
    clean()
  }
}
