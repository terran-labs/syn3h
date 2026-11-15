import * as THREE from 'three/webgpu'
import type { System } from '../core/Game'
import { params, worldSeed } from '../../shared/params'
import { Engine, unit, type MotionAudio } from './Engine'
import { synthCue, type Cue } from './Cues'
import { WorldAudio, lavaProximity, type AudioTerrain } from './WorldAudio'
import type { Vehicle } from '../vehicles/Vehicle'
import { Score, scoreSeed, type MatchMood } from './score/Score'
import { applySubmerge } from './score/ScoreSynth'
import { WeatherWind } from './weatherWind'
import { senseConvoy, senseRelief, type ConvoyVoice } from './scoreSenses'
import { cuesVolume, worldVolume, remoteVolume, crossfade, lobbyFade, effectsVolume, masterVolume, musicVolume, muted } from './params'

export type Sound = 'laserShot' | 'laserHit' | 'materialize'
/** `Score` is the generated adaptive score (src/audio/score); the rest are recordings. */
export const MUSIC_TRACKS = { Score: 'Adaptive score (generated)', SpaceStation: 'Space Station', Classic: 'Classic (Mars Explorer)', Carefree: 'Carefree (Mars Explorer)', Ambient: 'Ambient (legacy)' } as const
export type MusicTrack = keyof typeof MUSIC_TRACKS
export interface Position { x: number; y: number; z: number }
// Two winds: the owner's recorded clip follows the vehicle's own speed (Engine.setWind), and
// the generated voice (weatherWind.ts) carries the weather at the camera. AGENTS.md: the
// recorded originals stay unless the owner says otherwise.
const files: Record<Sound | 'wind', string> = { laserShot: 'LaserShot.mp3', laserHit: 'LaserHit.mp3', materialize: 'Materialize.mp3', wind: 'Wind.wav' }
interface Deck { element: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode; stopTimer?: ReturnType<typeof setTimeout> }

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
  private nextSpatial = 0
  private lavaNear = 0
  private match: MatchMood | null = null
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly decks = new Map<Exclude<MusicTrack, 'Score'>, Deck>()
  private readonly voices = new Set<AudioBufferSourceNode>()
  private readonly forward = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly position = new THREE.Vector3()
  private readonly rotation = new THREE.Quaternion()
  private selected: MusicTrack = 'SpaceStation'
  private lobbyVisible = true
  private disposed = false
  private loads?: Promise<void>
  private readonly gestures = new AbortController()
  private readonly unsubscribe: () => void
  enabled = false
  /** Failed assets are reported without preventing the game from starting. */
  readonly errors: string[] = []
  motion: MotionAudio = { speed: 0, throttle: 0, airborne: false }

  constructor(private readonly camera: THREE.Camera) {
    const unlock = () => { void this.unlock().catch((error) => this.errors.push(String(error))) }
    window.addEventListener('pointerdown', unlock, { signal: this.gestures.signal })
    window.addEventListener('keydown', unlock, { signal: this.gestures.signal })
    this.unsubscribe = params.onChange((id) => {
      if (id.startsWith('audio.')) this.syncMix()
      if (id === worldSeed.def.id || id === scoreSeed.def.id) this.score?.setSeed(scoreSeed.value || worldSeed.value)
    })
    // A hidden tab stops rendering frames, so nothing would schedule notes while the pads held
    // their last chord. Fade the score out until the tab is back.
    document.addEventListener('visibilitychange', this.onVisibility)
  }
  private readonly onVisibility = () => this.score?.synth.setLevel(document.hidden || this.selected !== 'Score' ? 0 : 1, 0.6)
  get state(): AudioContextState | 'locked' { return this.context?.state ?? 'locked' }
  get track(): MusicTrack { return this.selected }
  get loadedSounds(): number { return this.buffers.size }
  get isMuted(): boolean { return muted.value }
  setMuted(value: boolean): void { params.set(muted.def.id, value) }

  async unlock(): Promise<void> {
    if (this.disposed) return
    if (!this.context) {
      const context = this.context = new AudioContext()
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .003; limiter.release.value = .15
      const ceiling=context.createWaveShaper(),curve=new Float32Array(4097)
      for(let i=0;i<curve.length;i++){const x=i/(curve.length-1)*2-1,a=Math.abs(x);curve[i]=Math.sign(x)*(a<=.8?a:.8+.15*(1-Math.exp(-(a-.8)/.15)))}
      ceiling.curve=curve;ceiling.oversample='2x'
      this.submerge = context.createBiquadFilter(); this.submerge.type = 'lowpass'; this.submerge.frequency.value = 20000
      this.master = context.createGain(); this.master.connect(this.submerge).connect(limiter).connect(ceiling).connect(context.destination)
      this.music = context.createGain(); this.music.connect(this.master)
      this.effects = context.createGain(); this.effects.connect(this.master)
      this.cueBus=context.createGain();this.cueBus.connect(this.master)
      this.worldBus=context.createGain();this.worldBus.connect(this.master)
      this.remoteBus=context.createGain();this.remoteBus.connect(this.master)
      this.engine = new Engine(context, this.master)
      this.world = new WorldAudio(context,this.worldBus,this.engine.noise)
      this.weatherWind = new WeatherWind(context, this.master)
      this.score = new Score(context, this.music, scoreSeed.value || worldSeed.value)
      this.score.setMatch(this.match)
      this.syncMix()
      this.loads = this.loadBuffers()
    }
    // Both calls happen inside the gesture before awaiting either promise (Safari included).
    const resumed = this.context.resume()
    const music = this.startTrack(this.selected)
    await Promise.all([resumed, music])
    this.gestures.abort()
  }
  async ready(): Promise<void> { await this.loads }
  private async loadBuffers(): Promise<void> {
    await Promise.all(Object.entries(files).map(async ([name, file]) => {
      try {
        const response = await fetch(`/audio/${file}`)
        if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
        const buffer = await this.context!.decodeAudioData(await response.arrayBuffer())
        if (this.disposed) return
        this.buffers.set(name, buffer)
        if (name === 'wind') this.engine!.setWind(buffer)
      } catch (error) { this.errors.push(String(error)) }
    }))
  }
  async setTrack(track: MusicTrack): Promise<void> {
    this.selected = track
    this.syncMix()
    if (this.context) await this.startTrack(track)
  }
  private async startTrack(track: MusicTrack): Promise<void> {
    const context = this.context!
    this.score?.setActive(track === 'Score', crossfade.value)
    if (track === 'Score') {
      // Nothing to download: fade the recordings out and let the generated score take over.
      for (const other of this.decks.values()) {
        clearTimeout(other.stopTimer)
        other.gain.gain.cancelAndHoldAtTime(context.currentTime)
        other.gain.gain.linearRampToValueAtTime(0, context.currentTime + crossfade.value)
        other.stopTimer = setTimeout(() => other.element.pause(), crossfade.value * 1000 + 100)
      }
      return
    }
    let deck = this.decks.get(track)
    if (!deck) {
      const element = new Audio(`/audio/${track}.mp3`)
      element.loop = true; element.preload = 'none'
      const source = context.createMediaElementSource(element), gain = context.createGain()
      gain.gain.value = 0; source.connect(gain).connect(this.music!)
      deck = { element, source, gain }; this.decks.set(track, deck)
    }
    await deck.element.play()
    if (this.disposed || this.selected !== track) { deck.element.pause(); return }
    for (const [name, other] of this.decks) {
      clearTimeout(other.stopTimer)
      const now = context.currentTime
      other.gain.gain.cancelAndHoldAtTime(now)
      other.gain.gain.linearRampToValueAtTime(name === track ? 1 : 0, now + crossfade.value)
      if (name !== track) other.stopTimer = setTimeout(() => other.element.pause(), crossfade.value * 1000 + 100)
    }
  }
  /** CoreAudio fades title music at 0.1 volume units per second outside fullscreen UI. */
  setLobbyVisible(visible: boolean): void {
    this.lobbyVisible = visible
    if (!this.context || !this.music || this.selected !== 'SpaceStation') return
    const now = this.context.currentTime
    this.music.gain.cancelAndHoldAtTime(now)
    this.music.gain.linearRampToValueAtTime(visible ? musicVolume.value : 0, now + lobbyFade.value)
  }
  private syncMix(): void {
    if (!this.context) return
    const now = this.context.currentTime
    this.master!.gain.setTargetAtTime(muted.value ? 0 : masterVolume.value, now, 0.03)
    this.music!.gain.cancelAndHoldAtTime(now)
    this.music!.gain.setTargetAtTime(this.selected === 'SpaceStation' && !this.lobbyVisible ? 0 : musicVolume.value, now, 0.03)
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
  play(sound: Sound, position?: Position): void {
    const buffer = this.buffers.get(sound)
    if (!buffer || this.context?.state !== 'running' || this.voices.size >= 32) return
    // Laser fire near the listener is what the score hears as combat. A hit counts for more.
    if (this.enabled && sound !== 'materialize') {
      const near = position ? unit(1 - (Math.hypot(position.x - this.position.x, position.y - this.position.y, position.z - this.position.z) - 40) / 360) : 1
      this.score?.combat((sound === 'laserHit' ? 0.3 : 0.14) * near)
    }
    const source = this.context.createBufferSource(), output = this.output(position)
    // When the score plays a note for each tag beam, the recorded beam ducks under it by
    // about 9 dB: the note carries the music, the recording still says where it came from.
    // The "tagged" sound stays at full level, since it is the confirmation.
    const duck = sound === 'laserShot' && params.get('audio.score.tagNotes')?.value ? this.context.createGain() : null
    if (duck) duck.gain.value = 0.35
    source.buffer = buffer; if (duck) source.connect(duck).connect(output.node); else source.connect(output.node)
    this.voices.add(source)
    source.onended = () => { source.disconnect(); duck?.disconnect(); output.dispose(); this.voices.delete(source) }
    source.start()
  }
  impact(strength: number, position?: Position): void {
    if (!this.context || this.context.state !== 'running' || !Number.isFinite(strength) || strength <= 0 || this.voices.size >= 32) return
    const now = this.context.currentTime, output = this.output(position)
    const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), gain = this.context.createGain()
    source.buffer = this.engine!.noise; filter.type = 'lowpass'; filter.frequency.value = 180
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(Math.min(.7, strength / 25), now + .005); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
    source.connect(filter).connect(gain).connect(output.node); this.voices.add(source)
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); output.dispose(); this.voices.delete(source) }
    source.start(); source.stop(now + 0.32)
  }
  setPlayer(vehicle:Vehicle,terrain:AudioTerrain):void {this.local=vehicle;this.terrain=terrain;this.events.clear()}
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
  get diagnostics(){return {state:this.state,score:this.score?{playing:this.score.playing,mode:this.score.mode,tempo:Math.round(this.score.tempo),mood:{...this.score.mood},nodes:this.score.synth.nodeCount}:null,remoteVoices:this.remote.size,engineNodes:(this.engine?.nodeCount??0)+(this.weatherWind?.nodeCount??0)+[...this.remote.values()].reduce((n,v)=>n+v.engine.nodeCount,0),oneShots:this.voices.size+this.cueStops.size,trackedVehicles:this.events.size}}
  private readVehicle(v:Vehicle):MotionAudio {
    const velocity=v.body.linvel(),p=v.object.position,ground=this.terrain?.heightAt(p.x,p.z)??p.y
    return {kind:v.kind,speed:Math.hypot(velocity.x,velocity.y,velocity.z),throttle:v.kind==='jet'?v.input.z:v.input.y,airborne:v.wheelsGrounded===0,wings:v.wingsOpen,slip:Math.max(0,...(v.getWheelEffects?.()??[]).filter(w=>w.grounded).map(w=>w.slip)),altitude:Math.max(0,p.y),clearance:Math.max(0,p.y-ground)}
  }
  private vehicleEvents(v:Vehicle):void {
    const p=v.object.position,liquid=this.terrain?.liquidHeightAt?.(p.x,p.z)??-Infinity
    // A thick gloop going into lava, a splash going into a sea, lake or river.
    const liquidKind=p.y<liquid+1?this.terrain?.liquidKindAt?.(p.x,p.z)??null:null
    const previous=this.events.get(v)
    if(this.enabled&&previous){
      if(previous.wings!==v.wingsOpen)this.cue(v.wingsOpen?'deploy':'retract',p)
      if(v.landedThisStep&&!previous.landed)this.impact(v.landingImpact,p)
      if(liquidKind&&!previous.liquid)this.cue(liquidKind==='lava'?'lava':'splash',p)
    }
    this.events.set(v,{wings:v.wingsOpen,landed:v.landedThisStep,liquid:liquidKind})
  }
  fixedUpdate(): void {
    // A landing flag may clear before the next rendered frame on a slow device.
    if(!this.context || this.disposed)return
    if(this.local)this.vehicleEvents(this.local)
    for(const vehicle of this.remote.keys())this.vehicleEvents(vehicle)
  }
  update(): void {
    if (!this.context || this.disposed) return
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
    this.disposed = true; this.gestures.abort(); this.unsubscribe(); document.removeEventListener('visibilitychange', this.onVisibility)
    for (const deck of this.decks.values()) { clearTimeout(deck.stopTimer); deck.element.pause(); deck.element.removeAttribute('src'); deck.element.load(); deck.source.disconnect(); deck.gain.disconnect() }
    for (const source of this.voices) source.stop()
    for(const stop of [...this.cueStops])stop()
    for(const voice of this.remote.values()){voice.engine.dispose(true);voice.panner.disconnect()}
    this.remote.clear();this.events.clear();this.world?.dispose();this.weatherWind?.dispose();this.weatherWind=undefined;this.score?.dispose();this.score=undefined;this.submerge?.disconnect();this.submerge=undefined
    this.engine?.dispose(true); this.engine=undefined; this.world=undefined
    for(const bus of [this.master,this.music,this.effects,this.cueBus,this.worldBus,this.remoteBus])bus?.disconnect()
    this.master=this.music=this.effects=this.cueBus=this.worldBus=this.remoteBus=undefined
    this.local=undefined;this.terrain=undefined;this.vehicleSource=()=>[]
    this.buffers.clear(); this.decks.clear(); this.voices.clear(); void this.context?.close()
  }
}

/** True while the vehicle's Rapier body is still in the world. A removed body must never be read. */
function alive(v: Vehicle): boolean {
  try { return v.body.isValid() } catch { return false }
}
