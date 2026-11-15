/**
 * How a Pester looks: a soft luminous core inside a drifting swarm of motes.
 *
 * The swarm stretches back along its motion, breathes slowly, tightens and brightens as it
 * closes on its target, and scatters outward when it ends. There is no face and no body: it
 * speaks through motion and brightness only.
 *
 * Every Pester in the game is drawn by two instanced draws: the additive light (cores and
 * motes) and a normally blended haze under each core, which keeps the cloud readable against
 * a bright sky where additive light alone washes out. All motion runs in the vertex shader
 * from a clock; the CPU writes one centre, velocity and brightness per Pester per frame.
 * Nothing is loaded: the sprite is a radial falloff computed per pixel (AGENTS.md: generate
 * it, do not ship it).
 *
 * Motes per Pester follow the graphics level. A level change rewrites one small buffer and
 * compiles nothing. The shaders compile while the world appears (../warm.ts).
 */
import * as THREE from 'three/webgpu'
import { attribute, cos, float, floor, instanceIndex, mix, sin, uniform, uv, vec2, vec3 } from 'three/tsl'
import { graphicsLevel, levelNumber } from '../../core/quality'
import { hotExposureNode } from '../../vehicles/skins/hotExposure'
import { pesterGlow, pesterHue, pesterSize } from './params'

// TSL nodes are dynamically typed; the effect sprites use the same alias.
type N = any // eslint-disable-line @typescript-eslint/no-explicit-any

/** Pesters drawn at once. More than this can exist; the extra ones fly unseen. */
export const CLOUD_ORBS = 32
/** Motes per Pester at the safe, mobile and desktop graphics levels. */
export const CLOUD_MOTES = [6, 14, 26] as const
/** Instances per Pester in the buffers: the core and the most motes any level draws. */
const STRIDE = 1 + CLOUD_MOTES[2]
/** Seconds of travel the slowest motes lag behind: the length of the wake. */
const WAKE = 0.16

/** A repeatable number in 0 to 1 for slot `i`, stream `k`. */
function hash(i: number, k: number): number {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return x - Math.floor(x)
}

export class PesterCloud {
  readonly light: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.SpriteNodeMaterial>
  readonly haze: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.SpriteNodeMaterial>
  private readonly clock: N = uniform(0)
  private readonly color: N = uniform(new THREE.Color())
  private readonly size: N = uniform(1)
  /** Per Pester: centre and brightness; velocity and how far it has scattered (0 to 1). */
  private readonly centre = new Float32Array(CLOUD_ORBS * 4)
  private readonly motion = new Float32Array(CLOUD_ORBS * 4)
  private readonly lightCentre: THREE.InstancedBufferAttribute
  private readonly lightMotion: THREE.InstancedBufferAttribute
  private readonly hazeCentre: THREE.InstancedBufferAttribute
  private readonly hazeMotion: THREE.InstancedBufferAttribute
  private readonly role: THREE.InstancedBufferAttribute
  private readonly used = new Array<boolean>(CLOUD_ORBS).fill(false)
  private level = -1
  private hue = NaN
  private glow = NaN
  /** Frames left to draw one empty instance, so the shaders compile before a first launch. */
  private warming = 0

  constructor() {
    const plane = new THREE.PlaneGeometry(1, 1)
    const lightGeo = new THREE.InstancedBufferGeometry().copy(plane as unknown as THREE.InstancedBufferGeometry)
    const hazeGeo = new THREE.InstancedBufferGeometry().copy(plane as unknown as THREE.InstancedBufferGeometry)
    plane.dispose()
    const dynamic = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.lightCentre = dynamic(CLOUD_ORBS * STRIDE)
    this.lightMotion = dynamic(CLOUD_ORBS * STRIDE)
    this.hazeCentre = dynamic(CLOUD_ORBS)
    this.hazeMotion = dynamic(CLOUD_ORBS)
    // Fixed per slot: two random numbers, the role (0 core, 1 mote, -1 unused at this
    // graphics level) and how far the mote lags behind the centre (0 to 1).
    this.role = new THREE.InstancedBufferAttribute(new Float32Array(CLOUD_ORBS * STRIDE * 4), 4)
    lightGeo.setAttribute('pcCentre', this.lightCentre)
    lightGeo.setAttribute('pcMotion', this.lightMotion)
    lightGeo.setAttribute('pcRole', this.role)
    hazeGeo.setAttribute('pcCentre', this.hazeCentre)
    hazeGeo.setAttribute('pcMotion', this.hazeMotion)
    lightGeo.instanceCount = 0
    hazeGeo.instanceCount = 0

    const t: N = this.clock
    const centre: N = attribute('pcCentre', 'vec4'), motion: N = attribute('pcMotion', 'vec4'), role: N = attribute('pcRole', 'vec4')
    const energy = centre.w, scatter = motion.w
    const a = role.x, b = role.y, kind = role.z, lag = role.w
    const isCore = kind.lessThan(0.5)
    // Each Pester breathes on its own slow clock.
    const orb = floor(float(instanceIndex).div(STRIDE))
    const breathe = sin(t.mul(0.9).add(orb.mul(1.7))).mul(0.12).add(1)
    // A mote wanders on three slow sine paths of its own inside the cloud.
    const wander = vec3(
      sin(t.mul(a.mul(1.3).add(0.7)).add(a.mul(40))),
      sin(t.mul(b.mul(1.1).add(0.6)).add(b.mul(40))).mul(0.7),
      cos(t.mul(a.add(b).mul(0.6).add(0.8)).add(a.add(b).mul(40))),
    )
    // Loose when far from its target, drawn tight as it closes; flung outward when it ends.
    const reach = this.size.mul(b.mul(0.65).add(0.35)).mul(breathe).mul(mix(1.3, 0.75, energy)).mul(scatter.mul(4).add(1))
    const wake = motion.xyz.mul(lag.mul(lag).mul(-WAKE))
    const live = kind.greaterThan(-0.5).select(1, 0).mul(energy.greaterThan(0).select(1, 0))
    const twinkle = sin(t.mul(b.mul(5).add(3)).add(a.mul(60))).mul(0.3).add(0.7)
    const fade = float(1).sub(scatter)

    const light = new THREE.SpriteNodeMaterial({ name: 'gear pester light', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    light.positionNode = isCore.select(centre.xyz, centre.xyz.add(wander.mul(reach)).add(wake))
    const moteSize = this.size.mul(a.mul(0.28).add(0.2)).mul(float(1).sub(lag.mul(0.5)))
    const coreSize = this.size.mul(2.6).mul(breathe).mul(scatter.mul(1.5).add(1))
    const side = isCore.select(coreSize, moteSize).mul(live)
    light.scaleNode = vec2(side, side)
    const r = uv().mul(2).sub(1).length().clamp(0, 1)
    const soft = float(1).sub(r)
    // The core is a wide soft glow with a small hot heart; a mote is a tight soft dot.
    const coreLook = soft.pow(2).mul(0.75).add(soft.pow(8).mul(0.6))
    const moteLook = soft.mul(soft).mul(twinkle).mul(float(1).sub(lag.mul(0.6)))
    const bright = energy.mul(0.7).add(0.5)
    // The falloff goes in the opacity, as the effect sprites do it: additive blending scales
    // the colour by it, and a pixel outside the glow then writes nothing at all. With the
    // falloff in the colour and an opacity of one, the whole square showed as a pale box.
    light.colorNode = this.color.mul(bright).mul(hotExposureNode())
    light.opacityNode = isCore.select(coreLook, moteLook).mul(fade).clamp(0, 1)

    const haze = new THREE.SpriteNodeMaterial({ name: 'gear pester haze', transparent: true, depthWrite: false })
    const hazeCentre: N = attribute('pcCentre', 'vec4'), hazeMotion: N = attribute('pcMotion', 'vec4')
    haze.positionNode = hazeCentre.xyz
    const hazeSide = this.size.mul(2.4).mul(hazeCentre.w.greaterThan(0).select(1, 0)).mul(hazeMotion.w.mul(1.5).add(1))
    haze.scaleNode = vec2(hazeSide, hazeSide)
    // A deeper shade of the same colour, so the cloud keeps its hue over a pale sky.
    // Normally blended, so it tints what is behind it blue where additive light would only
    // brighten it: over a bright orange sky that is what keeps the cloud blue.
    haze.colorNode = this.color.mul(0.45)
    haze.opacityNode = soft.pow(1.5).mul(0.6).mul(float(1).sub(hazeMotion.w))

    this.light = new THREE.Mesh(lightGeo, light)
    this.haze = new THREE.Mesh(hazeGeo, haze)
    for (const m of [this.light, this.haze]) { m.frustumCulled = false; m.visible = false }
    this.haze.renderOrder = 3
    this.light.renderOrder = 4
    this.retier()
  }

  /** A place for one more Pester, or -1 when all are taken: that one flies unseen. */
  take(): number {
    const slot = this.used.indexOf(false)
    if (slot >= 0) this.used[slot] = true
    return slot
  }

  free(slot: number): void {
    if (slot < 0) return
    this.used[slot] = false
    this.centre[slot * 4 + 3] = 0
  }

  /**
   * Where a Pester is this frame. `energy` runs from a little above 0 (far from its target)
   * to 1 (about to catch it) and `scatter` from 0 to 1 as it ends.
   */
  set(slot: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, energy: number, scatter: number): void {
    if (slot < 0) return
    const i = slot * 4
    this.centre[i] = x; this.centre[i + 1] = y; this.centre[i + 2] = z; this.centre[i + 3] = Math.max(1e-3, energy)
    this.motion[i] = vx; this.motion[i + 1] = vy; this.motion[i + 2] = vz; this.motion[i + 3] = Math.min(1, Math.max(0, scatter))
  }

  /** Draw one empty instance for a few frames, so the shaders compile before a first launch. */
  warm(): void {
    this.warming = 2
  }

  /** Once per frame, after every `set`: upload what changed. */
  update(time: number): void {
    this.clock.value = time
    this.size.value = pesterSize.value
    if (this.hue !== pesterHue.value || this.glow !== pesterGlow.value) {
      this.hue = pesterHue.value
      this.glow = pesterGlow.value
      // Full saturation and a modest brightness: brighter than this tone maps to white, not blue.
      this.color.value.setHSL(this.hue / 360, 1, 0.55).multiplyScalar(1.5 * this.glow)
    }
    if (this.level !== levelNumber(graphicsLevel.value)) this.retier()
    const orbs = this.used.lastIndexOf(true) + 1
    const drawn = orbs > 0 ? orbs : this.warming > 0 ? 1 : 0
    if (this.warming > 0) this.warming--
    this.light.visible = this.haze.visible = drawn > 0
    this.light.geometry.instanceCount = drawn * STRIDE
    this.haze.geometry.instanceCount = drawn
    if (drawn === 0) return
    // Every instance of a Pester carries the same centre and motion.
    const lc = this.lightCentre.array as Float32Array, lm = this.lightMotion.array as Float32Array
    for (let o = 0; o < drawn; o++) {
      const s = o * 4
      for (let k = 0; k < STRIDE; k++) {
        const d = (o * STRIDE + k) * 4
        lc[d] = this.centre[s]; lc[d + 1] = this.centre[s + 1]; lc[d + 2] = this.centre[s + 2]; lc[d + 3] = this.centre[s + 3]
        lm[d] = this.motion[s]; lm[d + 1] = this.motion[s + 1]; lm[d + 2] = this.motion[s + 2]; lm[d + 3] = this.motion[s + 3]
      }
    }
    ;(this.hazeCentre.array as Float32Array).set(this.centre)
    ;(this.hazeMotion.array as Float32Array).set(this.motion)
    for (const [attr, n] of [[this.lightCentre, drawn * STRIDE * 4], [this.lightMotion, drawn * STRIDE * 4], [this.hazeCentre, drawn * 4], [this.hazeMotion, drawn * 4]] as const) {
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, n)
      attr.needsUpdate = true
    }
  }

  dispose(): void {
    for (const m of [this.light, this.haze]) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose() }
  }

  /** Set which motes exist at this graphics level. */
  private retier(): void {
    this.level = levelNumber(graphicsLevel.value)
    const motes = CLOUD_MOTES[this.level]
    const r = this.role.array as Float32Array
    for (let o = 0; o < CLOUD_ORBS; o++) {
      for (let k = 0; k < STRIDE; k++) {
        const i = o * STRIDE + k, d = i * 4
        r[d] = hash(i, 1)
        r[d + 1] = hash(i, 2)
        r[d + 2] = k === 0 ? 0 : k <= motes ? 1 : -1
        // Spread the lag evenly over the motes drawn, so a thin swarm still has a wake.
        r[d + 3] = k === 0 ? 0 : (k - 1) / Math.max(1, motes - 1)
      }
    }
    this.role.needsUpdate = true
  }
}
