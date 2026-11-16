import * as THREE from 'three/webgpu'
import type { System } from '../core/Game'
import { params, worldSeed } from '../../shared/params'
import { Engine, SLIP_ALLOW, unit, type MotionAudio } from './Engine'
import { synthCue, type Cue, type CueOptions } from './Cues'
import { CrashWatcher, impactStrength, synthImpact, type ImpactKind } from './Impacts'
import { synthMaterialize, synthZorbPulse, type MaterializeVoice } from './VehicleCues'
import type { SurfaceKind } from '../world/terrain/surface'
import { WorldAudio, lavaProximity, type AudioTerrain } from './WorldAudio'
import type { Vehicle } from '../vehicles/Vehicle'
import { Score, scoreSeed, type MatchMood } from './score/Score'
import { applySubmerge } from './score/ScoreSynth'
import { WeatherWind } from './weatherWind'
import { senseConvoy, senseRelief, type ConvoyVoice } from './scoreSenses'
import { audioContext, hadGesture, onGesture } from './unlock'
import { cuesVolume, worldVolume, remoteVolume, crossfade, effectsVolume, masterVolume, musicVolume, muted } from './params'

export type Sound = 'laserShot' | 'laserHit' | 'materialize'
export interface Position { x: number; y: number; z: number }
// Owner's rule, 15 November 2026: no audio files ship. The generated score (src/audio/score)
// is the only music, in the lobby and in play, and these three sounds are synthesised
// (src/audio/Cues.ts). The names are the ones the networking and gear code already call.
const cueFor: Record<Sound, Cue> = { laserShot: 'beam', laserHit: 'tagged', materialize: 'materialize' }
/**
 * In the lobby the score is the only thing sounding, and it plays its quiet opening state:
 * measured at about -28 dBFS, too faint on a laptop or a phone. It is lifted there and eases
 * back over a couple of seconds when play begins and engines, wind and drums join. 8 dB since
 * 16 November 2026 (6 before), making up the 2.5 dB the sparser lobby score lost.
 */
const LOBBY_LIFT = 2.5
/**
 * Seconds for the whole mix to rise from silence the first time sound starts, and the least
 * the score takes to fade in then. Arriving sound eases in; it never bursts.
 */
const ARRIVAL_FADE = 3
const ARRIVAL_SCORE_FADE = 6
/** Match the terrain classifier, including snow and roads within a world. */
const IMPACT_SURFACE: Record<SurfaceKind, ImpactKind> = {
  dust: 'dust', sand: 'sand', grass: 'soil', mud: 'mud', snow: 'snow', ice: 'ice',
  glass: 'glass', regolith: 'dust', rock: 'rock', road: 'rock', track: 'soil',
}
/** Storage key of the retired track selector. Removed on start so old choices cannot linger. */
const RETIRED_TRACK_KEY = 'syn3h.musicTrack'

export class GameAudio implements System {
  private context?: AudioContext
  private master?: GainNode
  private music?: GainNode
  private effects?: GainNode
  private engine?: Engine
  private cueBus?: GainNode
  private worldBus?: GainNode
  private remoteBus?: GainNode
  private world?: WorldAudio
  private weatherWind?: WeatherWind
  private score?: Score
  /** Lowpass on the whole mix, closed while the player's vehicle is under a liquid surface. */
  private submerge?: BiquadFilterNode
  private local?: Vehicle
  // What the score hears beyond the player's own motion (scoreSenses.ts). Sampled every
  // tenth frame into arrays that are kept, so nothing is allocated while the game runs.
  private readonly convoy: ConvoyVoice[] = []
  private readonly reliefHeights: number[] = []
  private relief: number[] | undefined
  private readonly convoyMemory = new WeakMap<Vehicle, number>()
  private readonly others: Vehicle[] = []
  private senseFrame = 0
  private sensedAt = 0
  private terrain?: AudioTerrain
  private vehicleSource: () => readonly Vehicle[] = () => []
  private readonly remote = new Map<Vehicle, {engine:Engine;panner:PannerNode}>()
  private readonly cueStops = new Set<() => void>()
  private readonly events = new Map<Vehicle,{wings:boolean;landed:boolean;liquid:'lava'|'water'|null}>()
  private readonly materializing = new Map<object, MaterializeVoice>()
  private readonly crashes = new CrashWatcher()
  private impactSeed = 0
  private nextSpatial = 0
  private lavaNear = 0
  private match: MatchMood | null = null
  private readonly voices = new Set<AudioBufferSourceNode>()
  /** Taps the final output so a check can prove the mix is audible. Never read during play. */
  private meter?: AnalyserNode
  private meterData?: Float32Array<ArrayBuffer>
  private readonly forward = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly position = new THREE.Vector3()
  private readonly rotation = new THREE.Quaternion()
  private disposed = false
  private readonly stopGestures: () => void
  private readonly unsubscribe: () => void
  enabled = false
  /** Failed assets are reported without preventing the game from starting. */
  readonly errors: string[] = []
  motion: MotionAudio = { speed: 0, throttle: 0, airborne: false }

  constructor(private readonly camera: THREE.Camera) {
    // The recorded tracks are gone, and with them the choice between them.
    try { localStorage.removeItem(RETIRED_TRACK_KEY) } catch { /* Audio does not require storage. */ }
    // Every gesture anywhere on the page (unlock.ts listens from the loading view on, in the
    // capture phase) resumes the context there and then, as Safari requires. A touch going down
    // is refused and the touch lifting is accepted, so each gesture must try again, not only the first.
    this.stopGestures = onGesture(this.onGesture)
    this.unsubscribe = params.onChange((id) => {
      if (id.startsWith('audio.')) this.syncMix()
      if (id === worldSeed.def.id || id === scoreSeed.def.id) this.score?.setSeed(scoreSeed.value || worldSeed.value)
    })
    // A hidden tab stops rendering frames, so nothing would schedule notes while the pads held
    // their last chord. Fade the score out until the tab is back.
    document.addEventListener('visibilitychange', this.onVisibility)
    // Build the mix while the page is still loading, so the first tap has nothing to wait for.
    // If the visitor already tapped during the loading view, or the browser lets this site play
    // without one, start now instead of waiting for another gesture.
    this.idle = whenIdle(() => this.prepare())
    if (hadGesture()) void this.unlock().catch(error => this.errors.push(String(error)))
  }
  private readonly idle: number
  private readonly onGesture = () => {
    if (this.disposed || this.paused) return
    const context = this.context ?? this.pending ?? audioContext()
    if (context && context.state !== 'running') void context.resume().catch(() => {})
    if (!this.context) void this.unlock().catch(error => this.errors.push(String(error)))
  }
  private readonly onVisibility = () => {
    this.score?.synth.setLevel(document.hidden ? 0 : 1, 0.6)
    // Back from the background with the clock stopped by the browser (an iOS interruption, a
    // phone call): start it again if the game is not paused. A browser may still want a tap.
    if (!document.hidden && !this.paused && this.context && this.context.state !== 'running') void this.context.resume().catch(() => {})
  }
  /** True until sound has started: the browser is waiting for a first tap or key press. */
  get waitingForGesture(): boolean { return !this.context && !this.disposed }
  get state(): AudioContextState | 'locked' { return this.context?.state ?? 'locked' }
  /**
   * Level of the final output over the last 2048 samples, in dBFS (RMS). -Infinity while
   * locked or silent. For checks and the audition page; it costs nothing until it is read.
   */
  get outputLevel(): number {
    if (!this.meter || !this.meterData) return -Infinity
    this.meter.getFloatTimeDomainData(this.meterData)
    let sum = 0
    for (const sample of this.meterData) sum += sample * sample
    return 10 * Math.log10(sum / this.meterData.length)
  }
  get isMuted(): boolean { return muted.value }
  setMuted(value: boolean): void { params.set(muted.def.id, value) }

  /**
   * Called from the first click or key press, which must stay cheap: it is often the tap
   * that enters a world. The context and the whole graph are built earlier, in idle time
   * while the page loads (`prepare`), so the gesture only resumes the context, which Safari
   * requires to happen inside it. If no idle time came first, the context is created here
   * and the graph is built just after the gesture, a step at a time. `context` is published
   * only once it is running with a complete graph, so nothing else sees a half-built mix
   * and nothing schedules onto a suspended clock.
   */
  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.context) return this.paused ? Promise.resolve() : this.context.resume()
    return this.unlocking ??= this.start().finally(() => { if (!this.context) this.unlocking = undefined })
  }
  private unlocking?: Promise<void>
  /** A context made ahead of the gesture, still suspended, and the graph being built on it. */
  private pending?: AudioContext
  private graph?: Promise<void>
  /**
   * Main-thread milliseconds of the first unlock, for the performance lane: `gesture` is what
   * the tap itself pays, `score` and `voices` are graph building (in idle time when `ahead`).
   */
  readonly unlockCost = { gesture: 0, voices: 0, score: 0, ahead: false }
  /** Build the suspended context and graph before any gesture. Safe to call more than once. */
  prepare(): void {
    if (this.disposed || this.context || this.pending || this.unlocking) return
    const context = audioContext()
    if (!context) return
    this.pending = context
    this.unlockCost.ahead = true
    this.graph = this.buildGraph(context)
    // Some browsers let a site play without a gesture (one the visitor uses often, an installed
    // app), and a context made after a gesture starts running. Do not assume it is blocked.
    // The state can turn to running a moment after creation, so watch it as well as reading it.
    const allowed = () => { if (context.state === 'running' && !this.context && !this.disposed) void this.unlock().catch(error => this.errors.push(String(error))) }
    context.addEventListener('statechange', allowed)
    allowed()
  }
  private async start(): Promise<void> {
    const mark = performance.now()
    const context = this.pending ??= audioContext()
    if (!context) return
    void context.resume().catch(() => {})
    this.unlockCost.gesture = performance.now() - mark
    await (this.graph ??= this.buildGraph(context))
    // Wait for the clock to run. If this was not a gesture the browser accepts (a touch going
    // down, or no gesture yet), the next one resumes the context and this carries on.
    if (context.state !== 'running') await new Promise<void>(resolve => {
      const check = () => { if (context.state === 'running' || this.disposed) { context.removeEventListener('statechange', check); resolve() } }
      context.addEventListener('statechange', check)
    })
    if (this.disposed) return
    this.context = context; this.pending = undefined
    this.syncMix()
    // Arriving sound fades in from silence: the whole mix over a few seconds, the score slower.
    const now = context.currentTime, master = this.master!.gain
    master.cancelScheduledValues(now); master.setValueAtTime(0, now)
    if (!this.paused) master.linearRampToValueAtTime(muted.value ? 0 : masterVolume.value, now + ARRIVAL_FADE)
    // Nothing to download, so the lobby has music from the first gesture.
    this.score!.setActive(true, Math.max(crossfade.value, ARRIVAL_SCORE_FADE))
  }
  /** The mix, in three steps with the page given a turn between them so no frame is held up. */
  private async buildGraph(context: AudioContext): Promise<void> {
    let mark = performance.now()
    const lap = () => { const now = performance.now(), took = now - mark; mark = now; return took }
    const breathe = async () => { await new Promise<void>(resolve => setTimeout(resolve)); mark = performance.now() }
    await breathe(); if (this.disposed || this.pending !== context) return
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .003; limiter.release.value = .15
    const ceiling=context.createWaveShaper(),curve=new Float32Array(4097)
    for(let i=0;i<curve.length;i++){const x=i/(curve.length-1)*2-1,a=Math.abs(x);curve[i]=Math.sign(x)*(a<=.8?a:.8+.15*(1-Math.exp(-(a-.8)/.15)))}
    ceiling.curve=curve;ceiling.oversample='2x'
    this.submerge = context.createBiquadFilter(); this.submerge.type = 'lowpass'; this.submerge.frequency.value = 20000
    this.meter = context.createAnalyser(); this.meter.fftSize = 2048; this.meterData = new Float32Array(this.meter.fftSize)
    this.master = context.createGain(); this.master.connect(this.submerge).connect(limiter).connect(ceiling).connect(context.destination); ceiling.connect(this.meter)
    this.music = context.createGain(); this.music.connect(this.master)
    this.effects = context.createGain(); this.effects.connect(this.master)
    this.cueBus=context.createGain();this.cueBus.connect(this.master)
    this.worldBus=context.createGain();this.worldBus.connect(this.master)
    this.remoteBus=context.createGain();this.remoteBus.connect(this.master)
    // The score first: it is what the lobby plays, so it should be the first thing ready.
    this.score = new Score(context, this.music, scoreSeed.value || worldSeed.value)
    this.score.setMatch(this.match)
    this.unlockCost.score = lap()
    await breathe(); if (this.disposed || this.pending !== context) return
    this.engine = new Engine(context, this.master)
    this.world = new WorldAudio(context,this.worldBus,this.engine.noise)
    this.weatherWind = new WeatherWind(context, this.master)
    this.unlockCost.voices = lap()
  }
  /** Release every node of the mix. The context itself is closed by the caller. */
  private dropGraph(): void {
    for (const voice of [...this.materializing.values()]) voice.stop()
    for (const source of this.voices) source.stop()
    for(const stop of [...this.cueStops])stop()
    for(const voice of this.remote.values()){voice.engine.dispose(true);voice.panner.disconnect()}
    this.remote.clear();this.events.clear();this.world?.dispose();this.weatherWind?.dispose();this.weatherWind=undefined;this.score?.dispose();this.score=undefined;this.submerge?.disconnect();this.submerge=undefined;this.meter?.disconnect();this.meter=undefined
    this.engine?.dispose(true); this.engine=undefined; this.world=undefined
    for(const bus of [this.master,this.music,this.effects,this.cueBus,this.worldBus,this.remoteBus])bus?.disconnect()
    this.master=this.music=this.effects=this.cueBus=this.worldBus=this.remoteBus=undefined
    this.voices.clear()
  }
  /** Resolves once the first unlock has built the mix. Nothing is downloaded or decoded. */
  async ready(): Promise<void> { await this.unlocking }
  /** The score plays in the lobby and in play alike; it hears which through `enabled`. */
  setLobbyVisible(_visible: boolean): void {}
  private paused = false
  private pauseTimer?: ReturnType<typeof setTimeout>
  get isPaused(): boolean { return this.paused }
  /**
   * The game is paused (a second Escape, or the tab went to the background): fade the whole
   * mix to silence, then stop the audio clock, which also stops the score's worklets from
   * using any processor time. Everything sounds through the one master gain, so nothing leaks.
   */
  pause(seconds = 0.5): void {
    if (this.paused || this.disposed) return
    this.paused = true
    this.crashes.reset()
    const context = this.context
    if (!context || !this.master) return
    const now = context.currentTime
    this.master.gain.cancelScheduledValues(now); this.master.gain.setValueAtTime(this.master.gain.value, now)
    this.master.gain.linearRampToValueAtTime(0, now + seconds)
    clearTimeout(this.pauseTimer)
    this.pauseTimer = setTimeout(() => { if (this.paused && !this.disposed) void context.suspend() }, seconds * 1000 + 60)
  }
  /** Back from a pause: start the clock, then bring the mix up from silence. */
  resume(seconds = 0.3): void {
    if (!this.paused || this.disposed) return
    this.paused = false; clearTimeout(this.pauseTimer)
    const context = this.context
    if (!context || !this.master) return
    void context.resume().then(() => {
      if (this.paused || this.disposed || !this.master) return
      const now = context.currentTime
      this.master.gain.cancelScheduledValues(now); this.master.gain.setValueAtTime(0, now)
      this.master.gain.linearRampToValueAtTime(muted.value ? 0 : masterVolume.value, now + seconds)
    })
  }
  /** Whether the last mix was set for play or for the lobby. */
  private mixedFor = false
  private syncMix(): void {
    if (!this.context) return
    const now = this.context.currentTime
    // A pause owns the master gain until it ends; the other buses can still follow their sliders.
    if (!this.paused) this.master!.gain.setTargetAtTime(muted.value ? 0 : masterVolume.value, now, 0.03)
    this.music!.gain.cancelAndHoldAtTime(now)
    this.music!.gain.setTargetAtTime(musicVolume.value * (this.enabled ? 1 : LOBBY_LIFT), now, this.mixedFor === this.enabled ? 0.03 : 0.8)
    this.mixedFor = this.enabled
    this.effects!.gain.setTargetAtTime(effectsVolume.value, now, 0.03)
    this.cueBus!.gain.setTargetAtTime(cuesVolume.value,now,.03)
    this.worldBus!.gain.setTargetAtTime(worldVolume.value,now,.03)
    this.remoteBus!.gain.setTargetAtTime(remoteVolume.value,now,.03)
  }
  private output(position?: Position, bus = this.effects!): { node: AudioNode; dispose: () => void } {
    if (!position) return { node: bus, dispose() {} }
    const panner = this.context!.createPanner()
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 8; panner.maxDistance = 600; panner.rolloffFactor = 1
    panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z
    panner.connect(bus)
    return { node: panner, dispose: () => panner.disconnect() }
  }
  /**
   * The tag beam, the tagged confirmation and a vehicle materializing. For materialize,
   * `options.seconds` stretches the building swoosh to the length of the spawn hold.
   */
  play(sound: Sound, position?: Position, options?: CueOptions): void {
    if (this.context?.state !== 'running' || this.cueStops.size >= 32) return
    // A tag beam near the listener is what the score hears as a chase. A tag counts for more.
    if (this.enabled && sound !== 'materialize') {
      const near = position ? unit(1 - (Math.hypot(position.x - this.position.x, position.y - this.position.y, position.z - this.position.z) - 40) / 360) : 1
      this.score?.combat((sound === 'laserHit' ? 0.3 : 0.14) * near)
    }
    const output = this.output(position)
    // When the score plays a note for each tag beam, the beam ducks under it by about 9 dB:
    // the note carries the music, the beam still says where it came from. The tagged sound
    // stays at full level, since it is the confirmation.
    const duck = sound === 'laserShot' && params.get('audio.score.tagNotes')?.value ? this.context.createGain() : null
    if (duck) { duck.gain.value = 0.35; duck.connect(output.node) }
    let stop: () => void
    stop = synthCue(this.context, duck ?? output.node, cueFor[sound], this.engine!.noise, () => { this.cueStops.delete(stop); duck?.disconnect(); output.dispose() }, options)
    this.cueStops.add(stop)
  }
  /** Called by the actual hop event, including nearby remote and bot hops. */
  zorbPulse(position: Position): void {
    if (this.disposed || this.paused || !this.enabled || this.context?.state !== 'running' || this.cueStops.size >= 32) return
    const output = this.output(position)
    let stop: () => void
    stop = synthZorbPulse(this.context, output.node, () => { this.cueStops.delete(stop); output.dispose() })
    this.cueStops.add(stop)
  }
  /** Follow the switch lifecycle; cancellation must not sound like a successful drop. */
  materialize(cue: 'materializeStart' | 'materializeRelease' | 'materializeCancel', position: Position, vehicle: object): void {
    const previous = this.materializing.get(vehicle)
    if (cue === 'materializeCancel') { previous?.stop(); return }
    if (cue === 'materializeRelease') { previous?.release(); return }
    previous?.stop()
    if (this.disposed || this.paused || !this.enabled || this.context?.state !== 'running' || this.cueStops.size >= 32) return
    const output = this.output(position)
    const voice = synthMaterialize(this.context, output.node, this.engine!.noise, () => {
      this.materializing.delete(vehicle); this.cueStops.delete(voice.stop); output.dispose()
    })
    this.materializing.set(vehicle, voice); this.cueStops.add(voice.stop)
  }
  /** Network contacts use the hull clang; landings pass the surface beneath them. */
  impact(strength: number, position?: Position, kind: ImpactKind = 'vehicle', hull = this.local?.kind): void {
    if (!this.enabled || this.paused || this.local?.zorbed || this.context?.state !== 'running' || !Number.isFinite(strength) || strength <= 2 || this.cueStops.size >= 32) return
    if (kind === 'vehicle') this.crashes.suppress(this.context.currentTime)
    const output = this.output(position)
    let stop: () => void
    stop = synthImpact(this.context, output.node, { kind, hull, strength: impactStrength(strength), seed: ++this.impactSeed }, () => {
      this.cueStops.delete(stop); output.dispose()
    })
    this.cueStops.add(stop)
  }
  private groundImpact(position: Position): ImpactKind {
    const surface = this.terrain?.surfaceAt?.(position.x, position.z) ?? 'rock'
    return IMPACT_SURFACE[surface]
  }
  setPlayer(vehicle:Vehicle,terrain:AudioTerrain):void {this.local=vehicle;this.terrain=terrain;this.events.clear();this.crashes.reset()}
  setVehicles(source:()=>readonly Vehicle[]):void {this.vehicleSource=source}
  /** The match as the score hears it: holding the hill is triumph, a contested hill is tension. */
  setMatch(match:MatchMood|null):void {this.match=match;this.score?.setMatch(match)}
  /** The other vehicles and the ground ahead, for the score. Removed vehicles are never read. */
  private sense():void {
    const now=this.context!.currentTime,seconds=now-this.sensedAt;this.sensedAt=now
    this.others.length=0
    if(this.enabled)for(const v of this.vehicleSource())if(v!==this.local&&alive(v)&&!this.others.includes(v))this.others.push(v)
    // Remote vehicles are already placed at their nearest image on a wrapping world.
    senseConvoy(this.convoy,this.position,this.forward,this.up,this.others,v=>v.object.position,this.convoyMemory,seconds)
    const local=this.local
    this.relief=this.enabled&&local&&alive(local)&&this.terrain?senseRelief(this.reliefHeights,local.object.position,local.body.linvel(),(x,z)=>this.terrain!.heightAt(x,z)):undefined
  }
  /** Metres the local vehicle sits below a liquid surface; zero or less when dry. */
  private submersion():number {
    if(!this.enabled||!this.local||!alive(this.local))return 0
    const p=this.local.object.position,liquid=this.terrain?.liquidHeightAt?.(p.x,p.z)??-Infinity
    return Number.isFinite(liquid)?liquid-p.y:0
  }
  cue(cue:Cue,position?:Position):void {
    if(this.context?.state!=='running'||this.cueStops.size>=16)return
    if(cue==='tag')this.score?.combat(.5)
    else if(cue==='capture'||cue==='win')this.score?.accent(cue==='win'?1:.6)
    const out=position?this.output(position,this.cueBus!):{node:this.cueBus!,dispose(){}}
    let stop:()=>void
    stop=synthCue(this.context,out.node,cue,this.engine!.noise,()=>{this.cueStops.delete(stop);out.dispose()})
    this.cueStops.add(stop)
  }
  get diagnostics(){return {state:this.state,score:this.score?{playing:this.score.playing,mode:this.score.mode,tempo:Math.round(this.score.tempo),stalls:this.score.stalls,mood:{...this.score.mood},nodes:this.score.synth.nodeCount}:null,remoteVoices:this.remote.size,engineNodes:(this.engine?.nodeCount??0)+(this.weatherWind?.nodeCount??0)+[...this.remote.values()].reduce((n,v)=>n+v.engine.nodeCount,0),oneShots:this.voices.size+this.cueStops.size,trackedVehicles:this.events.size}}
  private readVehicle(v:Vehicle):MotionAudio {
    const velocity=v.body.linvel(),p=v.object.position,ground=this.terrain?.heightAt(p.x,p.z)??p.y
    const wheels=(v.getWheelEffects?.()??[]).filter(w=>w.grounded),slip=Math.max(0,...wheels.map(w=>w.slip))
    // A slide is the body moving sideways with at least two wheels down (Engine.ts, slipVoice).
    this.right.set(1,0,0).applyQuaternion(v.object.quaternion)
    const slide=wheels.length>=2?Math.abs(velocity.x*this.right.x+velocity.y*this.right.y+velocity.z*this.right.z):0
    // The ground colours the tyre scrub; it is looked up only while the body slides.
    const surface=slide>SLIP_ALLOW?this.terrain?.surfaceAt?.(p.x,p.z):undefined
    return {zorbed:v.zorbed,kind:v.kind,speed:Math.hypot(velocity.x,velocity.y,velocity.z),throttle:v.kind==='jet'?v.input.z:v.input.y,airborne:v.wheelsGrounded===0,wings:v.wingsOpen,slip,slide,surface,altitude:Math.max(0,p.y),clearance:Math.max(0,p.y-ground)}
  }
  private vehicleEvents(v:Vehicle):void {
    const p=v.object.position,liquid=this.terrain?.liquidHeightAt?.(p.x,p.z)??-Infinity
    // A thick gloop going into lava, a splash going into a sea, lake or river.
    const liquidKind=p.y<liquid+1?this.terrain?.liquidKindAt?.(p.x,p.z)??null:null
    const previous=this.events.get(v)
    if(this.enabled&&!v.zorbed&&previous){
      if(previous.wings!==v.wingsOpen)this.cue(v.wingsOpen?'deploy':'retract',p)
      if(v.landedThisStep&&!previous.landed)this.impact(v.landingImpact,p,this.groundImpact(p),v.kind)
      if(liquidKind&&!previous.liquid)this.cue(liquidKind==='lava'?'lava':'splash',p)
    }
    this.events.set(v,{wings:v.wingsOpen,landed:v.landedThisStep,liquid:liquidKind})
  }
  fixedUpdate(): void {
    // A landing flag may clear before the next rendered frame on a slow device.
    if(!this.context || this.disposed || this.paused)return
    if(this.local){
      const v = this.local
      // Only local physics is authoritative. Remote interpolation can jump in velocity.
      if (this.enabled && !v.zorbed && alive(v)) {
        if (v.landedThisStep) this.crashes.suppress(this.context.currentTime)
        const lost = this.crashes.step(v.body.translation(), v.body.linvel(), this.context.currentTime)
        if (lost && v.wheelsGrounded > 0) this.impact(lost, v.object.position, this.groundImpact(v.object.position), v.kind)
      } else this.crashes.reset()
      this.vehicleEvents(v)
    }
    for(const vehicle of this.remote.keys())this.vehicleEvents(vehicle)
  }
  update(): void {
    // Nothing is scheduled onto a paused clock: it would all fire at once on resume.
    if (!this.context || this.disposed || this.paused) return
    if (this.enabled !== this.mixedFor) this.syncMix()
    if(this.local&&alive(this.local)){this.motion=this.readVehicle(this.local);this.vehicleEvents(this.local)}
    this.engine!.update(this.motion, this.enabled)
    this.camera.getWorldPosition(this.position); this.camera.getWorldQuaternion(this.rotation)
    this.forward.set(0, 0, -1).applyQuaternion(this.rotation); this.up.set(0, 1, 0).applyQuaternion(this.rotation)
    if(this.context.currentTime>=this.nextSpatial){
      this.nextSpatial=this.context.currentTime+.2
      const nearest=this.enabled?[...new Set(this.vehicleSource())].filter(v=>v!==this.local&&alive(v)&&v.object.position.distanceToSquared(this.position)<350*350).sort((a,b)=>a.object.position.distanceToSquared(this.position)-b.object.position.distanceToSquared(this.position)).slice(0,4):[]
      for(const [v,voice] of this.remote)if(!nearest.includes(v)){voice.engine.dispose();setTimeout(()=>voice.panner.disconnect(),80);this.remote.delete(v);this.events.delete(v)}
      for(const v of nearest)if(!this.remote.has(v)){const panner=this.context.createPanner();panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=7;panner.rolloffFactor=1.5;panner.connect(this.remoteBus!);this.remote.set(v,{panner,engine:new Engine(this.context,panner,this.engine!.noise)})}
      this.lavaNear=this.terrain?lavaProximity(this.terrain,this.position):0
    }
    // A bot or remote vehicle can be removed between the throttled nearest-list refreshes.
    // Reading a removed Rapier body corrupts the physics world, so drop its voice first.
    for(const [v,voice] of this.remote)if(!alive(v)){voice.engine.dispose();setTimeout(()=>voice.panner.disconnect(),80);this.remote.delete(v);this.events.delete(v)}
    for(const [v,voice] of this.remote){const p=v.object.position;voice.panner.positionX.value=p.x;voice.panner.positionY.value=p.y;voice.panner.positionZ.value=p.z;voice.engine.update(this.readVehicle(v),this.enabled);this.vehicleEvents(v)}
    this.world!.update(this.lavaNear,this.enabled)
    const m=this.motion,submerged=this.submersion()
    if(this.senseFrame++%10===0)this.sense()
    const wind=this.weatherWind!.update(this.position,this.rotation,this.context.currentTime,this.enabled)
    // `convoy` and `relief` are optional inputs the score reads only when its toggles are on.
    const heard={playing:this.enabled,speed:m.speed,throttle:m.throttle,airborne:m.airborne,clearance:m.clearance??0,altitude:m.altitude??0,submerged,lava:this.lavaNear,convoy:this.convoy,relief:this.relief,wind}
    this.score!.update(heard)
    applySubmerge(this.submerge!,this.score!.mood.depth,this.context.currentTime)
    const l = this.context.listener, p = this.position, f = this.forward, u = this.up
    if (l.positionX) {
      for (const [param, value] of [[l.positionX,p.x],[l.positionY,p.y],[l.positionZ,p.z],[l.forwardX,f.x],[l.forwardY,f.y],[l.forwardZ,f.z],[l.upX,u.x],[l.upY,u.y],[l.upZ,u.z]] as const) param.value = value
    } else { l.setPosition(p.x,p.y,p.z); l.setOrientation(f.x,f.y,f.z,u.x,u.y,u.z) }
  }
  dispose(): void {
    this.disposed = true; this.stopGestures(); this.unsubscribe(); document.removeEventListener('visibilitychange', this.onVisibility)
    cancelIdle(this.idle); clearTimeout(this.pauseTimer)
    this.dropGraph()
    this.local=undefined;this.terrain=undefined;this.vehicleSource=()=>[]
    void this.context?.close(); void this.pending?.close(); this.pending = undefined
  }
}

/** Idle time where the browser offers it (Safari does not), otherwise shortly after this task. */
function whenIdle(run: () => void): number {
  return typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 3000 }) : window.setTimeout(run, 300)
}
function cancelIdle(id: number): void {
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id); else clearTimeout(id)
}

/** True while the vehicle's Rapier body is still in the world. A removed body must never be read. */
function alive(v: Vehicle): boolean {
  try { return v.body.isValid() } catch { return false }
}
