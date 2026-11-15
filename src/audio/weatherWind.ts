/**
 * The wind, generated: filtered noise whose loudness and brightness follow the speed of the
 * air past the CAMERA.
 *
 * Airspeed at the camera is the wind there (src/world/weather, the same field that pushes
 * the vehicles, gusts included) minus the camera's own velocity. So a still camera on a
 * windy summit hears the gale, a chase camera behind a fast jet hears rush even in still
 * air, a headwind is louder than a tailwind, and the gusts players feel arrive as swells.
 * On an airless world it is silent: everything is scaled by world.atmosphere.
 *
 * Graph, built once when the audio context is unlocked by a gesture (iOS):
 *
 *   noise (generated, looped) -+- lowpass "body"     -> gain -+- stereo pan -> level -> output
 *                              +- bandpass "whistle" -> gain -+
 *
 * `output` is the game's master bus, so the mute, the master volume, the underwater lowpass
 * and the limiter all apply. `level` follows the existing "Wind volume" slider (audio.wind).
 * Per frame: one wind lookup and a handful of AudioParam targets, nothing allocated.
 *
 * Replaces the recorded Wind.wav, which followed the vehicle's speed and altitude only. With
 * the camera's own motion in the airspeed, the generated voice covers the rush of speed as
 * well as the weather, so the clip added nothing and is no longer downloaded (1.2 MB).
 */
import type * as THREE from 'three/webgpu'
import { atmosphereValue } from '../world/weather/params'
import { FULL_STRENGTH, windDrift } from '../world/weather/wind'
import { seamlessBuffer, unit } from './Engine'
import { windVolume } from './params'

/** Airspeed (m/s) where the wind starts to be heard, and where it is at full voice. */
export const WIND_QUIET = 2
export const WIND_LOUD = 32
/** Seconds the camera velocity is smoothed over, so a cut or a shake does not gust. */
const CAMERA_SMOOTH = 0.15
/** Faster than this between frames is a teleport or a seam crossing, not motion. */
const MAX_CAMERA_SPEED = 400

/** Loudness 0..1, body cutoff and whistle frequency (Hz) and whistle level for an airspeed. */
export function windVoice(airspeed: number, air: number) {
  const s = unit((airspeed - WIND_QUIET) / (WIND_LOUD - WIND_QUIET))
  return {
    level: unit(air) * s ** 1.5,
    body: 160 + 2600 * s ** 1.2,
    whistle: 320 + 1300 * s,
    whistleLevel: 0.3 * s * s,
  }
}

/**
 * Stereo pan for air arriving along `rel` (the air's velocity relative to the camera): the
 * sound comes from where the air comes from, so -rel, against the camera's right vector.
 * Kept within plus or minus 0.6 so the wind never sits in one ear.
 */
export function windPan(rel: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number {
  const n = Math.hypot(rel.x, rel.y, rel.z)
  if (!(n > 1e-3)) return 0
  return Math.max(-0.6, Math.min(0.6, -0.6 * (rel.x * right.x + rel.y * right.y + rel.z * right.z) / n))
}

export class WeatherWind {
  private readonly nodes: AudioNode[] = []
  private readonly source: AudioBufferSourceNode
  private readonly body: BiquadFilterNode
  private readonly whistle: BiquadFilterNode
  private readonly whistleGain: GainNode
  private readonly pan: StereoPannerNode
  private readonly level: GainNode
  private readonly last = { x: 0, y: 0, z: 0, t: -1 }
  private readonly velocity = { x: 0, y: 0, z: 0 }
  private readonly wind = { x: 0, y: 0, z: 0 }
  private readonly rel = { x: 0, y: 0, z: 0 }
  private readonly right = { x: 1, y: 0, z: 0 }
  private disposed = false
  /** Last airspeed at the camera, m/s, for diagnostics and tests. */
  airspeed = 0

  constructor(private readonly context: BaseAudioContext, output: AudioNode) {
    const own = <T extends AudioNode>(node: T): T => { this.nodes.push(node); return node }
    this.source = own(context.createBufferSource())
    this.source.buffer = windNoise(context)
    this.source.loop = true
    this.body = own(context.createBiquadFilter()); this.body.type = 'lowpass'; this.body.Q.value = 0.5; this.body.frequency.value = 200
    this.whistle = own(context.createBiquadFilter()); this.whistle.type = 'bandpass'; this.whistle.Q.value = 3; this.whistle.frequency.value = 400
    const bodyGain = own(context.createGain()); bodyGain.gain.value = 1
    this.whistleGain = own(context.createGain()); this.whistleGain.gain.value = 0
    this.pan = own(context.createStereoPanner())
    this.level = own(context.createGain()); this.level.gain.value = 0
    this.source.connect(this.body).connect(bodyGain).connect(this.pan)
    this.source.connect(this.whistle).connect(this.whistleGain).connect(this.pan)
    this.pan.connect(this.level).connect(output)
    this.source.start()
  }

  get nodeCount(): number { return this.disposed ? 0 : this.nodes.length }

  /**
   * Once per rendered frame with the camera's world position and rotation. Returns the wind
   * strength at the camera, 0 calm to 1 gale, for the score's `wind` input.
   */
  update(position: THREE.Vector3, rotation: THREE.Quaternion, now: number, enabled: boolean): number {
    if (this.disposed) return 0
    const last = this.last, v = this.velocity
    const dt = last.t < 0 ? 0 : now - last.t
    if (dt > 0) {
      const rx = (position.x - last.x) / dt, ry = (position.y - last.y) / dt, rz = (position.z - last.z) / dt
      if (Math.hypot(rx, ry, rz) < MAX_CAMERA_SPEED) {
        const k = Math.min(1, dt / CAMERA_SMOOTH)
        v.x += (rx - v.x) * k; v.y += (ry - v.y) * k; v.z += (rz - v.z) * k
      }
    }
    last.x = position.x; last.y = position.y; last.z = position.z; last.t = now

    const w = windDrift(position.x, position.y, position.z, this.wind)
    const rel = this.rel
    rel.x = w.x - v.x; rel.y = w.y - v.y; rel.z = w.z - v.z
    this.airspeed = Math.hypot(rel.x, rel.y, rel.z)
    const air = atmosphereValue()
    const voice = windVoice(this.airspeed, air)
    // Camera right: (1, 0, 0) rotated by the camera's quaternion.
    const q = rotation
    this.right.x = 1 - 2 * (q.y * q.y + q.z * q.z)
    this.right.y = 2 * (q.x * q.y + q.w * q.z)
    this.right.z = 2 * (q.x * q.z - q.w * q.y)

    const target = (param: AudioParam, value: number, time: number) => param.setTargetAtTime(value, now, time)
    target(this.level.gain, enabled ? voice.level * windVolume.value : 0, 0.25)
    target(this.body.frequency, voice.body, 0.3)
    target(this.whistle.frequency, voice.whistle, 0.4)
    target(this.whistleGain.gain, voice.whistleLevel, 0.3)
    target(this.pan.pan, windPan(rel, this.right), 0.4)
    return unit(Math.hypot(w.x, w.z) / FULL_STRENGTH) * unit(air)
  }

  /** Stop and release every node. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.source.onended = null
    try { this.source.stop() } catch { /* never started */ }
    for (const node of this.nodes) node.disconnect()
    this.nodes.length = 0
  }
}

/**
 * Four seconds of seeded pink-ish noise: white noise through a cheap three pole filter, so
 * the low rumble and the hiss are both there for the filters to shape. Seamless when looped.
 */
export function windNoise(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate), data = buffer.getChannelData(0)
  let seed = 90210, b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const white = seed / 2147483648 - 1
    // Paul Kellet's economy pink filter.
    b0 = 0.99765 * b0 + white * 0.099046
    b1 = 0.963 * b1 + white * 0.2965164
    b2 = 0.57 * b2 + white * 1.0526913
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2
  }
  return seamlessBuffer(context, buffer)
}
