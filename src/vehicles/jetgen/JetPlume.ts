import * as THREE from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'
import { abs, attribute, clamp, dot, float, max, mix, normalView, positionLocal, positionViewDirection, renderGroup, uniform, vec3 } from 'three/tsl'
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
/** Colour of the cones: 0 is the jet's accent colour, 1 is white hot. */
export const jetPlumeHeat = defineParam<number>({ id: 'jet.plumeHeat', label: 'Thrust plume heat (accent to white)', group: 'Jet', scope: 'world', default: .35, min: 0, max: 1, step: .05 })

/** Where a jet's thrust leaves it: rear nozzles (exhaust runs toward +Z) and belly ports (downward). */
export interface PlumeFittings {
  nozzles: readonly { x: number; y: number; z: number; r: number }[]
  ports: readonly { x: number; y: number; z: number; r: number }[]
}

/** Designed cone length in metres per metre of nozzle radius. */
const MAIN_LENGTH = 8, PORT_LENGTH = 4.5

let shared: THREE.Material | undefined
/**
 * One unlit material for every jet's plume. It does not go through the showroom shading on
 * purpose: that falls back to plain lit materials at shading tier 0 and on other players' jets
 * beyond 30 metres, where a plume would become a solid cone. It adds light and holds back part
 * of what is behind it, as the canopy does, so it reads against a bright sky as well as dark
 * ground and does not need bloom. It is compiled with the jet, not at first throttle: the idle
 * glow is always drawn.
 */
function plumeMaterial(): THREE.Material {
  if (shared) return shared
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
  material.name = 'jet plume'; material.fog = false; material.forceSinglePass = true
  // Per vertex: x is the distance along the cone 0..1, y is 0 for a rear nozzle and 1 for a belly port.
  const where: N = attribute('plume', 'vec2')
  // Per jet: length and strength of the rear cones (x, y) and of the belly cones (z, w).
  const state: N = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object?.userData.plume as THREE.Vector4 | undefined)
  const accent: N = uniform(new THREE.Color()).onObjectUpdate(({ object }) => object?.userData.plumeColor as THREE.Color | undefined)
  const setting = (read: () => number): N => uniform(1).setGroup(renderGroup).onRenderUpdate(read)
  const lengthParam = setting(() => jetPlumeLength.value), brightness = setting(() => jetPlumeBrightness.value), heat = setting(() => jetPlumeHeat.value)
  const length: N = mix(state.x, state.z, where.y).mul(lengthParam), strength: N = mix(state.y, state.w, where.y)
  // The cone is modelled one unit long; each vertex carries the vector that stretches it.
  material.positionNode = positionLocal.add((attribute('stretch', 'vec3') as N).mul(length.sub(1)))
  // Keep the accent's hue at full brightness, however dark the player's colour is.
  const hue: N = vec3(accent), tint: N = hue.div(max(max(hue.x, hue.y), max(hue.z, float(.02))))
  const along: N = where.x, fade: N = float(1).sub(along).pow(1.6)
  // Brightest where the view passes through the middle of the cone, soft at its outline.
  const facing: N = clamp(abs(dot(normalView, positionViewDirection)), 0, 1).pow(1.5).mul(.85).add(.15)
  // White hot at the nozzle, cooling to the accent colour down the cone.
  const colour: N = mix(tint, vec3(1), clamp(heat.mul(fade.mul(1.4)), 0, 1))
  const light: N = fade.mul(facing).mul(strength).mul(brightness)
  material.blending = THREE.CustomBlending
  material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor
  material.blendSrcAlpha = THREE.OneFactor; material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  material.colorNode = colour.mul(light).mul(3.2).mul(hotExposureNode())
  material.opacityNode = clamp(light.mul(.55), 0, .65)
  return shared = material
}

function createPlumeGeometry(fittings: PlumeFittings): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const cone = (x: number, y: number, z: number, r: number, port: boolean) => {
    // Starts a little inside the throat, bulges slightly, then tapers to a point.
    const L = r * (port ? PORT_LENGTH : MAIN_LENGTH), stations = [[0, .62], [.1, .7], [.4, .48], [.75, .2], [1, .01]], around = 8
    const rings = stations.map(([s, f]) => Array.from({ length: around }, (_, i) => {
      const a = i / around * Math.PI * 2, u = Math.cos(a) * r * f, v = Math.sin(a) * r * f
      return port ? new THREE.Vector3(x + u, y - s * L, z + v) : new THREE.Vector3(x + u, y + v, z + s * L)
    }))
    const g = loft(rings, false, false), count = g.attributes.position.count, width = around + 1
    const where = new Float32Array(count * 2), stretch = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const s = stations[Math.floor(i / width)][0]
      where[i * 2] = s; where[i * 2 + 1] = port ? 1 : 0
      stretch[i * 3 + (port ? 1 : 2)] = (port ? -1 : 1) * s * L
    }
    g.setAttribute('plume', new THREE.BufferAttribute(where, 2)); g.setAttribute('stretch', new THREE.BufferAttribute(stretch, 3))
    parts.push(g)
  }
  for (const n of fittings.nozzles) cone(n.x, n.y, n.z - .12, n.r, false)
  for (const p of fittings.ports) cone(p.x, p.y + .06, p.z, p.r, true)
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

  constructor(fittings: PlumeFittings) {
    const geometry = fittings === MK2_FITTINGS
      ? (mk2PlumeGeometry ??= createPlumeGeometry(fittings))
      : createPlumeGeometry(fittings)
    this.mesh = new THREE.Mesh(geometry, plumeMaterial())
    this.mesh.name = 'jet-plume'; this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.renderOrder = 2
    this.mesh.userData.plume = this.state; this.mesh.userData.plumeColor = this.colour
  }

  /**
   * @param throttle 0..1
   * @param hover true while the belly ports carry the jet, false in forward flight.
   * A visible idle glow at rest, a strong cone under lift or thrust, a flare near full throttle.
   */
  set(throttle: number, hover: boolean): void {
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
