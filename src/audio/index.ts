import * as THREE from 'three/webgpu'
import type { System } from '../core/Game'
import { params } from '../../shared/params'
import { Engine, type MotionAudio } from './Engine'
import { synthCue, type Cue } from './Cues'
import { WorldAudio, lavaProximity, type AudioTerrain } from './WorldAudio'
import type { Vehicle } from '../vehicles/Vehicle'
import { cuesVolume, worldVolume, remoteVolume, crossfade, lobbyFade, effectsVolume, masterVolume, musicVolume, muted } from './params'

export type Sound = 'laserShot' | 'laserHit' | 'materialize'
export const MUSIC_TRACKS = { SpaceStation: 'Space Station', Classic: 'Classic (Mars Explorer)', Carefree: 'Carefree (Mars Explorer)', Ambient: 'Ambient (legacy)' } as const
export type MusicTrack = keyof typeof MUSIC_TRACKS
export interface Position { x: number; y: number; z: number }
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
  private local?: Vehicle
  private terrain?: AudioTerrain
  private vehicleSource: () => readonly Vehicle[] = () => []
  private readonly remote = new Map<Vehicle, {engine:Engine;panner:PannerNode}>()
  private readonly cueStops = new Set<() => void>()
  private readonly events = new Map<Vehicle,{wings:boolean;landed:boolean;lava:boolean}>()
  private nextSpatial = 0
  private lavaNear = 0
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly decks = new Map<MusicTrack, Deck>()
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
    this.unsubscribe = params.onChange((id) => { if (id.startsWith('audio.')) this.syncMix() })
  }
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
      this.master = context.createGain(); this.master.connect(limiter).connect(ceiling).connect(context.destination)
      this.music = context.createGain(); this.music.connect(this.master)
      this.effects = context.createGain(); this.effects.connect(this.master)
      this.cueBus=context.createGain();this.cueBus.connect(this.master)
      this.worldBus=context.createGain();this.worldBus.connect(this.master)
      this.remoteBus=context.createGain();this.remoteBus.connect(this.master)
      this.engine = new Engine(context, this.master)
      this.world = new WorldAudio(context,this.worldBus,this.engine.noise)
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
    const source = this.context.createBufferSource(), output = this.output(position)
    source.buffer = buffer; source.connect(output.node); this.voices.add(source)
    source.onended = () => { source.disconnect(); output.dispose(); this.voices.delete(source) }
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
  cue(cue:Cue,position?:Position):void {
    if(this.context?.state!=='running'||this.cueStops.size>=16)return
    const out=position?this.output(position,this.cueBus!):{node:this.cueBus!,dispose(){}}
    let stop:()=>void
    stop=synthCue(this.context,out.node,cue,this.engine!.noise,()=>{this.cueStops.delete(stop);out.dispose()})
    this.cueStops.add(stop)
  }
  get diagnostics(){return {state:this.state,remoteVoices:this.remote.size,engineNodes:(this.engine?.nodeCount??0)+[...this.remote.values()].reduce((n,v)=>n+v.engine.nodeCount,0),oneShots:this.voices.size+this.cueStops.size,trackedVehicles:this.events.size}}
  private readVehicle(v:Vehicle):MotionAudio {
    const velocity=v.body.linvel(),p=v.object.position,ground=this.terrain?.heightAt(p.x,p.z)??p.y
    return {kind:v.kind,speed:Math.hypot(velocity.x,velocity.y,velocity.z),throttle:v.kind==='jet'?v.input.z:v.input.y,airborne:v.wheelsGrounded===0,wings:v.wingsOpen,slip:Math.max(0,...(v.getWheelEffects?.()??[]).filter(w=>w.grounded).map(w=>w.slip)),altitude:Math.max(0,p.y),clearance:Math.max(0,p.y-ground)}
  }
  private vehicleEvents(v:Vehicle):void {
    const p=v.object.position,liquid=this.terrain?.liquidHeightAt?.(p.x,p.z)??-Infinity
    const lava=this.terrain?.liquidKindAt?.(p.x,p.z)==='lava'&&p.y<liquid+1
    const previous=this.events.get(v)
    if(this.enabled&&previous){
      if(previous.wings!==v.wingsOpen)this.cue(v.wingsOpen?'deploy':'retract',p)
      if(v.landedThisStep&&!previous.landed)this.impact(v.landingImpact,p)
      if(lava&&!previous.lava)this.cue('lava',p)
    }
    this.events.set(v,{wings:v.wingsOpen,landed:v.landedThisStep,lava})
  }
  fixedUpdate(): void {
    // A landing flag may clear before the next rendered frame on a slow device.
    if(!this.context || this.disposed)return
    if(this.local)this.vehicleEvents(this.local)
    for(const vehicle of this.remote.keys())this.vehicleEvents(vehicle)
  }
  update(): void {
    if (!this.context || this.disposed) return
    if(this.local){this.motion=this.readVehicle(this.local);this.vehicleEvents(this.local)}
    this.engine!.update(this.motion, this.enabled)
    this.camera.getWorldPosition(this.position); this.camera.getWorldQuaternion(this.rotation)
    this.forward.set(0, 0, -1).applyQuaternion(this.rotation); this.up.set(0, 1, 0).applyQuaternion(this.rotation)
    if(this.context.currentTime>=this.nextSpatial){
      this.nextSpatial=this.context.currentTime+.2
      const nearest=this.enabled?[...new Set(this.vehicleSource())].filter(v=>v!==this.local&&v.object.position.distanceToSquared(this.position)<350*350).sort((a,b)=>a.object.position.distanceToSquared(this.position)-b.object.position.distanceToSquared(this.position)).slice(0,4):[]
      for(const [v,voice] of this.remote)if(!nearest.includes(v)){voice.engine.dispose();setTimeout(()=>voice.panner.disconnect(),80);this.remote.delete(v);this.events.delete(v)}
      for(const v of nearest)if(!this.remote.has(v)){const panner=this.context.createPanner();panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=7;panner.rolloffFactor=1.5;panner.connect(this.remoteBus!);this.remote.set(v,{panner,engine:new Engine(this.context,panner,this.engine!.noise)})}
      this.lavaNear=this.terrain?lavaProximity(this.terrain,this.position):0
    }
    for(const [v,voice] of this.remote){const p=v.object.position;voice.panner.positionX.value=p.x;voice.panner.positionY.value=p.y;voice.panner.positionZ.value=p.z;voice.engine.update(this.readVehicle(v),this.enabled);this.vehicleEvents(v)}
    this.world!.update(this.lavaNear,this.enabled)
    const l = this.context.listener, p = this.position, f = this.forward, u = this.up
    if (l.positionX) {
      for (const [param, value] of [[l.positionX,p.x],[l.positionY,p.y],[l.positionZ,p.z],[l.forwardX,f.x],[l.forwardY,f.y],[l.forwardZ,f.z],[l.upX,u.x],[l.upY,u.y],[l.upZ,u.z]] as const) param.value = value
    } else { l.setPosition(p.x,p.y,p.z); l.setOrientation(f.x,f.y,f.z,u.x,u.y,u.z) }
  }
  dispose(): void {
    this.disposed = true; this.gestures.abort(); this.unsubscribe()
    for (const deck of this.decks.values()) { clearTimeout(deck.stopTimer); deck.element.pause(); deck.element.removeAttribute('src'); deck.element.load(); deck.source.disconnect(); deck.gain.disconnect() }
    for (const source of this.voices) source.stop()
    for(const stop of [...this.cueStops])stop()
    for(const voice of this.remote.values()){voice.engine.dispose(true);voice.panner.disconnect()}
    this.remote.clear();this.events.clear();this.world?.dispose()
    this.engine?.dispose(true); this.engine=undefined; this.world=undefined
    for(const bus of [this.master,this.music,this.effects,this.cueBus,this.worldBus,this.remoteBus])bus?.disconnect()
    this.master=this.music=this.effects=this.cueBus=this.worldBus=this.remoteBus=undefined
    this.local=undefined;this.terrain=undefined;this.vehicleSource=()=>[]
    this.buffers.clear(); this.decks.clear(); this.voices.clear(); void this.context?.close()
  }
}
