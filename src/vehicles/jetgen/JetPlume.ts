import * as THREE from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import { abs, attribute, clamp, cos, dot, float, fract, mix, normalView, positionLocal, positionViewDirection, sin, smoothstep, tan, time, uniform, vec3 } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { defineParam } from '../../../shared/params'
import { hotExposureNode } from '../skins/hotExposure'
import { loft } from './shapes'
import { MK2_FITTINGS } from './shipped'

type N = Node<'float'> | Node<'vec2'> | Node<'vec3'> | Node<'vec4'> | any // eslint-disable-line @typescript-eslint/no-explicit-any

/** How long the thrust cones are, as a multiple of their designed length. */
export const jetPlumeLength = defineParam<number>({ id: 'jet.plumeLength', label: 'Thrust plume length', group: 'Jet', scope: 'world', default: 1, min: 0, max: 3, step: .05 })
/** How bright the thrust cones are. 0 hides them. */
export const jetPlumeBrightness = defineParam<number>({ id: 'jet.plumeBrightness', label: 'Thrust plume brightness', group: 'Jet', scope: 'world', default: 1, min: 0, max: 3, step: .05 })
/** How far down the cone the white-hot root reaches, 0 none to 1 a third of its length. */
export const jetPlumeHeat = defineParam<number>({ id: 'jet.plumeHeat', label: 'Thrust plume white-hot root', group: 'Jet', scope: 'world', default: .35, min: 0, max: 1, step: .05 })
/**
 * Hue of the shockwave cones, degrees on the colour wheel: 268 is the original Syn3h's purple
 * (the owner: "more purple shockwave cones than just a white triangle").
 */
export const jetPlumeHue = defineParam<number>({ id: 'jet.plumeHue', label: 'Thrust plume colour (hue)', group: 'Jet', scope: 'world', default: 268, min: 0, max: 360, step: 1 })

/** Where a jet's thrust leaves it: rear nozzles (exhaust runs toward +Z) and belly ports (downward). */
export interface PlumeFittings {
  nozzles: readonly { x: number; y: number; z: number; r: number }[]
  ports: readonly { x: number; y: number; z: number; r: number }[]
}

/**
 * Designed cone length in metres per metre of nozzle radius, at throttle length 1. Full
 * throttle draws 1.3 of it (the owner: full throttle should look about as half did at twice this).
 */
const MAIN_LENGTH = 8, PORT_LENGTH = 5.5
/** The soft outer sheath round each rear cone: its width against the core, and its length. */
const SHEATH_WIDTH = 1.8, SHEATH_LENGTH = .8

let shared: THREE.Material | undefined
/** How far a cone bends with its nozzle, as a share of the nozzle's angle. */
const BEND = .5

/**
 * What makes one vehicle's exhaust its own, all of it per object: one material and one
 * pipeline serve every thruster in the game, whatever it looks like (the owner: "a single
 * thruster shader ... just configurable properties so you have less shaders to compile").
 */
export interface ThrusterLook {
  /** Hue, degrees on the colour wheel. */
  hue: number
  /** Cone length and brightness, as multiples of the design's. */
  length: number; brightness: number
  /** How far down the cone the white-hot root reaches, 0..1. */
  heat: number
  /** Shock diamonds along a full cone, and how hard each pinches it (0 none). */
  diamonds: number; pinch: number
  /** Strength of the soft outer sheath, and how fast the flame flickers (1 the jet's). */
  sheath: number; flicker: number
}
/** The jet's: violet, with shock diamonds. Hue, length, brightness and heat come from the registry. */
const JET_LOOK = { diamonds: 4.5, pinch: .3, sheath: .45, flicker: 1 }
/**
 * One material for every jet's plume: a shockwave cone. A bright core, purple with violet-white
 * shock diamonds that pinch it down its length, white hot at the nozzle, inside a soft violet
 * sheath, all flickering fast. It does not go through the showroom shading on purpose: that
 * falls back to plain lit materials at shading tier 0 and on other players' jets beyond 30
 * metres, where a plume would become a solid cone.
 *
 * Blending is premultiplied (one, one minus source alpha), which carries two layers in one draw:
 * a deep violet core blended normally, which keeps its colour against a noon sky where light
 * that is only added washes out, and the bright diamonds, root and sheath added on top. It is
 * compiled with the jet, not at first throttle: the idle glow is always drawn. Every jet shares
 * it; what differs per jet (throttle, nozzle deflection) arrives as object uniforms.
 */
function plumeMaterial(): THREE.Material {
  if (shared) return shared
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
  material.name = 'thruster'; material.fog = false; material.forceSinglePass = true
  // Per vertex: x is the distance along the cone 0..1, y is 0 for a rear nozzle and 1 for a belly
  // port; which side the nozzle is on (-1 left boom, 0 main, 1 right boom); the offset from the
  // cone's axis, which the diamonds pinch; and 1 on the outer sheath, 0 on the core.
  const where: N = attribute('plume', 'vec2'), side: N = attribute('nozzle', 'float'), radial: N = attribute('radial', 'vec3'), sheath: N = attribute('sheath', 'float')
  // Per jet: length and strength of the rear cones (x, y) and of the belly cones (z, w); and the
  // nozzles' deflection in radians, as NextJet.setVector draws it (pitch, yaw, roll).
  const state: N = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object?.userData.plume as THREE.Vector4 | undefined)
  const vector: N = uniform(new THREE.Vector3()).onObjectUpdate(({ object }) => object?.userData.plumeVector as THREE.Vector3 | undefined)
  // Per object: hue (turns), length, brightness, heat; diamonds, pinch, sheath, flicker rate.
  const look: N = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object?.userData.thrusterLook as THREE.Vector4 | undefined)
  const look2: N = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object?.userData.thrusterShape as THREE.Vector4 | undefined)
  const lengthParam: N = look.y, brightness: N = look.z, heat: N = look.w
  const DIAMONDS: N = look2.x, PINCH: N = look2.y
  // Colours from the hue, in the shader so the hue is a uniform: HSL to RGB.
  const hsl = (dh: number, sat: number, light: number): N => {
    const rgb: N = clamp(abs(fract(look.x.add(dh / 360).add(vec3(0, 2 / 3, 1 / 3))).mul(6).sub(3)).sub(1), 0, 1)
    return rgb.sub(.5).mul(sat * (1 - Math.abs(2 * light - 1))).add(light)
  }
  const core: N = hsl(0, 1, .55), shock: N = hsl(-14, .9, .72), deep: N = hsl(4, 1, .26), glow: N = hsl(10, 1, .48)
  const rear: N = float(1).sub(where.y), inner: N = float(1).sub(sheath)
  const length: N = mix(state.x, state.z, where.y).mul(lengthParam), strength: N = mix(state.y, state.w, where.y)
  const along: N = where.x
  // Shock diamonds: bright, pinched bands down the core, settling in a little after the root.
  const band: N = cos(along.mul(DIAMONDS).mul(Math.PI * 2)).mul(.5).add(.5).pow(6).mul(smoothstep(.06, .2, along)).mul(inner).mul(DIAMONDS.min(1))
  const stretch: N = attribute('stretch', 'vec3') as N
  // The cone is modelled one unit long; each vertex carries the vector that stretches it. It
  // bends with its nozzle: exhaust up for positive pitch, right for positive yaw, and the boom
  // cones opposite ways for roll.
  const reach: N = stretch.length().mul(length)
  // Half the nozzles' own angle: the gas leaves along the deflected nozzle and straightens behind it.
  const bend: N = vec3(tan(vector.y), tan(vector.x.add(vector.z.mul(side))), 0).mul(reach).mul(rear).mul(BEND)
  material.positionNode = positionLocal.add(stretch.mul(length.sub(1))).sub(radial.mul(band.mul(PINCH))).add(bend)
  const fade: N = float(1).sub(along).pow(1.2)
  // Seen from the side the middle of the cone is brightest; seen from behind, up the cone, its
  // walls are edge on, so the diamonds carry it there as nested rings.
  const facing: N = clamp(abs(dot(normalView, positionViewDirection)), 0, 1)
  // A fast, uneven flicker, different on each nozzle.
  const rate: N = time.mul(look2.w)
  const flicker: N = float(1).add(sin(rate.mul(61).add(side.mul(2.1))).mul(.1)).add(sin(rate.mul(37.3).add(along.mul(9)).add(side)).mul(.08))
  const power: N = strength.mul(brightness).mul(flicker)
  // Core: deep violet blended normally (opacity), then purple, the diamonds and a white-hot root added.
  const root: N = float(1).sub(smoothstep(0, heat.mul(.3).add(.03), along))
  const coreAlpha: N = clamp(fade.mul(power).mul(facing.mul(.3).add(.6)), 0, .85).mul(inner)
  const hot: N = mix(mix(vec3(core), vec3(shock), band), vec3(1), root)
  const coreLight: N = fade.mul(power).mul(facing.mul(.6).add(.25).add(band.mul(1.6)).add(root.mul(.8)))
  // Sheath: soft violet added light, fading toward its outline and its tail.
  const sheathLight: N = float(1).sub(along).pow(1.8).mul(facing.pow(2)).mul(power).mul(look2.z).mul(sheath)
  material.blending = THREE.CustomBlending
  material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor
  material.blendSrcAlpha = THREE.OneFactor; material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  const added: N = hot.mul(coreLight).mul(inner).add(vec3(glow).mul(sheathLight)).mul(3).mul(hotExposureNode())
  material.colorNode = vec3(deep).mul(coreAlpha).add(added)
  material.opacityNode = coreAlpha
  return shared = material
}

/** Core radius along a rear cone, as a share of the nozzle's: wider at the root, then to a point. */
const coreProfile = (s: number) => s < .1 ? 1 + 3 * s : 1.3 * Math.pow(1 - (s - .1) / .9, .9)

function createPlumeGeometry(fittings: PlumeFittings): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const cone = (x: number, y: number, z: number, r: number, port: boolean, sheath: boolean) => {
    const full = r * (port ? PORT_LENGTH : MAIN_LENGTH), L = sheath ? full * SHEATH_LENGTH : full
    // Rear cores carry enough stations for the diamonds to pinch; ports and sheaths are smooth.
    const stations: [number, number][] = port ? [[0, .62], [.1, .7], [.4, .48], [.75, .2], [1, .01]]
      // The sheath leaves the nozzle at its own width and spreads behind it, so it never glows on the hull.
      : sheath ? Array.from({ length: 8 }, (_, i) => { const s = i / 7, spread = 1 + (SHEATH_WIDTH - 1) * Math.min(1, s / .25); return [s, spread * Math.max(.02, coreProfile(s)) / coreProfile(0)] as [number, number] })
        : Array.from({ length: 28 }, (_, i) => { const s = i / 27; return [s, Math.max(.01, coreProfile(s))] as [number, number] })
    const around = 10
    const rings = stations.map(([s, f]) => Array.from({ length: around }, (_, i) => {
      const a = i / around * Math.PI * 2, u = Math.cos(a) * r * f, v = Math.sin(a) * r * f
      return port ? new THREE.Vector3(x + u, y - s * L, z + v) : new THREE.Vector3(x + u, y + v, z + s * L)
    }))
    const g = loft(rings, false, false), count = g.attributes.position.count, width = around + 1
    const where = new Float32Array(count * 2), stretch = new Float32Array(count * 3), nozzle = new Float32Array(count), radial = new Float32Array(count * 3), shell = new Float32Array(count)
    const p = g.attributes.position
    for (let i = 0; i < count; i++) {
      const s = stations[Math.floor(i / width)][0]
      where[i * 2] = s; where[i * 2 + 1] = port ? 1 : 0
      stretch[i * 3 + (port ? 1 : 2)] = (port ? -1 : 1) * s * L
      nozzle[i] = Math.abs(x) < .01 ? 0 : Math.sign(x)
      shell[i] = sheath ? 1 : 0
      // Offset from the cone's axis at this station.
      if (port) { radial[i * 3] = p.getX(i) - x; radial[i * 3 + 2] = p.getZ(i) - z } else { radial[i * 3] = p.getX(i) - x; radial[i * 3 + 1] = p.getY(i) - y }
    }
    g.setAttribute('plume', new THREE.BufferAttribute(where, 2)); g.setAttribute('stretch', new THREE.BufferAttribute(stretch, 3))
    g.setAttribute('nozzle', new THREE.BufferAttribute(nozzle, 1)); g.setAttribute('radial', new THREE.BufferAttribute(radial, 3)); g.setAttribute('sheath', new THREE.BufferAttribute(shell, 1))
    parts.push(g)
  }
  for (const n of fittings.nozzles) { cone(n.x, n.y, n.z - .12, n.r, false, false); cone(n.x, n.y, n.z - .12, n.r, false, true) }
  for (const p of fittings.ports) cone(p.x, p.y + .06, p.z, p.r, true, false)
  const geometry = mergeGeometries(parts); parts.forEach(g => g.dispose())
  // The cones stretch in the vertex shader, so cull against their longest reach.
  geometry.computeBoundingSphere(); geometry.boundingSphere!.radius += 3 * Math.max(...fittings.nozzles.map(n => n.r * MAIN_LENGTH), 1)
  return geometry
}

let mk2PlumeGeometry: THREE.BufferGeometry | undefined

/**
 * The jet's thrust plume: a soft cone behind each rear nozzle and under each belly port, drawn
 * as one mesh in one draw at every detail level. Generated; no image, no particles.
 */
export class JetPlume {
  readonly mesh: THREE.Mesh
  private readonly state = new THREE.Vector4(.3, .3, .3, 0)
  private readonly colour = new THREE.Color()
  /** The nozzles' deflection the cones bend with: pitch, yaw, roll in radians (NextJet.setVector). */
  private readonly vector = new THREE.Vector3()
  private readonly look = new THREE.Vector4()
  private readonly shape = new THREE.Vector4()

  constructor(fittings: PlumeFittings) {
    const geometry = fittings === MK2_FITTINGS
      ? (mk2PlumeGeometry ??= createPlumeGeometry(fittings))
      : createPlumeGeometry(fittings)
    this.mesh = new THREE.Mesh(geometry, plumeMaterial())
    this.mesh.name = 'jet-plume'; this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.renderOrder = 2
    this.mesh.userData.plume = this.state; this.mesh.userData.plumeColor = this.colour; this.mesh.userData.plumeVector = this.vector
    this.mesh.userData.thrusterLook = this.look; this.mesh.userData.thrusterShape = this.shape
    this.setLook()
  }

  /** This exhaust's look (ThrusterLook); by default the jet's, from the registry. Cheap: call per frame. */
  setLook(look: ThrusterLook = { hue: jetPlumeHue.value, length: jetPlumeLength.value, brightness: jetPlumeBrightness.value, heat: jetPlumeHeat.value, ...JET_LOOK }): void {
    this.look.set(((look.hue % 360) + 360) % 360 / 360, look.length, look.brightness, look.heat)
    this.shape.set(look.diamonds, look.pinch, look.sheath, look.flicker)
  }

  /** Bend the rear cones with their nozzles: radians, signed as NextJet.setVector. */
  setVector(pitch: number, yaw: number, roll: number): void { this.vector.set(pitch, yaw, roll) }

  /**
   * @param throttle 0..1
   * @param hover true while the belly ports carry the jet, false in forward flight.
   * A visible idle glow at rest, a strong cone under lift or thrust, a flare near full throttle.
   */
  set(throttle: number, hover: boolean): void {
    this.setLook()
    const t = Math.min(1, Math.max(0, throttle)), flare = Math.max(0, (t - .85) / .15)
    const length = .3 + .7 * t + .3 * flare, strength = .35 + 1.1 * t + .6 * flare
    // The rear nozzles idle in hover; the belly ports are shut in flight.
    if (hover) this.state.set(.3, .3, length, strength)
    else this.state.set(length, strength, .3, 0)
  }

  /** What is drawn now: [rear length, rear strength, port length, port strength]. For tests. */
  get levels(): readonly [number, number, number, number] { return [this.state.x, this.state.y, this.state.z, this.state.w] }

  setColor(accent: THREE.ColorRepresentation): void { this.colour.set(accent) }

  dispose(): void {
    this.mesh.removeFromParent()
    if (this.mesh.geometry !== mk2PlumeGeometry) this.mesh.geometry.dispose()
  }
}
