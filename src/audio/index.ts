import * as THREE from 'three/webgpu'
import type { System } from '../core/Game'
import { params } from '../../shared/params'
import { Engine, type MotionAudio } from './Engine'
import { crossfade, lobbyFade, effectsVolume, masterVolume, musicVolume, muted } from './params'

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
      limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 8
      this.master = context.createGain(); this.master.connect(limiter).connect(context.destination)
      this.music = context.createGain(); this.music.connect(this.master)
      this.effects = context.createGain(); this.effects.connect(this.master)
      this.engine = new Engine(context, this.effects)
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
  }
  private output(position?: Position): { node: AudioNode; dispose: () => void } {
    if (!position) return { node: this.effects!, dispose() {} }
    const panner = this.context!.createPanner()
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 8; panner.maxDistance = 600; panner.rolloffFactor = 1
    panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z
    panner.connect(this.effects!)
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
    gain.gain.setValueAtTime(Math.min(1, strength / 20), now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
    source.connect(filter).connect(gain).connect(output.node); this.voices.add(source)
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); output.dispose(); this.voices.delete(source) }
    source.start(); source.stop(now + 0.32)
  }
  update(): void {
    if (!this.context) return
    this.engine!.update(this.motion, this.enabled)
    this.camera.getWorldPosition(this.position); this.camera.getWorldQuaternion(this.rotation)
    this.forward.set(0, 0, -1).applyQuaternion(this.rotation); this.up.set(0, 1, 0).applyQuaternion(this.rotation)
    const l = this.context.listener, p = this.position, f = this.forward, u = this.up
    if (l.positionX) {
      for (const [param, value] of [[l.positionX,p.x],[l.positionY,p.y],[l.positionZ,p.z],[l.forwardX,f.x],[l.forwardY,f.y],[l.forwardZ,f.z],[l.upX,u.x],[l.upY,u.y],[l.upZ,u.z]] as const) param.value = value
    } else { l.setPosition(p.x,p.y,p.z); l.setOrientation(f.x,f.y,f.z,u.x,u.y,u.z) }
  }
  dispose(): void {
    this.disposed = true; this.gestures.abort(); this.unsubscribe()
    for (const deck of this.decks.values()) { clearTimeout(deck.stopTimer); deck.element.pause(); deck.element.removeAttribute('src'); deck.element.load(); deck.source.disconnect(); deck.gain.disconnect() }
    for (const source of this.voices) source.stop()
    this.engine?.dispose(); void this.context?.close()
  }
}
